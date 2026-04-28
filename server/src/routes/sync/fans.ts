import { Hono } from "hono";
import { db } from "../../db/client.js";
import {
  accounts, fans, fan_spend, fan_attributions, fan_account_stats,
  tracking_link_ltv, sync_logs,
} from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── auto-migrate: ensure new columns + fan_account_stats table exist ──────────
async function ensureSchema() {
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS username TEXT`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS status TEXT`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS tags TEXT[]`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS notes TEXT`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS total_revenue NUMERIC`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS total_transactions INTEGER`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS first_transaction_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS last_transaction_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS is_cross_poll BOOLEAN`);
  await db.execute(sql`ALTER TABLE fans ADD COLUMN IF NOT EXISTS acquired_via_account_id UUID REFERENCES accounts(id)`);
  // Unique constraint on fan_spend so we can upsert per fan per account
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_fan_spend_fan_account'
      ) THEN
        ALTER TABLE fan_spend ADD CONSTRAINT uq_fan_spend_fan_account UNIQUE(fan_id, account_id);
      END IF;
    END $$
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fan_account_stats (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fan_id               UUID NOT NULL REFERENCES fans(id) ON DELETE CASCADE,
      account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      total_revenue        NUMERIC DEFAULT '0',
      total_transactions   INTEGER DEFAULT 0,
      subscription_revenue NUMERIC DEFAULT '0',
      tip_revenue          NUMERIC DEFAULT '0',
      message_revenue      NUMERIC DEFAULT '0',
      post_revenue         NUMERIC DEFAULT '0',
      first_transaction_at TIMESTAMPTZ,
      last_transaction_at  TIMESTAMPTZ,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(fan_id, account_id)
    )
  `);
}

// ── bootstrap: build fan profiles from fan_spend + fan_attributions ───────────
async function bootstrapFromSpend(send: (data: any) => any) {
  // 1. Diagnose all source tables so we know exactly what data exists
  const diagResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM fan_attributions)                                                            AS attr_total,
      (SELECT COUNT(*) FROM fan_attributions WHERE fan_id IS NOT NULL AND fan_id != '')                  AS attr_valid,
      (SELECT COUNT(*) FROM fan_spend)                                                                   AS spend_total,
      (SELECT COUNT(*) FROM fan_spend WHERE fan_id IS NOT NULL AND fan_id != '')                         AS spend_valid,
      (SELECT COUNT(*) FROM fans)                                                                        AS fans_total
  `);
  const diag = (diagResult.rows[0] as any) ?? {};
  const totalAttr = Number(diag.attr_valid ?? 0);
  const totalSpend = Number(diag.spend_valid ?? 0);
  const diagMsg = `fan_attributions: ${diag.attr_total} rows (${diag.attr_valid} valid fan_ids) · fan_spend: ${diag.spend_total} rows (${diag.spend_valid} valid) · fans: ${diag.fans_total} rows`;
  await send({ step: "count", message: diagMsg });

  if (totalAttr === 0 && totalSpend === 0) {
    await send({ step: "warn", message: `No source data found. ${diagMsg}. Run a Dashboard Sync first.` });
    return { upsertedFans: 0, upsertedStats: 0, failedFans: 0, diagMsg };
  }

  // 2. Load all fan_spend grouped by fan_id
  await send({ step: "load_spend", message: "Loading fan spend data..." });
  const spendRows = await db
    .select({
      fan_id: fan_spend.fan_id,
      account_id: fan_spend.account_id,
      revenue: fan_spend.revenue,
      calculated_at: fan_spend.calculated_at,
    })
    .from(fan_spend);

  const spendByFan = new Map<string, { total: number; accounts: Map<string, { revenue: number; calc_at: Date | null }> }>();
  for (const row of spendRows) {
    const fid = row.fan_id ?? "";
    if (!fid) continue;
    if (!spendByFan.has(fid)) spendByFan.set(fid, { total: 0, accounts: new Map() });
    const entry = spendByFan.get(fid)!;
    const rev = Number(row.revenue ?? 0);
    entry.total += rev;
    const accId = String(row.account_id ?? "");
    if (accId) {
      const existing = entry.accounts.get(accId) ?? { revenue: 0, calc_at: null };
      existing.revenue += rev;
      if (row.calculated_at && (!existing.calc_at || new Date(row.calculated_at) > existing.calc_at)) {
        existing.calc_at = new Date(row.calculated_at);
      }
      entry.accounts.set(accId, existing);
    }
  }

  // 3. Load all fan_attributions for usernames + subscribe dates
  await send({ step: "load_attr", message: "Loading fan attributions..." });
  const attrRows = await db
    .select({
      fan_id: fan_attributions.fan_id,
      fan_username: fan_attributions.fan_username,
      account_id: fan_attributions.account_id,
      subscribe_date_approx: fan_attributions.subscribe_date_approx,
    })
    .from(fan_attributions);

  const attrByFan = new Map<string, { username: string | null; first_date: Date | null; first_account_id: string | null; account_ids: Set<string> }>();
  for (const row of attrRows) {
    const fid = row.fan_id ?? "";
    if (!fid) continue;
    if (!attrByFan.has(fid)) attrByFan.set(fid, { username: null, first_date: null, first_account_id: null, account_ids: new Set() });
    const entry = attrByFan.get(fid)!;
    if (row.fan_username && !entry.username) entry.username = row.fan_username;
    if (row.subscribe_date_approx) {
      const d = new Date(row.subscribe_date_approx);
      if (!entry.first_date || d < entry.first_date) {
        entry.first_date = d;
        entry.first_account_id = row.account_id ? String(row.account_id) : null;
      }
    }
    if (row.account_id) entry.account_ids.add(String(row.account_id));
  }

  // 4. Collect all unique fan_ids from both sources and UPSERT into fans table
  const allFanIds = new Set<string>([...attrByFan.keys(), ...spendByFan.keys()]);
  const fanIdArray = [...allFanIds];
  await send({ step: "persist", message: `Upserting ${fanIdArray.length} fan profiles...` });

  let upsertedFans = 0;
  let upsertedStats = 0;
  let failedFans = 0;
  let firstError: string | null = null;

  const BATCH = 100;
  for (let i = 0; i < fanIdArray.length; i += BATCH) {
    const batch = fanIdArray.slice(i, i + BATCH);

    for (const fanId of batch) {
      const spend = spendByFan.get(fanId);
      const attr = attrByFan.get(fanId);

      const totalRevenue = spend?.total ?? 0;
      const spentAccountIds = [...(spend?.accounts.keys() ?? [])];
      const isCrossPoll = spentAccountIds.length > 1;

      const firstDate = attr?.first_date ?? null;
      let lastDate: Date | null = null;
      for (const acc of spend?.accounts.values() ?? []) {
        if (acc.calc_at && (!lastDate || acc.calc_at > lastDate)) lastDate = acc.calc_at;
      }

      try {
        // UPSERT — no acquired_via_account_id to avoid FK violations; that can be set in a separate pass
        const result = await db.insert(fans).values({
          fan_id: fanId,
          username: attr?.username ?? null,
          total_revenue: String(totalRevenue),
          total_transactions: spentAccountIds.length,
          first_transaction_at: firstDate,
          last_transaction_at: lastDate,
          is_cross_poll: isCrossPoll,
          first_subscribe_date: firstDate ? firstDate.toISOString().split("T")[0] : null,
        }).onConflictDoUpdate({
          target: fans.fan_id,
          set: {
            username: attr?.username ?? null,
            total_revenue: String(totalRevenue),
            total_transactions: spentAccountIds.length,
            first_transaction_at: firstDate,
            last_transaction_at: lastDate,
            is_cross_poll: isCrossPoll,
            updated_at: new Date(),
          },
        }).returning({ id: fans.id });

        const fanUuid = result[0]?.id;
        upsertedFans++;

        if (spend && fanUuid) {
          for (const [accountId, accData] of spend.accounts.entries()) {
            try {
              await db.insert(fan_account_stats).values({
                fan_id: fanUuid,
                account_id: accountId,
                total_revenue: String(accData.revenue),
                total_transactions: 1,
                updated_at: new Date(),
                last_transaction_at: accData.calc_at,
              }).onConflictDoUpdate({
                target: [fan_account_stats.fan_id, fan_account_stats.account_id],
                set: {
                  total_revenue: String(accData.revenue),
                  last_transaction_at: accData.calc_at,
                  updated_at: new Date(),
                },
              });
              upsertedStats++;
            } catch (err: any) {
              console.error(`[FanSync] fan_account_stats error: ${err.message}`);
            }
          }
        }
      } catch (err: any) {
        failedFans++;
        if (!firstError) firstError = `${fanId}: ${err.message}`;
        console.error(`[FanSync] fan upsert error for ${fanId}: ${err.message}`);
      }
    }

    if (i % 500 === 0 && i > 0) {
      await send({ step: "progress", message: `Processed ${i}/${fanIdArray.length} fans (${upsertedFans} ok, ${failedFans} failed)...` });
    }
  }

  if (failedFans > 0) {
    await send({ step: "warn", message: `${failedFans} fan upserts failed. First error: ${firstError}` });
  }

  return { upsertedFans, upsertedStats, failedFans, diagMsg: "" };
}

// Update tracking_link_ltv cross-poll data
async function updateCrosspollLtv() {
  const rows = await db.execute(sql`
    SELECT
      f.first_subscribe_link_id                                                         AS tracking_link_id,
      tl.account_id                                                                     AS link_account_id,
      tl.campaign_name,
      tl.external_tracking_link_id,
      COUNT(DISTINCT f.id)                                                              AS fans_total,
      COUNT(DISTINCT CASE WHEN fs.account_id::text != tl.account_id::text THEN f.id END) AS cross_poll_fans,
      COALESCE(SUM(CASE WHEN fs.account_id::text != tl.account_id::text THEN fs.revenue::numeric ELSE 0 END), 0) AS cross_poll_revenue
    FROM fans f
    JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
    LEFT JOIN fan_spend fs ON fs.fan_id = f.fan_id
    WHERE f.first_subscribe_link_id IS NOT NULL
      AND tl.deleted_at IS NULL
      AND tl.external_tracking_link_id IS NOT NULL
    GROUP BY f.first_subscribe_link_id, tl.account_id, tl.campaign_name, tl.external_tracking_link_id
  `);

  const results = rows.rows as any[];
  let updated = 0;

  for (const row of results) {
    const crossFans = Number(row.cross_poll_fans ?? 0);
    const crossRevenue = Number(row.cross_poll_revenue ?? 0);
    const fansTotal = Number(row.fans_total ?? 0);
    const avgPerFan = crossFans > 0 ? Math.round(crossRevenue / crossFans * 100) / 100 : 0;
    const conversionPct = fansTotal > 0 ? Math.round(crossFans / fansTotal * 10000) / 100 : 0;
    const trackingLinkIdStr = String(row.tracking_link_id);

    const [existing] = await db
      .select({ id: tracking_link_ltv.id })
      .from(tracking_link_ltv)
      .where(eq(tracking_link_ltv.tracking_link_id, trackingLinkIdStr))
      .limit(1);

    if (existing) {
      await db.update(tracking_link_ltv).set({
        new_subs_total: fansTotal,
        cross_poll_fans: crossFans,
        cross_poll_revenue: String(crossRevenue),
        cross_poll_avg_per_fan: String(avgPerFan),
        cross_poll_conversion_pct: String(conversionPct),
        updated_at: new Date(),
      }).where(eq(tracking_link_ltv.id, existing.id));
    } else {
      await db.insert(tracking_link_ltv).values({
        tracking_link_id: trackingLinkIdStr,
        external_tracking_link_id: String(row.external_tracking_link_id),
        account_id: String(row.link_account_id),
        new_subs_total: fansTotal,
        cross_poll_fans: crossFans,
        cross_poll_revenue: String(crossRevenue),
        cross_poll_avg_per_fan: String(avgPerFan),
        cross_poll_conversion_pct: String(conversionPct),
      });
    }
    updated++;
  }

  return updated;
}

// ── POST /sync/fans/bootstrap ─────────────────────────────────────────────────
router.post("/bootstrap", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `fan_bootstrap_${triggeredBy}`,
    message: "Fan bootstrap started", records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    try {
      await send({ step: "migrate", message: "Ensuring schema is up to date..." });
      await ensureSchema();

      await send({ step: "start", message: "Building fan profiles from fan_spend + fan_attributions..." });
      const { upsertedFans, upsertedStats, failedFans, diagMsg } = await bootstrapFromSpend(send);

      await send({ step: "crosspoll", message: "Updating cross-poll LTV..." });
      const ltvUpdated = await updateCrosspollLtv();

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: "success", success: true, finished_at: now, completed_at: now,
          records_processed: upsertedFans,
          message: `Bootstrap: ${upsertedFans} fans, ${upsertedStats} stats, ${ltvUpdated} LTV links${failedFans ? ` (${failedFans} failed)` : ""}. ${diagMsg}`,
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `Done — ${upsertedFans} fans updated, ${upsertedStats} account stats, ${ltvUpdated} LTV links` });
    } catch (err: any) {
      if (syncLogId) {
        await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

// ── Extract fan identity from transaction description HTML ────────────────────
// description format: "Payment for message from <a href="https://onlyfans.com/USERNAME">Display Name</a>"
function parseFanFromDescription(description: string | null | undefined): { fan_id: string; username: string; display_name: string } | null {
  if (!description) return null;
  const match = description.match(/href="https?:\/\/onlyfans\.com\/([^"]+)">([^<]+)<\/a>/i);
  if (!match) return null;
  const username = match[1].trim();
  const display_name = match[2].trim();
  if (!username) return null;
  return { fan_id: username, username, display_name };
}

// ── POST /sync/fans ───────────────────────────────────────────────────────────
router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `fan_sync_${triggeredBy}`,
    message: "Fan sync started", records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    const errors: string[] = [];       // data errors → partial
    const authErrors: string[] = [];   // 401/403 → warning only, not partial

    try {
      await send({ step: "migrate", message: "Ensuring schema..." });
      await ensureSchema();

      // ── Incremental sync cutoff: find last successful/partial fan sync ────────
      const lastSyncRow = await db.execute(sql`
        SELECT started_at FROM sync_logs
        WHERE triggered_by LIKE 'fan_sync_%'
          AND (success = true OR (status = 'partial' AND records_processed > 0))
        ORDER BY started_at DESC LIMIT 1
      `);
      const lastSyncRaw = (lastSyncRow.rows[0] as any)?.started_at;
      // Apply a 2-day overlap to avoid missing transactions near the boundary
      const cutoffDate: Date | null = lastSyncRaw
        ? new Date(new Date(lastSyncRaw).getTime() - 2 * 24 * 60 * 60 * 1000)
        : null;

      const enabledAccounts = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(eq(accounts.is_active, true));

      const mode = cutoffDate ? `incremental from ${cutoffDate.toISOString().split("T")[0]}` : "full historical";
      await send({ step: "start", message: `${enabledAccounts.length} accounts — ${mode}` });

      let totalTxProcessed = 0;

      // Per-account result tracking — stored in sync log details for visibility
      type AccountResult = { account: string; status: "ok" | "auth_error" | "error" | "skipped"; fans: number; pages: number; note?: string };
      const accountResults: AccountResult[] = [];

      // Global map: fanId → aggregated data across all accounts
      type FanEntry = { revenue: number; username: string; display_name: string; first_date: string | null; last_date: string | null; byAccount: Map<string, number> };
      const globalFanMap = new Map<string, FanEntry>();

      // ── Phase 1: fetch transactions, stop when hitting old data ──────────────
      for (const account of enabledAccounts) {
        if (!account.onlyfans_account_id) {
          accountResults.push({ account: account.display_name ?? account.id, status: "skipped", fans: 0, pages: 0, note: "no onlyfans_account_id" });
          continue;
        }
        try {
          const perAccountMap = new Map<string, { revenue: number; username: string; display_name: string; first_date: string | null; last_date: string | null }>();

          let url: string | null = `${API_BASE}/${account.onlyfans_account_id}/transactions?limit=100`;
          let apiCalls = 0;
          let hitCutoff = false;
          let accountStatus: AccountResult["status"] = "ok";
          let accountNote: string | undefined;

          while (url && apiCalls < 500 && !hitCutoff) {
            apiCalls++;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });

            if (res.status === 429) {
              const retryAfter = Number(res.headers.get("Retry-After") ?? 15);
              await sleep(retryAfter * 1000);
              apiCalls--;
              continue;
            }
            if (res.status === 401 || res.status === 403) {
              accountStatus = "auth_error";
              accountNote = `HTTP ${res.status} — check API credentials for this account`;
              authErrors.push(`${account.display_name}: HTTP ${res.status} (check API credentials for this account)`);
              break;
            }
            if (!res.ok) {
              accountStatus = "error";
              accountNote = `HTTP ${res.status}`;
              errors.push(`${account.display_name}: HTTP ${res.status}`);
              break;
            }

            const json = await res.json() as any;
            const page: any[] = json?.data?.list ?? json?.data ?? json?.transactions ?? json?.list ?? [];
            if (!Array.isArray(page) || page.length === 0) break;

            for (const tx of page) {
              // Stop early if this tx predates the last sync (API returns newest-first)
              if (cutoffDate) {
                const txRaw = tx.createdAt ?? tx.date;
                if (txRaw && new Date(txRaw) < cutoffDate) { hitCutoff = true; break; }
              }

              totalTxProcessed++;
              const fan = parseFanFromDescription(tx.description);
              if (!fan) continue;
              const revenue = Number(tx.amount ?? tx.revenue ?? 0);
              const dateStr: string | null = tx.createdAt ? String(tx.createdAt).split("T")[0] : (tx.date ? String(tx.date).split("T")[0] : null);
              const ex = perAccountMap.get(fan.fan_id);
              if (ex) {
                ex.revenue += revenue;
                if (dateStr) {
                  if (!ex.first_date || dateStr < ex.first_date) ex.first_date = dateStr;
                  if (!ex.last_date  || dateStr > ex.last_date)  ex.last_date  = dateStr;
                }
              } else {
                perAccountMap.set(fan.fan_id, { revenue, username: fan.username, display_name: fan.display_name, first_date: dateStr, last_date: dateStr });
              }
            }

            const nextPage = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
            url = nextPage ?? null;
            await sleep(150);
          }

          accountResults.push({ account: account.display_name ?? account.id, status: accountStatus, fans: perAccountMap.size, pages: apiCalls, note: accountNote ?? (hitCutoff ? "stopped at cutoff (incremental)" : undefined) });
          await send({ step: "account_done", message: `${account.display_name}: ${accountStatus === "auth_error" ? "⚠ skipped (auth error)" : accountStatus === "error" ? `⚠ error (${accountNote})` : `${perAccountMap.size} fans from ${apiCalls} pages`}` });

          // Merge into global map
          for (const [fanId, data] of perAccountMap.entries()) {
            const g = globalFanMap.get(fanId);
            if (g) {
              g.revenue += data.revenue;
              if (data.first_date && (!g.first_date || data.first_date < g.first_date)) g.first_date = data.first_date;
              if (data.last_date  && (!g.last_date  || data.last_date  > g.last_date))  g.last_date  = data.last_date;
              g.byAccount.set(account.id, (g.byAccount.get(account.id) ?? 0) + data.revenue);
            } else {
              globalFanMap.set(fanId, { revenue: data.revenue, username: data.username, display_name: data.display_name, first_date: data.first_date, last_date: data.last_date, byAccount: new Map([[account.id, data.revenue]]) });
            }
          }
        } catch (err: any) {
          accountResults.push({ account: account.display_name ?? account.id, status: "error", fans: 0, pages: 0, note: err.message });
          errors.push(`${account.display_name}: ${err.message}`);
        }
      }

      const totalUniqueFans = globalFanMap.size;
      await send({ step: "persist", message: `Writing ${totalUniqueFans} fan profiles in batches...` });

      // ── Phase 2: batch upsert fans (100 at a time) ────────────────────────────
      const BATCH = 100;
      const fanEntries = [...globalFanMap.entries()];
      let upsertedFans = 0;

      for (let i = 0; i < fanEntries.length; i += BATCH) {
        const batch = fanEntries.slice(i, i + BATCH);
        await db.insert(fans).values(batch.map(([fanId, d]) => ({
          fan_id: fanId,
          username: d.username,
          display_name: d.display_name,
          total_revenue: String(d.revenue),
          first_transaction_at: d.first_date ? new Date(d.first_date) : null,
          last_transaction_at:  d.last_date  ? new Date(d.last_date)  : null,
          is_cross_poll: d.byAccount.size > 1,
        }))).onConflictDoUpdate({
          target: fans.fan_id,
          set: {
            username:            sql`EXCLUDED.username`,
            display_name:        sql`EXCLUDED.display_name`,
            total_revenue:       sql`EXCLUDED.total_revenue`,
            last_transaction_at: sql`EXCLUDED.last_transaction_at`,
            is_cross_poll:       sql`EXCLUDED.is_cross_poll`,
            updated_at:          sql`NOW()`,
          },
        });
        upsertedFans += batch.length;
      }

      // ── Phase 3: batch upsert fan_spend (100 at a time) ──────────────────────
      const spendEntries: [string, string, number][] = [];
      for (const [fanId, d] of globalFanMap.entries()) {
        for (const [accountId, revenue] of d.byAccount.entries()) {
          spendEntries.push([fanId, accountId, revenue]);
        }
      }

      for (let i = 0; i < spendEntries.length; i += BATCH) {
        const batch = spendEntries.slice(i, i + BATCH);
        const vals = batch.map(([fanId, accountId, revenue]) =>
          sql`(${fanId}, ${accountId}::uuid, ${String(revenue)}::numeric, NOW())`
        );
        await db.execute(sql`
          INSERT INTO fan_spend (fan_id, account_id, revenue, calculated_at)
          VALUES ${sql.join(vals, sql`, `)}
          ON CONFLICT (fan_id, account_id)
          DO UPDATE SET revenue = EXCLUDED.revenue, calculated_at = EXCLUDED.calculated_at
        `);
      }

      await send({ step: "crosspoll", message: "Updating cross-poll data..." });
      const ltvUpdated = await updateCrosspollLtv();

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: errors.length > 0 ? "partial" : "success",
          success: errors.length === 0,
          finished_at: now, completed_at: now,
          records_processed: upsertedFans,
          message: `${upsertedFans} fan profiles (${mode}) — ${totalTxProcessed} transactions processed${errors.length ? `. Errors: ${errors.slice(0, 3).join("; ")}` : ""}${authErrors.length ? `. Auth issues (skipped): ${authErrors.map(e => e.split(":")[0]).join(", ")}` : ""}`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
          details: { tx_processed: totalTxProcessed, unique_fans: totalUniqueFans, profiles_built: upsertedFans, ltv_links: ltvUpdated, account_results: accountResults },
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `Done — ${upsertedFans} fans, ${totalTxProcessed} transactions processed`, errors: errors.length > 0 ? errors : undefined, auth_warnings: authErrors.length > 0 ? authErrors : undefined });
    } catch (err: any) {
      if (syncLogId) {
        await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

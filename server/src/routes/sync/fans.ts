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
  // 1. Count source data — fan_attributions is the source of truth (NOT fans table which may be empty)
  const spendCountResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM fan_spend`);
  const attrCountResult = await db.execute(sql`SELECT COUNT(DISTINCT fan_id) as cnt FROM fan_attributions WHERE fan_id IS NOT NULL AND fan_id != ''`);
  const totalSpend = Number((spendCountResult.rows[0] as any)?.cnt ?? 0);
  const totalAttr = Number((attrCountResult.rows[0] as any)?.cnt ?? 0);
  await send({ step: "count", message: `${totalAttr} unique fans in attributions · ${totalSpend} spend rows` });

  if (totalAttr === 0 && totalSpend === 0) {
    await send({ step: "warn", message: "No fan data found — run a Dashboard Sync first to populate fan data" });
    return { upsertedFans: 0, upsertedStats: 0 };
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

  const BATCH = 100;
  for (let i = 0; i < fanIdArray.length; i += BATCH) {
    const batch = fanIdArray.slice(i, i + BATCH);

    for (const fanId of batch) {
      const spend = spendByFan.get(fanId);
      const attr = attrByFan.get(fanId);

      const totalRevenue = spend?.total ?? 0;
      const spentAccountIds = [...(spend?.accounts.keys() ?? [])];
      const acquiredAccountId = attr?.first_account_id ?? (spentAccountIds[0] ?? null);
      const isCrossPoll = spentAccountIds.length > 1 ||
        (acquiredAccountId != null && spentAccountIds.length === 1 && spentAccountIds[0] !== acquiredAccountId);

      const firstDate = attr?.first_date ?? null;
      let lastDate: Date | null = null;
      for (const acc of spend?.accounts.values() ?? []) {
        if (acc.calc_at && (!lastDate || acc.calc_at > lastDate)) lastDate = acc.calc_at;
      }

      try {
        // UPSERT — creates new fan rows if they don't exist, updates if they do
        const result = await db.insert(fans).values({
          fan_id: fanId,
          username: attr?.username ?? null,
          total_revenue: String(totalRevenue),
          total_transactions: spentAccountIds.length,
          first_transaction_at: firstDate,
          last_transaction_at: lastDate,
          is_cross_poll: isCrossPoll,
          acquired_via_account_id: acquiredAccountId,
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
            acquired_via_account_id: acquiredAccountId,
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
        console.error(`[FanSync] fan upsert error for ${fanId}: ${err.message}`);
      }
    }

    if (i % 500 === 0 && i > 0) {
      await send({ step: "progress", message: `Processed ${i}/${fanIdArray.length} fans...` });
    }
  }

  return { upsertedFans, upsertedStats };
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
      const { upsertedFans, upsertedStats } = await bootstrapFromSpend(send);

      await send({ step: "crosspoll", message: "Updating cross-poll LTV..." });
      const ltvUpdated = await updateCrosspollLtv();

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: "success", success: true, finished_at: now, completed_at: now,
          records_processed: upsertedFans,
          message: `Bootstrap: ${upsertedFans} fans, ${upsertedStats} stats, ${ltvUpdated} LTV links`,
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

// ── POST /sync/fans ───────────────────────────────────────────────────────────
// Attempts OF API for new transactions, then re-runs bootstrap aggregation
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
    const errors: string[] = [];

    try {
      await send({ step: "migrate", message: "Ensuring schema..." });
      await ensureSchema();

      const enabledAccounts = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(eq(accounts.is_active, true));

      await send({ step: "start", message: `Fetching transactions for ${enabledAccounts.length} accounts...` });

      let newTransactions = 0;

      for (const account of enabledAccounts) {
        try {
          let page = 1;
          let hasMore = true;
          let accountTx = 0;

          while (hasMore && page <= 50) {
            const url = `${API_BASE}/${account.onlyfans_account_id}/transactions?limit=200&page=${page}`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            });

            if (!res.ok) {
              if (res.status !== 404) errors.push(`${account.display_name}: HTTP ${res.status}`);
              hasMore = false;
              break;
            }

            const data = await res.json() as any;
            const list: any[] = Array.isArray(data) ? data : (data?.data?.list ?? data?.data ?? []);
            if (!list.length) { hasMore = false; break; }

            // Store raw transactions for future use (best-effort)
            for (const tx of list) {
              try {
                const { transactions } = await import("../../db/schema.js");
                const extId = String(tx.id ?? tx.transactionId ?? "");
                if (!extId) continue;
                const fanId = String(tx.userId ?? tx.user_id ?? tx.fanId ?? tx.fan_id ?? "");
                await db.insert(transactions).values({
                  account_id: account.id,
                  user_id: fanId || null,
                  fan_id: fanId || null,
                  fan_username: tx.username ?? tx.fan_username ?? null,
                  date: String(tx.date ?? tx.createdAt ?? "").split("T")[0] || null,
                  type: tx.type ?? null,
                  revenue: String(Number(tx.amount ?? tx.revenue ?? 0)),
                  revenue_net: String(Number(tx.net ?? tx.revenue_net ?? 0)),
                  fee: String(Number(tx.fee ?? 0)),
                  currency: tx.currency ?? "USD",
                  status: tx.status ?? "success",
                  external_transaction_id: extId,
                }).onConflictDoNothing();
                newTransactions++;
                accountTx++;
              } catch {}
            }

            const nextPage = data?._meta?._pagination?.next_page ?? null;
            if (!nextPage || list.length < 200) hasMore = false;
            else page++;
            await sleep(300);
          }
          if (accountTx > 0) await send({ step: "account_done", message: `${account.display_name}: ${accountTx} transactions` });
        } catch (err: any) {
          errors.push(`${account.display_name}: ${err.message}`);
        }
      }

      // Always re-run bootstrap aggregation so fan profiles stay current
      await send({ step: "aggregate", message: `Re-aggregating fan profiles (${newTransactions} new API transactions)...` });
      const { upsertedFans, upsertedStats } = await bootstrapFromSpend(send);

      await send({ step: "crosspoll", message: "Updating cross-poll LTV..." });
      const ltvUpdated = await updateCrosspollLtv();

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: errors.length > 0 ? "partial" : "success",
          success: errors.length === 0,
          finished_at: now, completed_at: now,
          records_processed: upsertedFans,
          message: `${upsertedFans} fans updated, ${ltvUpdated} LTV links${newTransactions > 0 ? `, ${newTransactions} new transactions` : ""}`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `Sync complete — ${upsertedFans} fans`, errors: errors.length > 0 ? errors : undefined });
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

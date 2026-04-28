import { Hono } from "hono";
import { db } from "../../db/client.js";
import {
  accounts, fans, transactions, fan_account_stats,
  tracking_links, tracking_link_ltv, sync_logs,
} from "../../db/schema.js";
import { eq, sql, and, inArray } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── helpers ───────────────────────────────────────────────────────────────────

function classifyType(type: string | null | undefined): "subscription" | "tip" | "message" | "post" | "other" {
  const t = (type ?? "").toLowerCase();
  if (t.includes("subscri")) return "subscription";
  if (t.includes("tip")) return "tip";
  if (t.includes("message") || t.includes("chat")) return "message";
  if (t.includes("post") || t.includes("media")) return "post";
  return "other";
}

interface FanAgg {
  fan_id: string;
  username: string | null;
  total_revenue: number;
  total_transactions: number;
  first_tx: Date | null;
  last_tx: Date | null;
  // per account_id → per-type revenue
  per_account: Record<string, {
    total_revenue: number;
    total_transactions: number;
    subscription_revenue: number;
    tip_revenue: number;
    message_revenue: number;
    post_revenue: number;
    first_tx: Date | null;
    last_tx: Date | null;
  }>;
}

// Aggregate raw transactions into fan-level objects
async function buildFanAggregates(accountIds?: string[]): Promise<FanAgg[]> {
  const where = accountIds?.length
    ? inArray(transactions.account_id, accountIds)
    : undefined;

  const rows = await db
    .select({
      fan_id: transactions.fan_id,
      fan_username: transactions.fan_username,
      account_id: transactions.account_id,
      type: transactions.type,
      revenue: transactions.revenue,
      date: transactions.date,
    })
    .from(transactions)
    .where(where);

  const map = new Map<string, FanAgg>();

  for (const row of rows) {
    const fid = row.fan_id ?? "";
    if (!fid) continue;

    if (!map.has(fid)) {
      map.set(fid, {
        fan_id: fid,
        username: row.fan_username ?? null,
        total_revenue: 0,
        total_transactions: 0,
        first_tx: null,
        last_tx: null,
        per_account: {},
      });
    }
    const agg = map.get(fid)!;
    if (row.fan_username && !agg.username) agg.username = row.fan_username;

    const rev = Number(row.revenue ?? 0);
    agg.total_revenue += rev;
    agg.total_transactions++;

    const txDate = row.date ? new Date(row.date) : null;
    if (txDate) {
      if (!agg.first_tx || txDate < agg.first_tx) agg.first_tx = txDate;
      if (!agg.last_tx || txDate > agg.last_tx) agg.last_tx = txDate;
    }

    const accId = row.account_id ?? "";
    if (!agg.per_account[accId]) {
      agg.per_account[accId] = {
        total_revenue: 0, total_transactions: 0,
        subscription_revenue: 0, tip_revenue: 0,
        message_revenue: 0, post_revenue: 0,
        first_tx: null, last_tx: null,
      };
    }
    const pa = agg.per_account[accId];
    pa.total_revenue += rev;
    pa.total_transactions++;
    if (txDate) {
      if (!pa.first_tx || txDate < pa.first_tx) pa.first_tx = txDate;
      if (!pa.last_tx || txDate > pa.last_tx) pa.last_tx = txDate;
    }
    const cls = classifyType(row.type);
    if (cls === "subscription") pa.subscription_revenue += rev;
    else if (cls === "tip") pa.tip_revenue += rev;
    else if (cls === "message") pa.message_revenue += rev;
    else if (cls === "post") pa.post_revenue += rev;
  }

  return Array.from(map.values());
}

// Upsert fans + fan_account_stats from aggregated data
async function persistFans(aggs: FanAgg[], accountUuidMap: Record<string, string>) {
  // Fetch existing fans to know their UUIDs
  const existingFanIds = new Set((await db.select({ fan_id: fans.fan_id }).from(fans)).map(r => r.fan_id));

  // Fetch first_subscribe_link_id data to determine acquired_via_account_id
  const fanLinkRows = await db
    .select({ fan_id: fans.fan_id, first_subscribe_link_id: fans.first_subscribe_link_id })
    .from(fans)
    .where(sql`first_subscribe_link_id IS NOT NULL`);

  const linkIdSet = [...new Set(fanLinkRows.map(r => r.first_subscribe_link_id).filter(Boolean) as string[])];
  const linkAccountMap: Record<string, string> = {};
  if (linkIdSet.length > 0) {
    const linkRows = await db
      .select({ id: tracking_links.id, account_id: tracking_links.account_id })
      .from(tracking_links)
      .where(inArray(tracking_links.id, linkIdSet));
    for (const r of linkRows) {
      if (r.account_id) linkAccountMap[r.id] = r.account_id;
    }
  }
  const fanAcquiredMap: Record<string, string> = {};
  for (const r of fanLinkRows) {
    if (r.first_subscribe_link_id && linkAccountMap[r.first_subscribe_link_id]) {
      fanAcquiredMap[r.fan_id] = linkAccountMap[r.first_subscribe_link_id];
    }
  }

  let upsertedFans = 0;
  let upsertedStats = 0;

  for (const agg of aggs) {
    // Determine cross-poll: spent on multiple accounts OR different from acquired account
    const spentAccounts = Object.keys(agg.per_account).filter(a => agg.per_account[a].total_revenue > 0);
    const acquiredAccountId = fanAcquiredMap[agg.fan_id] ?? null;
    const isCrossPoll = spentAccounts.length > 1 || (acquiredAccountId != null && spentAccounts.length === 1 && spentAccounts[0] !== acquiredAccountId);

    const updateSet: Record<string, any> = {
      username: agg.username,
      total_revenue: String(agg.total_revenue),
      total_transactions: agg.total_transactions,
      first_transaction_at: agg.first_tx,
      last_transaction_at: agg.last_tx,
      is_cross_poll: isCrossPoll,
      acquired_via_account_id: acquiredAccountId,
      updated_at: new Date(),
    };

    if (!existingFanIds.has(agg.fan_id)) {
      await db.insert(fans).values({
        fan_id: agg.fan_id,
        ...updateSet,
      }).onConflictDoUpdate({ target: fans.fan_id, set: updateSet });
    } else {
      await db.update(fans).set(updateSet).where(eq(fans.fan_id, agg.fan_id));
    }
    upsertedFans++;

    // Fetch the fan's UUID
    const [fanRow] = await db.select({ id: fans.id }).from(fans).where(eq(fans.fan_id, agg.fan_id)).limit(1);
    if (!fanRow) continue;

    // Upsert per-account stats
    for (const [accountUuid, pa] of Object.entries(agg.per_account)) {
      if (!accountUuid) continue;
      try {
        await db.insert(fan_account_stats).values({
          fan_id: fanRow.id,
          account_id: accountUuid,
          total_revenue: String(pa.total_revenue),
          total_transactions: pa.total_transactions,
          subscription_revenue: String(pa.subscription_revenue),
          tip_revenue: String(pa.tip_revenue),
          message_revenue: String(pa.message_revenue),
          post_revenue: String(pa.post_revenue),
          first_transaction_at: pa.first_tx,
          last_transaction_at: pa.last_tx,
          updated_at: new Date(),
        }).onConflictDoUpdate({
          target: [fan_account_stats.fan_id, fan_account_stats.account_id],
          set: {
            total_revenue: String(pa.total_revenue),
            total_transactions: pa.total_transactions,
            subscription_revenue: String(pa.subscription_revenue),
            tip_revenue: String(pa.tip_revenue),
            message_revenue: String(pa.message_revenue),
            post_revenue: String(pa.post_revenue),
            first_transaction_at: pa.first_tx,
            last_transaction_at: pa.last_tx,
            updated_at: new Date(),
          },
        });
        upsertedStats++;
      } catch (err: any) {
        console.error(`[FanSync] fan_account_stats upsert error for fan ${agg.fan_id}: ${err.message}`);
      }
    }
  }

  return { upsertedFans, upsertedStats };
}

// Update tracking_link_ltv cross-poll data (same logic as old crosspoll route)
async function updateCrosspollLtv() {
  const rows = await db.execute(sql`
    SELECT
      f.first_subscribe_link_id                                                      AS tracking_link_id,
      tl.account_id                                                                  AS link_account_id,
      tl.campaign_name,
      tl.external_tracking_link_id,
      COUNT(DISTINCT f.id)                                                           AS fans_total,
      COUNT(DISTINCT CASE WHEN t.account_id::text != tl.account_id::text THEN f.id END) AS cross_poll_fans,
      COALESCE(SUM(CASE WHEN t.account_id::text != tl.account_id::text THEN t.revenue::numeric ELSE 0 END), 0) AS cross_poll_revenue
    FROM fans f
    JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
    LEFT JOIN transactions t ON t.fan_id = f.fan_id
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

    const [existing] = await db.select({ id: tracking_link_ltv.id }).from(tracking_link_ltv).where(eq(tracking_link_ltv.tracking_link_id, trackingLinkIdStr)).limit(1);
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
// Derives fan records from existing transactions table (no OF API calls)
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
      // Auto-apply schema changes so no manual SQL migration is required
      await send({ step: "migrate", message: "Ensuring schema is up to date..." });
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

      await send({ step: "start", message: "Reading existing transactions..." });

      const txCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM transactions`);
      const totalTx = Number(txCount.rows[0]?.cnt ?? 0);
      await send({ step: "count", message: `Found ${totalTx} transactions` });

      await send({ step: "aggregate", message: "Aggregating fan data..." });
      const aggs = await buildFanAggregates();
      await send({ step: "aggregated", message: `${aggs.length} unique fans found` });

      await send({ step: "persist", message: "Upserting fans and account stats..." });
      const { upsertedFans, upsertedStats } = await persistFans(aggs, {});
      await send({ step: "persisted", message: `${upsertedFans} fans, ${upsertedStats} account-stat rows` });

      await send({ step: "crosspoll", message: "Updating cross-poll LTV..." });
      const ltvUpdated = await updateCrosspollLtv();
      await send({ step: "crosspoll_done", message: `${ltvUpdated} links updated` });

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: "success", success: true, finished_at: now, completed_at: now,
          records_processed: upsertedFans,
          message: `Bootstrap: ${upsertedFans} fans, ${upsertedStats} stats, ${ltvUpdated} LTV links`,
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `Bootstrap complete`, fans: upsertedFans, stats: upsertedStats, ltv: ltvUpdated });
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
// Fetches new transactions from OF API, then re-aggregates all fans
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
    let newTransactions = 0;
    const errors: string[] = [];

    try {
      const enabledAccounts = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(eq(accounts.is_active, true));

      await send({ step: "start", message: `Syncing transactions for ${enabledAccounts.length} accounts...` });

      for (const account of enabledAccounts) {
        try {
          await send({ step: "account", message: `Fetching transactions for ${account.display_name}...` });

          // Paginate through OF API transactions endpoint
          let page = 1;
          let hasMore = true;
          let accountTx = 0;

          while (hasMore && page <= 50) {
            const url = `${API_BASE}/${account.onlyfans_account_id}/transactions?limit=200&page=${page}`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            });

            if (!res.ok) {
              if (res.status === 404) {
                // Endpoint might not exist for this account — skip silently
                hasMore = false;
                break;
              }
              errors.push(`${account.display_name}: HTTP ${res.status}`);
              hasMore = false;
              break;
            }

            const data = await res.json() as any;
            const list: any[] = Array.isArray(data) ? data : (data?.data?.list ?? data?.data ?? []);

            if (!list.length) { hasMore = false; break; }

            for (const tx of list) {
              const extId = String(tx.id ?? tx.transactionId ?? "");
              if (!extId) continue;

              const fanId = String(tx.userId ?? tx.user_id ?? tx.fanId ?? tx.fan_id ?? "");
              const fanUsername = tx.username ?? tx.fan_username ?? tx.fanUsername ?? null;
              const txType = tx.type ?? tx.transactionType ?? null;
              const revenue = Number(tx.amount ?? tx.revenue ?? tx.total ?? 0);
              const revenueNet = Number(tx.net ?? tx.revenue_net ?? revenue * 0.8);
              const fee = Number(tx.fee ?? 0);
              const currency = tx.currency ?? "USD";
              const status = tx.status ?? "success";
              const rawDate = tx.date ?? tx.createdAt ?? tx.created_at ?? null;
              const txDate = rawDate ? String(rawDate).split("T")[0] : new Date().toISOString().split("T")[0];

              try {
                await db.insert(transactions).values({
                  account_id: account.id,
                  user_id: fanId || null,
                  fan_id: fanId || null,
                  fan_username: fanUsername,
                  date: txDate,
                  type: txType,
                  revenue: String(revenue),
                  revenue_net: String(revenueNet),
                  fee: String(fee),
                  currency,
                  status,
                  external_transaction_id: extId,
                }).onConflictDoNothing();
                newTransactions++;
                accountTx++;
              } catch {}
            }

            // Check for next page
            const nextPage = data?._meta?._pagination?.next_page ?? data?._pagination?.next_page ?? null;
            if (!nextPage || list.length < 200) { hasMore = false; } else { page++; }
            await sleep(300);
          }

          await send({ step: "account_done", message: `${account.display_name}: ${accountTx} new transactions` });
        } catch (err: any) {
          errors.push(`${account.display_name}: ${err.message}`);
          await send({ step: "account_error", message: `${account.display_name} failed: ${err.message}` });
        }
      }

      await send({ step: "aggregate", message: `Aggregating all fans (${newTransactions} new transactions)...` });
      const aggs = await buildFanAggregates();

      await send({ step: "persist", message: `Persisting ${aggs.length} fans...` });
      const { upsertedFans, upsertedStats } = await persistFans(aggs, {});

      await send({ step: "crosspoll", message: "Updating cross-poll LTV..." });
      const ltvUpdated = await updateCrosspollLtv();

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: errors.length > 0 ? "partial" : "success",
          success: errors.length === 0,
          finished_at: now, completed_at: now,
          records_processed: upsertedFans,
          message: `${newTransactions} new transactions, ${upsertedFans} fans, ${ltvUpdated} LTV links`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
        }).where(eq(sync_logs.id, syncLogId));
      }

      await send({ step: "done", message: `Sync complete`, new_transactions: newTransactions, fans: upsertedFans, ltv: ltvUpdated, errors: errors.length > 0 ? errors : undefined });
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

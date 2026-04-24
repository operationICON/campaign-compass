import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, transactions, fan_spend, fans, sync_logs } from "../../db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";
import { cancelFlags } from "../../lib/cancelFlags.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllTransactions(ofAccountId: string, apiKey: string): Promise<{ items: any[]; apiCalls: number }> {
  const items: any[] = [];
  let url: string | null = `/${ofAccountId}/transactions?limit=100`;
  let apiCalls = 0;
  while (url && apiCalls < 500) {
    apiCalls++;
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`OF API ${res.status} for account ${ofAccountId}`);
    const json = await res.json() as any;
    const page: any[] = json?.data?.list ?? json?.data ?? json?.transactions ?? json?.list ?? [];
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    const nextPage = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
    url = nextPage ?? null;
    await sleep(300);
  }
  return { items, apiCalls };
}

function mapType(raw: string | undefined | null): keyof typeof BUCKETS {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("message") || t === "ppv" || t === "chat") return "messages";
  if (t.includes("tip")) return "tips";
  if (t.includes("subscription") || t.includes("sub")) return "subscriptions";
  if (t.includes("post")) return "posts";
  return "other";
}

const BUCKETS = { messages: 0, tips: 0, subscriptions: 0, posts: 0, other: 0 };

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `revenue_breakdown_sync_${triggeredBy}`,
    message: "Revenue sync started", records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    let totalTx = 0;
    let totalApiCalls = 0;
    let accountsUpdated = 0;
    const errors: string[] = [];

    try {
      const accountList = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(eq(accounts.is_active, true));

      await send({ step: "start", message: `Syncing transactions for ${accountList.length} accounts...` });

      for (const account of accountList) {
        if (syncLogId && cancelFlags.get(syncLogId)) {
          cancelFlags.delete(syncLogId);
          await send({ step: "cancelled", message: "Sync cancelled by user" });
          return;
        }
        if (!account.onlyfans_account_id) continue;
        try {
          await send({ step: "fetching", message: `Fetching ${account.display_name}...` });
          const { items: txList, apiCalls } = await fetchAllTransactions(account.onlyfans_account_id, apiKey);
          totalApiCalls += apiCalls;
          await send({ step: "fetched", message: `${account.display_name}: ${txList.length} transactions (${apiCalls} API calls)` });

          // Upsert transactions in batches
          for (let i = 0; i < txList.length; i += 100) {
            const batch = txList.slice(i, i + 100);
            const values = batch.map((tx: any) => {
              const fanId = String(tx.userId ?? tx.user_id ?? tx.fanId ?? tx.fan_id ?? "");
              const extId = tx.id ? String(tx.id) : `${account.onlyfans_account_id}_${tx.date ?? ""}_${fanId}_${tx.type ?? ""}_${tx.amount ?? tx.revenue ?? 0}`;
              return {
                account_id: account.id,
                user_id: fanId,
                fan_id: fanId,
                fan_username: tx.userUsername ?? tx.fanUsername ?? tx.username ?? null,
                date: tx.date ? String(tx.date).split("T")[0] : null,
                type: tx.type ?? null,
                revenue: String(Number(tx.amount ?? tx.revenue ?? 0)),
                revenue_net: (tx.amountNet ?? tx.revenueNet ?? tx.netAmount) != null ? String(tx.amountNet ?? tx.revenueNet ?? tx.netAmount) : null,
                fee: tx.fee != null ? String(tx.fee) : null,
                currency: tx.currency ?? "USD",
                status: tx.status ?? null,
                external_transaction_id: extId,
              };
            });
            await db.insert(transactions)
              .values(values)
              .onConflictDoUpdate({
                target: transactions.external_transaction_id,
                set: {
                  revenue: sql`excluded.revenue`,
                  status: sql`excluded.status`,
                  type: sql`excluded.type`,
                  fan_username: sql`excluded.fan_username`,
                },
              });
            totalTx += batch.length;
          }

          // Rebuild fan_spend for this account from transactions
          const fanSpendAgg = await db.execute(sql`
            SELECT fan_id, SUM(revenue::numeric) AS total
            FROM transactions
            WHERE account_id = ${account.id}
              AND fan_id IS NOT NULL AND fan_id != ''
            GROUP BY fan_id
          `);
          const aggRows = fanSpendAgg.rows as { fan_id: string; total: string }[];

          if (aggRows.length > 0) {
            // Look up first_subscribe_link_id from fans table
            const fanIds = aggRows.map(r => r.fan_id);
            const fanLinkMap: Record<string, string | null> = {};
            for (let i = 0; i < fanIds.length; i += 500) {
              const batch = fanIds.slice(i, i + 500);
              const linkRows = await db
                .select({ fan_id: fans.fan_id, first_subscribe_link_id: fans.first_subscribe_link_id })
                .from(fans)
                .where(inArray(fans.fan_id, batch));
              for (const r of linkRows) fanLinkMap[r.fan_id] = r.first_subscribe_link_id ?? null;
            }

            // Delete existing fan_spend for this account, then re-insert
            await db.execute(sql`DELETE FROM fan_spend WHERE account_id = ${account.id}`);

            const spendValues = aggRows.map(r => ({
              fan_id: r.fan_id,
              account_id: account.id,
              tracking_link_id: fanLinkMap[r.fan_id] ?? null,
              revenue: String(r.total),
              calculated_at: new Date(),
            }));
            for (let i = 0; i < spendValues.length; i += 500) {
              await db.insert(fan_spend).values(spendValues.slice(i, i + 500));
            }
          }

          // Update account LTV breakdown from transactions
          const typeAgg = await db.execute(sql`
            SELECT type, COALESCE(SUM(revenue::numeric), 0) AS total
            FROM transactions
            WHERE account_id = ${account.id}
            GROUP BY type
          `);
          const breakdown = { ...BUCKETS };
          for (const row of typeAgg.rows as any[]) {
            const bucket = mapType(row.type);
            breakdown[bucket] += Number(row.total ?? 0);
          }
          const ltvTotal = breakdown.messages + breakdown.tips + breakdown.subscriptions + breakdown.posts + breakdown.other;

          await db.update(accounts).set({
            ltv_messages:      String(breakdown.messages),
            ltv_tips:          String(breakdown.tips),
            ltv_subscriptions: String(breakdown.subscriptions),
            ltv_posts:         String(breakdown.posts),
            ltv_total:         String(ltvTotal),
            ltv_updated_at:    new Date(),
          }).where(eq(accounts.id, account.id));

          accountsUpdated++;
          await send({ step: "account_done", message: `${account.display_name}: ${txList.length} tx, $${ltvTotal.toFixed(2)} total LTV` });
        } catch (err: any) {
          errors.push(`${account.display_name}: ${err.message}`);
          await send({ step: "account_error", message: `${account.display_name}: ${err.message}` });
        }
      }

      if (syncLogId) await db.update(sync_logs).set({
        status: errors.length > 0 ? "partial" : "success",
        success: errors.length === 0,
        finished_at: new Date(), completed_at: new Date(),
        records_processed: totalTx,
        message: `${totalTx} transactions synced, ${accountsUpdated} accounts updated`,
        error_message: errors.length > 0 ? errors.join("; ") : null,
        details: { api_calls: totalApiCalls },
      }).where(eq(sync_logs.id, syncLogId));

      await send({ step: "done", message: `${totalTx} transactions synced, ${accountsUpdated} accounts updated`, transactions_synced: totalTx, accounts_updated: accountsUpdated, api_calls: totalApiCalls, errors: errors.length });
    } catch (err: any) {
      if (syncLogId) await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, syncLogId));
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

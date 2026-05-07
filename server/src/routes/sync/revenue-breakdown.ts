import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, transactions, sync_logs } from "../../db/schema.js";
import { eq, sql, and, like } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";
import { cancelFlags } from "../../lib/cancelFlags.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTransactions(ofAccountId: string, apiKey: string, afterDate?: string): Promise<{ items: any[]; apiCalls: number }> {
  const items: any[] = [];
  // If we have a known latest date, only pull transactions after that — far fewer API calls
  const dateParam = afterDate ? `&after=${afterDate}` : "";
  let url: string | null = `/${ofAccountId}/transactions?limit=100${dateParam}`;
  let apiCalls = 0;
  while (url && apiCalls < 500) {
    apiCalls++;
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? 15);
      await sleep(retryAfter * 1000);
      apiCalls--;
      continue;
    }
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
  const forceFull: boolean = !!body.force_full;

  // Clean up stuck previous runs
  const stuckRows = await db
    .select({ id: sync_logs.id })
    .from(sync_logs)
    .where(and(eq(sync_logs.status, "running"), like(sync_logs.triggered_by, "%revenue_breakdown%")));
  for (const row of stuckRows) {
    cancelFlags.set(row.id, true);
    await db.update(sync_logs).set({
      status: "error", success: false, finished_at: new Date(), completed_at: new Date(),
      error_message: "Superseded by new run",
    }).where(eq(sync_logs.id, row.id));
  }

  const { stream, send, close } = createSSEStream();

  // Parent log — stays "running" for the duration so cancel.ts can find and flag it
  const [parentLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `revenue_breakdown_sync_${triggeredBy}`,
    message: forceFull ? "Revenue breakdown FULL HISTORY scan started" : "Revenue breakdown sync started",
    records_processed: 0,
  }).returning();
  const parentLogId = parentLog?.id;

  (async () => {
    let totalTx = 0;
    let totalApiCalls = 0;
    let accountsUpdated = 0;
    const errors: string[] = [];
    const authErrors: string[] = [];
    type AccountRevResult = { account: string; status: string; transactions: number; api_calls: number; note?: string };
    const accountResults: AccountRevResult[] = [];

    try {
      const accountList = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(and(eq(accounts.is_active, true), sql`accounts.sync_excluded IS NOT TRUE`));

      await send({ step: "start", message: `Syncing ${accountList.length} accounts...` });

      for (const account of accountList) {
        // Check cancel on the parent log before starting each account
        if (parentLogId && cancelFlags.get(parentLogId)) {
          cancelFlags.delete(parentLogId);
          await db.update(sync_logs).set({
            status: "error", success: false, finished_at: new Date(), completed_at: new Date(),
            error_message: "Cancelled by user",
            records_processed: totalTx,
            accounts_synced: accountsUpdated,
          }).where(eq(sync_logs.id, parentLogId));
          await send({ step: "cancelled", message: "Sync cancelled by user" });
          return;
        }

        if (!account.onlyfans_account_id) continue;

        // Create a per-account sync log so it shows up individually in the logs UI
        const [accountLog] = await db.insert(sync_logs).values({
          account_id: account.id,
          started_at: new Date(), status: "running", success: false,
          triggered_by: `revenue_breakdown_sync_${triggeredBy}`,
          message: `Syncing ${account.display_name}`,
          records_processed: 0,
        }).returning();
        const accountLogId = accountLog?.id;

        try {
          // Find the latest transaction date we already have — only fetch newer ones (unless force_full)
          let latestDate: string | null = null;
          if (!forceFull) {
            const latestRow = await db.execute(sql`
              SELECT MAX(date) AS latest FROM transactions WHERE account_id = ${account.id}
            `);
            latestDate = (latestRow.rows[0] as any)?.latest as string | null;
          }
          const isIncremental = !!latestDate;

          await send({ step: "fetching", message: `Fetching ${account.display_name}${forceFull ? " (FULL HISTORY SCAN)" : isIncremental ? ` (incremental from ${latestDate})` : " (full scan)"}...` });
          const { items: txList, apiCalls } = await fetchTransactions(account.onlyfans_account_id, apiKey, latestDate ?? undefined);
          totalApiCalls += apiCalls;
          await send({ step: "fetched", message: `${account.display_name}: ${txList.length} transactions (${apiCalls} API calls${isIncremental ? ", incremental" : ", full scan"})` });

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

          // Update account LTV breakdown
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
          accountResults.push({ account: account.display_name ?? account.id, status: "ok", transactions: txList.length, api_calls: apiCalls, note: `$${ltvTotal.toFixed(2)}` });

          // Mark this account's log as success
          if (accountLogId) {
            await db.update(sync_logs).set({
              status: "success", success: true,
              finished_at: new Date(), completed_at: new Date(),
              records_processed: txList.length,
              message: `${account.display_name}: ${txList.length} tx · $${ltvTotal.toFixed(2)}`,
            }).where(eq(sync_logs.id, accountLogId));
          }

          await send({ step: "account_done", message: `${account.display_name}: ${txList.length} tx · $${ltvTotal.toFixed(2)}` });
        } catch (err: any) {
          const is401 = /\b401\b/.test(err.message);
          accountResults.push({ account: account.display_name ?? account.id, status: is401 ? "auth_error" : "error", transactions: 0, api_calls: 0, note: err.message });
          if (is401) {
            authErrors.push(`${account.display_name ?? account.id}: credentials expired (401)`);
          } else {
            errors.push(`${account.display_name}: ${err.message}`);
          }
          await send({ step: "account_error", message: `${account.display_name}: ${is401 ? "credentials expired (401) — renew in OFT Settings" : err.message}` });
          if (accountLogId) {
            await db.update(sync_logs).set({
              status: is401 ? "auth_error" : "error", success: false,
              finished_at: new Date(), completed_at: new Date(),
              error_message: is401 ? "Credentials expired — renew account connection in OFT Settings" : err.message,
              message: `${account.display_name}: ${is401 ? "credentials expired" : "failed"}`,
            }).where(eq(sync_logs.id, accountLogId));
          }
        }
      }

      // Mark parent log done — 401 auth errors don't downgrade to partial
      const hasDataErrors = errors.length > 0;
      const allErrorMessages = [
        ...errors,
        ...(authErrors.length > 0 ? [`${authErrors.length} account(s) need credential renewal: ${authErrors.join(", ")}`] : []),
      ];
      if (parentLogId) {
        await db.update(sync_logs).set({
          status: hasDataErrors ? "partial" : "success",
          success: !hasDataErrors,
          finished_at: new Date(), completed_at: new Date(),
          records_processed: totalTx,
          accounts_synced: accountsUpdated,
          message: `${accountsUpdated} accounts · ${totalTx} transactions synced${authErrors.length > 0 ? ` · ${authErrors.length} credential error(s)` : ""}`,
          error_message: allErrorMessages.length > 0 ? allErrorMessages.join("; ") : null,
          details: { api_calls: totalApiCalls, account_results: accountResults },
        }).where(eq(sync_logs.id, parentLogId));
      }

      await send({ step: "done", message: `${totalTx} transactions synced, ${accountsUpdated} accounts updated${authErrors.length > 0 ? `, ${authErrors.length} credential error(s)` : ""}`, transactions_synced: totalTx, accounts_updated: accountsUpdated, api_calls: totalApiCalls, errors: errors.length, auth_errors: authErrors.length });
    } catch (err: any) {
      if (parentLogId) {
        await db.update(sync_logs).set({
          status: "error", success: false,
          finished_at: new Date(), completed_at: new Date(),
          error_message: err.message,
        }).where(eq(sync_logs.id, parentLogId));
      }
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

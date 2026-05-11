import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, daily_snapshots, sync_logs } from "../../db/schema.js";
import { eq, isNull, isNotNull, or, gt, sql, and } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";
const DELAY_MS = 200;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// POST /sync/snapshots — daily snapshot sync (runs automatically at 02:00 UTC via scheduler)
// Fetches yesterday (complete day) + today (current progress) in one API call per link.
// Critical: at 02:00 UTC "today" is only 2 hrs old — yesterday is the complete day we must capture.
router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";

  const now = new Date();
  const DATE_TODAY = now.toISOString().split("T")[0];
  const DATE_YESTERDAY = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
  // Fetch yesterday + today in one call: yesterday captures the complete prior day,
  // today keeps current-day progress live so the dashboard isn't stale.
  const DATE_START = DATE_YESTERDAY;
  const DATE_END = DATE_TODAY;

  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(),
    status: "running",
    success: false,
    triggered_by: `snapshot_sync_${triggeredBy}`,
    message: `Snapshot sync: ${DATE_YESTERDAY} → ${DATE_TODAY}`,
    records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    let totalSaved = 0, totalErrors = 0, apiCalls = 0;
    type AccountSnapshotResult = { account: string; links: number; snapshots: number; api_calls: number; errors: number };
    const accountResults: AccountSnapshotResult[] = [];
    try {
      await send({ step: "start", message: `Syncing snapshots ${DATE_START} → ${DATE_END}...` });

      const accountList = await db.select().from(accounts).where(and(eq(accounts.is_active, true), sql`accounts.sync_excluded IS NOT TRUE`));
      await send({ step: "accounts", message: `Found ${accountList.length} accounts`, total: accountList.length });

      for (const acct of accountList) {
        if (!acct.onlyfans_account_id) continue;
        await send({ step: "account", message: `${acct.display_name}...` });

        const links: any[] = [];
        let offset = 0;
        while (true) {
          const batch = await db.select({
            id: tracking_links.id,
            external_tracking_link_id: tracking_links.external_tracking_link_id,
          })
          .from(tracking_links)
          .where(and(
            eq(tracking_links.account_id, acct.id),
            isNull(tracking_links.deleted_at),
            isNotNull(tracking_links.external_tracking_link_id),
            or(gt(tracking_links.clicks, 0), gt(tracking_links.subscribers, 0)),
          ))
          .limit(100).offset(offset);
          if (!batch.length) break;
          links.push(...batch);
          if (batch.length < 100) break;
          offset += 100;
        }

        let acctSaved = 0, acctErrors = 0, acctCalls = 0;

        for (const link of links) {
          try {
            const statsUrl = `${API_BASE}/${acct.onlyfans_account_id}/tracking-links/${link.external_tracking_link_id}/stats?date_start=${DATE_START}&date_end=${DATE_END}`;
            const res = await fetch(statsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
            apiCalls++;
            acctCalls++;
            if (!res.ok) { totalErrors++; acctErrors++; await sleep(DELAY_MS); continue; }

            const json = await res.json() as any;
            const daily: any[] = json?.data?.daily_metrics ?? [];

            const rows = daily
              .filter((d: any) => Number(d.clicks ?? 0) > 0 || Number(d.subs ?? 0) > 0 || Number(d.revenue ?? 0) > 0)
              .map((d: any) => ({
                tracking_link_id: link.id,
                account_id: acct.id,
                external_tracking_link_id: link.external_tracking_link_id!,
                snapshot_date: d.timestamp,
                clicks: Number(d.clicks ?? 0),
                subscribers: Number(d.subs ?? 0),
                revenue: String(d.revenue ?? 0),
                raw_clicks: Number(d.clicks ?? 0),
                raw_subscribers: Number(d.subs ?? 0),
                raw_revenue: String(d.revenue ?? 0),
                synced_at: new Date(),
              }));

            if (rows.length > 0) {
              await db.insert(daily_snapshots).values(rows).onConflictDoUpdate({
                target: [daily_snapshots.tracking_link_id, daily_snapshots.snapshot_date],
                set: {
                  clicks: sql`excluded.clicks`,
                  subscribers: sql`excluded.subscribers`,
                  revenue: sql`excluded.revenue`,
                  raw_clicks: sql`excluded.raw_clicks`,
                  raw_subscribers: sql`excluded.raw_subscribers`,
                  raw_revenue: sql`excluded.raw_revenue`,
                  synced_at: sql`excluded.synced_at`,
                },
              });
              totalSaved += rows.length;
              acctSaved += rows.length;
            }
          } catch { totalErrors++; acctErrors++; }
          await sleep(DELAY_MS);
        }

        accountResults.push({ account: acct.display_name ?? acct.id, links: links.length, snapshots: acctSaved, api_calls: acctCalls, errors: acctErrors });
        if (syncLogId) {
          await db.update(sync_logs).set({ records_processed: totalSaved, message: `${acct.display_name} done — ${acctSaved} rows from ${links.length} links` }).where(eq(sync_logs.id, syncLogId));
        }
      }

      const done = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: totalErrors > 0 && totalSaved === 0 ? "error" : "success",
          success: totalSaved > 0 || totalErrors === 0,
          finished_at: done, completed_at: done,
          records_processed: totalSaved,
          message: `${totalSaved} snapshots saved (${DATE_START}→${DATE_END}), ${apiCalls} API calls`,
          error_message: totalErrors > 0 ? `${totalErrors} errors` : null,
          details: { api_calls: apiCalls, account_results: accountResults },
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `${totalSaved} snapshots saved`, snapshots_saved: totalSaved, api_calls: apiCalls, errors: totalErrors });
    } catch (err: any) {
      if (syncLogId) {
        await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message, message: `Fatal: ${err.message}` }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

// POST /sync/snapshots/backfill — fetches current month + previous month for all links
router.post("/backfill", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";

  const now = new Date();
  const DATE_END = now.toISOString().split("T")[0];
  // Accept explicit date_start for full-history backfills; default = first of prev month
  const DATE_START = body.date_start
    ? String(body.date_start)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];

  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `snapshot_backfill_${triggeredBy}`,
    message: `Snapshot backfill: ${DATE_START} → ${DATE_END}`,
    records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    let totalSaved = 0, totalErrors = 0, apiCalls = 0;
    try {
      await send({ step: "start", message: `Backfilling ${DATE_START} → ${DATE_END}` });

      const accountList = await db.select().from(accounts).where(and(eq(accounts.is_active, true), sql`accounts.sync_excluded IS NOT TRUE`));
      await send({ step: "accounts", message: `${accountList.length} accounts`, total: accountList.length });

      const accountResults: any[] = [];

      for (const acct of accountList) {
        if (!acct.onlyfans_account_id) continue;
        await send({ step: "account", message: `${acct.display_name}...` });

        let acctSaved = 0, acctErrors = 0;

        try {
          const links: any[] = [];
          let offset = 0;
          while (true) {
            const batch = await db.select({
              id: tracking_links.id,
              external_tracking_link_id: tracking_links.external_tracking_link_id,
            })
            .from(tracking_links)
            .where(and(
              eq(tracking_links.account_id, acct.id),
              isNull(tracking_links.deleted_at),
              isNotNull(tracking_links.external_tracking_link_id),
            ))
            .limit(100).offset(offset);
            if (!batch.length) break;
            links.push(...batch);
            if (batch.length < 100) break;
            offset += 100;
          }

          for (const link of links) {
            try {
              const statsUrl = `${API_BASE}/${acct.onlyfans_account_id}/tracking-links/${link.external_tracking_link_id}/stats?date_start=${DATE_START}&date_end=${DATE_END}`;
              const res = await fetch(statsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
              apiCalls++;
              if (!res.ok) { acctErrors++; totalErrors++; await sleep(DELAY_MS); continue; }

              const json = await res.json() as any;
              const daily: any[] = json?.data?.daily_metrics ?? [];

              const rows = daily
                .filter((d: any) => (d.clicks || 0) > 0 || (d.subs || 0) > 0 || (d.revenue || 0) > 0)
                .map((d: any) => ({
                  tracking_link_id: link.id,
                  account_id: acct.id,
                  external_tracking_link_id: link.external_tracking_link_id!,
                  snapshot_date: d.timestamp,
                  clicks: d.clicks || 0,
                  subscribers: d.subs || 0,
                  revenue: String(d.revenue || 0),
                  raw_clicks: d.clicks || 0,
                  raw_subscribers: d.subs || 0,
                  raw_revenue: String(d.revenue || 0),
                  synced_at: new Date(),
                }));

              if (rows.length > 0) {
                await db.insert(daily_snapshots).values(rows).onConflictDoUpdate({
                  target: [daily_snapshots.tracking_link_id, daily_snapshots.snapshot_date],
                  set: {
                    clicks: sql`excluded.clicks`,
                    subscribers: sql`excluded.subscribers`,
                    revenue: sql`excluded.revenue`,
                    raw_clicks: sql`excluded.raw_clicks`,
                    raw_subscribers: sql`excluded.raw_subscribers`,
                    raw_revenue: sql`excluded.raw_revenue`,
                    synced_at: sql`excluded.synced_at`,
                  },
                });
                totalSaved += rows.length;
                acctSaved += rows.length;
              }
            } catch { acctErrors++; totalErrors++; }
            await sleep(DELAY_MS);
          }

          accountResults.push({ account: acct.display_name, saved: acctSaved, errors: acctErrors });
        } catch (acctErr: any) {
          // Isolate per-account failures — one broken account doesn't stop the rest
          totalErrors++;
          accountResults.push({ account: acct.display_name, saved: 0, errors: 1, fatal: acctErr.message });
          await send({ step: "account_error", message: `${acct.display_name} skipped: ${acctErr.message}` });
        }

        if (syncLogId) {
          await db.update(sync_logs).set({ records_processed: totalSaved, message: `${acct.display_name} done — ${totalSaved} rows saved so far` }).where(eq(sync_logs.id, syncLogId));
        }
      }

      const nowDone = new Date();
      const failedAccounts = accountResults.filter((r: any) => r.errors > 0 || r.fatal).map((r: any) => r.account);
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: totalErrors > 0 && totalSaved === 0 ? "error" : "success",
          success: totalSaved > 0 || totalErrors === 0,
          finished_at: nowDone, completed_at: nowDone,
          records_processed: totalSaved,
          message: `Backfill complete: ${totalSaved} rows, ${apiCalls} API calls`,
          error_message: failedAccounts.length > 0 ? `${totalErrors} errors (accounts with issues: ${failedAccounts.join(", ")})` : null,
          details: { api_calls: apiCalls, account_results: accountResults },
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `${totalSaved} rows saved`, snapshots_saved: totalSaved, api_calls: apiCalls, errors: totalErrors, failed_accounts: failedAccounts });
    } catch (err: any) {
      if (syncLogId) {
        await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message, message: `Fatal: ${err.message}` }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

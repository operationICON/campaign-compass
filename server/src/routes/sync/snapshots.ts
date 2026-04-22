import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, daily_snapshots, sync_logs } from "../../db/schema.js";
import { eq, isNull, isNotNull, or, gt, sql, and, lt, desc } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";
const DELAY_MS = 200;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const TODAY = new Date().toISOString().split("T")[0];

  const { stream, send, close } = createSSEStream();

  // Create sync log
  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(),
    status: "running",
    success: false,
    triggered_by: `snapshot_sync_${triggeredBy}`,
    message: `Snapshot sync started for ${TODAY}`,
    records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    let totalSaved = 0, totalErrors = 0, apiCalls = 0;
    try {
      await send({ step: "start", message: `Syncing snapshots for ${TODAY}...` });

      const accountList = await db.select().from(accounts).where(eq(accounts.is_active, true));
      await send({ step: "accounts", message: `Found ${accountList.length} accounts`, total: accountList.length });

      for (const acct of accountList) {
        await send({ step: "account", message: `${acct.display_name}...` });

        // Get active links (paginated)
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
            or(gt(tracking_links.clicks, 0), gt(tracking_links.subscribers, 0)),
          ))
          .limit(100).offset(offset);
          if (!batch.length) break;
          links.push(...batch.filter(l => !!l.external_tracking_link_id));
          if (batch.length < 100) break;
          offset += 100;
        }

        for (const link of links) {
          try {
            const statsUrl = `${API_BASE}/${acct.onlyfans_account_id}/tracking-links/${link.external_tracking_link_id}/stats?date_start=${TODAY}&date_end=${TODAY}`;
            const res = await fetch(statsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
            apiCalls++;
            if (!res.ok) { totalErrors++; await sleep(DELAY_MS); continue; }

            const json = await res.json() as any;
            const dayData = (json?.data?.daily_metrics ?? []).find((d: any) => d.timestamp === TODAY);
            if (!dayData) { await sleep(DELAY_MS); continue; }

            const currentClicks = Number(dayData.clicks ?? 0);
            const currentSubs = Number(dayData.subs ?? 0);
            const currentRevenue = Number(dayData.revenue ?? 0);

            const [baseline] = await db.select({
              raw_clicks: daily_snapshots.raw_clicks,
              raw_subscribers: daily_snapshots.raw_subscribers,
              raw_revenue: daily_snapshots.raw_revenue,
            })
            .from(daily_snapshots)
            .where(and(eq(daily_snapshots.tracking_link_id, link.id), lt(daily_snapshots.snapshot_date, TODAY)))
            .orderBy(desc(daily_snapshots.snapshot_date))
            .limit(1);

            const incClicks = baseline ? Math.max(currentClicks - (baseline.raw_clicks ?? 0), 0) : 0;
            const incSubs = baseline ? Math.max(currentSubs - (baseline.raw_subscribers ?? 0), 0) : 0;
            const incRevenue = baseline ? Math.max(currentRevenue - Number(baseline.raw_revenue ?? 0), 0) : 0;

            await db.insert(daily_snapshots).values({
              tracking_link_id: link.id,
              account_id: acct.id,
              external_tracking_link_id: link.external_tracking_link_id!,
              snapshot_date: TODAY,
              clicks: incClicks,
              subscribers: incSubs,
              revenue: String(incRevenue),
              raw_clicks: currentClicks,
              raw_subscribers: currentSubs,
              raw_revenue: String(currentRevenue),
              synced_at: new Date(),
            }).onConflictDoUpdate({
              target: [daily_snapshots.tracking_link_id, daily_snapshots.snapshot_date],
              set: {
                clicks: sql`excluded.clicks`, subscribers: sql`excluded.subscribers`,
                revenue: sql`excluded.revenue`, raw_clicks: sql`excluded.raw_clicks`,
                raw_subscribers: sql`excluded.raw_subscribers`, raw_revenue: sql`excluded.raw_revenue`,
                synced_at: sql`excluded.synced_at`,
              },
            });
            totalSaved++;
          } catch { totalErrors++; }
          await sleep(DELAY_MS);
        }

        if (syncLogId) {
          await db.update(sync_logs).set({ records_processed: totalSaved, message: `${acct.display_name} done — ${totalSaved} saved` }).where(eq(sync_logs.id, syncLogId));
        }
      }

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: totalErrors > 0 && totalSaved === 0 ? "error" : "success",
          success: totalSaved > 0 || totalErrors === 0,
          finished_at: now, completed_at: now,
          records_processed: totalSaved,
          message: `${totalSaved} snapshots saved, ${apiCalls} API calls`,
          error_message: totalErrors > 0 ? `${totalErrors} errors` : null,
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

// POST /sync/snapshots/backfill — full date-range backfill
// Body: { days?: number, full?: boolean, triggered_by?: string }
// days=7 (default) | full=true uses 2025-07-01 as start
router.post("/backfill", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const full = body.full === true || body.full === "true";
  const days = full ? null : Math.min(Number(body.days ?? 7), 365);

  const DATE_END = new Date().toISOString().split("T")[0];
  const DATE_START = full
    ? "2025-07-01"
    : new Date(Date.now() - (days! * 24 * 60 * 60 * 1000)).toISOString().split("T")[0];

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

      const accountList = await db.select().from(accounts).where(eq(accounts.is_active, true));
      await send({ step: "accounts", message: `${accountList.length} accounts`, total: accountList.length });

      for (const acct of accountList) {
        if (!acct.onlyfans_account_id) continue;
        await send({ step: "account", message: `${acct.display_name}...` });

        // ALL links with external_tracking_link_id — including 0-click new links
        const links: any[] = [];
        let offset = 0;
        while (true) {
          const batch = await db.select({
            id: tracking_links.id,
            external_tracking_link_id: tracking_links.external_tracking_link_id,
            campaign_name: tracking_links.campaign_name,
          })
          .from(tracking_links)
          .where(and(
            eq(tracking_links.account_id, acct.id),
            isNull(tracking_links.deleted_at),
            isNotNull(tracking_links.external_tracking_link_id),
          ))
          .limit(50).offset(offset);
          if (!batch.length) break;
          links.push(...batch);
          if (batch.length < 50) break;
          offset += 50;
        }

        for (const link of links) {
          try {
            const statsUrl = `${API_BASE}/${acct.onlyfans_account_id}/tracking-links/${link.external_tracking_link_id}/stats?date_start=${DATE_START}&date_end=${DATE_END}`;
            const res = await fetch(statsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
            apiCalls++;
            if (!res.ok) { totalErrors++; await sleep(DELAY_MS); continue; }

            const json = await res.json() as any;
            const daily: any[] = json?.data?.daily_metrics ?? [];

            // OFAPI returns true daily incremental values — save directly
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
                  clicks: sql`excluded.clicks`, subscribers: sql`excluded.subscribers`,
                  revenue: sql`excluded.revenue`, raw_clicks: sql`excluded.raw_clicks`,
                  raw_subscribers: sql`excluded.raw_subscribers`, raw_revenue: sql`excluded.raw_revenue`,
                  synced_at: sql`excluded.synced_at`,
                },
              });
              totalSaved += rows.length;
            }
          } catch { totalErrors++; }
          await sleep(DELAY_MS);
        }

        if (syncLogId) {
          await db.update(sync_logs).set({ records_processed: totalSaved, message: `${acct.display_name} done — ${totalSaved} rows saved` }).where(eq(sync_logs.id, syncLogId));
        }
      }

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: totalErrors > 0 && totalSaved === 0 ? "error" : "success",
          success: totalSaved > 0 || totalErrors === 0,
          finished_at: now, completed_at: now,
          records_processed: totalSaved,
          message: `Backfill complete: ${totalSaved} rows, ${apiCalls} API calls`,
          error_message: totalErrors > 0 ? `${totalErrors} errors` : null,
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `${totalSaved} snapshot rows saved`, snapshots_saved: totalSaved, api_calls: apiCalls, errors: totalErrors });
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

import { Hono } from "hono";
import { db } from "../../db/client.js";
import { fans, transactions, tracking_links, tracking_link_ltv, sync_logs } from "../../db/schema.js";
import { eq, isNotNull, and, ne, sql } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();

router.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `crosspoll_sync_${triggeredBy}`,
    message: "Cross-poll sync started", records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    let saved = 0;
    const errors: string[] = [];
    try {
      await send({ step: "start", message: "Computing cross-poll revenue..." });

      // Preflight diagnostics
      const fanCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM fans WHERE first_subscribe_link_id IS NOT NULL`);
      const linkCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM tracking_links WHERE deleted_at IS NULL AND external_tracking_link_id IS NOT NULL`);
      const txCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM transactions`);
      await send({ step: "preflight", message: `Fans with link: ${fanCheck.rows[0]?.cnt ?? 0}, active links: ${linkCheck.rows[0]?.cnt ?? 0}, transactions: ${txCheck.rows[0]?.cnt ?? 0}` });

      // For each tracking link, compute cross-poll directly from transactions —
      // fans who first subscribed via that link but spent on a DIFFERENT account.
      const rows = await db.execute(sql`
        SELECT
          f.first_subscribe_link_id                                                AS tracking_link_id,
          tl.account_id                                                            AS link_account_id,
          tl.campaign_name,
          COUNT(DISTINCT f.id)                                                     AS fans_total,
          COUNT(DISTINCT CASE WHEN t.account_id::text != tl.account_id::text THEN f.id END) AS cross_poll_fans,
          COALESCE(SUM(CASE WHEN t.account_id::text != tl.account_id::text THEN t.revenue::numeric ELSE 0 END), 0) AS cross_poll_revenue,
          tl.external_tracking_link_id
        FROM fans f
        JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
        LEFT JOIN transactions t ON t.fan_id = f.fan_id
        WHERE f.first_subscribe_link_id IS NOT NULL
          AND tl.deleted_at IS NULL
          AND tl.external_tracking_link_id IS NOT NULL
        GROUP BY f.first_subscribe_link_id, tl.account_id, tl.campaign_name, tl.external_tracking_link_id
      `);

      const results = rows.rows as any[];
      const sample = results[0];
      await send({ step: "computed", message: `${results.length} links with fan data${sample ? ` | sample: ${sample.campaign_name}, fans=${sample.fans_total}, crossFans=${sample.cross_poll_fans}, crossRev=${sample.cross_poll_revenue}` : ""}` });

      for (const row of results) {
        const crossFans = Number(row.cross_poll_fans ?? 0);
        const crossRevenue = Number(row.cross_poll_revenue ?? 0);
        const fansTotal = Number(row.fans_total ?? 0);
        const avgPerFan = crossFans > 0 ? Math.round(crossRevenue / crossFans * 100) / 100 : 0;
        const conversionPct = fansTotal > 0 ? Math.round(crossFans / fansTotal * 10000) / 100 : 0;

        try {
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
          saved++;
        } catch (err: any) {
          errors.push(`${row.campaign_name}: ${err.message}`);
        }
      }

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: errors.length > 0 ? "partial" : "success",
          success: errors.length === 0,
          finished_at: now, completed_at: now,
          records_processed: saved,
          message: `${saved} links updated`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
        }).where(eq(sync_logs.id, syncLogId));
      }
      await send({ step: "done", message: `${saved} links updated`, links_updated: saved, errors: errors.length });
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

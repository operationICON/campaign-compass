import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, daily_metrics, sync_logs, campaigns } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllTrackingLinks(ofAccountId: string, apiKey: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = `/${ofAccountId}/tracking-links?limit=50`;
  let page = 0;
  while (url && page < 100) {
    page++;
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!res.ok) break;
    const json = await res.json() as any;
    const links = json?.data?.list ?? [];
    if (!links.length) break;
    all.push(...links);
    const nextPage = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
    if (nextPage) { try { const p = new URL(nextPage); url = p.pathname + p.search; } catch { url = nextPage; } }
    else url = null;
    await sleep(300);
  }
  return all;
}

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json() as any;
  const { account_id, onlyfans_account_id, numeric_of_id, display_name } = body;
  // Tracking-links endpoint requires the numeric performer ID, not the acct_... API ID
  const trackingLinksId = numeric_of_id ? String(numeric_of_id) : onlyfans_account_id;

  const [syncLog] = await db.insert(sync_logs).values({
    account_id, started_at: new Date(), status: "running", success: false,
    message: `Syncing ${display_name}`, records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  let linkCount = 0;
  try {
    // Fetch all tracking links from OF API (requires numeric performer ID)
    const items = await fetchAllTrackingLinks(trackingLinksId, apiKey);

    // Ensure campaigns exist
    const campaignNames = [...new Set(items.map((l: any) => l.campaignName ?? "Unknown"))];
    const existingCampaigns = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.account_id, account_id));
    const campaignMap: Record<string, string> = {};
    for (const c of existingCampaigns) campaignMap[c.name] = c.id;
    const missing = campaignNames.filter(n => !campaignMap[n]);
    if (missing.length > 0) {
      const newCampaigns = await db.insert(campaigns).values(missing.map(name => ({ account_id, name, status: "active" }))).returning();
      for (const c of newCampaigns) campaignMap[c.name] = c.id;
    }

    const today = new Date().toISOString().split("T")[0];

    for (const link of items) {
      const clicks = Number(link.clicksCount ?? 0);
      const subs = Number(link.subscribersCount ?? 0);
      const rev = Number(link.revenue?.total ?? 0);
      const extId = String(link.id ?? "");
      const campaignName = link.campaignName ?? "Unknown";
      const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0];

      const payload: Record<string, any> = {
        external_tracking_link_id: extId,
        url: link.campaignUrl ?? "",
        campaign_id: campaignId,
        campaign_name: campaignName,
        account_id,
        clicks, subscribers: subs,
        spenders: Number(link.revenue?.spendersCount ?? 0),
        revenue: String(rev),
        revenue_per_click: String(Number(link.revenue?.revenuePerClick ?? 0)),
        revenue_per_subscriber: String(Number(link.revenue?.revenuePerSubscriber ?? 0)),
        conversion_rate: clicks > 0 ? String((subs / clicks) * 100) : "0",
        calculated_at: link.revenue?.calculatedAt ? new Date(link.revenue.calculatedAt) : new Date(),
        source: link.type ?? null,
        country: link.country ?? null,
        updated_at: new Date(),
      };
      if (link.createdAt) payload.created_at = new Date(link.createdAt);

      await db.insert(tracking_links).values(payload).onConflictDoUpdate({
        target: tracking_links.external_tracking_link_id,
        set: { clicks: sql`excluded.clicks`, subscribers: sql`excluded.subscribers`, revenue: sql`excluded.revenue`, revenue_per_click: sql`excluded.revenue_per_click`, revenue_per_subscriber: sql`excluded.revenue_per_subscriber`, conversion_rate: sql`excluded.conversion_rate`, updated_at: sql`excluded.updated_at` },
      });

      // Upsert daily metrics
      const [upsertedLink] = await db.select({ id: tracking_links.id }).from(tracking_links).where(eq(tracking_links.external_tracking_link_id, extId));
      if (upsertedLink) {
        await db.insert(daily_metrics).values({ tracking_link_id: upsertedLink.id, account_id, date: today, clicks, subscribers: subs, revenue: String(rev) }).onConflictDoUpdate({ target: [daily_metrics.tracking_link_id, daily_metrics.date], set: { clicks: sql`excluded.clicks`, subscribers: sql`excluded.subscribers`, revenue: sql`excluded.revenue` } });
      }
      linkCount++;
    }

    await db.update(accounts).set({ last_synced_at: new Date() }).where(eq(accounts.id, account_id));

    if (syncLogId) await db.update(sync_logs).set({ status: "success", success: true, finished_at: new Date(), completed_at: new Date(), records_processed: linkCount, tracking_links_synced: linkCount, message: `${linkCount} links synced` }).where(eq(sync_logs.id, syncLogId));

    return c.json({ account: display_name, status: "success", links: linkCount });
  } catch (err: any) {
    if (syncLogId) await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, syncLogId));
    return c.json({ account: display_name, status: "error", error: err.message }, 500);
  }
});

export default router;

import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, daily_metrics, sync_logs, campaigns } from "../../db/schema.js";
import { eq, sql, and, isNull } from "drizzle-orm";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("?")[0].split("#")[0].replace(/\/$/, "").toLowerCase();
}

async function fetchAllTrackingLinks(ofAccountId: string, apiKey: string): Promise<{ items: any[]; apiCalls: number }> {
  const items: any[] = [];
  let url: string | null = `/${ofAccountId}/tracking-links?limit=50`;
  let apiCalls = 0;
  while (url && apiCalls < 100) {
    apiCalls++;
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!res.ok) break;
    const json = await res.json() as any;
    const links = json?.data?.list ?? [];
    if (!links.length) break;
    items.push(...links);
    const nextPage = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
    url = nextPage ?? null;
    await sleep(300);
  }
  return { items, apiCalls };
}

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json() as any;
  const { account_id, onlyfans_account_id, display_name } = body;

  const [syncLog] = await db.insert(sync_logs).values({
    account_id, started_at: new Date(), status: "running", success: false,
    message: `Syncing ${display_name}`, records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  let linkCount = 0;
  try {
    // Fetch all tracking links from OF API
    const { items, apiCalls } = await fetchAllTrackingLinks(onlyfans_account_id, apiKey);

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

      const spenders = Number(link.revenue?.spendersCount ?? 0);
      const cvr = clicks > 0 ? (subs / clicks) * 100 : 0;
      const arpu = spenders > 0 ? rev / spenders : 0;
      const ltvPerSub = subs > 0 ? rev / subs : 0;
      const spenderRate = subs > 0 ? (spenders / subs) * 100 : 0;

      const payload: Record<string, any> = {
        external_tracking_link_id: extId,
        url: link.campaignUrl ?? "",
        campaign_id: campaignId,
        campaign_name: campaignName,
        account_id,
        clicks, subscribers: subs,
        spenders,
        revenue: String(rev),
        revenue_per_click: String(Number(link.revenue?.revenuePerClick ?? 0)),
        revenue_per_subscriber: String(ltvPerSub),
        conversion_rate: String(cvr),
        cvr: String(cvr),
        arpu: String(arpu),
        ltv: String(rev),
        ltv_per_sub: String(ltvPerSub),
        spender_rate: String(spenderRate),
        calculated_at: link.revenue?.calculatedAt ? new Date(link.revenue.calculatedAt) : new Date(),
        source: link.type ?? null,
        country: link.country ?? null,
        updated_at: new Date(),
      };
      if (link.createdAt) payload.created_at = new Date(link.createdAt);

      await db.insert(tracking_links).values(payload).onConflictDoUpdate({
        target: tracking_links.external_tracking_link_id,
        set: {
          clicks: sql`excluded.clicks`,
          subscribers: sql`excluded.subscribers`,
          spenders: sql`excluded.spenders`,
          revenue: sql`excluded.revenue`,
          revenue_per_click: sql`excluded.revenue_per_click`,
          revenue_per_subscriber: sql`excluded.revenue_per_subscriber`,
          conversion_rate: sql`excluded.conversion_rate`,
          cvr: sql`excluded.cvr`,
          arpu: sql`excluded.arpu`,
          ltv: sql`excluded.ltv`,
          ltv_per_sub: sql`excluded.ltv_per_sub`,
          spender_rate: sql`excluded.spender_rate`,
          updated_at: sql`excluded.updated_at`,
        },
      });

      // Upsert daily metrics
      const [upsertedLink] = await db.select({ id: tracking_links.id }).from(tracking_links).where(eq(tracking_links.external_tracking_link_id, extId));
      if (upsertedLink) {
        await db.insert(daily_metrics).values({ tracking_link_id: upsertedLink.id, account_id, date: today, clicks, subscribers: subs, revenue: String(rev) }).onConflictDoUpdate({ target: [daily_metrics.tracking_link_id, daily_metrics.date], set: { clicks: sql`excluded.clicks`, subscribers: sql`excluded.subscribers`, revenue: sql`excluded.revenue` } });
      }
      linkCount++;
    }

    // Connect manual links (no external_tracking_link_id) to API data by URL match
    const apiUrlMap: Record<string, any> = {};
    for (const link of items) {
      const norm = normalizeUrl(link.campaignUrl ?? "");
      if (norm) apiUrlMap[norm] = link;
    }
    const manualLinks = await db.select({ id: tracking_links.id, url: tracking_links.url })
      .from(tracking_links)
      .where(and(eq(tracking_links.account_id, account_id), isNull(tracking_links.deleted_at), isNull(tracking_links.external_tracking_link_id)));
    for (const ml of manualLinks) {
      const norm = normalizeUrl(ml.url);
      if (!norm) continue;
      const matched = apiUrlMap[norm];
      if (!matched) continue;
      const extId = String(matched.id ?? "");
      // Don't connect if another link already owns this external ID
      const [existing] = await db.select({ id: tracking_links.id }).from(tracking_links).where(eq(tracking_links.external_tracking_link_id, extId));
      if (existing) continue;
      await db.update(tracking_links).set({
        external_tracking_link_id: extId,
        clicks: Number(matched.clicksCount ?? 0),
        subscribers: Number(matched.subscribersCount ?? 0),
        revenue: String(Number(matched.revenue?.total ?? 0)),
        updated_at: new Date(),
      }).where(eq(tracking_links.id, ml.id));
    }

    // Aggregate totals from all tracking links for this account
    const [aggRow] = await db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(revenue::numeric), 0)`,
        totalSubscribers: sql<number>`COALESCE(SUM(subscribers), 0)`,
      })
      .from(tracking_links)
      .where(and(eq(tracking_links.account_id, account_id), isNull(tracking_links.deleted_at)));
    const totalLtv = aggRow?.totalRevenue ?? "0";
    const totalSubsFromLinks = Number(aggRow?.totalSubscribers ?? 0);

    // Fetch current subscribers_count; use link-sum as fallback when account has none
    const [acctRow] = await db
      .select({ subscribers_count: accounts.subscribers_count })
      .from(accounts)
      .where(eq(accounts.id, account_id));
    const currentSubCount = Number(acctRow?.subscribers_count ?? 0);
    const updateFields: Record<string, any> = { last_synced_at: new Date() };
    if (currentSubCount === 0 && totalSubsFromLinks > 0) {
      updateFields.subscribers_count = totalSubsFromLinks;
    }

    await db.update(accounts).set(updateFields).where(eq(accounts.id, account_id));

    if (syncLogId) await db.update(sync_logs).set({ status: "success", success: true, finished_at: new Date(), completed_at: new Date(), records_processed: linkCount, tracking_links_synced: linkCount, message: `${linkCount} links synced`, details: { api_calls: apiCalls } }).where(eq(sync_logs.id, syncLogId));

    return c.json({ account: display_name, status: "success", links: linkCount, api_calls: apiCalls });
  } catch (err: any) {
    if (syncLogId) await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, syncLogId));
    return c.json({ account: display_name, status: "error", error: err.message }, 500);
  }
});

export default router;

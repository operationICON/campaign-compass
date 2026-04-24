import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, onlytraffic_orders, onlytraffic_unmatched_orders, sync_logs } from "../../db/schema.js";
import { eq, isNull, sql, inArray, and } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const OT_BASE = "https://studio-api.onlytraffic.com/api/external/v1";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function normalizeUrl(url: string | null | undefined) {
  if (!url) return null;
  return url.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("?")[0]
    .split("#")[0]
    .replace(/\/$/, "")
    .toLowerCase();
}

async function getAllPages(path: string, apiKey: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${OT_BASE}${path}${sep}page=${page}`, { headers: { "X-API-Key": apiKey } });
    if (!res.ok) throw new Error(`OT API ${res.status}: ${path}`);
    const json = await res.json() as any;
    if (!json.success || !json.data || json.data.length === 0) break;
    all.push(...json.data);
    if (page >= (json.pagination?.total_pages ?? 1)) break;
    page++;
    await sleep(200);
  }
  return all;
}

function deriveStatus(orders: any[]) {
  const s = orders.map(o => (o.status || "").toLowerCase());
  if (s.includes("active")) return "active";
  if (s.includes("accepted")) return "accepted";
  if (s.includes("waiting")) return "waiting";
  if (s.every(x => x === "completed")) return "completed";
  if (s.every(x => x === "rejected")) return "rejected";
  return "completed";
}
function deriveWeightedCPL(orders: any[]) {
  const spent = orders.reduce((s, o) => s + parseFloat(o.total_spent || 0), 0);
  const del = orders.reduce((s, o) => s + (o.quantity_delivered || 0), 0);
  return del === 0 ? null : Math.round(spent / del * 100) / 100;
}
function deriveWeightedCPC(orders: any[]) {
  const spent = orders.reduce((s, o) => s + parseFloat(o.total_spent || 0), 0);
  const ord = orders.reduce((s, o) => s + (o.quantity_ordered || 0), 0);
  return ord === 0 ? null : Math.round(spent / ord * 10000) / 10000;
}

router.post("/", async (c) => {
  const otApiKey = process.env.ONLYTRAFFIC_API_KEY;
  if (!otApiKey) return c.json({ error: "ONLYTRAFFIC_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `onlytraffic_sync_${triggeredBy}`,
    message: "OnlyTraffic sync started", records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    const stats = { cplOrders: 0, cpcOrders: 0, matched: 0, unmatched: 0, accountMismatches: 0, updated: 0, staleZeroed: 0, ordersSaved: 0, errors: [] as string[] };
    const unmatchedOrders: any[] = [];
    const ordersToSave: any[] = [];

    try {
      await send({ step: "loading", message: "Loading accounts and tracking links..." });

      const accountList = await db.select({ id: accounts.id, display_name: accounts.display_name, numeric_of_id: accounts.numeric_of_id }).from(accounts);
      const accountNumericIdMap: Record<string, string> = {};
      for (const a of accountList) if (a.numeric_of_id) accountNumericIdMap[a.id] = a.numeric_of_id.toString();

      // Load all tracking links
      const allLinks: any[] = [];
      let offset = 0;
      while (true) {
        const batch = await db.select({ id: tracking_links.id, url: tracking_links.url, campaign_name: tracking_links.campaign_name, account_id: tracking_links.account_id, traffic_category: tracking_links.traffic_category, source_tag: tracking_links.source_tag, onlytraffic_order_id: tracking_links.onlytraffic_order_id }).from(tracking_links).where(isNull(tracking_links.deleted_at)).limit(1000).offset(offset);
        if (!batch.length) break;
        allLinks.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      await send({ step: "loaded", message: `${accountList.length} accounts, ${allLinks.length} links loaded` });

      await send({ step: "fetching_cpl", message: "Fetching CPL orders..." });
      const cplOrders = await getAllPages("/cpl/orders", otApiKey);
      stats.cplOrders = cplOrders.length;

      await send({ step: "fetching_cpc", message: "Fetching CPC orders..." });
      const cpcOrders = await getAllPages("/cpc/orders", otApiKey);
      stats.cpcOrders = cpcOrders.length;

      await send({ step: "matching", message: "Matching orders to tracking links..." });

      const linkMap: Record<string, { link: any; orders: any[]; type: string; source: string | null; marketer: string | null; offer_id: string | null }> = {};

      // Build order_id → link map for secondary matching
      const orderIdToLink: Record<string, any> = {};
      for (const tl of allLinks) {
        if (tl.onlytraffic_order_id) orderIdToLink[tl.onlytraffic_order_id] = tl;
      }

      const processOrder = (order: any, type: "CPL" | "CPC") => {
        const campaignUrl = type === "CPL" ? order.campaign_url : order.url;
        const normUrl = normalizeUrl(campaignUrl);
        // Primary: match by normalized URL; secondary: match by previously stamped order_id
        const urlMatch = allLinks.find(tl => normalizeUrl(tl.url) === normUrl)
          ?? (order.order_id ? orderIdToLink[order.order_id] : undefined);
        if (!urlMatch) { stats.unmatched++; unmatchedOrders.push({ order_id: order.order_id, order_type: type, campaign_url: campaignUrl || null, total_spent: parseFloat(order.total_spent || 0), source: order.source || null, marketer: order.offer_marketer_name || null, status: order.status || "unmatched" }); return; }

        const expected = accountNumericIdMap[urlMatch.account_id];
        if (expected && order.of_account_id && order.of_account_id.toString() !== expected) { stats.accountMismatches++; return; }

        stats.matched++;
        ordersToSave.push({ tracking_link_id: urlMatch.id, order_id: order.order_id, order_type: type, order_number: order.order_number || null, source: order.source || null, marketer: order.offer_marketer_name || null, offer_id: order.offer_id || null, offer_marketer_uuid: order.offer_marketer_uuid || null, of_account_id: order.of_account_id || null, quantity_ordered: order.quantity_ordered || 0, quantity_delivered: order.quantity_delivered || 0, price_per_unit: parseFloat(type === "CPL" ? (order.price_per_subscriber || 0) : (order.price_per_click || 0)), total_spent: parseFloat(order.total_spent || 0), status: order.status || null, order_created_at: order.created_at ? new Date(order.created_at) : null, order_completed_at: order.completed_at ? new Date(order.completed_at) : null, synced_at: new Date() });

        if (!linkMap[urlMatch.id]) linkMap[urlMatch.id] = { link: urlMatch, orders: [], type, source: order.source || null, marketer: order.offer_marketer_name || null, offer_id: order.offer_id || null };
        linkMap[urlMatch.id].orders.push(order);
      };

      for (const o of cplOrders) processOrder(o, "CPL");
      for (const o of cpcOrders) processOrder(o, "CPC");

      const matchedLinkIds = Object.keys(linkMap);
      if (matchedLinkIds.length === 0) throw new Error("Zero links matched — aborting to avoid data loss");

      await send({ step: "matched", message: `${stats.matched} orders → ${matchedLinkIds.length} links, ${stats.unmatched} unmatched` });

      // Auto-register numeric_of_id for new accounts
      const discovered: Record<string, string> = {};
      for (const linkId of matchedLinkIds) {
        const entry = linkMap[linkId];
        if (accountNumericIdMap[entry.link.account_id]) continue;
        for (const order of entry.orders) if (order.of_account_id) { discovered[entry.link.account_id] = order.of_account_id.toString(); break; }
      }
      for (const [accountId, numericId] of Object.entries(discovered)) {
        await db.update(accounts).set({ numeric_of_id: parseInt(numericId) }).where(eq(accounts.id, accountId));
      }

      // Save orders
      await send({ step: "saving_orders", message: `Saving ${ordersToSave.length} orders...` });
      for (let i = 0; i < ordersToSave.length; i += 50) {
        await db.insert(onlytraffic_orders).values(ordersToSave.slice(i, i + 50)).onConflictDoUpdate({ target: onlytraffic_orders.order_id, set: { status: sql`excluded.status`, quantity_delivered: sql`excluded.quantity_delivered`, total_spent: sql`excluded.total_spent`, synced_at: sql`excluded.synced_at` } });
      }
      stats.ordersSaved = ordersToSave.length;

      // Update tracking links
      await send({ step: "updating_links", message: `Updating ${matchedLinkIds.length} tracking links...` });
      for (const linkId of matchedLinkIds) {
        const entry = linkMap[linkId];
        const orders = entry.orders;
        const totalSpend = Math.round(orders.reduce((s, o) => s + parseFloat(o.total_spent || 0), 0) * 100) / 100;
        const totalDelivered = orders.reduce((s, o) => s + (o.quantity_delivered || 0), 0);
        const weightedCPL = entry.type === "CPL" ? deriveWeightedCPL(orders) : null;
        const weightedCPC = entry.type === "CPC" ? deriveWeightedCPC(orders) : null;
        const cappedSpend = weightedCPL && totalDelivered > 0 ? Math.round(totalDelivered * weightedCPL * 100) / 100 : 0;
        const updateData: Record<string, any> = { traffic_category: "OnlyTraffic", source_tag: entry.link.source_tag || entry.source || null, cost_total: String(totalSpend), capped_spend: String(cappedSpend), onlytraffic_order_id: orders[orders.length - 1].order_id, onlytraffic_order_type: entry.type.toLowerCase(), onlytraffic_status: deriveStatus(orders), onlytraffic_marketer: entry.marketer || null, offer_id: entry.offer_id ? parseInt(entry.offer_id) : null, updated_at: new Date() };
        if (weightedCPL !== null) { updateData.cost_per_lead = String(weightedCPL); updateData.payment_type = "CPL"; }
        if (weightedCPC !== null) { updateData.cost_per_click = String(weightedCPC); updateData.payment_type = "CPC"; }
        try { await db.update(tracking_links).set(updateData).where(eq(tracking_links.id, linkId)); stats.updated++; }
        catch (err: any) { stats.errors.push(err.message); }
      }

      // Zero stale OT links
      const staleLinks = allLinks.filter(tl => tl.traffic_category === "OnlyTraffic" && !linkMap[tl.id]);
      if (staleLinks.length > 0) {
        await send({ step: "stale", message: `Zeroing ${staleLinks.length} stale links...` });
        const staleIds = staleLinks.map(tl => tl.id);
        for (let b = 0; b < staleIds.length; b += 100) await db.update(tracking_links).set({ cost_total: "0", capped_spend: "0", onlytraffic_status: "stale" }).where(inArray(tracking_links.id, staleIds.slice(b, b + 100)));
        stats.staleZeroed = staleLinks.length;
      }

      // Save unmatched orders
      if (unmatchedOrders.length > 0) {
        await db.delete(onlytraffic_unmatched_orders);
        for (let i = 0; i < unmatchedOrders.length; i += 50) await db.insert(onlytraffic_unmatched_orders).values(unmatchedOrders.slice(i, i + 50));
      }

      const now = new Date();
      const hasErrors = stats.errors.length > 0;
      if (syncLogId) await db.update(sync_logs).set({ status: hasErrors ? "partial" : "success", success: !hasErrors, finished_at: now, completed_at: now, records_processed: stats.updated, tracking_links_synced: stats.updated, message: `${stats.updated} links updated, ${stats.unmatched} unmatched`, error_message: hasErrors ? stats.errors.join("; ") : null }).where(eq(sync_logs.id, syncLogId));

      await send({ step: "done", message: `${stats.updated} links updated`, links_updated: stats.updated, orders_saved: stats.ordersSaved, unmatched: stats.unmatched, stale_zeroed: stats.staleZeroed, errors: stats.errors.length });
    } catch (err: any) {
      if (syncLogId) await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message, message: `Fatal: ${err.message}` }).where(eq(sync_logs.id, syncLogId));
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

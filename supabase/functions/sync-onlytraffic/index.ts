import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OT_BASE = "https://studio-api.onlytraffic.com/api/external/v1";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/$/, "").toLowerCase().trim();
}

// Pull all pages from a paginated OT API endpoint
async function getAllPages(path: string, apiKey: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${OT_BASE}${path}${sep}page=${page}`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) throw new Error(`OT API ${res.status}: ${path}`);
    const json = await res.json();
    if (!json.success || !json.data || json.data.length === 0) break;
    all.push(...json.data);
    if (page >= (json.pagination?.total_pages ?? 1)) break;
    page++;
    await sleep(200);
  }
  return all;
}

// Match an order URL to a tracking link, with strict account verification for known accounts
function matchLink(
  campaignUrl: string | null | undefined,
  ofAccountId: string | number | null | undefined,
  trackingLinks: any[],
  accountNumericIdMap: Record<string, string>
): any | null {
  if (!campaignUrl) return null;
  const normalizedUrl = normalizeUrl(campaignUrl);
  const urlMatch = trackingLinks.find((tl) => normalizeUrl(tl.url) === normalizedUrl);
  if (!urlMatch) return null;

  const expectedNumericId = accountNumericIdMap[urlMatch.account_id];
  if (expectedNumericId && ofAccountId) {
    if (ofAccountId.toString() !== expectedNumericId.toString()) {
      return null; // account mismatch — reject
    }
  }
  return urlMatch;
}

// Status priority: active > accepted > waiting > completed > rejected
function deriveStatus(orders: any[]): string {
  const statuses = orders.map((o) => (o.status || "").toLowerCase());
  if (statuses.includes("active")) return "active";
  if (statuses.includes("accepted")) return "accepted";
  if (statuses.includes("waiting")) return "waiting";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.every((s) => s === "rejected")) return "rejected";
  return "completed";
}

// Weighted CPL = SUM(total_spent) / SUM(quantity_delivered)
function deriveWeightedCPL(orders: any[]): number | null {
  const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total_spent || 0), 0);
  const totalDelivered = orders.reduce((sum, o) => sum + (o.quantity_delivered || 0), 0);
  if (totalDelivered === 0) return null;
  return Math.round((totalSpent / totalDelivered) * 100) / 100;
}

// Weighted CPC = SUM(total_spent) / SUM(quantity_ordered)
function deriveWeightedCPC(orders: any[]): number | null {
  const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total_spent || 0), 0);
  const totalOrdered = orders.reduce((sum, o) => sum + (o.quantity_ordered || 0), 0);
  if (totalOrdered === 0) return null;
  return Math.round((totalSpent / totalOrdered) * 10000) / 10000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const otApiKey = Deno.env.get("ONLYTRAFFIC_API_KEY");

  if (!otApiKey) {
    return new Response(
      JSON.stringify({ error: "ONLYTRAFFIC_API_KEY is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const db = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {}
  };

  // Create sync log
  const startedAt = new Date().toISOString();
  const { data: syncLog } = await db
    .from("sync_logs")
    .insert({
      started_at: startedAt,
      status: "running",
      success: false,
      triggered_by: `onlytraffic_sync_${triggeredBy}`,
      message: "OnlyTraffic sync started",
      records_processed: 0,
    })
    .select()
    .single();
  const syncLogId = syncLog?.id;

  (async () => {
    const stats = {
      cplOrders: 0, cpcOrders: 0,
      matched: 0, unmatched: 0, accountMismatches: 0,
      updated: 0, staleZeroed: 0, ordersSaved: 0,
      errors: [] as string[],
    };
    const unmatchedOrders: any[] = [];
    const ordersToSave: any[] = [];

    try {
      // ── STEP 1: Load accounts and tracking links ──
      await send({ step: "loading", message: "Loading accounts and tracking links..." });

      const { data: accounts, error: accErr } = await db
        .from("accounts")
        .select("id, username, onlyfans_account_id, display_name, numeric_of_id");
      if (accErr) throw accErr;

      const accountList = accounts ?? [];
      const accountNumericIdMap: Record<string, string> = {};
      for (const a of accountList) {
        if (a.numeric_of_id) accountNumericIdMap[a.id] = a.numeric_of_id.toString();
      }

      // Load all tracking links (paginated)
      let trackingLinks: any[] = [];
      let offset = 0;
      while (true) {
        const { data: batch, error } = await db
          .from("tracking_links")
          .select("id, url, campaign_name, account_id, traffic_category, source_tag, subscribers")
          .is("deleted_at", null)
          .range(offset, offset + 999);
        if (error || !batch || batch.length === 0) break;
        trackingLinks.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      await send({
        step: "loaded",
        message: `${accountList.length} accounts, ${trackingLinks.length} tracking links loaded`,
      });

      // ── STEP 2: Pull ALL orders from OT API ──
      await send({ step: "fetching_cpl", message: "Fetching CPL orders from OnlyTraffic..." });
      let cplOrders: any[] = [];
      try {
        cplOrders = await getAllPages("/cpl/orders", otApiKey);
        stats.cplOrders = cplOrders.length;
        await send({ step: "cpl_done", message: `${cplOrders.length} CPL orders fetched` });
      } catch (err: any) {
        throw new Error(`Failed to fetch CPL orders: ${err.message}`);
      }

      await send({ step: "fetching_cpc", message: "Fetching CPC orders from OnlyTraffic..." });
      let cpcOrders: any[] = [];
      try {
        cpcOrders = await getAllPages("/cpc/orders", otApiKey);
        stats.cpcOrders = cpcOrders.length;
        await send({ step: "cpc_done", message: `${cpcOrders.length} CPC orders fetched` });
      } catch (err: any) {
        throw new Error(`Failed to fetch CPC orders: ${err.message}`);
      }

      // ── STEP 3: Match orders to tracking links ──
      await send({ step: "matching", message: "Matching orders to tracking links..." });

      const linkMap: Record<string, { link: any; orders: any[]; type: string; source: string | null; marketer: string | null; offer_id: string | null }> = {};

      const processOrder = (order: any, type: "CPL" | "CPC") => {
        const campaignUrl = type === "CPL" ? order.campaign_url : order.url;
        const link = matchLink(campaignUrl, order.of_account_id, trackingLinks, accountNumericIdMap);

        if (!link) {
          const urlOnly = trackingLinks.find((tl) => normalizeUrl(tl.url) === normalizeUrl(campaignUrl));
          if (urlOnly) stats.accountMismatches++;
          else stats.unmatched++;

          unmatchedOrders.push({
            order_id: order.order_id,
            order_type: type,
            campaign_url: campaignUrl || null,
            total_spent: parseFloat(order.total_spent || 0),
            source: order.source || null,
            marketer: order.offer_marketer_name || null,
            status: order.status || "unmatched",
            of_account_id: order.of_account_id || null,
          });
          return;
        }

        stats.matched++;

        ordersToSave.push({
          tracking_link_id: link.id,
          order_id: order.order_id,
          order_type: type,
          order_number: order.order_number || null,
          source: order.source || null,
          marketer: order.offer_marketer_name || null,
          offer_id: order.offer_id || null,
          offer_marketer_uuid: order.offer_marketer_uuid || null,
          of_account_id: order.of_account_id || null,
          quantity_ordered: order.quantity_ordered || 0,
          quantity_delivered: order.quantity_delivered || 0,
          price_per_unit: parseFloat(
            type === "CPL" ? (order.price_per_subscriber || 0) : (order.price_per_click || 0)
          ),
          total_spent: parseFloat(order.total_spent || 0),
          status: order.status || null,
          order_created_at: order.created_at || null,
          order_completed_at: order.completed_at || null,
          synced_at: new Date().toISOString(),
        });

        if (!linkMap[link.id]) {
          linkMap[link.id] = {
            link,
            orders: [],
            type,
            source: order.source || null,
            marketer: order.offer_marketer_name || null,
            offer_id: order.offer_id || null,
          };
        }
        linkMap[link.id].orders.push(order);
      };

      for (const o of cplOrders) processOrder(o, "CPL");
      for (const o of cpcOrders) processOrder(o, "CPC");

      const matchedLinkIds = Object.keys(linkMap);

      await send({
        step: "matched",
        message: `${stats.matched} orders matched to ${matchedLinkIds.length} links, ${stats.unmatched} unmatched`,
      });

      if (matchedLinkIds.length === 0) {
        throw new Error("Zero links matched — aborting to avoid data loss");
      }

      // ── STEP 4: Auto-register numeric_of_id for new accounts ──
      const discovered: Record<string, string> = {};
      for (const linkId of matchedLinkIds) {
        const entry = linkMap[linkId];
        const accountId = entry.link.account_id;
        if (accountNumericIdMap[accountId]) continue;
        for (const order of entry.orders) {
          if (order.of_account_id) {
            discovered[accountId] = order.of_account_id.toString();
            break;
          }
        }
      }
      for (const [accountId, numericId] of Object.entries(discovered)) {
        await db.from("accounts").update({ numeric_of_id: parseInt(numericId) }).eq("id", accountId);
        accountNumericIdMap[accountId] = numericId;
        console.log(`Auto-registered numeric_of_id=${numericId} for account ${accountId}`);
      }

      // ── STEP 5: Save orders (permanent ledger) ──
      await send({ step: "saving_orders", message: `Saving ${ordersToSave.length} orders...` });
      const batchSize = 50;
      for (let i = 0; i < ordersToSave.length; i += batchSize) {
        const { error } = await db
          .from("onlytraffic_orders")
          .upsert(ordersToSave.slice(i, i + batchSize), { onConflict: "order_id" });
        if (error) console.error(`Orders batch error: ${error.message}`);
      }
      stats.ordersSaved = ordersToSave.length;

      // ── STEP 6: Update matched tracking_links ──
      await send({ step: "updating_links", message: `Updating ${matchedLinkIds.length} tracking links...` });

      for (const linkId of matchedLinkIds) {
        const entry = linkMap[linkId];
        const orders = entry.orders;

        const totalSpend = Math.round(
          orders.reduce((sum, o) => sum + parseFloat(o.total_spent || 0), 0) * 100
        ) / 100;

        const totalDelivered = orders.reduce((sum, o) => sum + (o.quantity_delivered || 0), 0);
        const weightedCPL = entry.type === "CPL" ? deriveWeightedCPL(orders) : null;
        const weightedCPC = entry.type === "CPC" ? deriveWeightedCPC(orders) : null;
        const cappedSpend = weightedCPL && totalDelivered > 0
          ? Math.round(totalDelivered * weightedCPL * 100) / 100
          : 0;
        const derivedStatus = deriveStatus(orders);
        const newSourceTag = entry.link.source_tag || entry.source || null;

        const updateData: Record<string, any> = {
          traffic_category: "OnlyTraffic",
          source_tag: newSourceTag,
          cost_total: totalSpend,
          capped_spend: cappedSpend,
          onlytraffic_order_id: orders[orders.length - 1].order_id,
          onlytraffic_order_type: entry.type.toLowerCase(),
          onlytraffic_status: derivedStatus,
          onlytraffic_marketer: entry.marketer || null,
          offer_id: entry.offer_id ? parseInt(entry.offer_id) : null,
          updated_at: new Date().toISOString(),
        };
        if (weightedCPL !== null) { updateData.cost_per_lead = weightedCPL; updateData.payment_type = "CPL"; }
        if (weightedCPC !== null) { updateData.cost_per_click = weightedCPC; updateData.payment_type = "CPC"; }

        try {
          const { error } = await db.from("tracking_links").update(updateData).eq("id", linkId);
          if (error) throw new Error(error.message);
          stats.updated++;
        } catch (err: any) {
          stats.errors.push(`Update ${entry.link.campaign_name}: ${err.message}`);
        }
      }

      // ── STEP 7: Zero stale OT links not in this sync ──
      const staleLinks = trackingLinks.filter(
        (tl) => tl.traffic_category === "OnlyTraffic" && !linkMap[tl.id]
      );
      if (staleLinks.length > 0) {
        await send({ step: "stale", message: `Zeroing ${staleLinks.length} stale OnlyTraffic links...` });
        const staleIds = staleLinks.map((tl) => tl.id);
        for (let b = 0; b < staleIds.length; b += 100) {
          await db
            .from("tracking_links")
            .update({ cost_total: 0, capped_spend: 0, onlytraffic_status: "stale" })
            .in("id", staleIds.slice(b, b + 100));
        }
        stats.staleZeroed = staleLinks.length;
      }

      // ── STEP 8: Save unmatched orders ──
      if (unmatchedOrders.length > 0) {
        await send({ step: "unmatched", message: `Saving ${unmatchedOrders.length} unmatched orders...` });
        await db
          .from("onlytraffic_unmatched_orders")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        const uBatch = 50;
        for (let ub = 0; ub < unmatchedOrders.length; ub += uBatch) {
          await db.from("onlytraffic_unmatched_orders").insert(unmatchedOrders.slice(ub, ub + uBatch));
        }
      }

      const unmatchedSpend = unmatchedOrders.reduce((sum, o) => sum + (o.total_spent || 0), 0);
      const totalOrders = stats.cplOrders + stats.cpcOrders;

      // Finalize sync log
      const now = new Date().toISOString();
      const hasErrors = stats.errors.length > 0;
      if (syncLogId) {
        await db.from("sync_logs").update({
          status: hasErrors ? "partial" : "success",
          success: !hasErrors,
          finished_at: now,
          completed_at: now,
          records_processed: stats.updated,
          tracking_links_synced: stats.updated,
          message: `${totalOrders} orders → ${matchedLinkIds.length} links updated, ${stats.unmatched} unmatched`,
          error_message: hasErrors ? stats.errors.join("; ") : null,
        }).eq("id", syncLogId);
      }

      await send({
        step: "done",
        message: `${matchedLinkIds.length} links updated`,
        cpl_orders: stats.cplOrders,
        cpc_orders: stats.cpcOrders,
        matched: stats.matched,
        unmatched: stats.unmatched,
        account_mismatches: stats.accountMismatches,
        links_updated: stats.updated,
        orders_saved: stats.ordersSaved,
        stale_zeroed: stats.staleZeroed,
        unmatched_spend: Math.round(unmatchedSpend * 100) / 100,
        errors: stats.errors.length,
      });
    } catch (err: any) {
      console.error(`OnlyTraffic sync fatal: ${err.message}`);
      if (syncLogId) {
        const now = new Date().toISOString();
        await db.from("sync_logs").update({
          status: "error",
          success: false,
          finished_at: now,
          completed_at: now,
          error_message: err.message,
          message: `Fatal: ${err.message}`,
        }).eq("id", syncLogId);
      }
      await send({ step: "error", error: err.message });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
});

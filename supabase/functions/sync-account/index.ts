import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_BASE = "https://app.onlyfansapi.com/api";

const apiHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

async function apiFetchAllPages(path: string, apiKey: string, maxPages = 1000): Promise<any[]> {
  const allItems: any[] = [];
  let currentUrl: string | null = `${API_BASE}${path}`;
  let page = 0;

  while (currentUrl && page < maxPages) {
    page++;
    console.log(`Fetching page ${page}: ${currentUrl}`);
    const res = await fetch(currentUrl, { headers: apiHeaders(apiKey) });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${path} returned ${res.status}: ${body}`);
    }
    const json = await res.json();

    if (Array.isArray(json)) {
      allItems.push(...json);
      break;
    }

    const data = json.data;
    if (data && Array.isArray(data.list)) {
      allItems.push(...data.list);
      const nextPage = json._pagination?.next_page ?? null;
      const hasMore = data.hasMore === true;
      currentUrl = hasMore && nextPage ? nextPage : null;
    } else if (data && Array.isArray(data)) {
      allItems.push(...data);
      currentUrl = json._pagination?.next_page ?? null;
    } else {
      break;
    }
  }

  console.log(`Fetched ${allItems.length} items from ${path} in ${page} pages`);
  return allItems;
}

// Marker-based pagination for subscribers/spenders endpoints
async function apiFetchMarkerPaginated(path: string, apiKey: string, maxPages = 200): Promise<any[]> {
  const allItems: any[] = [];
  let marker: string | null = null;
  let page = 0;

  while (page < maxPages) {
    page++;
    let url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}limit=50`;
    if (marker) url += `&after=${marker}`;

    const res = await fetch(url, { headers: apiHeaders(apiKey) });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${path} returned ${res.status}: ${body.substring(0, 200)}`);
    }
    const json = await res.json();

    const data = json.data;
    if (data && Array.isArray(data.list)) {
      allItems.push(...data.list);
      if (!data.hasMore || data.list.length === 0) break;
      marker = data.list[data.list.length - 1]?.id?.toString() ?? null;
      if (!marker) break;
    } else if (Array.isArray(data)) {
      allItems.push(...data);
      break;
    } else if (Array.isArray(json)) {
      allItems.push(...json);
      break;
    } else {
      break;
    }
  }

  return allItems;
}

function parseDurationToDays(duration: string | null | undefined): number {
  if (!duration) return 0;
  const lower = duration.toLowerCase();
  const num = parseInt(lower);
  if (isNaN(num)) return 0;
  if (lower.includes("year")) return num * 365;
  if (lower.includes("month")) return num * 30;
  if (lower.includes("week")) return num * 7;
  if (lower.includes("day")) return num;
  return 0;
}

function calculateCostMetrics(
  clicks: number,
  subscribers: number,
  revenue: number,
  costType: string | null,
  costValue: number,
) {
  let cost_total = 0;
  let cvr = clicks > 0 ? subscribers / clicks : 0;
  let cpc_real = 0;
  let cpl_real = 0;
  let arpu = subscribers > 0 ? revenue / subscribers : 0;

  if (costType === "CPC") {
    cost_total = clicks * costValue;
    cpc_real = costValue;
    cpl_real = cvr > 0 ? costValue / cvr : 0;
  } else if (costType === "CPL") {
    cost_total = subscribers * costValue;
    cpc_real = cvr > 0 ? costValue * cvr : 0;
    cpl_real = costValue;
  } else if (costType === "FIXED") {
    cost_total = costValue;
    cpc_real = clicks > 0 ? cost_total / clicks : 0;
    cpl_real = subscribers > 0 ? cost_total / subscribers : 0;
  }

  const profit = revenue - cost_total;
  const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0;

  const daysSinceCreated = 0;
  let status = "NO_DATA";
  if (!costType) {
    status = "NO_DATA";
  } else {
    if (roi > 150) status = "SCALE";
    else if (roi >= 50) status = "WATCH";
    else if (roi >= 0) status = "LOW";
    else status = "KILL";
  }

  return { cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status };
}

async function createNotification(db: any, type: string, message: string) {
  await db.from("notifications").insert({ type, message });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ONLYFANS_API_KEY");

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ONLYFANS_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = createClient(supabaseUrl, serviceKey);
  const startedAt = new Date().toISOString();

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const accountId = body.account_id as string;
  const acctId = body.onlyfans_account_id as string;
  const displayName = (body.display_name as string) || "Unknown";

  if (!accountId || !acctId) {
    return new Response(JSON.stringify({ error: "account_id and onlyfans_account_id are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create sync log for this account
  const { data: syncLog } = await db
    .from("sync_logs")
    .insert({
      account_id: accountId,
      started_at: startedAt,
      status: "running",
      success: false,
      message: `Syncing ${displayName}…`,
      records_processed: 0,
    })
    .select()
    .single();

  const syncLogId = syncLog?.id;

  try {
    let linkCount = 0;
    let txCount = 0;

    // ── Fetch existing tracking links to preserve manual data ──
    const { data: existingLinks } = await db
      .from("tracking_links")
      .select(
        "id, external_tracking_link_id, cost_type, cost_value, cost_total, profit, roi, source_tag, manually_tagged, status, cpl_real, cpc_real, cvr, arpu",
      )
      .eq("account_id", accountId);

    const existingMap: Record<string, any> = {};
    for (const link of existingLinks ?? []) {
      if (link.external_tracking_link_id) {
        existingMap[link.external_tracking_link_id] = link;
      }
    }

    // ── Sync tracking links ──
    try {
      const items = await apiFetchAllPages(`/${acctId}/tracking-links?limit=50`, apiKey);
      console.log(`Got ${items.length} tracking links for ${displayName}`);

      // Ensure campaigns exist
      const campaignNames = [...new Set(items.map((l: any) => l.campaignName ?? "Unknown"))];
      const { data: existingCampaigns } = await db
        .from("campaigns")
        .select("id, name")
        .eq("account_id", accountId)
        .in("name", campaignNames);
      const campaignMap: Record<string, string> = {};
      for (const c of existingCampaigns ?? []) campaignMap[c.name] = c.id;
      const missingNames = campaignNames.filter((n) => !campaignMap[n]);
      if (missingNames.length > 0) {
        const { data: newC } = await db
          .from("campaigns")
          .insert(missingNames.map((name) => ({ account_id: accountId, name, status: "active" })))
          .select("id, name");
        for (const c of newC ?? []) campaignMap[c.name] = c.id;
      }

      // Upsert tracking links with COALESCE protection
      const linkPayloads: Record<string, any>[] = [];
      const dailyMetricsPayloads: Record<string, any>[] = [];
      const today = new Date().toISOString().split("T")[0];

      for (const link of items) {
        const campaignName = link.campaignName ?? "Unknown";
        const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0];
        const extId = String(link.id ?? "");
        const existing = existingMap[extId];

        const clicks = Number(link.clicksCount ?? 0);
        const subscribers = Number(link.subscribersCount ?? 0);
        const revenue = Number(link.revenue?.total ?? 0);

        const payload: Record<string, any> = {
          external_tracking_link_id: extId,
          url: link.campaignUrl ?? `https://onlyfans.com/${acctId}`,
          campaign_id: campaignId,
          campaign_name: campaignName,
          account_id: accountId,
          clicks,
          subscribers,
          spenders: Number(link.revenue?.spendersCount ?? 0),
          revenue,
          revenue_per_click: Number(link.revenue?.revenuePerClick ?? 0),
          revenue_per_subscriber: Number(link.revenue?.revenuePerSubscriber ?? 0),
          conversion_rate: clicks > 0 ? (subscribers / clicks) * 100 : 0,
          calculated_at: link.revenue?.calculatedAt ?? startedAt,
          source: link.type ?? null,
          country: link.country ?? null,
        };
        if (link.createdAt) payload.created_at = link.createdAt;

        // COALESCE: preserve manually set fields
        if (existing) {
          const hasManualCost = existing.cost_type && existing.cost_value > 0;
          if (hasManualCost) {
            const metrics = calculateCostMetrics(
              clicks,
              subscribers,
              revenue,
              existing.cost_type,
              Number(existing.cost_value),
            );
            payload.cost_type = existing.cost_type;
            payload.cost_value = existing.cost_value;
            payload.cost_total = metrics.cost_total;
            payload.profit = metrics.profit;
            payload.roi = metrics.roi;
            payload.cpl_real = metrics.cpl_real;
            payload.cpc_real = metrics.cpc_real;
            payload.cvr = metrics.cvr;
            payload.arpu = metrics.arpu;
            payload.status = metrics.status;
          }
          // source_tag and manually_tagged are never touched during sync
        }

        linkPayloads.push(payload);

        dailyMetricsPayloads.push({
          tracking_link_id: existing?.id,
          account_id: accountId,
          date: today,
          clicks,
          subscribers,
          revenue,
          spenders: Number(link.revenue?.spendersCount ?? 0),
          epc: clicks > 0 ? revenue / clicks : 0,
          conversion_rate: clicks > 0 ? (subscribers / clicks) * 100 : 0,
          _ext_id: extId,
        });
      }

      // Batch upsert tracking links in chunks of 50
      for (let i = 0; i < linkPayloads.length; i += 50) {
        const batch = linkPayloads.slice(i, i + 50);
        await db.from("tracking_links").upsert(batch, {
          onConflict: "external_tracking_link_id",
          ignoreDuplicates: false,
        });
      }
      linkCount = linkPayloads.length;

      // Now fetch all tracking_link IDs
      const { data: allLinks } = await db
        .from("tracking_links")
        .select("id, external_tracking_link_id")
        .eq("account_id", accountId);

      const idMap: Record<string, string> = {};
      for (const l of allLinks ?? []) {
        if (l.external_tracking_link_id) idMap[l.external_tracking_link_id] = l.id;
      }

      // Build daily_metrics with delta calculations
      const linkIds = Object.values(idMap);

      const { data: prevSnapshots } = await db
        .from("daily_metrics")
        .select("tracking_link_id, subscribers, revenue, clicks")
        .in("tracking_link_id", linkIds)
        .order("date", { ascending: false });

      const prevMap: Record<string, { subscribers: number; revenue: number; clicks: number }> = {};
      for (const snap of prevSnapshots ?? []) {
        if (!prevMap[snap.tracking_link_id]) {
          prevMap[snap.tracking_link_id] = {
            subscribers: Number(snap.subscribers ?? 0),
            revenue: Number(snap.revenue ?? 0),
            clicks: Number(snap.clicks ?? 0),
          };
        }
      }

      const metricsToInsert = dailyMetricsPayloads
        .filter((m) => idMap[m._ext_id])
        .map((m) => {
          const { _ext_id, ...rest } = m;
          const tlId = idMap[_ext_id];
          const prev = prevMap[tlId];
          const newSubs = prev ? Math.max(0, rest.subscribers - prev.subscribers) : rest.subscribers;
          const newRev = prev ? Math.max(0, rest.revenue - prev.revenue) : rest.revenue;
          return {
            ...rest,
            tracking_link_id: tlId,
            new_subscribers: newSubs,
            new_revenue: newRev,
          };
        });

      if (metricsToInsert.length > 0) {
        for (let i = 0; i < metricsToInsert.length; i += 100) {
          const batch = metricsToInsert.slice(i, i + 100);
          await db.from("daily_metrics").upsert(batch, {
            onConflict: "tracking_link_id,date",
            ignoreDuplicates: false,
          });
        }
        console.log(`Upserted ${metricsToInsert.length} daily_metrics with deltas`);
      }

      // ── Upsert daily_snapshots with INCREMENTAL deltas ──
      // FIXED: use raw_clicks, raw_subscribers, raw_revenue from previous snapshot
      // to correctly calculate today's incremental values
      const snapshotLinkIds = dailyMetricsPayloads.filter((m) => idMap[m._ext_id]).map((m) => idMap[m._ext_id]);

      const prevSnapMap: Record<string, { clicks: number; subscribers: number; revenue: number }> = {};
      for (let i = 0; i < snapshotLinkIds.length; i += 200) {
        const batch = snapshotLinkIds.slice(i, i + 200);
        const { data: prevSnaps } = await db
          .from("daily_snapshots")
          .select("tracking_link_id, raw_clicks, raw_subscribers, raw_revenue")
          .in("tracking_link_id", batch)
          .lt("snapshot_date", today)
          .order("snapshot_date", { ascending: false });
        for (const snap of prevSnaps ?? []) {
          if (!prevSnapMap[snap.tracking_link_id]) {
            prevSnapMap[snap.tracking_link_id] = {
              clicks: Number(snap.raw_clicks ?? 0),
              subscribers: Number(snap.raw_subscribers ?? 0),
              revenue: Number(snap.raw_revenue ?? 0),
            };
          }
        }
      }

      const snapshotPayloads = dailyMetricsPayloads
        .filter((m) => idMap[m._ext_id])
        .map((m) => {
          const tlId = idMap[m._ext_id];
          const prev = prevSnapMap[tlId];
          return {
            tracking_link_id: tlId,
            account_id: accountId,
            snapshot_date: today,
            clicks: prev ? Math.max(0, m.clicks - prev.clicks) : 0,
            subscribers: prev ? Math.max(0, m.subscribers - prev.subscribers) : 0,
            revenue: prev ? Math.max(0, m.revenue - prev.revenue) : 0,
            raw_clicks: m.clicks,
            raw_subscribers: m.subscribers,
            raw_revenue: m.revenue,
            external_tracking_link_id: m._ext_id,
            synced_at: new Date().toISOString(),
          };
        });

      if (snapshotPayloads.length > 0) {
        for (let i = 0; i < snapshotPayloads.length; i += 100) {
          const batch = snapshotPayloads.slice(i, i + 100);
          await db.from("daily_snapshots").upsert(batch, {
            onConflict: "tracking_link_id,snapshot_date",
            ignoreDuplicates: false,
          });
        }
        console.log(`Upserted ${snapshotPayloads.length} incremental daily_snapshots for ${displayName}`);
      }
    } catch (err: any) {
      console.error(`Tracking links error for ${displayName}: ${err.message}`);
    }

    // ── FAN SYNC skipped — handled separately by sync-fans to avoid timeouts ──
    console.log(`[${displayName}] Skipping fan LTV sync (use sync-fans modal instead)`);

    // ── Sync transactions (batched, limited to 10 pages) ──
    try {
      const txItems = await apiFetchAllPages(`/${acctId}/transactions`, apiKey, 10);
      console.log(`Got ${txItems.length} transactions for ${displayName}`);

      const txPayloads: Record<string, any>[] = [];
      for (const tx of txItems) {
        const externalTxId = String(tx.id ?? "");
        if (!externalTxId) continue;
        txPayloads.push({
          external_transaction_id: externalTxId,
          account_id: accountId,
          revenue: Number(tx.amount ?? 0),
          revenue_net: Number(tx.net ?? 0),
          fee: Number(tx.fee ?? 0),
          type: tx.type ?? null,
          date: tx.createdAt ? tx.createdAt.split("T")[0] : startedAt.split("T")[0],
          fan_id: tx.user?.id ? String(tx.user.id) : null,
          fan_username: tx.user?.username ?? null,
          currency: tx.currency ?? "USD",
          status: tx.status ?? null,
          user_id: tx.user?.id ? String(tx.user.id) : null,
        });
      }

      for (let i = 0; i < txPayloads.length; i += 100) {
        const batch = txPayloads.slice(i, i + 100);
        await db.from("transactions").upsert(batch, { onConflict: "external_transaction_id" });
      }
      txCount = txPayloads.length;
    } catch (err: any) {
      console.error(`Transactions error for ${displayName}: ${err.message}`);
    }

    // ── Fetch earnings statistics for true LTV ──
    try {
      console.log(`Fetching earnings stats for ${displayName}...`);

      const today = new Date().toISOString().split("T")[0];

      const allTimeRes = await fetch(
        `${API_BASE}/${acctId}/statistics/statements/earnings?start_date=2015-01-01&end_date=${today}`,
        {
          headers: apiHeaders(apiKey),
        },
      );

      const ltvUpdate: Record<string, any> = {
        last_synced_at: new Date().toISOString(),
        ltv_updated_at: new Date().toISOString(),
      };

      if (allTimeRes.ok) {
        const allTimeJson = await allTimeRes.json();
        const totals = allTimeJson?.data?.total ?? allTimeJson?.data?.list?.total ?? {};
        ltvUpdate.ltv_total = Number(totals?.gross ?? totals?.all?.total_gross ?? 0);
        ltvUpdate.ltv_tips = 0;
        ltvUpdate.ltv_subscriptions = 0;
        ltvUpdate.ltv_messages = 0;
        ltvUpdate.ltv_posts = 0;
        console.log(`${displayName} all-time LTV (gross): $${ltvUpdate.ltv_total}`);
      } else {
        const errBody = await allTimeRes.text();
        console.error(`Earnings stats returned ${allTimeRes.status} for ${displayName}: ${errBody}`);
      }

      const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const res30 = await fetch(
        `${API_BASE}/${acctId}/statistics/statements/earnings?start_date=${d30}&end_date=${today}`,
        {
          headers: apiHeaders(apiKey),
        },
      );
      if (res30.ok) {
        const json30 = await res30.json();
        const totals30 = json30?.data?.total ?? json30?.data?.list?.total ?? {};
        ltvUpdate.ltv_last_30d = Number(totals30?.gross ?? totals30?.all?.total_gross ?? 0);
      }

      const d7 = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const res7 = await fetch(
        `${API_BASE}/${acctId}/statistics/statements/earnings?start_date=${d7}&end_date=${today}`,
        {
          headers: apiHeaders(apiKey),
        },
      );
      if (res7.ok) {
        const json7 = await res7.json();
        const totals7 = json7?.data?.total ?? json7?.data?.list?.total ?? {};
        ltvUpdate.ltv_last_7d = Number(totals7?.gross ?? totals7?.all?.total_gross ?? 0);
      }

      const d1 = new Date(Date.now() - 1 * 86400000).toISOString().split("T")[0];
      const res1 = await fetch(
        `${API_BASE}/${acctId}/statistics/statements/earnings?start_date=${d1}&end_date=${today}`,
        {
          headers: apiHeaders(apiKey),
        },
      );
      if (res1.ok) {
        const json1 = await res1.json();
        const totals1 = json1?.data?.total ?? json1?.data?.list?.total ?? {};
        ltvUpdate.ltv_last_day = Number(totals1?.gross ?? totals1?.all?.total_gross ?? 0);
      }

      await db.from("accounts").update(ltvUpdate).eq("id", accountId);
    } catch (err: any) {
      console.error(`Earnings stats error for ${displayName}: ${err.message}`);
      await db.from("accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", accountId);
    }

    // ── Zero-click alert check ──
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: zeroClickLinks } = await db
        .from("tracking_links")
        .select("id, campaign_name, account_id")
        .eq("account_id", accountId)
        .eq("clicks", 0)
        .lt("created_at", threeDaysAgo);

      if (zeroClickLinks && zeroClickLinks.length > 0) {
        await db
          .from("alerts")
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq("type", "zero_clicks")
          .eq("account_id", accountId)
          .eq("resolved", false);

        const alertInserts = zeroClickLinks.map((link: any) => ({
          campaign_name: link.campaign_name || "Unknown",
          account_name: displayName,
          account_id: accountId,
          tracking_link_id: link.id,
          type: "zero_clicks",
          message: `Campaign "${link.campaign_name}" has had 0 clicks for 3+ days`,
          resolved: false,
        }));

        await db.from("alerts").insert(alertInserts);
      }
    } catch (err: any) {
      console.error(`Alert check error: ${err.message}`);
    }

    const totalRecords = linkCount + txCount;
    const now = new Date().toISOString();

    if (syncLogId) {
      await db
        .from("sync_logs")
        .update({
          status: "success",
          success: true,
          finished_at: now,
          completed_at: now,
          message: `${displayName}: ${linkCount} links, ${txCount} transactions`,
          records_processed: totalRecords,
          tracking_links_synced: linkCount,
        })
        .eq("id", syncLogId);
    }

    await createNotification(db, "sync_success", `${displayName} synced — ${totalRecords} records`);

    return new Response(
      JSON.stringify({
        account: displayName,
        status: "success",
        links: linkCount,
        transactions: txCount,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    const now = new Date().toISOString();
    if (syncLogId) {
      await db
        .from("sync_logs")
        .update({
          status: "error",
          success: false,
          finished_at: now,
          completed_at: now,
          error_message: error.message,
          message: `${displayName}: ${error.message}`,
        })
        .eq("id", syncLogId);
    }

    await createNotification(db, "sync_failed", `${displayName} sync failed — ${error.message}`);

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

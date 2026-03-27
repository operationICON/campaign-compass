import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_BASE = "https://app.onlyfansapi.com/api";

function parseDurationToDays(duration: string | null | undefined): number {
  if (!duration) return 0;
  const num = parseInt(duration) || 0;
  if (duration.includes("year")) return num * 365;
  if (duration.includes("month")) return num * 30;
  if (duration.includes("day")) return num;
  return 0;
}

async function apiFetchMarkerPaginated(
  path: string,
  apiKey: string,
  maxPages = 200
): Promise<any[]> {
  const all: any[] = [];
  let marker: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = marker
      ? `${API_BASE}${path}${sep}limit=50&after=${marker}`
      : `${API_BASE}${path}${sep}limit=50`;

    const res = await fetch(url, {
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text}`);
    }

    const json = await res.json();
    const items = json?.data?.list || json?.data || json?.list || [];
    if (!Array.isArray(items) || items.length === 0) break;

    all.push(...items);
    marker = json?.data?.marker || json?.marker || null;
    const hasMore = json?.data?.hasMore ?? json?.hasMore ?? false;
    if (!hasMore || !marker) break;
  }

  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ONLYFANS_API_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  let trackingLinkId: string | undefined;

  try {
    const body = await req.json();
    trackingLinkId = body.tracking_link_id;
    const accountId = body.account_id;

    if (!trackingLinkId) throw new Error("tracking_link_id is required");

    // Step 1 — Get tracking link and account
    const { data: link, error: linkErr } = await db
      .from("tracking_links")
      .select("*, accounts(onlyfans_account_id)")
      .eq("id", trackingLinkId)
      .single();

    if (linkErr || !link) throw new Error(`Link not found: ${linkErr?.message}`);

    const externalAccountId = link.accounts?.onlyfans_account_id;
    if (!externalAccountId) throw new Error("No external account ID found");

    const extLinkId = link.external_tracking_link_id || link.id;

    // Step 2 — Fetch subscribers
    console.log(`Fetching subscribers for link ${extLinkId}...`);
    const subscribers = await apiFetchMarkerPaginated(
      `/${externalAccountId}/tracking-links/${extLinkId}/subscribers`,
      apiKey
    );
    console.log(`Found ${subscribers.length} subscribers`);

    // Upsert fan_attributions
    let subsUpserted = 0;
    for (const sub of subscribers) {
      const duration = sub.subscribedOnDuration || "";
      const days = parseDurationToDays(duration);
      const now = new Date();
      const subscribeDate = new Date(now.getTime() - days * 86400000)
        .toISOString()
        .split("T")[0];

      const record = {
        fan_id: String(sub.id),
        fan_username: sub.username || "",
        tracking_link_id: trackingLinkId,
        account_id: link.account_id,
        subscribed_on_duration: duration,
        subscribe_date_approx: subscribeDate,
        is_active: sub.isActive ?? false,
        is_expired: sub.subscribedOnExpiredNow ?? false,
        updated_at: new Date().toISOString(),
      };

      // Check if existing record has manual source
      const { data: existing } = await db
        .from("fan_attributions")
        .select("source")
        .eq("fan_id", record.fan_id)
        .eq("tracking_link_id", trackingLinkId)
        .maybeSingle();

      if (existing) {
        // Update but preserve manual source
        const updateData: any = {
          is_active: record.is_active,
          is_expired: record.is_expired,
          subscribed_on_duration: record.subscribed_on_duration,
          subscribe_date_approx: record.subscribe_date_approx,
          updated_at: record.updated_at,
          fan_username: record.fan_username,
        };
        if (existing.source !== "manual") {
          updateData.source = "api";
        }
        await db
          .from("fan_attributions")
          .update(updateData)
          .eq("fan_id", record.fan_id)
          .eq("tracking_link_id", trackingLinkId);
      } else {
        await db.from("fan_attributions").insert({ ...record, source: "api" });
      }
      subsUpserted++;
    }

    // Step 3 — Fetch spenders
    console.log(`Fetching spenders for link ${extLinkId}...`);
    let spenders: any[] = [];
    try {
      const spenderRes = await fetch(
        `${API_BASE}/${externalAccountId}/tracking-links/${extLinkId}/spenders`,
        {
          headers: {
            Authorization: apiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      if (spenderRes.ok) {
        const spenderJson = await spenderRes.json();
        spenders = spenderJson?.data?.list || spenderJson?.data || spenderJson?.list || [];
        if (!Array.isArray(spenders)) spenders = [];
      }
    } catch (e) {
      console.error("Spender fetch error:", e);
    }
    console.log(`Found ${spenders.length} spenders`);

    let spendersUpserted = 0;
    for (const sp of spenders) {
      const fanId = String(sp.onlyfans_id || sp.id);
      const revenue = sp.revenue?.total || sp.total || 0;
      const calculatedAt = sp.revenue?.calculated_at || new Date().toISOString();

      // Check existing source
      const { data: existing } = await db
        .from("fan_spend")
        .select("source")
        .eq("fan_id", fanId)
        .eq("tracking_link_id", trackingLinkId)
        .maybeSingle();

      if (existing) {
        if (existing.source !== "manual") {
          await db
            .from("fan_spend")
            .update({
              revenue,
              calculated_at: calculatedAt,
              updated_at: new Date().toISOString(),
            })
            .eq("fan_id", fanId)
            .eq("tracking_link_id", trackingLinkId);
        }
      } else {
        await db.from("fan_spend").insert({
          fan_id: fanId,
          tracking_link_id: trackingLinkId,
          account_id: link.account_id,
          revenue,
          calculated_at: calculatedAt,
          source: "api",
        });
      }
      spendersUpserted++;
    }

    // Step 4 — Calculate true LTV
    const linkCreatedAt = link.created_at
      ? new Date(link.created_at).toISOString().split("T")[0]
      : "2000-01-01";

    const { data: fans } = await db
      .from("fan_attributions")
      .select("fan_id")
      .eq("tracking_link_id", trackingLinkId)
      .eq("is_expired", false)
      .gte("subscribe_date_approx", linkCreatedAt);

    const fanIds = (fans || []).map((f: any) => f.fan_id);
    let trueLtv = 0;
    let spendersCount = 0;

    if (fanIds.length > 0) {
      const { data: spendData } = await db
        .from("fan_spend")
        .select("fan_id, revenue")
        .eq("tracking_link_id", trackingLinkId)
        .in("fan_id", fanIds);

      for (const s of spendData || []) {
        const rev = Number(s.revenue) || 0;
        trueLtv += rev;
        if (rev > 0) spendersCount++;
      }
    }

    const newSubs = fanIds.length;
    const ltvPerSub = newSubs > 0 ? trueLtv / newSubs : 0;
    const spenderRate = newSubs > 0 ? (spendersCount / newSubs) * 100 : 0;

    // Update tracking_links
    await db
      .from("tracking_links")
      .update({
        ltv: trueLtv,
        ltv_per_sub: ltvPerSub,
        spenders_count: spendersCount,
        spender_rate: spenderRate,
        fans_last_synced_at: new Date().toISOString(),
        needs_full_sync: false,
      } as any)
      .eq("id", trackingLinkId);

    console.log(
      `Link ${trackingLinkId}: ${subsUpserted} subs, ${spendersUpserted} spenders, LTV=$${trueLtv.toFixed(2)}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        tracking_link_id: trackingLinkId,
        subscribers_synced: subsUpserted,
        spenders_synced: spendersUpserted,
        ltv: trueLtv,
        ltv_per_sub: ltvPerSub,
        spenders_count: spendersCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("sync-fans error:", error.message);
    return new Response(
      JSON.stringify({
        success: false,
        tracking_link_id: trackingLinkId,
        error: error.message,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

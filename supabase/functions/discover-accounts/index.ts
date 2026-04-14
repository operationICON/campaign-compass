import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ONLYFANS_API_KEY");
  const db = createClient(supabaseUrl, serviceKey);

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ONLYFANS_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const res = await fetch("https://app.onlyfansapi.com/api/accounts", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(
        JSON.stringify({ error: `OF API returned ${res.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiAccounts = await res.json();
    const accountList = Array.isArray(apiAccounts) ? apiAccounts : (apiAccounts.data ?? []);

    let created = 0;
    let updated = 0;
    const results: { name: string; status: string }[] = [];

    for (const acc of accountList) {
      const ud = acc.onlyfans_user_data ?? {};
      const ofId = String(acc.id);

      const upsertData: Record<string, any> = {
        onlyfans_account_id: ofId,
        username: acc.onlyfans_username ?? ud.username ?? null,
        display_name: acc.display_name ?? ud.name ?? acc.onlyfans_username ?? ofId,
        is_active: true,
        avatar_url: ud.avatar ?? null,
        avatar_thumb_url: ud.avatarThumbs?.c144 ?? ud.avatarThumbs?.c50 ?? null,
        header_url: ud.header ?? null,
        subscribers_count: ud.subscribersCount ?? 0,
        performer_top: ud.performerTop ?? null,
        subscribe_price: ud.subscribePrice ?? 0,
        last_seen: ud.lastSeen ?? null,
      };

      // Check if exists
      const { data: existing } = await db
        .from("accounts")
        .select("id")
        .eq("onlyfans_account_id", ofId)
        .maybeSingle();

      const { error: upsertErr } = await db
        .from("accounts")
        .upsert(upsertData, { onConflict: "onlyfans_account_id" });

      if (upsertErr) {
        results.push({ name: upsertData.display_name, status: `error: ${upsertErr.message}` });
      } else if (existing) {
        updated++;
        results.push({ name: upsertData.display_name, status: "updated" });
      } else {
        created++;
        results.push({ name: upsertData.display_name, status: "created" });
      }
    }

    return new Response(
      JSON.stringify({
        total_api_accounts: accountList.length,
        created,
        updated,
        accounts: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

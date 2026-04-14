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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const apiKey = Deno.env.get("ONLYFANS_API_KEY");
  const db = createClient(supabaseUrl, serviceKey);

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const triggeredBy = body.triggered_by ?? "manual";

  try {
    // ── STEP 1: Mark stuck syncs as failed ──
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: stuck } = await db
      .from("sync_logs")
      .select("id")
      .eq("status", "running")
      .lt("started_at", tenMinutesAgo);

    if (stuck && stuck.length > 0) {
      const now = new Date().toISOString();
      for (const row of stuck) {
        await db
          .from("sync_logs")
          .update({
            status: "error",
            success: false,
            finished_at: now,
            completed_at: now,
            error_message: "Sync timed out — exceeded 10 minute limit",
            message: "Sync timed out — exceeded 10 minute limit",
          })
          .eq("id", row.id);
      }
      console.log(`Marked ${stuck.length} stuck syncs as failed`);
    }

    // ── STEP 2: Discover new accounts from OF API ──
    if (apiKey) {
      try {
        console.log("Discovering accounts from OF API...");
        const res = await fetch("https://app.onlyfansapi.com/api/accounts", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        if (res.ok) {
          const apiAccounts = await res.json();
          const accountList = Array.isArray(apiAccounts) ? apiAccounts : (apiAccounts.data ?? []);

          console.log(`OF API returned ${accountList.length} accounts`);

          for (const acc of accountList) {
            const ud = acc.onlyfans_user_data ?? {};

            const upsertData: Record<string, any> = {
              onlyfans_account_id: String(acc.id),
              username: acc.onlyfans_username ?? ud.username ?? null,
              display_name: acc.display_name ?? ud.name ?? acc.onlyfans_username ?? String(acc.id),
              is_active: true,
              avatar_url: ud.avatar ?? null,
              avatar_thumb_url: ud.avatarThumbs?.c144 ?? ud.avatarThumbs?.c50 ?? null,
              header_url: ud.header ?? null,
              subscribers_count: ud.subscribersCount ?? 0,
              performer_top: ud.performerTop ?? null,
              subscribe_price: ud.subscribePrice ?? 0,
              last_seen: ud.lastSeen ?? null,
            };

            const { error: upsertErr } = await db
              .from("accounts")
              .upsert(upsertData, { onConflict: "onlyfans_account_id" });

            if (upsertErr) {
              console.error(`Failed to upsert account ${acc.id}: ${upsertErr.message}`);
            } else {
              console.log(`Upserted account: ${upsertData.display_name} (${upsertData.username})`);
            }
          }

          console.log(`Account discovery complete — ${accountList.length} accounts synced`);
        } else {
          const errText = await res.text();
          console.error(`OF API accounts returned ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        console.error(`Account discovery error: ${err.message}`);
      }
    } else {
      console.warn("ONLYFANS_API_KEY not set — skipping account discovery");
    }

    // ── STEP 3: Create orchestrator sync log ──
    const startedAt = new Date().toISOString();
    const { data: orchLog } = await db
      .from("sync_logs")
      .insert({
        started_at: startedAt,
        status: "running",
        success: false,
        message: "Orchestrator started — syncing accounts in parallel batches of 3",
        records_processed: 0,
        triggered_by: triggeredBy,
        accounts_synced: 0,
        tracking_links_synced: 0,
      })
      .select()
      .single();

    const orchLogId = orchLog?.id;

    // ── STEP 4: Get all active accounts (now includes newly discovered) ──
    const { data: accounts, error: accErr } = await db
      .from("accounts")
      .select("id, display_name, onlyfans_account_id, sync_enabled, username")
      .eq("is_active", true);

    if (accErr) throw accErr;

    const accountList = accounts ?? [];
    let accountsSynced = 0;
    let totalLinksSynced = 0;
    const errors: string[] = [];

    // Filter out disabled accounts
    const enabledAccounts: typeof accountList = [];
    for (const account of accountList) {
      if (account.sync_enabled === false) {
        console.log(`Skipped ${account.display_name} (@${account.username}) — sync disabled`);
        await db.from("sync_logs").insert({
          account_id: account.id,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          status: "skipped",
          success: true,
          message: `Skipped ${account.display_name} — sync disabled in settings`,
          records_processed: 0,
          triggered_by: triggeredBy,
        });
        continue;
      }
      enabledAccounts.push(account);
    }

    console.log(`Syncing ${enabledAccounts.length} enabled accounts`);

    // ── STEP 5: Sync each account ──
    async function syncAccountWithRetry(account: (typeof accountList)[0]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const label = attempt === 0 ? "" : " (retry)";
          console.log(`Syncing account${label}: ${account.display_name}`);

          if (orchLogId) {
            await db
              .from("sync_logs")
              .update({
                message: `Syncing ${account.display_name}${label} — ${accountsSynced}/${enabledAccounts.length} done`,
              })
              .eq("id", orchLogId);
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

          const res = await fetch(`${supabaseUrl}/functions/v1/sync-account`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${anonKey}`,
            },
            body: JSON.stringify({
              account_id: account.id,
              onlyfans_account_id: account.onlyfans_account_id,
              display_name: account.display_name,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (res.ok) {
            const result = await res.json();
            accountsSynced++;
            totalLinksSynced += result.links ?? 0;
            console.log(`✓ ${account.display_name}: ${result.links} links, ${result.transactions} tx`);
            return;
          } else {
            const errText = await res.text();
            if (attempt === 0) {
              console.warn(`✗ ${account.display_name} attempt 1 failed (${res.status}), retrying...`);
              continue;
            }
            console.error(`✗ ${account.display_name}: ${res.status} ${errText}`);
            errors.push(`${account.display_name}: ${errText}`);
          }
        } catch (err: any) {
          if (attempt === 0) {
            console.warn(`✗ ${account.display_name} attempt 1 error: ${err.message}, retrying...`);
            continue;
          }
          console.error(`✗ ${account.display_name} failed after retry: ${err.message}`);
          errors.push(`${account.display_name}: ${err.message}`);
        }
      }
    }

    // Process in parallel batches of 3
    const BATCH_SIZE = 3;
    for (let i = 0; i < enabledAccounts.length; i += BATCH_SIZE) {
      const batch = enabledAccounts.slice(i, i + BATCH_SIZE);
      const batchNames = batch.map((a) => a.display_name).join(", ");
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchNames}`);

      if (orchLogId) {
        await db
          .from("sync_logs")
          .update({
            message: `Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(enabledAccounts.length / BATCH_SIZE)}: syncing ${batchNames}`,
            accounts_synced: accountsSynced,
            tracking_links_synced: totalLinksSynced,
          })
          .eq("id", orchLogId);
      }

      await Promise.all(batch.map((account) => syncAccountWithRetry(account)));
    }

    // ── STEP 6: Update orchestrator log ──
    const now = new Date().toISOString();
    const hasErrors = errors.length > 0;
    if (orchLogId) {
      await db
        .from("sync_logs")
        .update({
          status: hasErrors ? "partial" : "success",
          success: !hasErrors,
          finished_at: now,
          completed_at: now,
          accounts_synced: accountsSynced,
          tracking_links_synced: totalLinksSynced,
          records_processed: totalLinksSynced,
          message: `Synced ${accountsSynced}/${enabledAccounts.length} accounts, ${totalLinksSynced} links${hasErrors ? ` (${errors.length} errors)` : ""}`,
          error_message: hasErrors ? errors.join("; ") : null,
        })
        .eq("id", orchLogId);
    }

    return new Response(
      JSON.stringify({
        message: `Synced ${accountsSynced}/${enabledAccounts.length} accounts`,
        accounts_synced: accountsSynced,
        tracking_links_synced: totalLinksSynced,
        errors: errors.length > 0 ? errors : undefined,
        accounts: accountList.map((a) => ({
          id: a.id,
          display_name: a.display_name,
          onlyfans_account_id: a.onlyfans_account_id,
        })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error(`Orchestrator error: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

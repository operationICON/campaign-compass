import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_BASE = "https://app.onlyfansapi.com/api";
const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ONLYFANS_API_KEY");

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ONLYFANS_API_KEY is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const db = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const TODAY = new Date().toISOString().split("T")[0];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {}
  };

  // Create sync log entry
  const startedAt = new Date().toISOString();
  const { data: syncLog } = await db
    .from("sync_logs")
    .insert({
      started_at: startedAt,
      status: "running",
      success: false,
      triggered_by: `snapshot_sync_${triggeredBy}`,
      message: `Snapshot sync started for ${TODAY}`,
      records_processed: 0,
    })
    .select()
    .single();
  const syncLogId = syncLog?.id;

  (async () => {
    let totalSaved = 0;
    let totalErrors = 0;
    let apiCalls = 0;

    try {
      await send({ step: "start", message: `Syncing snapshots for ${TODAY}...` });

      // Load all active accounts
      const { data: accounts, error: accErr } = await db
        .from("accounts")
        .select("id, onlyfans_account_id, display_name")
        .eq("is_active", true);

      if (accErr) throw accErr;
      const accountList = accounts ?? [];

      await send({ step: "accounts", message: `Found ${accountList.length} accounts`, total: accountList.length });

      for (const acct of accountList) {
        await send({ step: "account", message: `${acct.display_name}...` });

        // Get all active links for this account (any clicks or subscribers)
        let offset = 0;
        const links: any[] = [];
        while (true) {
          const { data: batch, error } = await db
            .from("tracking_links")
            .select("id, external_tracking_link_id, campaign_name")
            .eq("account_id", acct.id)
            .is("deleted_at", null)
            .or("clicks.gt.0,subscribers.gt.0")
            .range(offset, offset + 99);

          if (error || !batch || batch.length === 0) break;
          links.push(...batch.filter((l: any) => !!l.external_tracking_link_id));
          if (batch.length < 100) break;
          offset += 100;
        }

        console.log(`${acct.display_name}: ${links.length} active links`);

        for (const link of links) {
          try {
            // Fetch today's stats from OF API (1 credit per link)
            const statsUrl = `${API_BASE}/${acct.onlyfans_account_id}/tracking-links/${link.external_tracking_link_id}/stats?date_start=${TODAY}&date_end=${TODAY}`;
            const res = await fetch(statsUrl, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            apiCalls++;

            if (!res.ok) {
              console.error(`Stats API ${res.status} for link ${link.external_tracking_link_id}`);
              totalErrors++;
              await sleep(DELAY_MS);
              continue;
            }

            const json = await res.json();
            const dayData = (json?.data?.daily_metrics ?? []).find(
              (d: any) => d.timestamp === TODAY
            );

            if (!dayData) {
              await sleep(DELAY_MS);
              continue;
            }

            const currentClicks = Number(dayData.clicks ?? 0);
            const currentSubs = Number(dayData.subs ?? 0);
            const currentRevenue = Number(dayData.revenue ?? 0);

            // Get yesterday's baseline (raw cumulative totals) to calculate today's increment
            const { data: baselineRows } = await db
              .from("daily_snapshots")
              .select("raw_clicks, raw_subscribers, raw_revenue, snapshot_date")
              .eq("tracking_link_id", link.id)
              .lt("snapshot_date", TODAY)
              .order("snapshot_date", { ascending: false })
              .limit(1);

            const baseline = baselineRows?.[0] ?? null;

            let incrementalClicks: number;
            let incrementalSubs: number;
            let incrementalRevenue: number;

            if (
              baseline &&
              (baseline.raw_clicks !== null ||
                baseline.raw_subscribers !== null ||
                baseline.raw_revenue !== null)
            ) {
              // Subtract previous cumulative from current cumulative = today's increment
              incrementalClicks = Math.max(currentClicks - (baseline.raw_clicks ?? 0), 0);
              incrementalSubs = Math.max(currentSubs - (baseline.raw_subscribers ?? 0), 0);
              incrementalRevenue = Math.max(currentRevenue - (baseline.raw_revenue ?? 0), 0);
            } else {
              // No baseline — first active day, record 0 increment but save the raw values
              incrementalClicks = 0;
              incrementalSubs = 0;
              incrementalRevenue = 0;
            }

            await db.from("daily_snapshots").upsert(
              {
                tracking_link_id: link.id,
                account_id: acct.id,
                external_tracking_link_id: link.external_tracking_link_id,
                snapshot_date: TODAY,
                clicks: incrementalClicks,
                subscribers: incrementalSubs,
                revenue: incrementalRevenue,
                // Store raw cumulative for use as tomorrow's baseline
                raw_clicks: currentClicks,
                raw_subscribers: currentSubs,
                raw_revenue: currentRevenue,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "tracking_link_id,snapshot_date" }
            );

            totalSaved++;
          } catch (err: any) {
            console.error(`Snapshot error for link ${link.external_tracking_link_id}: ${err.message}`);
            totalErrors++;
          }

          await sleep(DELAY_MS);
        }

        // Update sync log with running total
        if (syncLogId) {
          await db
            .from("sync_logs")
            .update({ records_processed: totalSaved, message: `${acct.display_name} done — ${totalSaved} saved so far` })
            .eq("id", syncLogId);
        }
      }

      const now = new Date().toISOString();
      if (syncLogId) {
        await db
          .from("sync_logs")
          .update({
            status: totalErrors > 0 && totalSaved === 0 ? "error" : "success",
            success: totalSaved > 0 || totalErrors === 0,
            finished_at: now,
            completed_at: now,
            records_processed: totalSaved,
            message: `Snapshot sync complete — ${totalSaved} snapshots saved, ${apiCalls} API calls`,
            error_message: totalErrors > 0 ? `${totalErrors} link(s) failed` : null,
          })
          .eq("id", syncLogId);
      }

      await send({
        step: "done",
        message: `${totalSaved} snapshots saved`,
        snapshots_saved: totalSaved,
        api_calls: apiCalls,
        errors: totalErrors,
      });
    } catch (err: any) {
      console.error(`Snapshot sync fatal: ${err.message}`);

      if (syncLogId) {
        const now = new Date().toISOString();
        await db
          .from("sync_logs")
          .update({
            status: "error",
            success: false,
            finished_at: now,
            completed_at: now,
            error_message: err.message,
            message: `Fatal: ${err.message}`,
          })
          .eq("id", syncLogId);
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

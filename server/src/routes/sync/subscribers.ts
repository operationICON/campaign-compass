import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, sync_logs, sync_settings } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// OF API field names vary — try all known locations for the tracking link ID.
function extractTrackingLinkId(sub: any): string | null {
  return (
    sub?.tracking_link_id ??
    sub?.trackingLinkId ??
    sub?.source_tracking_link_id ??
    sub?.trackedLinkId ??
    sub?.subscribedByData?.tracking_link_id ??
    sub?.subscribedByData?.trackingLinkId ??
    sub?.trackedLink?.id ??
    null
  );
}

function extractFanId(sub: any): string | null {
  const raw = sub?.id ?? sub?.user?.id ?? sub?.userId ?? null;
  return raw != null ? String(raw) : null;
}

async function updateCrosspollLtv(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT
      f.first_subscribe_link_id                                                              AS tracking_link_id,
      tl.account_id                                                                          AS link_account_id,
      tl.campaign_name,
      tl.external_tracking_link_id,
      COUNT(DISTINCT f.id)                                                                   AS fans_total,
      COUNT(DISTINCT CASE WHEN fs.account_id::text != tl.account_id::text THEN f.id END)    AS cross_poll_fans,
      COALESCE(SUM(CASE WHEN fs.account_id::text != tl.account_id::text THEN fs.revenue::numeric ELSE 0 END), 0) AS cross_poll_revenue
    FROM fans f
    JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
    LEFT JOIN fan_spend fs ON fs.fan_id = f.fan_id
    WHERE f.first_subscribe_link_id IS NOT NULL
      AND tl.deleted_at IS NULL
      AND tl.external_tracking_link_id IS NOT NULL
      AND tl.account_id NOT IN (SELECT id FROM accounts WHERE sync_excluded = true)
    GROUP BY f.first_subscribe_link_id, tl.account_id, tl.campaign_name, tl.external_tracking_link_id
  `);

  const results = rows.rows as any[];
  let updated = 0;

  for (const row of results) {
    const crossFans    = Number(row.cross_poll_fans ?? 0);
    const crossRevenue = Number(row.cross_poll_revenue ?? 0);
    const fansTotal    = Number(row.fans_total ?? 0);
    const avgPerFan    = crossFans > 0 ? Math.round(crossRevenue / crossFans * 100) / 100 : 0;
    const convPct      = fansTotal > 0 ? Math.round(crossFans / fansTotal * 10000) / 100 : 0;

    await db.execute(sql`
      INSERT INTO tracking_link_ltv
        (tracking_link_id, external_tracking_link_id, account_id, new_subs_total,
         cross_poll_fans, cross_poll_revenue, cross_poll_avg_per_fan, cross_poll_conversion_pct)
      VALUES
        (${String(row.tracking_link_id)}, ${String(row.external_tracking_link_id)},
         ${String(row.link_account_id)}, ${fansTotal}, ${crossFans},
         ${String(crossRevenue)}, ${String(avgPerFan)}, ${String(convPct)})
      ON CONFLICT (tracking_link_id) DO UPDATE SET
        new_subs_total            = EXCLUDED.new_subs_total,
        cross_poll_fans           = EXCLUDED.cross_poll_fans,
        cross_poll_revenue        = EXCLUDED.cross_poll_revenue,
        cross_poll_avg_per_fan    = EXCLUDED.cross_poll_avg_per_fan,
        cross_poll_conversion_pct = EXCLUDED.cross_poll_conversion_pct,
        updated_at                = NOW()
    `);
    updated++;
  }

  return updated;
}

// POST /sync/subscribers
// Body: { triggered_by?, force_full? }
//
// Pulls the subscribers list per account from the OF API.
// Each subscriber includes which tracking link they came from, so this gives
// exact attribution for all 418K subscribers — not just the ~2K with spend records.
//
// Incremental by default: stores the newest subscribe date per account in
// sync_settings (key: sub_sync_last_{accountId}) and passes it as `after` param
// on subsequent runs. First run (no stored date) pulls all history.
// force_full=true ignores stored dates and re-pulls everything.
router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const forceFull: boolean = !!body.force_full;
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `subscriber_sync_${triggeredBy}`,
    message: forceFull ? "Subscriber attribution: full history" : "Subscriber attribution: incremental",
    records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    const errors: string[] = [];
    let totalAttributed = 0;
    let totalApiCalls = 0;

    try {
      // Build external_tracking_link_id → UUID lookup for fast mapping
      await send({ step: "start", message: "Loading tracking links..." });
      const allLinks = await db
        .select({ id: tracking_links.id, external_tracking_link_id: tracking_links.external_tracking_link_id })
        .from(tracking_links)
        .where(sql`deleted_at IS NULL AND external_tracking_link_id IS NOT NULL`);

      const linkByExtId = new Map<string, string>();
      for (const l of allLinks) {
        if (l.external_tracking_link_id) {
          linkByExtId.set(String(l.external_tracking_link_id).toLowerCase(), String(l.id));
        }
      }
      await send({ step: "links", message: `${linkByExtId.size} tracking links loaded` });

      const enabledAccounts = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(and(eq(accounts.is_active, true), sql`accounts.sync_excluded IS NOT TRUE`));

      await send({ step: "accounts", message: `${enabledAccounts.length} accounts to process` });

      for (const account of enabledAccounts) {
        if (!account.onlyfans_account_id) continue;

        // Retrieve last sync date for incremental mode
        const settingKey = `sub_sync_last_${account.id}`;
        const [settingRow] = await db
          .select({ value: sync_settings.value })
          .from(sync_settings)
          .where(eq(sync_settings.key, settingKey))
          .limit(1);
        const lastSyncedAt = !forceFull && settingRow?.value ? settingRow.value : null;

        const afterParam = lastSyncedAt ? `&after=${lastSyncedAt}` : "";
        const mode = lastSyncedAt ? `incremental from ${lastSyncedAt}` : "full history";
        await send({ step: "account_start", message: `${account.display_name}: ${mode}` });

        let url: string | null = `${API_BASE}/${account.onlyfans_account_id}/subscribers?limit=100${afterParam}`;
        let apiCalls = 0;
        let accountAttributed = 0;
        let newestDate: string | null = null;

        while (url && apiCalls < 2000) {
          apiCalls++;
          totalApiCalls++;

          const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });

          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("Retry-After") ?? 15);
            await sleep(retryAfter * 1000);
            apiCalls--;
            totalApiCalls--;
            continue;
          }
          if (res.status === 401 || res.status === 403) {
            errors.push(`${account.display_name}: HTTP ${res.status} (auth)`);
            break;
          }
          if (!res.ok) {
            errors.push(`${account.display_name}: HTTP ${res.status}`);
            break;
          }

          const json = await res.json() as any;
          const page: any[] = json?.data?.list ?? json?.data ?? json?.subscribers ?? json?.list ?? [];
          if (!Array.isArray(page) || page.length === 0) break;

          type UpsertRow = { fan_id: string; username: string | null; link_uuid: string | null; sub_date: string | null };
          const upsertRows: UpsertRow[] = [];

          for (const sub of page) {
            const fanId = extractFanId(sub);
            if (!fanId) continue;

            const extLinkId = extractTrackingLinkId(sub);
            const linkUuid = extLinkId ? (linkByExtId.get(String(extLinkId).toLowerCase()) ?? null) : null;
            if (linkUuid) accountAttributed++;

            const dateRaw = sub?.subscribedAt ?? sub?.subscribeAt ?? sub?.createdAt ?? sub?.joinDate ?? null;
            const dateStr = dateRaw ? String(dateRaw).split("T")[0] : null;
            if (dateStr && (!newestDate || dateStr > newestDate)) newestDate = dateStr;

            upsertRows.push({ fan_id: fanId, username: sub?.username ?? null, link_uuid: linkUuid, sub_date: dateStr });
          }

          if (upsertRows.length > 0) {
            const vals = upsertRows.map(r => sql`(
              ${r.fan_id},
              ${r.username},
              ${r.link_uuid ? sql`${r.link_uuid}::uuid` : sql`NULL::uuid`},
              ${r.sub_date ? sql`${r.sub_date}::date` : sql`NULL::date`}
            )`);
            await db.execute(sql`
              INSERT INTO fans (fan_id, username, first_subscribe_link_id, first_subscribe_date)
              VALUES ${sql.join(vals, sql`, `)}
              ON CONFLICT (fan_id) DO UPDATE SET
                username                = COALESCE(EXCLUDED.username, fans.username),
                first_subscribe_link_id = COALESCE(fans.first_subscribe_link_id, EXCLUDED.first_subscribe_link_id),
                first_subscribe_date    = COALESCE(fans.first_subscribe_date, EXCLUDED.first_subscribe_date),
                updated_at              = NOW()
            `);
          }

          const nextRaw = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
          url = nextRaw
            ? (String(nextRaw).startsWith("http") ? String(nextRaw) : `${API_BASE}${nextRaw}`)
            : null;

          if (apiCalls % 50 === 0) {
            await send({ step: "progress", message: `${account.display_name}: ${apiCalls} pages, ${accountAttributed} attributed so far...` });
          }
          await sleep(200);
        }

        // Save newest date seen for this account so next run is incremental
        const syncedUntil = newestDate ?? new Date().toISOString().split("T")[0];
        await db.execute(sql`
          INSERT INTO sync_settings (key, value, updated_at)
          VALUES (${settingKey}, ${syncedUntil}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `);

        totalAttributed += accountAttributed;
        await send({ step: "account_done", message: `${account.display_name}: ${accountAttributed} fans with tracking links (${apiCalls} API calls)` });
      }

      await send({ step: "crosspoll", message: "Updating cross-poll revenue data..." });
      const ltvUpdated = await updateCrosspollLtv();

      const now = new Date();
      if (syncLogId) {
        await db.update(sync_logs).set({
          status: errors.length > 0 ? "partial" : "success",
          success: errors.length === 0,
          finished_at: now, completed_at: now,
          records_processed: totalAttributed,
          message: `${totalAttributed} fans attributed via subscriber endpoint (${totalApiCalls} API calls, ${forceFull ? "full" : "incremental"}), ${ltvUpdated} cross-poll links updated${errors.length ? `. Errors: ${errors.slice(0, 3).join("; ")}` : ""}`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
          details: { attributed: totalAttributed, api_calls: totalApiCalls, ltv_links: ltvUpdated, force_full: forceFull },
        }).where(eq(sync_logs.id, syncLogId));
      }

      await send({
        step: "done",
        message: `Done — ${totalAttributed} fans attributed, ${ltvUpdated} cross-poll links updated (${totalApiCalls} API calls)`,
        attributed: totalAttributed,
        ltv_links: ltvUpdated,
        api_calls: totalApiCalls,
      });
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

import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, sync_logs, sync_settings } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function extractFanId(sub: any): string | null {
  const raw = sub?.id ?? sub?.user?.id ?? sub?.userId ?? sub?.fan_id ?? sub?.fanId ?? null;
  return raw != null ? String(raw) : null;
}

function extractUsername(sub: any): string | null {
  return sub?.username ?? sub?.user?.username ?? sub?.userName ?? null;
}

function extractSubDate(sub: any): string | null {
  const raw = sub?.subscribedAt ?? sub?.subscribeAt ?? sub?.createdAt ?? sub?.joinDate ?? sub?.created_at ?? null;
  return raw ? String(raw).split("T")[0] : null;
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
// Iterates over every active tracking link and calls the per-link subscribers
// endpoint: GET /{ofAccountId}/tracking-links/{extLinkId}/subscribers?limit=100
// This is the only OFAPI endpoint that actually returns subscriber data.
// Each page of subscribers is upserted into `fans` with first_subscribe_link_id
// set to that tracking link's UUID so attribution is exact.
router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const forceFull: boolean = !!body.force_full;
  const filterAccountId: string | null = body.account_id ?? null;
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `subscriber_sync_${triggeredBy}`,
    message: forceFull ? "Subscriber attribution (per-link): full history" : "Subscriber attribution (per-link): incremental",
    records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    const errors: string[] = [];
    let totalAttributed = 0;
    let totalApiCalls = 0;
    type AccountResult = { account: string; status: string; attributed: number; api_calls: number; links_processed: number; note?: string };
    const accountResults: AccountResult[] = [];

    try {
      await send({ step: "start", message: "Loading accounts and tracking links..." });

      const enabledAccounts = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(and(
          eq(accounts.is_active, true),
          sql`accounts.sync_excluded IS NOT TRUE`,
          filterAccountId ? eq(accounts.id, filterAccountId) : sql`TRUE`,
        ));

      await send({ step: "accounts", message: `${enabledAccounts.length} accounts to process` });

      for (const account of enabledAccounts) {
        if (!account.onlyfans_account_id) continue;

        // Load all tracking links for this account that have an external ID
        const accountLinks = await db
          .select({ id: tracking_links.id, external_tracking_link_id: tracking_links.external_tracking_link_id, campaign_name: tracking_links.campaign_name })
          .from(tracking_links)
          .where(sql`account_id = ${account.id} AND deleted_at IS NULL AND external_tracking_link_id IS NOT NULL`);

        if (accountLinks.length === 0) {
          await send({ step: "account_skip", message: `${account.display_name}: no tracking links, skipping` });
          accountResults.push({ account: account.display_name ?? account.id, status: "no_links", attributed: 0, api_calls: 0, links_processed: 0 });
          continue;
        }

        await send({ step: "account_start", message: `${account.display_name}: ${accountLinks.length} tracking links` });

        let accountAttributed = 0;
        let accountApiCalls = 0;
        let accountStatus = "ok";
        let accountNote: string | undefined;
        let linksProcessed = 0;

        for (const link of accountLinks) {
          const extId = link.external_tracking_link_id!;
          const linkUuid = link.id;

          // Incremental: check checkpoint per tracking link
          const settingKey = `sub_sync_link_${linkUuid}`;
          const [settingRow] = await db
            .select({ value: sync_settings.value })
            .from(sync_settings)
            .where(eq(sync_settings.key, settingKey))
            .limit(1);

          const today = new Date().toISOString().split("T")[0];
          const storedDate = settingRow?.value ?? null;
          const checkpointValid = storedDate && storedDate < today;
          const afterParam = (!forceFull && checkpointValid) ? `&after=${storedDate}` : "";

          const baseUrl = `${API_BASE}/${account.onlyfans_account_id}/tracking-links/${extId}/subscribers?limit=100`;
          let url: string | null = `${baseUrl}${afterParam}`;
          let linkApiCalls = 0;
          let linkAttributed = 0;
          let newestDate: string | null = null;
          let linkAuthFailed = false;

          while (url && linkApiCalls < 200) {
            linkApiCalls++;
            accountApiCalls++;
            totalApiCalls++;

            const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });

            if (res.status === 429) {
              const retryAfter = Number(res.headers.get("Retry-After") ?? 15);
              await sleep(retryAfter * 1000);
              linkApiCalls--; accountApiCalls--; totalApiCalls--;
              continue;
            }
            if (res.status === 401 || res.status === 403) {
              accountStatus = "auth_error";
              accountNote = `HTTP ${res.status}`;
              errors.push(`${account.display_name}: HTTP ${res.status} (auth)`);
              linkAuthFailed = true;
              break;
            }
            if (!res.ok) {
              // Non-fatal per link — log and move on
              errors.push(`${account.display_name} / link ${extId}: HTTP ${res.status}`);
              break;
            }

            const json = await res.json() as any;
            const page: any[] = json?.data?.list ?? json?.data ?? json?.subscribers ?? json?.list ?? [];
            if (!Array.isArray(page) || page.length === 0) break;

            type UpsertRow = { fan_id: string; username: string | null; sub_date: string | null };
            const upsertRows: UpsertRow[] = [];

            for (const sub of page) {
              const fanId = extractFanId(sub);
              if (!fanId) continue;
              linkAttributed++;

              const dateStr = extractSubDate(sub);
              if (dateStr && (!newestDate || dateStr > newestDate)) newestDate = dateStr;

              upsertRows.push({ fan_id: fanId, username: extractUsername(sub), sub_date: dateStr });
            }

            if (upsertRows.length > 0) {
              // Chunk into batches of 50 to avoid oversized SQL
              for (let i = 0; i < upsertRows.length; i += 50) {
                const chunk = upsertRows.slice(i, i + 50);
                const vals = chunk.map(r => sql`(
                  ${r.fan_id},
                  ${r.username},
                  ${sql`${linkUuid}::uuid`},
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
            }

            const nextRaw = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
            url = nextRaw
              ? (String(nextRaw).startsWith("http") ? String(nextRaw) : `${API_BASE}${nextRaw}`)
              : null;

            await sleep(100);
          }

          if (linkAuthFailed) break; // auth error — skip remaining links for this account

          // Advance checkpoint for this link
          if (newestDate) {
            await db.execute(sql`
              INSERT INTO sync_settings (key, value, updated_at)
              VALUES (${settingKey}, ${newestDate}, NOW())
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `);
          }

          accountAttributed += linkAttributed;
          linksProcessed++;

          if (linksProcessed % 5 === 0) {
            await send({ step: "progress", message: `${account.display_name}: ${linksProcessed}/${accountLinks.length} links, ${accountAttributed} fans so far...` });
          }

          await sleep(50);
        }

        totalAttributed += accountAttributed;
        accountResults.push({ account: account.display_name ?? account.id, status: accountStatus, attributed: accountAttributed, api_calls: accountApiCalls, links_processed: linksProcessed, note: accountNote });
        await send({ step: "account_done", message: `${account.display_name}: ${accountAttributed} fans attributed (${linksProcessed} links, ${accountApiCalls} API calls)` });
        // Persist progress periodically so a timeout leaves a useful partial record
        if (syncLogId) {
          await db.update(sync_logs).set({ records_processed: totalAttributed }).where(eq(sync_logs.id, syncLogId));
        }
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
          message: `${totalAttributed} fans attributed via per-link endpoint (${totalApiCalls} API calls, ${forceFull ? "full" : "incremental"}), ${ltvUpdated} cross-poll links updated${errors.length ? `. Errors: ${errors.slice(0, 3).join("; ")}` : ""}`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
          details: { attributed: totalAttributed, api_calls: totalApiCalls, ltv_links: ltvUpdated, force_full: forceFull, account_results: accountResults },
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

import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, tracking_links, sync_logs } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

const MAX_RUNTIME_MS = 540_000; // 9 minutes — stop gracefully before Railway's 10-min limit

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function extractFanId(sub: any): string | null {
  const raw = sub?.id ?? sub?.user?.id ?? sub?.userId ?? sub?.fan_id ?? sub?.fanId ?? null;
  return raw != null ? String(raw) : null;
}
function extractUsername(sub: any): string | null {
  return sub?.username ?? sub?.user?.username ?? sub?.userName ?? null;
}
function extractSubDate(sub: any): string | null {
  // subscribedBy is the actual date field from the tracking-link subscribers endpoint
  const raw = sub?.subscribedBy ?? sub?.subscribedOn ?? sub?.subscribedAt ?? sub?.subscribeAt ?? sub?.createdAt ?? sub?.joinDate ?? sub?.created_at ?? null;
  if (!raw) return null;
  const s = String(raw);
  return s.includes("T") ? s.split("T")[0] : (s.length >= 10 ? s.slice(0, 10) : null);
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

  let updated = 0;
  for (const row of rows.rows as any[]) {
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
// Body: { triggered_by?, force_full?, account_id? }
//
// Iterates every tracking link per account via the OFAPI per-link subscriber endpoint:
//   GET /{ofAccountId}/tracking-links/{extId}/subscribers?limit=100
//
// OFAPI is the single source of truth — always overwrites first_subscribe_link_id.
// Per-account mode (account_id in body) processes one account at a time to avoid
// Railway's 10-minute connection timeout.
router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy   = body.triggered_by ?? "manual";
  const filterAccountId: string | null = body.account_id ?? null;
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `subscriber_sync_${triggeredBy}`,
    message: filterAccountId ? "Subscriber attribution (per account, OFAPI)" : "Subscriber attribution (all accounts, OFAPI)",
    records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    const errors: string[] = [];
    let totalAttributed = 0;
    let totalApiCalls = 0;
    const startTime = Date.now();
    type AccountResult = { account: string; status: string; attributed: number; api_calls: number; links_processed: number; note?: string };
    const accountResults: AccountResult[] = [];

    try {
      const enabledAccounts = await db
        .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
        .from(accounts)
        .where(and(
          eq(accounts.is_active, true),
          sql`accounts.sync_excluded IS NOT TRUE`,
          filterAccountId ? eq(accounts.id, filterAccountId) : sql`TRUE`,
        ));

      await send({ step: "accounts", message: `${enabledAccounts.length} account(s) to process` });

      for (const account of enabledAccounts) {
        if (!account.onlyfans_account_id) continue;

        // Hard stop before Railway timeout
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          await send({ step: "timeout_stop", message: "Approaching time limit — stopping gracefully. Run per-account to continue." });
          break;
        }

        const accountLinks = await db
          .select({ id: tracking_links.id, external_tracking_link_id: tracking_links.external_tracking_link_id, campaign_name: tracking_links.campaign_name })
          .from(tracking_links)
          .where(sql`account_id = ${account.id} AND deleted_at IS NULL AND external_tracking_link_id IS NOT NULL`);

        if (accountLinks.length === 0) {
          await send({ step: "account_skip", message: `${account.display_name}: no tracking links` });
          accountResults.push({ account: account.display_name ?? account.id, status: "no_links", attributed: 0, api_calls: 0, links_processed: 0 });
          continue;
        }

        await send({ step: "account_start", message: `${account.display_name}: ${accountLinks.length} tracking links` });

        let accountAttributed = 0;
        let accountApiCalls = 0;
        let linksProcessed = 0;
        let accountStatus = "ok";
        let accountNote: string | undefined;
        let authFailed = false;

        for (const link of accountLinks) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) break;

          const extId    = link.external_tracking_link_id!;
          const linkUuid = link.id;
          let url: string | null = `${API_BASE}/${account.onlyfans_account_id}/tracking-links/${extId}/subscribers?limit=100`;
          let linkApiCalls = 0;
          let linkAttributed = 0;

          while (url && linkApiCalls < 200) {
            if (Date.now() - startTime > MAX_RUNTIME_MS) { url = null; break; }

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
              errors.push(`${account.display_name}: HTTP ${res.status}`);
              authFailed = true;
              break;
            }
            if (!res.ok) {
              errors.push(`${account.display_name}/${extId}: HTTP ${res.status}`);
              break;
            }

            const json = await res.json() as any;
            const page: any[] = json?.data?.list ?? json?.data ?? json?.subscribers ?? json?.list ?? [];
            if (!Array.isArray(page) || page.length === 0) break;

            // Upsert all subscribers on this page — OFAPI is source of truth, always overwrite
            const rows: { fan_id: string; username: string | null; sub_date: string | null }[] = [];
            for (const sub of page) {
              const fanId = extractFanId(sub);
              if (!fanId) continue;
              rows.push({ fan_id: fanId, username: extractUsername(sub), sub_date: extractSubDate(sub) });
              linkAttributed++;
            }

            for (let i = 0; i < rows.length; i += 50) {
              const chunk = rows.slice(i, i + 50);
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
                  username             = COALESCE(EXCLUDED.username, fans.username),
                  first_subscribe_link_id = EXCLUDED.first_subscribe_link_id,
                  first_subscribe_date    = COALESCE(EXCLUDED.first_subscribe_date, fans.first_subscribe_date),
                  updated_at              = NOW()
              `);
            }

            const nextRaw = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null;
            url = nextRaw
              ? (String(nextRaw).startsWith("http") ? String(nextRaw) : `${API_BASE}${nextRaw}`)
              : null;

            await sleep(100);
          }

          if (authFailed) break;
          accountAttributed += linkAttributed;
          linksProcessed++;

          if (linksProcessed % 5 === 0) {
            await send({ step: "progress", message: `${account.display_name}: ${linksProcessed}/${accountLinks.length} links, ${accountAttributed} fans so far...` });
          }
          await sleep(50);
        }

        totalAttributed += accountAttributed;
        accountResults.push({ account: account.display_name ?? account.id, status: accountStatus, attributed: accountAttributed, api_calls: accountApiCalls, links_processed: linksProcessed, note: accountNote });
        await send({ step: "account_done", message: `${account.display_name}: ${accountAttributed} fans attributed across ${linksProcessed} links (${accountApiCalls} API calls)` });

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
          message: `${totalAttributed} fans attributed from OFAPI (${totalApiCalls} API calls), ${ltvUpdated} cross-poll links updated${errors.length ? `. Errors: ${errors.slice(0, 3).join("; ")}` : ""}`,
          error_message: errors.length > 0 ? errors.join("; ") : null,
          details: { attributed: totalAttributed, api_calls: totalApiCalls, ltv_links: ltvUpdated, account_results: accountResults },
        }).where(eq(sync_logs.id, syncLogId));
      }

      await send({
        step: "done",
        message: `Done — ${totalAttributed} fans attributed from OFAPI, ${ltvUpdated} cross-poll links updated (${totalApiCalls} API calls)`,
        attributed: totalAttributed, ltv_links: ltvUpdated, api_calls: totalApiCalls,
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

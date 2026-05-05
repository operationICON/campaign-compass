import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, sync_logs } from "../../db/schema.js";
import { eq, lt, and, sql, inArray, notInArray } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const serverUrl = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  const { stream, send, close } = createSSEStream();

  const [orchLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: triggeredBy,
    message: "Orchestrator started",
    records_processed: 0, accounts_synced: 0, tracking_links_synced: 0,
  }).returning();
  const orchLogId = orchLog?.id;

  (async () => {
    let accountsSynced = 0, totalLinksSynced = 0, totalApiCalls = 0;
    const errors: string[] = [];
    type OrchestratorAccountResult = { account: string; status: string; links: number; api_calls: number; note?: string };
    const accountResults: OrchestratorAccountResult[] = [];

    try {
      await send({ step: "cleanup", message: "Cleaning up stuck syncs..." });

      // Only mark syncs as stuck if they've been running for >90 minutes
      // (revenue breakdown full scans can legitimately take 60+ min)
      const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000);
      const stuck = await db
        .select({ id: sync_logs.id })
        .from(sync_logs)
        .where(and(eq(sync_logs.status, "running"), lt(sync_logs.started_at, ninetyMinAgo)));
      for (const row of stuck.filter(r => r.id !== orchLogId)) {
        await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: "Sync timed out" }).where(eq(sync_logs.id, row.id));
      }

      // Discover accounts from OF API
      await send({ step: "discovery", message: "Discovering accounts..." });
      try {
        const res = await fetch(`${API_BASE}/accounts`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
        totalApiCalls++; // 1 credit for /accounts
        if (res.ok) {
          const data = await res.json() as any;
          const list = Array.isArray(data) ? data : (data.data ?? []);
          const seenOfIds = new Set<string>();

          for (const acc of list) {
            const ofId = String(acc.id);
            seenOfIds.add(ofId);
            const ud = acc.onlyfans_user_data ?? {};
            const numericId = ud.id ? Number(ud.id) : null;
            const freshSubCount = ud.subscribersCount && ud.subscribersCount > 0 ? ud.subscribersCount : null;
            const now = new Date();
            const updateSet: Record<string, any> = {
              display_name: ud.name ?? acc.display_name ?? String(acc.id),
              avatar_url: ud.avatar ?? null,
              avatar_thumb_url: ud.avatarThumbs?.c144 ?? null,
              username: acc.onlyfans_username ?? ud.username ?? null,
              numeric_of_id: numericId,
              is_active: true,   // re-activate if they were previously marked ex-model
              last_seen: now,
              updated_at: now,
            };
            if (freshSubCount !== null) updateSet.subscribers_count = freshSubCount;
            await db.insert(accounts).values({
              onlyfans_account_id: ofId,
              username: acc.onlyfans_username ?? ud.username ?? null,
              display_name: acc.display_name ?? ud.name ?? String(acc.id),
              is_active: true,
              last_seen: now,
              subscribers_count: freshSubCount ?? 0,
              avatar_url: ud.avatar ?? null,
              avatar_thumb_url: ud.avatarThumbs?.c144 ?? null,
              numeric_of_id: numericId,
            }).onConflictDoUpdate({ target: accounts.onlyfans_account_id, set: updateSet });
          }

          // Mark accounts missing from the OFAPI response as ex-model (is_active = false)
          // Only do this when we got a valid non-empty list — avoids false positives on API errors
          if (seenOfIds.size > 0) {
            const seenArray = Array.from(seenOfIds);
            await db.update(accounts)
              .set({ is_active: false, updated_at: new Date() })
              .where(and(
                eq(accounts.is_active, true),
                notInArray(accounts.onlyfans_account_id, seenArray)
              ));
            const exCount = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.is_active, false));
            if (exCount.length > 0) {
              await send({ step: "ex_model", message: `${exCount.length} account(s) no longer in OFAPI — marked as ex-model` });
            }
          }
        }
      } catch (err: any) { console.error("Discovery error:", err.message); }

      const enabledAccounts = await db.select().from(accounts).where(and(eq(accounts.is_active, true), sql`accounts.sync_excluded IS NOT TRUE`));
      await send({ step: "syncing", message: `Syncing ${enabledAccounts.length} accounts...`, total: enabledAccounts.length });

      // Sync accounts in batches of 3 by calling the /sync/account endpoint internally
      const BATCH_SIZE = 3;
      for (let i = 0; i < enabledAccounts.length; i += BATCH_SIZE) {
        const batch = enabledAccounts.slice(i, i + BATCH_SIZE);
        await send({ step: "batch", batch: Math.floor(i / BATCH_SIZE) + 1, names: batch.map(a => a.display_name).join(", "), accountsSynced, totalLinksSynced });

        await Promise.all(batch.map(async (account) => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const res = await fetch(`${serverUrl}/sync/account`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ account_id: account.id, onlyfans_account_id: account.onlyfans_account_id, numeric_of_id: account.numeric_of_id, display_name: account.display_name }),
              });
              if (res.ok) {
                const result = await res.json() as any;
                accountsSynced++;
                const links = result.links ?? 0;
                const calls = result.api_calls ?? 0;
                totalLinksSynced += links;
                totalApiCalls += calls;
                accountResults.push({ account: account.display_name ?? account.id, status: "ok", links, api_calls: calls });
                return;
              }
              if (attempt === 0) continue;
              errors.push(`${account.display_name}: HTTP ${res.status}`);
              accountResults.push({ account: account.display_name ?? account.id, status: "error", links: 0, api_calls: 0, note: `HTTP ${res.status}` });
            } catch (err: any) {
              if (attempt === 0) continue;
              errors.push(`${account.display_name}: ${err.message}`);
              accountResults.push({ account: account.display_name ?? account.id, status: "error", links: 0, api_calls: 0, note: err.message });
            }
          }
        }));

        if (orchLogId) await db.update(sync_logs).set({ accounts_synced: accountsSynced, tracking_links_synced: totalLinksSynced, message: `${accountsSynced}/${enabledAccounts.length} accounts synced` }).where(eq(sync_logs.id, orchLogId));
      }

      const now = new Date();
      const hasErrors = errors.length > 0;
      if (orchLogId) await db.update(sync_logs).set({ status: hasErrors ? "partial" : "success", success: !hasErrors, finished_at: now, completed_at: now, accounts_synced: accountsSynced, tracking_links_synced: totalLinksSynced, records_processed: totalLinksSynced, message: `Synced ${accountsSynced}/${enabledAccounts.length} accounts, ${totalLinksSynced} links`, error_message: hasErrors ? errors.join("; ") : null, details: { api_calls: totalApiCalls, account_results: accountResults } }).where(eq(sync_logs.id, orchLogId));

      await send({ step: "done", message: `Synced ${accountsSynced}/${enabledAccounts.length} accounts`, accounts_synced: accountsSynced, tracking_links_synced: totalLinksSynced, api_calls: totalApiCalls, errors: errors.length > 0 ? errors : undefined });
    } catch (err: any) {
      if (orchLogId) await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, orchLogId));
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

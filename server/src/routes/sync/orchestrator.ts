import { Hono } from "hono";
import { db } from "../../db/client.js";
import { accounts, sync_logs } from "../../db/schema.js";
import { eq, gt } from "drizzle-orm";
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

    try {
      await send({ step: "cleanup", message: "Cleaning up stuck syncs..." });

      // Mark stuck syncs as failed
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      const stuck = await db.select({ id: sync_logs.id }).from(sync_logs).where(eq(sync_logs.status, "running"));
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
          for (const acc of list) {
            const ud = acc.onlyfans_user_data ?? {};
            const numericId = ud.id ? Number(ud.id) : null;
            const freshSubCount = ud.subscribersCount && ud.subscribersCount > 0 ? ud.subscribersCount : null;
            const updateSet: Record<string, any> = {
              display_name: ud.name ?? acc.display_name ?? String(acc.id),
              avatar_url: ud.avatar ?? null,
              avatar_thumb_url: ud.avatarThumbs?.c144 ?? null,
              username: acc.onlyfans_username ?? ud.username ?? null,
              numeric_of_id: numericId,
              updated_at: new Date(),
            };
            // Only overwrite subscribers_count when the API returns a real positive value
            if (freshSubCount !== null) updateSet.subscribers_count = freshSubCount;
            await db.insert(accounts).values({
              onlyfans_account_id: String(acc.id),
              username: acc.onlyfans_username ?? ud.username ?? null,
              display_name: acc.display_name ?? ud.name ?? String(acc.id),
              is_active: true,
              subscribers_count: freshSubCount ?? 0,
              avatar_url: ud.avatar ?? null,
              avatar_thumb_url: ud.avatarThumbs?.c144 ?? null,
              numeric_of_id: numericId,
            }).onConflictDoUpdate({ target: accounts.onlyfans_account_id, set: updateSet });
          }
        }
      } catch (err: any) { console.error("Discovery error:", err.message); }

      const enabledAccounts = await db.select().from(accounts).where(eq(accounts.is_active, true));
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
                totalLinksSynced += result.links ?? 0;
                totalApiCalls += result.api_calls ?? 0;
                return;
              }
              if (attempt === 0) continue;
              errors.push(`${account.display_name}: HTTP ${res.status}`);
            } catch (err: any) {
              if (attempt === 0) continue;
              errors.push(`${account.display_name}: ${err.message}`);
            }
          }
        }));

        if (orchLogId) await db.update(sync_logs).set({ accounts_synced: accountsSynced, tracking_links_synced: totalLinksSynced, message: `${accountsSynced}/${enabledAccounts.length} accounts synced` }).where(eq(sync_logs.id, orchLogId));
      }

      const now = new Date();
      const hasErrors = errors.length > 0;
      if (orchLogId) await db.update(sync_logs).set({ status: hasErrors ? "partial" : "success", success: !hasErrors, finished_at: now, completed_at: now, accounts_synced: accountsSynced, tracking_links_synced: totalLinksSynced, records_processed: totalLinksSynced, message: `Synced ${accountsSynced}/${enabledAccounts.length} accounts, ${totalLinksSynced} links`, error_message: hasErrors ? errors.join("; ") : null, details: { api_calls: totalApiCalls } }).where(eq(sync_logs.id, orchLogId));

      await send({ step: "done", message: `Synced ${accountsSynced}/${enabledAccounts.length} accounts`, accounts_synced: accountsSynced, tracking_links_synced: totalLinksSynced, api_calls: totalApiCalls, errors: errors.length > 0 ? errors : undefined });
    } catch (err: any) {
      if (orchLogId) await db.update(sync_logs).set({ status: "error", success: false, finished_at: new Date(), completed_at: new Date(), error_message: err.message }).where(eq(sync_logs.id, orchLogId));
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;

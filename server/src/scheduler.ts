import cron from "node-cron";
import { db } from "./db/client.js";
import { sync_settings, sync_logs } from "./db/schema.js";
import { eq, desc, like } from "drizzle-orm";

const BASE_URL = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function drainSSE(path: string, triggeredBy: string) {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggered_by: triggeredBy }),
    });
    if (!res.ok || !res.body) {
      console.error(`[Scheduler] ${path} returned HTTP ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    console.log(`[Scheduler] ${path} complete`);
  } catch (err: any) {
    console.error(`[Scheduler] ${path} failed:`, err.message);
  }
}

async function getOTSyncIntervalHours(): Promise<number> {
  try {
    const [row] = await db.select().from(sync_settings).where(eq(sync_settings.key, "ot_sync_interval_hours"));
    return row?.value ? Math.max(1, Number(row.value)) : 24;
  } catch { return 24; }
}

async function getLastOTSyncTime(): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ started_at: sync_logs.started_at })
      .from(sync_logs)
      .where(like(sync_logs.triggered_by, "onlytraffic_sync_%"))
      .orderBy(desc(sync_logs.started_at))
      .limit(1);
    return row?.started_at ?? null;
  } catch { return null; }
}

async function runOTSyncIfDue() {
  const intervalHours = await getOTSyncIntervalHours();
  const lastRun = await getLastOTSyncTime();
  const nowMs = Date.now();
  const dueMs = lastRun ? lastRun.getTime() + intervalHours * 60 * 60 * 1000 : 0;
  if (nowMs >= dueMs) {
    console.log(`[Scheduler] OT sync due (interval=${intervalHours}h, last=${lastRun?.toISOString() ?? "never"})`);
    await drainSSE("/sync/onlytraffic", "cron_interval");
  } else {
    const minRemaining = Math.round((dueMs - nowMs) / 60000);
    console.log(`[Scheduler] OT sync not due yet — ${minRemaining}min remaining`);
  }
}

async function runDailySync() {
  console.log("[Scheduler] Daily sync starting: snapshots → crosspoll");
  await drainSSE("/sync/snapshots", "cron_daily");
  await drainSSE("/sync/crosspoll", "cron_daily");
  console.log("[Scheduler] Daily sync complete");
}

async function runDashboardSync() {
  console.log("[Scheduler] Scheduled dashboard sync starting");
  await drainSSE("/sync/orchestrate", "cron_dashboard");
  console.log("[Scheduler] Dashboard sync complete");
}

export function startScheduler() {
  // Every day at 02:00 UTC — snapshots + crosspoll
  cron.schedule("0 2 * * *", () => { runDailySync().catch(console.error); }, { timezone: "UTC" });

  // Every 3 days at 03:00 UTC — full dashboard sync (accounts + tracking links)
  cron.schedule("0 3 */3 * *", () => { runDashboardSync().catch(console.error); }, { timezone: "UTC" });

  // Every 30 min — check if OT sync interval has elapsed and run if due
  setInterval(() => { runOTSyncIfDue().catch(console.error); }, 30 * 60 * 1000);
  // Check once shortly after startup
  setTimeout(() => { runOTSyncIfDue().catch(console.error); }, 10_000);

  console.log("[Scheduler] Cron jobs active — daily at 02:00 UTC, dashboard every 3 days at 03:00 UTC, OT sync checked every 30min");
}

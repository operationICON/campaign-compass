import cron from "node-cron";
import { db } from "./db/client.js";
import { sync_settings, sync_logs } from "./db/schema.js";
import { eq, desc, like } from "drizzle-orm";

const BASE_URL = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

// Guards — prevent overlapping runs of the same job
let otSyncRunning = false;
let dailySyncRunning = false;
let dashboardSyncRunning = false;

async function drainSSE(path: string, triggeredBy: string) {
  const url = `${BASE_URL}${path}`;
  console.log(`[Scheduler] POST ${url} (triggered_by=${triggeredBy})`);
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
    const hours = row?.value ? Math.max(1, Number(row.value)) : 4;
    console.log(`[Scheduler] OT interval from DB: ${hours}h`);
    return hours;
  } catch (err: any) {
    console.error("[Scheduler] Failed to read OT interval:", err.message);
    return 4;
  }
}

async function getLastOTSyncTime(): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ started_at: sync_logs.started_at })
      .from(sync_logs)
      .where(like(sync_logs.triggered_by, "onlytraffic_sync_%"))
      .orderBy(desc(sync_logs.started_at))
      .limit(1);
    const t = row?.started_at ?? null;
    console.log(`[Scheduler] Last OT sync: ${t?.toISOString() ?? "never"}`);
    return t;
  } catch (err: any) {
    console.error("[Scheduler] Failed to read last OT sync time:", err.message);
    return null;
  }
}

async function runOTSyncIfDue() {
  if (otSyncRunning) {
    console.log("[Scheduler] OT sync already running — skipping check");
    return;
  }
  const intervalHours = await getOTSyncIntervalHours();
  const lastRun = await getLastOTSyncTime();
  const nowMs = Date.now();
  const dueMs = lastRun ? lastRun.getTime() + intervalHours * 60 * 60 * 1000 : 0;
  if (nowMs >= dueMs) {
    console.log(`[Scheduler] OT sync due — running (interval=${intervalHours}h, last=${lastRun?.toISOString() ?? "never"})`);
    otSyncRunning = true;
    try {
      await drainSSE("/sync/onlytraffic", "cron_interval");
    } finally {
      otSyncRunning = false;
    }
  } else {
    const minRemaining = Math.round((dueMs - nowMs) / 60000);
    console.log(`[Scheduler] OT sync not due — ${minRemaining}min remaining`);
  }
}

async function runDailySync() {
  if (dailySyncRunning) {
    console.log("[Scheduler] Daily sync already running — skipping");
    return;
  }
  dailySyncRunning = true;
  console.log("[Scheduler] Daily sync starting: revenue-breakdown → snapshots → fans");
  try {
    // Revenue breakdown FIRST so transactions table is fresh before fans reconcile
    await drainSSE("/sync/revenue-breakdown", "cron_daily");
    await drainSSE("/sync/snapshots", "cron_daily");
    await drainSSE("/sync/fans", "cron_daily");
    console.log("[Scheduler] Daily sync complete");
  } finally {
    dailySyncRunning = false;
  }
}

let subSyncRunning = false;

async function runSubAttributionSync() {
  if (subSyncRunning) {
    console.log("[Scheduler] Sub attribution sync already running — skipping");
    return;
  }
  subSyncRunning = true;
  console.log("[Scheduler] Sub attribution sync starting");
  try {
    await drainSSE("/sync/subscribers", "cron_daily");
    console.log("[Scheduler] Sub attribution sync complete");
  } finally {
    subSyncRunning = false;
  }
}

async function runDashboardSync() {
  if (dashboardSyncRunning) {
    console.log("[Scheduler] Dashboard sync already running — skipping");
    return;
  }
  dashboardSyncRunning = true;
  console.log("[Scheduler] Dashboard sync starting: accounts + tracking links");
  try {
    await drainSSE("/sync/orchestrate", "cron_dashboard");
    console.log("[Scheduler] Dashboard sync complete");
  } finally {
    dashboardSyncRunning = false;
  }
}

export function startScheduler() {
  // 01:00 UTC daily — full dashboard sync (accounts + tracking links)
  cron.schedule("0 1 * * *", () => { runDashboardSync().catch(console.error); }, { timezone: "UTC" });

  // 03:00 UTC daily — snapshots (runs after dashboard; fetches yesterday+today so complete prior day is always captured)
  cron.schedule("0 3 * * *", () => { runDailySync().catch(console.error); }, { timezone: "UTC" });

  // 06:00 UTC daily — sub attribution backfill (after all other daily syncs complete)
  cron.schedule("0 6 * * *", () => { runSubAttributionSync().catch(console.error); }, { timezone: "UTC" });

  // 04:00 UTC daily — sync OF earnings snapshots (ground-truth revenue totals)
  cron.schedule("0 4 * * *", async () => {
    console.log("[Scheduler] Earnings snapshot sync starting");
    try {
      const res = await fetch(`${BASE_URL}/revenue-snapshots/sync`, { method: "POST" });
      const data = await res.json() as any;
      console.log(`[Scheduler] Earnings snapshot sync complete — grand total: $${data.grand_total_net?.toFixed(2)}`);
    } catch (err: any) {
      console.error("[Scheduler] Earnings snapshot sync failed:", err.message);
    }
  }, { timezone: "UTC" });

  // Every 30 min — check if OT sync interval has elapsed and run if due
  setInterval(async () => {
    try { await runOTSyncIfDue(); } catch (err: any) { console.error("[Scheduler] OT check error:", err.message); }
  }, 30 * 60 * 1000);

  // Check OT sync once 30s after startup (give server time to fully bind)
  setTimeout(async () => {
    try { await runOTSyncIfDue(); } catch (err: any) { console.error("[Scheduler] OT startup check error:", err.message); }
  }, 30_000);

  // Keep-alive ping every 4 minutes so Railway doesn't put the service to sleep
  setInterval(async () => {
    try {
      await fetch(`${BASE_URL}/health`);
    } catch {
      // ignore — if it fails, nothing to do
    }
  }, 4 * 60 * 1000);

  console.log("[Scheduler] Active — dashboard 01:00 UTC, rev-breakdown+snapshots+fans 03:00 UTC, earnings-snapshots 04:00 UTC, sub-attribution 06:00 UTC, OT checked every 30min");
}

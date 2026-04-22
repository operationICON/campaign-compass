import cron from "node-cron";

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

async function runDailySync() {
  console.log("[Scheduler] Daily sync starting: snapshots → onlytraffic");
  await drainSSE("/sync/snapshots", "cron_daily");
  await drainSSE("/sync/onlytraffic", "cron_daily");
  console.log("[Scheduler] Daily sync complete");
}

async function runDashboardSync() {
  console.log("[Scheduler] Scheduled dashboard sync starting");
  await drainSSE("/sync/orchestrate", "cron_dashboard");
  console.log("[Scheduler] Dashboard sync complete");
}

export function startScheduler() {
  // Every day at 02:00 UTC — snapshots + onlytraffic orders
  cron.schedule("0 2 * * *", () => { runDailySync().catch(console.error); }, { timezone: "UTC" });

  // Every 3 days at 03:00 UTC — full dashboard sync (accounts + tracking links)
  cron.schedule("0 3 */3 * *", () => { runDashboardSync().catch(console.error); }, { timezone: "UTC" });

  console.log("[Scheduler] Cron jobs active — daily at 02:00 UTC, dashboard every 3 days at 03:00 UTC");
}

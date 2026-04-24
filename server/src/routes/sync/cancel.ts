import { Hono } from "hono";
import { db } from "../../db/client.js";
import { sync_logs } from "../../db/schema.js";
import { eq, and, like } from "drizzle-orm";
import { cancelFlags } from "../../lib/cancelFlags.js";

const router = new Hono();

// Triggered_by prefix patterns per sync type
const TYPE_PATTERNS: Record<string, string> = {
  revenue_breakdown: "%revenue_breakdown%",
  dashboard: "%manual%",
  crosspoll: "%crosspoll%",
  onlytraffic: "%onlytraffic%",
  snapshot: "%snapshot%",
};

router.post("/", async (c) => {
  const { sync_log_id, sync_type } = await c.req.json().catch(() => ({}));

  const now = new Date();
  const cancelled: number[] = [];

  if (sync_type && TYPE_PATTERNS[sync_type]) {
    // Cancel all running logs for this sync type
    const rows = await db
      .select({ id: sync_logs.id })
      .from(sync_logs)
      .where(and(eq(sync_logs.status, "running"), like(sync_logs.triggered_by, TYPE_PATTERNS[sync_type])));
    for (const row of rows) {
      cancelFlags.set(row.id, true);
      await db.update(sync_logs).set({
        status: "error", success: false,
        finished_at: now, completed_at: now,
        error_message: "Cancelled by user",
      }).where(eq(sync_logs.id, row.id));
      cancelled.push(row.id);
    }
  } else if (sync_log_id) {
    // Cancel a specific log by ID
    const id = Number(sync_log_id);
    cancelFlags.set(id, true);
    await db.update(sync_logs).set({
      status: "error", success: false,
      finished_at: now, completed_at: now,
      error_message: "Cancelled by user",
    }).where(eq(sync_logs.id, id));
    cancelled.push(id);
  } else {
    return c.json({ error: "sync_log_id or sync_type required" }, 400);
  }

  return c.json({ ok: true, cancelled });
});

export default router;

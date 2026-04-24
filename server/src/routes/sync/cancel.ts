import { Hono } from "hono";
import { db } from "../../db/client.js";
import { sync_logs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { cancelFlags } from "../../lib/cancelFlags.js";

const router = new Hono();

router.post("/", async (c) => {
  const { sync_log_id } = await c.req.json().catch(() => ({}));
  if (!sync_log_id) return c.json({ error: "sync_log_id required" }, 400);

  const id = Number(sync_log_id);
  cancelFlags.set(id, true);

  await db.update(sync_logs).set({
    status: "error",
    success: false,
    finished_at: new Date(),
    completed_at: new Date(),
    error_message: "Cancelled by user",
  }).where(eq(sync_logs.id, id));

  return c.json({ ok: true, cancelled: id });
});

export default router;

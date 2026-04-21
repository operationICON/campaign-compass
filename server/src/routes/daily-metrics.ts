import { Hono } from "hono";
import { db } from "../db/client.js";
import { daily_metrics } from "../db/schema.js";
import { inArray, asc } from "drizzle-orm";

const router = new Hono();

// GET /daily-metrics?tracking_link_ids=id1,id2,...
router.get("/", async (c) => {
  const idsParam = c.req.query("tracking_link_ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];

  if (!ids.length) return c.json([]);

  const rows = await db
    .select()
    .from(daily_metrics)
    .where(inArray(daily_metrics.tracking_link_id, ids))
    .orderBy(asc(daily_metrics.date));
  return c.json(rows);
});

export default router;

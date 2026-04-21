import { Hono } from "hono";
import { db } from "../db/client.js";
import { daily_snapshots } from "../db/schema.js";
import { inArray, gte, lte, and, asc } from "drizzle-orm";

const router = new Hono();

// GET /daily-snapshots?tracking_link_ids=id1,id2&date_from=&date_to=
router.get("/", async (c) => {
  const idsParam = c.req.query("tracking_link_ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");

  if (!ids.length) return c.json([]);

  const rows = await db
    .select()
    .from(daily_snapshots)
    .where(
      and(
        inArray(daily_snapshots.tracking_link_id, ids),
        dateFrom ? gte(daily_snapshots.snapshot_date, dateFrom) : undefined,
        dateTo ? lte(daily_snapshots.snapshot_date, dateTo) : undefined,
      )
    )
    .orderBy(asc(daily_snapshots.snapshot_date))
    .limit(1000);
  return c.json(rows);
});

export default router;

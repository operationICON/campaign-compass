import { Hono } from "hono";
import { db } from "../db/client.js";
import { onlytraffic_orders, onlytraffic_unmatched_orders } from "../db/schema.js";
import { inArray, gte, lte, and, not, isNull, eq } from "drizzle-orm";

const router = new Hono();

const ACTIVE_STATUSES = ["completed", "accepted", "active", "waiting"];

// GET /onlytraffic-orders?tracking_link_ids=&date_from=&date_to=&statuses=&marketer=&offer_id=
router.get("/", async (c) => {
  const idsParam = c.req.query("tracking_link_ids");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const statusesParam = c.req.query("statuses");
  const marketer = c.req.query("marketer");
  const offerIdParam = c.req.query("offer_id");
  const activeOnly = c.req.query("active_only") === "true";

  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
  const statuses = statusesParam ? statusesParam.split(",").filter(Boolean) : activeOnly ? ACTIVE_STATUSES : [];

  const conditions = [
    ids.length ? inArray(onlytraffic_orders.tracking_link_id, ids) : undefined,
    dateFrom ? gte(onlytraffic_orders.order_created_at, new Date(dateFrom + "T00:00:00Z")) : undefined,
    dateTo ? lte(onlytraffic_orders.order_created_at, new Date(dateTo + "T23:59:59Z")) : undefined,
    statuses.length ? inArray(onlytraffic_orders.status, statuses) : undefined,
    marketer ? eq(onlytraffic_orders.marketer, marketer) : undefined,
    offerIdParam ? eq(onlytraffic_orders.offer_id, offerIdParam) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(onlytraffic_orders)
    .where(conditions.length ? and(...(conditions as any[])) : undefined)
    .limit(10000);
  return c.json(rows);
});

// GET /onlytraffic-orders/unmatched
router.get("/unmatched", async (c) => {
  const rows = await db.select().from(onlytraffic_unmatched_orders).limit(5000);
  return c.json(rows);
});

export default router;

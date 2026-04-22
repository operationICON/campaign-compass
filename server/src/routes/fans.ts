import { Hono } from "hono";
import { db } from "../db/client.js";
import { fans, fan_attributions, fan_spend } from "../db/schema.js";
import { sql } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db
    .select()
    .from(fans)
    .limit(10000);
  return c.json(rows);
});

// GET /fans/count
router.get("/count", async (c) => {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(fans);
  return c.json({ count: Number(result[0]?.count ?? 0) });
});

// GET /fans/attribution-counts — returns { [account_id]: count } from fan_attributions
router.get("/attribution-counts", async (c) => {
  const rows = await db
    .select({ account_id: fan_attributions.account_id })
    .from(fan_attributions);
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.account_id) counts[r.account_id] = (counts[r.account_id] || 0) + 1;
  }
  return c.json(counts);
});

// GET /fans/spenders — returns fan_spend rows
router.get("/spenders", async (c) => {
  const rows = await db.select().from(fan_spend).limit(50000);
  return c.json(rows);
});

export default router;

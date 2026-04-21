import { Hono } from "hono";
import { db } from "../db/client.js";
import { ad_spend, campaigns } from "../db/schema.js";
import { eq, desc, and, gte, lte } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const campaignId = c.req.query("campaign_id");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");

  const rows = await db
    .select({ ...ad_spend, campaign_name: campaigns.name })
    .from(ad_spend)
    .leftJoin(campaigns, eq(ad_spend.campaign_id, campaigns.id))
    .where(
      and(
        campaignId ? eq(ad_spend.campaign_id, campaignId) : undefined,
        dateFrom ? gte(ad_spend.date, dateFrom) : undefined,
        dateTo ? lte(ad_spend.date, dateTo) : undefined,
      )
    )
    .orderBy(desc(ad_spend.date));
  return c.json(rows);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(ad_spend).values(body).returning();
  return c.json(row, 201);
});

router.delete("/:id", async (c) => {
  await db.delete(ad_spend).where(eq(ad_spend.id, c.req.param("id")));
  return c.json({ success: true });
});

export default router;

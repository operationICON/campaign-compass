import { Hono } from "hono";
import { db } from "../db/client.js";
import { alerts } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const unresolved = c.req.query("unresolved") === "true";
  const query = db.select().from(alerts).orderBy(desc(alerts.triggered_at));
  const rows = unresolved
    ? await db.select().from(alerts).where(eq(alerts.resolved, false)).orderBy(desc(alerts.triggered_at))
    : await query;
  return c.json(rows);
});

router.patch("/:id/resolve", async (c) => {
  const [row] = await db
    .update(alerts)
    .set({ resolved: true, resolved_at: new Date() })
    .where(eq(alerts.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

export default router;

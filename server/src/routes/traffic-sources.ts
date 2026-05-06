import { Hono } from "hono";
import { db } from "../db/client.js";
import { traffic_sources, tracking_links } from "../db/schema.js";
import { eq, asc, sql } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db.select().from(traffic_sources).orderBy(asc(traffic_sources.name));
  return c.json(rows);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(traffic_sources).values(body).returning();
  return c.json(row, 201);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db
    .update(traffic_sources)
    .set({ ...body, updated_at: new Date() })
    .where(eq(traffic_sources.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

router.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // Clear FK references first — otherwise Postgres rejects the delete
  const updated = await db
    .update(tracking_links)
    .set({ traffic_source_id: null })
    .where(eq(tracking_links.traffic_source_id, id))
    .returning({ id: tracking_links.id });
  await db.delete(traffic_sources).where(eq(traffic_sources.id, id));
  return c.json({ success: true, untagged: updated.length });
});

export default router;

import { Hono } from "hono";
import { db } from "../db/client.js";
import { sync_settings } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db.select().from(sync_settings);
  return c.json(rows);
});

router.put("/:key", async (c) => {
  const { value } = await c.req.json();
  const [row] = await db
    .insert(sync_settings)
    .values({ key: c.req.param("key"), value })
    .onConflictDoUpdate({ target: sync_settings.key, set: { value, updated_at: new Date() } })
    .returning();
  return c.json(row);
});

export default router;

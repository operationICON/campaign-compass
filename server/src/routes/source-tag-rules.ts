import { Hono } from "hono";
import { db } from "../db/client.js";
import { source_tag_rules } from "../db/schema.js";
import { eq, asc } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db.select().from(source_tag_rules).orderBy(asc(source_tag_rules.priority));
  return c.json(rows);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(source_tag_rules).values(body).returning();
  return c.json(row, 201);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db
    .update(source_tag_rules)
    .set(body)
    .where(eq(source_tag_rules.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

router.delete("/:id", async (c) => {
  await db.delete(source_tag_rules).where(eq(source_tag_rules.id, c.req.param("id")));
  return c.json({ success: true });
});

export default router;

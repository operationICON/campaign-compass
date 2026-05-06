import { Hono } from "hono";
import { db } from "../db/client.js";
import { source_tag_rules, tracking_links } from "../db/schema.js";
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
  const id = c.req.param("id");
  const [rule] = await db.select({ tag_name: source_tag_rules.tag_name }).from(source_tag_rules).where(eq(source_tag_rules.id, id));
  await db.delete(source_tag_rules).where(eq(source_tag_rules.id, id));
  // Clear matching source_tag strings on tracking links so deleted rules don't ghost on links
  if (rule?.tag_name) {
    await db.update(tracking_links).set({ source_tag: null, manually_tagged: false }).where(eq(tracking_links.source_tag, rule.tag_name));
  }
  return c.json({ success: true });
});

export default router;

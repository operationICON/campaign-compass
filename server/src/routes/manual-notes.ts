import { Hono } from "hono";
import { db } from "../db/client.js";
import { manual_notes } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db.select().from(manual_notes).orderBy(desc(manual_notes.updated_at));
  return c.json(rows);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(manual_notes).values(body).returning();
  return c.json(row);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db.update(manual_notes).set({ ...body, updated_at: new Date() }).where(eq(manual_notes.id, c.req.param("id"))).returning();
  return c.json(row);
});

router.delete("/:id", async (c) => {
  await db.delete(manual_notes).where(eq(manual_notes.id, c.req.param("id")));
  return c.json({ success: true });
});

export default router;

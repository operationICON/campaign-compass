import { Hono } from "hono";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";
import { desc, eq, sql } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.created_at))
    .limit(10);
  return c.json(rows);
});

router.get("/unread-count", async (c) => {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.read, false));
  return c.json({ count: Number(result?.count ?? 0) });
});

router.post("/mark-read", async (c) => {
  await db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
  return c.json({ success: true });
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(notifications).values(body).returning();
  return c.json(row, 201);
});

export default router;

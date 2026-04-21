import { Hono } from "hono";
import { db } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { eq, asc, desc, and, isNull } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db.select().from(accounts).orderBy(asc(accounts.display_name));
  return c.json(rows);
});

router.get("/:id", async (c) => {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(accounts).values(body).returning();
  return c.json(row, 201);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db
    .update(accounts)
    .set({ ...body, updated_at: new Date() })
    .where(eq(accounts.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

router.delete("/:id", async (c) => {
  await db.delete(accounts).where(eq(accounts.id, c.req.param("id")));
  return c.json({ success: true });
});

export default router;

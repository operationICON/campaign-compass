import { Hono } from "hono";
import { db } from "../db/client.js";
import { campaigns, accounts } from "../db/schema.js";
import { eq, desc, getTableColumns } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db
    .select({
      ...getTableColumns(campaigns),
      account_display_name: accounts.display_name,
    })
    .from(campaigns)
    .leftJoin(accounts, eq(campaigns.account_id, accounts.id))
    .orderBy(desc(campaigns.created_at));
  return c.json(rows);
});

router.get("/:id", async (c) => {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(campaigns).values(body).returning();
  return c.json(row);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db.update(campaigns).set(body).where(eq(campaigns.id, c.req.param("id"))).returning();
  return c.json(row);
});

router.delete("/:id", async (c) => {
  await db.delete(campaigns).where(eq(campaigns.id, c.req.param("id")));
  return c.json({ success: true });
});

export default router;

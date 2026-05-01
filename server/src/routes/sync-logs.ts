import { Hono } from "hono";
import { db } from "../db/client.js";
import { sync_logs, accounts } from "../db/schema.js";
import { desc, eq, getTableColumns, sql } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const accountId = c.req.query("account_id");
  
  let query = db
    .select({
      ...getTableColumns(sync_logs),
      account_display_name: accounts.display_name,
    })
    .from(sync_logs)
    .leftJoin(accounts, eq(sync_logs.account_id, accounts.id));
  
  if (accountId) {
    query = query.where(eq(sync_logs.account_id, accountId));
  }
  
  const rows = await query
    .orderBy(desc(sync_logs.started_at))
    .limit(500);
  return c.json(rows);
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(sync_logs).values(body).returning();
  return c.json(row, 201);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db
    .update(sync_logs)
    .set(body)
    .where(eq(sync_logs.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

export default router;

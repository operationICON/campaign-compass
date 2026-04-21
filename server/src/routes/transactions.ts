import { Hono } from "hono";
import { db } from "../db/client.js";
import { transactions, accounts } from "../db/schema.js";
import { eq, desc, and, gte, lte, inArray, sql } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  const accountId = c.req.query("account_id");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        accountId ? eq(transactions.account_id, accountId) : undefined,
        dateFrom ? gte(transactions.date, dateFrom) : undefined,
        dateTo ? lte(transactions.date, dateTo) : undefined,
      )
    )
    .orderBy(desc(transactions.date))
    .limit(2000);
  return c.json(rows);
});

// GET /transactions/type-totals — group by account_id and type
router.get("/type-totals", async (c) => {
  const rows = await db
    .select({
      account_id: transactions.account_id,
      type: transactions.type,
      revenue: sql<number>`sum(${transactions.revenue})`,
    })
    .from(transactions)
    .groupBy(transactions.account_id, transactions.type);
  return c.json(rows);
});

// GET /transactions/totals?account_id=&date_from=&date_to=
router.get("/totals", async (c) => {
  const accountId = c.req.query("account_id");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");

  const [result] = await db
    .select({
      total: sql<number>`sum(${transactions.revenue})`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(
      and(
        accountId ? eq(transactions.account_id, accountId) : undefined,
        dateFrom ? gte(transactions.date, dateFrom) : undefined,
        dateTo ? lte(transactions.date, dateTo) : undefined,
      )
    );
  return c.json({ total: Number(result?.total ?? 0), count: Number(result?.count ?? 0) });
});

export default router;

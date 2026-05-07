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

// GET /transactions/by-month?account_id= — monthly revenue + type breakdown for one account
router.get("/by-month", async (c) => {
  const accountId = c.req.query("account_id");
  if (!accountId) return c.json({ error: "account_id required" }, 400);

  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', date::date), 'YYYY-MM-DD') AS month,
      type,
      COALESCE(SUM(revenue::numeric), 0)                     AS revenue,
      COUNT(*)                                               AS tx_count
    FROM transactions
    WHERE account_id = ${accountId}::uuid
      AND revenue::numeric > 0
      AND date IS NOT NULL
    GROUP BY DATE_TRUNC('month', date::date), type
    ORDER BY month ASC
  `);
  return c.json(rows.rows);
});

// GET /transactions/daily?date_from=&date_to=&account_ids= — per-account per-day revenue for Overview
router.get("/daily", async (c) => {
  const dateFrom   = c.req.query("date_from");
  const dateTo     = c.req.query("date_to");
  const accountIds = c.req.queries("account_ids") ?? [];

  const conditions: any[] = [sql`${transactions.revenue}::numeric > 0`];
  if (dateFrom)            conditions.push(gte(transactions.date, dateFrom));
  if (dateTo)              conditions.push(lte(transactions.date, dateTo));
  if (accountIds.length > 0) conditions.push(inArray(transactions.account_id, accountIds));

  const rows = await db
    .select({
      account_id: sql<string>`${transactions.account_id}::text`,
      date:       sql<string>`${transactions.date}::text`,
      revenue:    sql<string>`COALESCE(SUM(${transactions.revenue}::numeric), 0)::text`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.account_id, transactions.date)
    .orderBy(transactions.date);

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

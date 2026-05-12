import { Hono } from "hono";
import { db } from "../db/client.js";
import { transactions, accounts } from "../db/schema.js";
import { eq, desc, and, gte, lte, inArray, sql } from "drizzle-orm";

const router = new Hono();

// GET /transactions?account_id=&date_from=&date_to=&tracking_link_id=&limit=2000
// Returns transactions enriched with the fan's acquisition campaign.
router.get("/", async (c) => {
  const accountId      = c.req.query("account_id");
  const dateFrom       = c.req.query("date_from");
  const dateTo         = c.req.query("date_to");
  const trackingLinkId = c.req.query("tracking_link_id");
  const limitRaw       = Math.min(Number(c.req.query("limit") ?? 2000), 10000);

  const conditions: ReturnType<typeof sql>[] = [];
  if (accountId)      conditions.push(sql`t.account_id = ${accountId}::uuid`);
  if (dateFrom)       conditions.push(sql`t.date >= ${dateFrom}`);
  if (dateTo)         conditions.push(sql`t.date <= ${dateTo}`);
  if (trackingLinkId) conditions.push(sql`f.first_subscribe_link_id = ${trackingLinkId}::uuid`);

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      t.*,
      f.id                                          AS fan_db_id,
      f.first_subscribe_link_id::text               AS fan_tracking_link_id,
      tl.campaign_name                              AS campaign_name,
      tl.external_tracking_link_id                  AS campaign_external_id,
      tl.account_id::text                           AS campaign_account_id
    FROM transactions t
    LEFT JOIN fans f ON f.fan_id = t.fan_username
    LEFT JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
    ${whereClause}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ${limitRaw}
  `);

  return c.json(rows.rows);
});

// GET /transactions/type-totals — group by account_id and type
router.get("/type-totals", async (c) => {
  const rows = await db
    .select({
      account_id: transactions.account_id,
      type: transactions.type,
      revenue: sql<number>`sum(${transactions.revenue})`,
      tx_count: sql<number>`count(*)`,
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

// GET /transactions/by-day?account_id= — daily revenue + type breakdown for one account
router.get("/by-day", async (c) => {
  const accountId = c.req.query("account_id");
  if (!accountId) return c.json({ error: "account_id required" }, 400);

  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(date::date, 'YYYY-MM-DD') AS day,
      type,
      COALESCE(SUM(revenue::numeric), 0) AS revenue,
      COUNT(*)                           AS tx_count
    FROM transactions
    WHERE account_id = ${accountId}::uuid
      AND revenue::numeric > 0
      AND date IS NOT NULL
    GROUP BY date::date, type
    ORDER BY day ASC
  `);
  return c.json(rows.rows);
});

// GET /transactions/daily?date_from=&date_to=&account_ids= — per-account per-day revenue for Overview
router.get("/daily", async (c) => {
  const dateFrom       = c.req.query("date_from");
  const dateTo         = c.req.query("date_to");
  const accountIdsRaw  = c.req.query("account_ids");
  const accountIds     = accountIdsRaw ? accountIdsRaw.split(",").filter(Boolean) : [];

  const conditions: any[] = [sql`${transactions.revenue}::numeric > 0`, sql`${transactions.date} IS NOT NULL`];
  if (dateFrom)              conditions.push(gte(transactions.date, dateFrom));
  if (dateTo)                conditions.push(lte(transactions.date, dateTo));
  if (accountIds.length > 0) conditions.push(inArray(transactions.account_id, accountIds));

  const rows = await db
    .select({
      account_id: sql<string>`${transactions.account_id}::text`,
      date:       sql<string>`${transactions.date}::text`,
      revenue:    sql<string>`COALESCE(SUM(
        CASE
          WHEN ${transactions.revenue_net} IS NOT NULL AND ${transactions.revenue_net}::text != ''
            THEN ${transactions.revenue_net}::numeric
          WHEN ${transactions.fee} IS NOT NULL AND ${transactions.fee}::text != ''
            THEN ${transactions.revenue}::numeric - ${transactions.fee}::numeric
          ELSE ${transactions.revenue}::numeric * 0.80
        END
      ), 0)::text`,
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

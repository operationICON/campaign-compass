import { Hono } from "hono";
import { db } from "../db/client.js";
import { daily_snapshots, tracking_links } from "../db/schema.js";
import { inArray, gte, lte, and, asc, desc, eq, sql } from "drizzle-orm";

const router = new Hono();

// GET /daily-snapshots/latest-date
router.get("/latest-date", async (c) => {
  const accountId = c.req.query("account_id");
  const [row] = await db
    .select({ snapshot_date: daily_snapshots.snapshot_date })
    .from(daily_snapshots)
    .where(accountId ? eq(daily_snapshots.account_id, accountId) : undefined)
    .orderBy(desc(daily_snapshots.snapshot_date))
    .limit(1);
  return c.json({ date: row?.snapshot_date ?? null });
});

// GET /daily-snapshots/earliest-date
router.get("/earliest-date", async (c) => {
  const [row] = await db
    .select({ snapshot_date: daily_snapshots.snapshot_date })
    .from(daily_snapshots)
    .orderBy(asc(daily_snapshots.snapshot_date))
    .limit(1);
  return c.json({ date: row?.snapshot_date ?? null });
});

// GET /daily-snapshots/distinct-dates — last N distinct snapshot dates
router.get("/distinct-dates", async (c) => {
  const limitN = Number(c.req.query("limit") ?? "10");
  const rows = await db
    .selectDistinct({ snapshot_date: daily_snapshots.snapshot_date })
    .from(daily_snapshots)
    .orderBy(desc(daily_snapshots.snapshot_date))
    .limit(limitN);
  return c.json(rows.map(r => r.snapshot_date).filter(Boolean));
});

// GET /daily-snapshots/alltime-totals?account_ids=
// Returns SUM(revenue) and SUM(subscribers) across all snapshots — used for correct all-time LTV/Sub
router.get("/alltime-totals", async (c) => {
  const accountIdsParam = c.req.query("account_ids");
  const accountIds = accountIdsParam ? accountIdsParam.split(",").filter(Boolean) : [];

  const condition = accountIds.length ? inArray(daily_snapshots.account_id, accountIds) : undefined;

  const [row] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${daily_snapshots.revenue}), 0)`,
      subscribers: sql<string>`COALESCE(SUM(${daily_snapshots.subscribers}), 0)`,
    })
    .from(daily_snapshots)
    .where(condition);

  return c.json({
    revenue: Number(row?.revenue ?? 0),
    subscribers: Number(row?.subscribers ?? 0),
  });
});

// GET /daily-snapshots/link-subs?account_ids=&date_from=&date_to=
// Returns [{tracking_link_id, account_id, subs}] — sum of daily subscriber deltas per link.
// JOINs tracking_links to get correct account_id (daily_snapshots.account_id can be stale).
router.get("/link-subs", async (c) => {
  const accountIdsParam = c.req.query("account_ids");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const accountIds = accountIdsParam ? accountIdsParam.split(",").filter(Boolean) : [];
  if (accountIds.length === 0) return c.json([]);

  const idList = sql.join(accountIds.map(id => sql`${id}::uuid`), sql`, `);

  const rows = await db.execute(sql`
    SELECT
      ds.tracking_link_id::text,
      tl.account_id::text AS account_id,
      COALESCE(SUM(ds.subscribers), 0)::int AS subs
    FROM daily_snapshots ds
    JOIN tracking_links tl ON ds.tracking_link_id = tl.id
    WHERE tl.account_id IN (${idList})
      ${dateFrom ? sql`AND ds.snapshot_date >= ${dateFrom}` : sql``}
      ${dateTo   ? sql`AND ds.snapshot_date <= ${dateTo}`   : sql``}
    GROUP BY ds.tracking_link_id, tl.account_id
    HAVING COALESCE(SUM(ds.subscribers), 0) > 0
    ORDER BY SUM(ds.subscribers) DESC
  `);

  return c.json(rows.rows);
});

// GET /daily-snapshots?tracking_link_ids=&account_ids=&date_from=&date_to=&cols=
router.get("/", async (c) => {
  const idsParam = c.req.query("tracking_link_ids");
  const accountIdsParam = c.req.query("account_ids");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const cols = c.req.query("cols"); // "slim" → only key columns

  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
  const accountIds = accountIdsParam ? accountIdsParam.split(",").filter(Boolean) : [];

  if (!ids.length && !accountIds.length && !dateFrom && !dateTo) {
    return c.json([]);
  }

  const conditions = [
    ids.length ? inArray(daily_snapshots.tracking_link_id, ids) : undefined,
    accountIds.length ? inArray(daily_snapshots.account_id, accountIds) : undefined,
    dateFrom ? gte(daily_snapshots.snapshot_date, dateFrom) : undefined,
    dateTo ? lte(daily_snapshots.snapshot_date, dateTo) : undefined,
  ].filter(Boolean);

  if (cols === "slim") {
    const rows = await db
      .select({
        tracking_link_id: daily_snapshots.tracking_link_id,
        account_id: daily_snapshots.account_id,
        snapshot_date: daily_snapshots.snapshot_date,
        clicks: daily_snapshots.clicks,
        subscribers: daily_snapshots.subscribers,
        revenue: daily_snapshots.revenue,
        cost_total: daily_snapshots.cost_total,
        raw_clicks: daily_snapshots.raw_clicks,
        raw_subscribers: daily_snapshots.raw_subscribers,
        raw_revenue: daily_snapshots.raw_revenue,
      })
      .from(daily_snapshots)
      .where(and(...(conditions as any[])))
      .orderBy(asc(daily_snapshots.snapshot_date))
      .limit(50000);
    return c.json(rows);
  }

  const rows = await db
    .select()
    .from(daily_snapshots)
    .where(and(...(conditions as any[])))
    .orderBy(asc(daily_snapshots.snapshot_date))
    .limit(50000);
  return c.json(rows);
});

export default router;

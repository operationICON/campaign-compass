import { Hono } from "hono";
import { db } from "../db/client.js";
import { fans, fan_account_stats, transactions, accounts } from "../db/schema.js";
import { eq, sql, desc } from "drizzle-orm";

const router = new Hono();

// ── GET /fans/stats ───────────────────────────────────────────────────────────
router.get("/stats", async (c) => {
  const accountId = c.req.query("account_id");

  const result = await db.execute(sql`
    SELECT
      COUNT(*)                                                                               AS total_fans,
      COUNT(CASE WHEN total_revenue::numeric > 0 THEN 1 END)                                AS spenders,
      COALESCE(SUM(total_revenue::numeric), 0)                                              AS total_revenue,
      COALESCE(AVG(CASE WHEN total_revenue::numeric > 0 THEN total_revenue::numeric END), 0) AS avg_per_spender,
      COUNT(CASE WHEN is_cross_poll = true THEN 1 END)                                      AS cross_poll_fans,
      COALESCE(SUM(CASE WHEN is_cross_poll = true THEN total_revenue::numeric ELSE 0 END), 0) AS cross_poll_revenue
    FROM fans
    WHERE total_transactions IS NOT NULL
      ${accountId ? sql`AND id IN (SELECT fan_id FROM fan_account_stats WHERE account_id = ${accountId}::uuid)` : sql``}
  `);

  const row = (result.rows[0] as any) ?? {};
  return c.json({
    total_fans: Number(row.total_fans ?? 0),
    spenders: Number(row.spenders ?? 0),
    total_revenue: Number(row.total_revenue ?? 0),
    avg_per_spender: Number(row.avg_per_spender ?? 0),
    cross_poll_fans: Number(row.cross_poll_fans ?? 0),
    cross_poll_revenue: Number(row.cross_poll_revenue ?? 0),
  });
});

// ── GET /fans ─────────────────────────────────────────────────────────────────
router.get("/", async (c) => {
  const accountId = c.req.query("account_id");
  const search = c.req.query("search");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const spendersOnly = c.req.query("spenders_only") === "true";
  const crossPollOnly = c.req.query("cross_poll_only") === "true";
  const limitRaw = Math.min(Number(c.req.query("limit") ?? 5000), 10000);
  const offsetRaw = Number(c.req.query("offset") ?? 0);
  const sortBy = c.req.query("sort_by") ?? "total_revenue";
  const sortDir = c.req.query("sort_dir") === "asc" ? "ASC" : "DESC";

  const allowedSortCols: Record<string, string> = {
    total_revenue: "f.total_revenue::numeric",
    total_transactions: "f.total_transactions",
    last_transaction_at: "f.last_transaction_at",
    first_transaction_at: "f.first_transaction_at",
    fan_id: "f.fan_id",
    username: "f.username",
  };
  const orderCol = allowedSortCols[sortBy] ?? "f.total_revenue::numeric";

  const conditions: ReturnType<typeof sql>[] = [sql`f.total_transactions IS NOT NULL`];
  if (accountId) conditions.push(sql`EXISTS (SELECT 1 FROM fan_account_stats fas WHERE fas.fan_id = f.id AND fas.account_id = ${accountId}::uuid)`);
  if (search) conditions.push(sql`(f.fan_id ILIKE ${"%" + search + "%"} OR f.username ILIKE ${"%" + search + "%"} OR f.display_name ILIKE ${"%" + search + "%"})`);
  if (dateFrom) conditions.push(sql`f.last_transaction_at >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`f.last_transaction_at <= ${dateTo}`);
  if (spendersOnly) conditions.push(sql`f.total_revenue::numeric > 0`);
  if (crossPollOnly) conditions.push(sql`f.is_cross_poll = true`);

  const whereClause = sql.join(conditions, sql` AND `);

  const rows = await db.execute(sql`
    SELECT
      f.id, f.fan_id, f.username, f.display_name, f.avatar_url, f.status,
      f.tags, f.notes, f.total_revenue, f.total_transactions,
      f.first_transaction_at, f.last_transaction_at, f.is_cross_poll,
      f.is_new_fan, f.first_subscribe_date, f.first_subscribe_account,
      f.acquired_via_account_id, f.join_date, f.created_at,
      (SELECT COUNT(DISTINCT fas.account_id) FROM fan_account_stats fas WHERE fas.fan_id = f.id) AS account_count
    FROM fans f
    WHERE ${whereClause}
    ORDER BY ${sql.raw(orderCol)} ${sql.raw(sortDir)} NULLS LAST
    LIMIT ${limitRaw} OFFSET ${offsetRaw}
  `);

  const countResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM fans f WHERE ${whereClause}`);
  const total = Number((countResult.rows[0] as any)?.cnt ?? 0);

  return c.json({ fans: rows.rows, total, limit: limitRaw, offset: offsetRaw });
});

// ── GET /fans/count ───────────────────────────────────────────────────────────
router.get("/count", async (c) => {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(fans);
  return c.json({ count: Number(result?.count ?? 0) });
});

// ── GET /fans/:id ─────────────────────────────────────────────────────────────
router.get("/:id", async (c) => {
  const id = c.req.param("id");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  let fanRow: any;
  if (isUuid) {
    const rows = await db.select().from(fans).where(eq(fans.id, id));
    fanRow = rows[0];
  } else {
    const rows = await db.select().from(fans).where(eq(fans.fan_id, id));
    fanRow = rows[0];
  }

  if (!fanRow) return c.json({ error: "Fan not found" }, 404);

  const statsRows = await db
    .select({
      fas: fan_account_stats,
      account_display_name: accounts.display_name,
      account_username: accounts.username,
    })
    .from(fan_account_stats)
    .leftJoin(accounts, eq(fan_account_stats.account_id, accounts.id))
    .where(eq(fan_account_stats.fan_id, fanRow.id));

  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.fan_id, fanRow.fan_id))
    .orderBy(desc(transactions.date))
    .limit(200);

  return c.json({
    fan: fanRow,
    account_stats: statsRows.map(r => ({
      ...r.fas,
      account_display_name: r.account_display_name,
      account_username: r.account_username,
    })),
    transactions: txRows,
  });
});

// ── PATCH /fans/:id ───────────────────────────────────────────────────────────
router.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const allowed: Record<string, any> = {};
  if (body.tags !== undefined) allowed.tags = body.tags;
  if (body.notes !== undefined) allowed.notes = body.notes;
  if (body.status !== undefined) allowed.status = body.status;
  if (Object.keys(allowed).length === 0) return c.json({ error: "No updatable fields" }, 400);
  allowed.updated_at = new Date();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const where = isUuid ? eq(fans.id, id) : eq(fans.fan_id, id);
  const updated = await db.update(fans).set(allowed).where(where).returning();
  if (!updated[0]) return c.json({ error: "Fan not found" }, 404);
  return c.json(updated[0]);
});

export default router;

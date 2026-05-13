import { Hono } from "hono";
import { db } from "../db/client.js";
import { fans, fan_account_stats, fan_spend, fan_attributions, transactions, accounts } from "../db/schema.js";
import { eq, sql, desc } from "drizzle-orm";

const router = new Hono();

// ── GET /fans/stats ───────────────────────────────────────────────────────────
router.get("/stats", async (c) => {
  const accountId = c.req.query("account_id");

  let result;
  if (accountId) {
    // Per-account: use fan_account_stats.total_revenue so revenue is specific to THIS account,
    // not each fan's total-across-all-accounts (which inflates/deflates numbers).
    result = await db.execute(sql`
      SELECT
        COUNT(DISTINCT fas.fan_id)::int                                                                    AS total_fans,
        COUNT(DISTINCT CASE WHEN fas.total_revenue::numeric > 0 THEN fas.fan_id END)::int                 AS spenders,
        COALESCE(SUM(fas.total_revenue::numeric), 0)                                                      AS total_revenue,
        COALESCE(AVG(CASE WHEN fas.total_revenue::numeric > 0 THEN fas.total_revenue::numeric END), 0)    AS avg_per_spender,
        COUNT(DISTINCT CASE WHEN f.is_cross_poll = true THEN fas.fan_id END)::int                         AS cross_poll_fans,
        COALESCE(SUM(CASE WHEN f.is_cross_poll = true THEN fas.total_revenue::numeric ELSE 0 END), 0)     AS cross_poll_revenue
      FROM fan_account_stats fas
      JOIN fans f ON f.id = fas.fan_id
      WHERE fas.account_id = ${accountId}::uuid
    `);
  } else {
    // Global: sum fans.total_revenue (each fan counted once regardless of cross-poll)
    result = await db.execute(sql`
      SELECT
        COUNT(*)                                                                               AS total_fans,
        COUNT(CASE WHEN total_revenue IS NOT NULL AND total_revenue::numeric > 0 THEN 1 END)   AS spenders,
        COALESCE(SUM(CASE WHEN total_revenue IS NOT NULL THEN total_revenue::numeric END), 0)  AS total_revenue,
        COALESCE(AVG(CASE WHEN total_revenue::numeric > 0 THEN total_revenue::numeric END), 0) AS avg_per_spender,
        COUNT(CASE WHEN is_cross_poll = true THEN 1 END)                                      AS cross_poll_fans,
        COALESCE(SUM(CASE WHEN is_cross_poll = true AND total_revenue IS NOT NULL THEN total_revenue::numeric ELSE 0 END), 0) AS cross_poll_revenue
      FROM fans
    `);
  }

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

// ── legacy compat (must be before /:id) ──────────────────────────────────────
router.get("/spenders", async (c) => {
  const rows = await db.select().from(fan_spend).limit(50000);
  return c.json(rows);
});

router.get("/attribution-counts", async (c) => {
  const rows = await db
    .select({ account_id: fan_attributions.account_id })
    .from(fan_attributions);
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.account_id) counts[r.account_id] = (counts[r.account_id] || 0) + 1;
  }
  return c.json(counts);
});

router.get("/count", async (c) => {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(fans);
  return c.json({ count: Number(result?.count ?? 0) });
});

// GET /fans/revenue-attribution?account_ids= — attributed vs unattributed revenue from fan_spend
router.get("/revenue-attribution", async (c) => {
  const accountIdsRaw = c.req.query("account_ids");
  const accountIds    = accountIdsRaw ? accountIdsRaw.split(",").filter(Boolean) : [];

  const whereClause = accountIds.length > 0
    ? sql`WHERE account_id = ANY(${accountIds}::uuid[])`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN tracking_link_id IS NOT NULL THEN revenue::numeric ELSE 0 END), 0) AS campaign_revenue,
      COALESCE(SUM(CASE WHEN tracking_link_id IS NULL     THEN revenue::numeric ELSE 0 END), 0) AS unattributed_revenue,
      COALESCE(SUM(revenue::numeric), 0)                                                        AS total_revenue
    FROM fan_spend
    ${whereClause}
  `);

  const row = (result.rows[0] as any) ?? {};
  return c.json({
    campaign_revenue:     Number(row.campaign_revenue     ?? 0),
    unattributed_revenue: Number(row.unattributed_revenue ?? 0),
    total_revenue:        Number(row.total_revenue        ?? 0),
  });
});

// ── GET /fans ─────────────────────────────────────────────────────────────────
router.get("/", async (c) => {
  const accountId = c.req.query("account_id");
  const trackingLinkId = c.req.query("tracking_link_id");
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

  const conditions: ReturnType<typeof sql>[] = [];
  if (accountId) conditions.push(sql`EXISTS (SELECT 1 FROM fan_account_stats fas WHERE fas.fan_id = f.id AND fas.account_id = ${accountId}::uuid)`);
  if (trackingLinkId) conditions.push(sql`f.first_subscribe_link_id = ${trackingLinkId}::uuid`);
  if (search) conditions.push(sql`(f.fan_id ILIKE ${"%" + search + "%"} OR f.username ILIKE ${"%" + search + "%"} OR f.display_name ILIKE ${"%" + search + "%"})`);
  if (dateFrom) conditions.push(sql`f.last_transaction_at >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`f.last_transaction_at <= ${dateTo}`);
  if (spendersOnly) conditions.push(sql`f.total_revenue IS NOT NULL AND f.total_revenue::numeric > 0`);
  if (crossPollOnly) conditions.push(sql`f.is_cross_poll = true`);

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const rows = await db.execute(sql`
    WITH tx_sum AS (
      SELECT
        fan_username,
        COALESCE(SUM(CASE WHEN type = 'tip' THEN revenue::numeric ELSE 0 END), 0)       AS tip_revenue,
        COUNT(CASE WHEN type IN ('message','chat','ppv') THEN 1 END)::int                AS message_count
      FROM transactions
      WHERE revenue IS NOT NULL AND revenue::numeric > 0
      GROUP BY fan_username
    )
    SELECT
      f.id, f.fan_id, f.username, f.display_name, f.avatar_url, f.status,
      f.tags, f.notes, f.total_revenue, f.total_transactions,
      f.first_transaction_at, f.last_transaction_at, f.is_cross_poll,
      f.is_new_fan, f.first_subscribe_date, f.first_subscribe_account,
      f.first_subscribe_link_id,
      f.acquired_via_account_id, f.join_date, f.created_at,
      (SELECT COUNT(DISTINCT fas.account_id) FROM fan_account_stats fas WHERE fas.fan_id = f.id) AS account_count,
      COALESCE(ts.tip_revenue,    0) AS tip_revenue,
      COALESCE(ts.message_count,  0) AS message_count
    FROM fans f
    LEFT JOIN tx_sum ts ON ts.fan_username = f.fan_id
    ${whereClause}
    ORDER BY ${sql.raw(orderCol)} ${sql.raw(sortDir)} NULLS LAST
    LIMIT ${limitRaw} OFFSET ${offsetRaw}
  `);

  const countResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM fans f ${whereClause}`);
  const total = Number((countResult.rows[0] as any)?.cnt ?? 0);

  return c.json({ fans: rows.rows, total, limit: limitRaw, offset: offsetRaw });
});

// ── GET /fans/spenders-breakdown ─────────────────────────────────────────────
// Returns spenders with per-type revenue from fan_account_stats.
// Params: account_id, tracking_link_id, search, limit
router.get("/spenders-breakdown", async (c) => {
  const accountId      = c.req.query("account_id");
  const trackingLinkId = c.req.query("tracking_link_id");
  const search         = c.req.query("search");
  const limitRaw       = Math.min(Number(c.req.query("limit") ?? 5000), 20000);

  // Base WHERE conditions on the fans table — never reference fas here
  // so that the LEFT JOIN doesn't silently drop fans with missing stats rows.
  const conditions: ReturnType<typeof sql>[] = [
    sql`f.total_revenue IS NOT NULL AND f.total_revenue::numeric > 0`,
  ];
  if (trackingLinkId) conditions.push(sql`f.first_subscribe_link_id = ${trackingLinkId}::uuid`);
  if (search)         conditions.push(sql`(f.fan_id ILIKE ${"%" + search + "%"} OR f.username ILIKE ${"%" + search + "%"} OR f.display_name ILIKE ${"%" + search + "%"})`);
  // When filtering by account, require at least one fas row for that account
  if (accountId)      conditions.push(sql`EXISTS (SELECT 1 FROM fan_account_stats x WHERE x.fan_id = f.id AND x.account_id = ${accountId}::uuid AND x.total_revenue::numeric > 0)`);

  const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

  const rows = await db.execute(sql`
    WITH tx_agg AS (
      SELECT
        t.fan_username,
        SUM(t.revenue::numeric)                                                                 AS total_tx_revenue,
        SUM(CASE WHEN t.type = 'new_subscription'        THEN t.revenue::numeric ELSE 0 END)   AS new_sub_revenue,
        SUM(CASE WHEN t.type = 'recurring_subscription'  THEN t.revenue::numeric ELSE 0 END)   AS resub_revenue,
        SUM(CASE WHEN t.type = 'tip'                     THEN t.revenue::numeric ELSE 0 END)   AS tip_revenue,
        SUM(CASE WHEN t.type IN ('message','chat','ppv')  THEN t.revenue::numeric ELSE 0 END)  AS message_revenue,
        SUM(CASE WHEN t.type = 'post'                    THEN t.revenue::numeric ELSE 0 END)   AS post_revenue
      FROM transactions t
      WHERE t.revenue IS NOT NULL AND t.revenue::numeric > 0
      GROUP BY t.fan_username
    ),
    fan_accounts AS (
      SELECT fan_id, STRING_AGG(DISTINCT account_id::text, ',') AS account_ids
      FROM fan_account_stats
      GROUP BY fan_id
    )
    SELECT
      f.id,
      f.fan_id,
      f.username,
      f.display_name,
      f.avatar_url,
      f.total_revenue::numeric                            AS total_revenue,
      f.total_transactions,
      f.first_subscribe_link_id::text                     AS first_subscribe_link_id,
      f.acquired_via_account_id::text                     AS acquired_via_account_id,
      f.last_transaction_at,
      COALESCE(ta.new_sub_revenue,   0)                   AS new_sub_revenue,
      COALESCE(ta.resub_revenue,     0)                   AS resub_revenue,
      COALESCE(ta.tip_revenue,       0)                   AS tip_revenue,
      COALESCE(ta.message_revenue,   0)                   AS message_revenue,
      COALESCE(ta.post_revenue,      0)                   AS post_revenue,
      COALESCE(fa.account_ids, '')                        AS account_ids
    FROM fans f
    LEFT JOIN tx_agg ta ON ta.fan_username = f.fan_id
    LEFT JOIN fan_accounts fa ON fa.fan_id = f.id
    ${whereClause}
    ORDER BY f.total_revenue::numeric DESC
    LIMIT ${limitRaw}
  `);

  // Also return the true total count of matching spenders for reconciliation
  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM fans f ${whereClause}
  `);
  const total = Number((countResult.rows[0] as any)?.cnt ?? 0);

  return c.json({ rows: rows.rows, total });
});

// ── GET /fans/campaign-breakdown?account_ids=&date_from=&date_to= ─────────────
// Returns: [{account_id, link_id, campaign_name, fan_count, link_deleted}]
// Fans attributed to each campaign (tracking link) per account for the period.
router.get("/campaign-breakdown", async (c) => {
  const accountIdsRaw = c.req.query("account_ids");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const accountIds = accountIdsRaw ? accountIdsRaw.split(",").filter(Boolean) : [];
  if (accountIds.length === 0) return c.json([]);

  const idList = sql.join(accountIds.map(id => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute(sql`
    SELECT
      tl.account_id::text                  AS account_id,
      f.first_subscribe_link_id::text      AS link_id,
      tl.campaign_name,
      tl.external_tracking_link_id,
      (tl.deleted_at IS NOT NULL)          AS link_deleted,
      COUNT(*)::int                        AS fan_count
    FROM fans f
    JOIN tracking_links tl ON f.first_subscribe_link_id = tl.id
    WHERE tl.account_id IN (${idList})
    ${dateFrom ? sql`AND f.first_subscribe_date >= ${dateFrom}` : sql``}
    ${dateTo ? sql`AND f.first_subscribe_date <= ${dateTo}` : sql``}
    GROUP BY tl.account_id, f.first_subscribe_link_id, tl.campaign_name, tl.external_tracking_link_id, tl.deleted_at
    ORDER BY COUNT(*) DESC
  `);

  return c.json(rows.rows);
});

// ── GET /fans/cross-poll-breakdown?tracking_link_id=<uuid> ───────────────────
// Per-receiving-account aggregate for one campaign's cross-poll revenue.
router.get("/cross-poll-breakdown", async (c) => {
  const tlId = c.req.query("tracking_link_id");
  if (!tlId) return c.json({ error: "tracking_link_id required" }, 400);

  const rows = await db.execute(sql`
    SELECT
      fs.account_id::text             AS dest_account_id,
      dst_acc.display_name            AS dest_account_name,
      dst_acc.avatar_thumb_url        AS dest_avatar_url,
      COUNT(DISTINCT fs.fan_id)::int  AS fans_count,
      SUM(fs.revenue::numeric)        AS revenue
    FROM fan_spend fs
    JOIN fans f ON f.fan_id = fs.fan_id
    JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
    JOIN accounts dst_acc ON dst_acc.id = fs.account_id::uuid
    WHERE f.first_subscribe_link_id = ${tlId}::uuid
      AND fs.account_id::text != tl.account_id::text
      AND fs.revenue::numeric > 0
    GROUP BY fs.account_id, dst_acc.display_name, dst_acc.avatar_thumb_url
    ORDER BY revenue DESC
  `);

  return c.json(rows.rows);
});

// ── GET /fans/cross-poll-detail?limit=200&source_account_id=&dest_account_id= ──
// Per-fan cross-poll rows: fans acquired via one account's link but with spend on another.
router.get("/cross-poll-detail", async (c) => {
  const limit  = Math.min(Number(c.req.query("limit") ?? 200), 1000);
  const srcAcc = c.req.query("source_account_id") ?? null;
  const dstAcc = c.req.query("dest_account_id")   ?? null;

  const rows = await db.execute(sql`
    SELECT
      fs.fan_id,
      f.username,
      f.first_subscribe_link_id::text AS tracking_link_id,
      tl.campaign_name,
      tl.url                          AS campaign_url,
      tl.account_id::text             AS source_account_id,
      src_acc.display_name            AS source_account_name,
      fs.account_id::text             AS dest_account_id,
      dst_acc.display_name            AS dest_account_name,
      fs.revenue::numeric             AS revenue
    FROM fan_spend fs
    JOIN fans f ON f.fan_id = fs.fan_id
    JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
    JOIN accounts src_acc ON src_acc.id = tl.account_id
    JOIN accounts dst_acc ON dst_acc.id = fs.account_id::uuid
    WHERE f.first_subscribe_link_id IS NOT NULL
      AND fs.account_id::text != tl.account_id::text
      AND fs.revenue::numeric > 0
      AND tl.deleted_at IS NULL
      ${srcAcc ? sql`AND tl.account_id::text = ${srcAcc}` : sql``}
      ${dstAcc ? sql`AND fs.account_id::text = ${dstAcc}` : sql``}
    ORDER BY fs.revenue::numeric DESC
    LIMIT ${limit}
  `);

  return c.json(rows.rows);
});

// ── GET /fans/cross-poll?limit=200 ────────────────────────────────────────────
// Cross-pollinated fans: fans with spend on 2+ accounts, revenue from fan_spend.
router.get("/cross-poll", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 200), 1000);

  const rows = await db.execute(sql`
    WITH cross_poll_fans AS (
      -- Fans with fan_spend revenue on 2+ distinct accounts
      SELECT fan_id
      FROM fan_spend
      WHERE revenue::numeric > 0
      GROUP BY fan_id
      HAVING COUNT(DISTINCT account_id) > 1
    )
    SELECT
      f.id,
      f.fan_id,
      f.username,
      f.display_name,
      f.avatar_url,
      f.total_revenue::numeric            AS total_revenue,
      f.first_subscribe_link_id::text     AS first_subscribe_link_id,
      f.first_subscribe_date,
      f.acquired_via_account_id::text     AS acquired_via_account_id,
      COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'account_id', fs.account_id::text,
            'revenue',    fs.revenue::numeric,
            'rev_before', 0,
            'rev_after',  fs.revenue::numeric,
            'tx_count',   0
          ) ORDER BY fs.revenue::numeric DESC
        ) FILTER (WHERE fs.account_id IS NOT NULL AND fs.revenue::numeric > 0),
        '[]'::json
      ) AS per_account_revenue
    FROM fans f
    JOIN cross_poll_fans cp ON cp.fan_id = f.fan_id
    LEFT JOIN fan_spend fs ON fs.fan_id = f.fan_id AND fs.revenue::numeric > 0
    WHERE f.total_revenue IS NOT NULL AND f.total_revenue::numeric > 0
    GROUP BY
      f.id, f.fan_id, f.username, f.display_name, f.avatar_url,
      f.total_revenue, f.first_subscribe_link_id, f.first_subscribe_date,
      f.acquired_via_account_id
    ORDER BY f.total_revenue::numeric DESC
    LIMIT ${limit}
  `);

  // parse per_account_revenue if returned as a string
  const result = (rows.rows as any[]).map(r => ({
    ...r,
    per_account_revenue: typeof r.per_account_revenue === "string"
      ? JSON.parse(r.per_account_revenue)
      : (r.per_account_revenue ?? []),
  }));

  return c.json(result);
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

  // fans.fan_id can be a username ("noster4041") or a numeric-style ID ("u468812253").
  // transactions.fan_id is the raw numeric OF user ID ("468812253").
  // transactions.fan_username is the username when returned by the API (null for many subs).
  // Try all three vectors so no revenue is missed.
  const numericId = /^u(\d+)$/.exec(fanRow.fan_id)?.[1] ?? null;
  const altUsername = fanRow.username && fanRow.username !== fanRow.fan_id ? fanRow.username : null;

  const txRows = await db
    .select()
    .from(transactions)
    .where(sql`
      ${transactions.fan_username} = ${fanRow.fan_id}
      ${altUsername ? sql`OR ${transactions.fan_username} = ${altUsername}` : sql``}
      ${numericId   ? sql`OR ${transactions.fan_id} = ${numericId}` : sql``}
      ${numericId   ? sql`OR ${transactions.user_id}  = ${numericId}` : sql``}
      OR ${transactions.user_id} = ${fanRow.fan_id}
    `)
    .orderBy(desc(transactions.date))
    .limit(5000);

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

import { Hono } from "hono";
import { db } from "../db/client.js";
import { tracking_links, daily_metrics, fan_account_stats, transactions } from "../db/schema.js";
import { eq, and, isNull, sql, desc, asc } from "drizzle-orm";

const router = new Hono();

// GET /campaign-analytics/campaigns?account_id=UUID  (omit for all accounts)
router.get("/campaigns", async (c) => {
  const accountId = c.req.query("account_id");

  const rows = await db
    .select()
    .from(tracking_links)
    .where(
      accountId
        ? and(eq(tracking_links.account_id, accountId), isNull(tracking_links.deleted_at))
        : isNull(tracking_links.deleted_at)
    )
    .orderBy(desc(tracking_links.subscribers));

  return c.json(rows);
});

// GET /campaign-analytics/revenue-by-campaign?account_id=UUID
// Returns one row per campaign (campaigns table when linked, else tracking_link campaign_name).
router.get("/revenue-by-campaign", async (c) => {
  const accountId = c.req.query("account_id");
  const accountCond = accountId
    ? sql`AND tl.account_id = ${accountId}::uuid`
    : sql``;

  const rows = await db.execute(sql`
    WITH fan_tx AS (
      SELECT
        COALESCE(c.id::text, tl.id::text)          AS group_key,
        COALESCE(c.name, tl.campaign_name, 'Unnamed') AS campaign_name,
        t.revenue::numeric                          AS rev
      FROM fans f
      JOIN transactions t ON (
        t.fan_username = f.fan_id
        OR (f.fan_id ~ '^u[0-9]+$' AND t.fan_id = SUBSTRING(f.fan_id, 2))
      )
      JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
      LEFT JOIN campaigns c ON c.id = tl.campaign_id
      WHERE f.first_subscribe_link_id IS NOT NULL
        AND tl.deleted_at IS NULL
        AND t.revenue IS NOT NULL AND t.revenue::numeric > 0
        ${accountCond}
    )
    SELECT
      group_key,
      campaign_name,
      SUM(rev) AS total_revenue
    FROM fan_tx
    GROUP BY group_key, campaign_name
    ORDER BY total_revenue DESC
  `);

  return c.json(rows.rows);
});

// GET /campaign-analytics/revenue-by-type?account_id=UUID
// Returns per-campaign revenue broken down by transaction type, sourced from transactions table.
router.get("/revenue-by-type", async (c) => {
  const accountId = c.req.query("account_id");

  const accountCond = accountId
    ? sql`AND tl.account_id = ${accountId}::uuid`
    : sql``;

  const rows = await db.execute(sql`
    WITH fan_tx AS (
      SELECT
        f.first_subscribe_link_id,
        t.type,
        t.revenue::numeric AS rev
      FROM fans f
      JOIN transactions t ON (
        t.fan_username = f.fan_id
        OR (f.fan_id ~ '^u[0-9]+$' AND t.fan_id = SUBSTRING(f.fan_id, 2))
      )
      JOIN tracking_links tl ON tl.id = f.first_subscribe_link_id
      WHERE f.first_subscribe_link_id IS NOT NULL
        AND t.revenue IS NOT NULL AND t.revenue::numeric > 0
        ${accountCond}
    )
    SELECT
      first_subscribe_link_id::text                                                        AS tracking_link_id,
      SUM(rev)                                                                             AS total_revenue,
      SUM(CASE WHEN type = 'new_subscription'        THEN rev ELSE 0 END)                 AS new_sub_revenue,
      SUM(CASE WHEN type = 'recurring_subscription'  THEN rev ELSE 0 END)                 AS resub_revenue,
      SUM(CASE WHEN type = 'tip'                     THEN rev ELSE 0 END)                 AS tip_revenue,
      SUM(CASE WHEN type IN ('message','chat','ppv')  THEN rev ELSE 0 END)                AS message_revenue,
      SUM(CASE WHEN type = 'post'                    THEN rev ELSE 0 END)                 AS post_revenue
    FROM fan_tx
    GROUP BY first_subscribe_link_id
  `);

  return c.json(rows.rows);
});

// GET /campaign-analytics/:id/trend?days=30
router.get("/:id/trend", async (c) => {
  const id = c.req.param("id");
  const days = Math.min(Number(c.req.query("days") ?? 30), 730);

  const rows = await db
    .select()
    .from(daily_metrics)
    .where(
      and(
        eq(daily_metrics.tracking_link_id, id),
        sql`${daily_metrics.date} >= CURRENT_DATE - ${days}::int`
      )
    )
    .orderBy(asc(daily_metrics.date));

  return c.json(rows);
});

// GET /campaign-analytics/:id/spenders?limit=500
// NOTE: fan_account_stats type columns (tip_revenue etc.) are never populated by sync,
// so ALL type breakdown comes from the transactions table directly via CTE.
// Also: fan_spend misses subscription-only fans (no description HTML = no fan_id parse),
// so we filter by fans.total_revenue > 0 instead.
router.get("/:id/spenders", async (c) => {
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 500), 2000);

  const rows = await db.execute(sql`
    WITH tx_agg AS (
      SELECT
        t.fan_username,
        SUM(t.revenue::numeric)                                                                  AS total_revenue,
        SUM(CASE WHEN t.type = 'new_subscription'       THEN t.revenue::numeric ELSE 0 END)     AS new_sub_revenue,
        SUM(CASE WHEN t.type = 'recurring_subscription' THEN t.revenue::numeric ELSE 0 END)     AS resub_revenue,
        SUM(CASE WHEN t.type = 'tip'                    THEN t.revenue::numeric ELSE 0 END)     AS tip_revenue,
        SUM(CASE WHEN t.type IN ('message','chat','ppv') THEN t.revenue::numeric ELSE 0 END)    AS message_revenue,
        SUM(CASE WHEN t.type = 'post'                   THEN t.revenue::numeric ELSE 0 END)     AS post_revenue
      FROM transactions t
      WHERE t.revenue IS NOT NULL AND t.revenue::numeric > 0
      GROUP BY t.fan_username
    )
    SELECT
      f.id,
      f.fan_id,
      f.username,
      f.display_name,
      f.avatar_url,
      f.first_subscribe_date,
      COALESCE(ta.total_revenue,     f.total_revenue::numeric, 0) AS revenue,
      COALESCE(ta.new_sub_revenue,   0) AS new_sub_revenue,
      COALESCE(ta.resub_revenue,     0) AS resub_revenue,
      COALESCE(ta.tip_revenue,       0) AS tip_revenue,
      COALESCE(ta.message_revenue,   0) AS message_revenue,
      COALESCE(ta.post_revenue,      0) AS post_revenue
    FROM fans f
    LEFT JOIN tx_agg ta ON ta.fan_username = f.fan_id
    WHERE f.first_subscribe_link_id = ${id}::uuid
      AND f.total_revenue IS NOT NULL AND f.total_revenue::numeric > 0
    ORDER BY COALESCE(ta.total_revenue, f.total_revenue::numeric, 0) DESC
    LIMIT ${limit}
  `);

  const countRow = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM fans f
    WHERE f.first_subscribe_link_id = ${id}::uuid
      AND f.total_revenue IS NOT NULL AND f.total_revenue::numeric > 0
  `);
  const total = Number((countRow.rows[0] as any)?.cnt ?? 0);

  return c.json({ rows: rows.rows, total });
});

// GET /campaign-analytics/:id/cohort-arps?acq_start=&acq_end=&revenue_basis=net
router.get("/:id/cohort-arps", async (c) => {
  const id = c.req.param("id");
  const acqStart = c.req.query("acq_start") || null;
  const acqEnd = c.req.query("acq_end") || null;
  const revBasis = c.req.query("revenue_basis") === "gross" ? "gross" : "net";

  const acqStartCond = acqStart ? sql`AND f.first_subscribe_date >= ${acqStart}::date` : sql``;
  const acqEndCond = acqEnd ? sql`AND f.first_subscribe_date <= ${acqEnd}::date` : sql``;

  const result = await db.execute(sql`
    WITH cohort AS (
      SELECT
        f.id,
        f.fan_id,
        f.first_subscribe_date,
        CASE WHEN f.fan_id ~ '^u[0-9]+$' THEN SUBSTRING(f.fan_id, 2) ELSE NULL END AS numeric_fan_id
      FROM fans f
      WHERE f.first_subscribe_link_id = ${id}::uuid
        AND f.first_subscribe_date IS NOT NULL
        ${acqStartCond}
        ${acqEndCond}
    ),
    fan_tx AS (
      SELECT
        cf.id AS fan_db_id,
        cf.first_subscribe_date,
        CASE WHEN ${revBasis} = 'gross'
          THEN COALESCE(t.revenue::numeric, 0)
          ELSE COALESCE(t.revenue_net::numeric, t.revenue::numeric, 0)
        END AS rev,
        (t.date::date - cf.first_subscribe_date) AS days_after_sub
      FROM cohort cf
      LEFT JOIN transactions t ON (
        t.fan_username = cf.fan_id
        OR (cf.numeric_fan_id IS NOT NULL AND t.fan_id = cf.numeric_fan_id)
      )
    )
    SELECT
      (SELECT COUNT(*) FROM cohort)::int AS cohort_size,
      (SELECT COUNT(*) FROM fans WHERE first_subscribe_link_id = ${id}::uuid)::int AS total_source_subs,
      SUM(CASE WHEN days_after_sub IS NOT NULL AND days_after_sub >= 0 AND days_after_sub <= 2  THEN rev ELSE 0 END) AS rev_48h,
      SUM(CASE WHEN days_after_sub IS NOT NULL AND days_after_sub >= 0 AND days_after_sub <= 7  THEN rev ELSE 0 END) AS rev_7d,
      SUM(CASE WHEN days_after_sub IS NOT NULL AND days_after_sub >= 0 AND days_after_sub <= 14 THEN rev ELSE 0 END) AS rev_14d,
      SUM(CASE WHEN days_after_sub IS NOT NULL AND days_after_sub >= 0 AND days_after_sub <= 21 THEN rev ELSE 0 END) AS rev_21d,
      SUM(CASE WHEN days_after_sub IS NOT NULL AND days_after_sub >= 0 AND days_after_sub <= 30 THEN rev ELSE 0 END) AS rev_30d,
      SUM(CASE WHEN days_after_sub IS NOT NULL AND days_after_sub >= 0 THEN rev ELSE 0 END) AS rev_all_time
    FROM fan_tx
  `);

  const row = (result.rows[0] as any) ?? {};
  const cohortSize = Number(row.cohort_size ?? 0);
  const totalSourceSubs = Number(row.total_source_subs ?? 0);

  const rev48h = Number(row.rev_48h ?? 0);
  const rev7d = Number(row.rev_7d ?? 0);
  const rev14d = Number(row.rev_14d ?? 0);
  const rev21d = Number(row.rev_21d ?? 0);
  const rev30d = Number(row.rev_30d ?? 0);
  const revAllTime = Number(row.rev_all_time ?? 0);

  const arps = (rev: number) => cohortSize > 0 ? rev / cohortSize : 0;

  return c.json({
    cohort_size: cohortSize,
    total_source_subs: totalSourceSubs,
    coverage: totalSourceSubs > 0 ? (cohortSize / totalSourceSubs) * 100 : 0,
    arps_48h: arps(rev48h),
    arps_7d: arps(rev7d),
    arps_14d: arps(rev14d),
    arps_21d: arps(rev21d),
    arps_30d: arps(rev30d),
    arps_all_time: arps(revAllTime),
    rev_48h: rev48h,
    rev_7d: rev7d,
    rev_14d: rev14d,
    rev_21d: rev21d,
    rev_30d: rev30d,
    rev_all_time: revAllTime,
    curve: [
      { period: "48h",  days: 2,    revenue: rev48h,     arps: arps(rev48h) },
      { period: "7d",   days: 7,    revenue: rev7d,      arps: arps(rev7d) },
      { period: "14d",  days: 14,   revenue: rev14d,     arps: arps(rev14d) },
      { period: "21d",  days: 21,   revenue: rev21d,     arps: arps(rev21d) },
      { period: "30d",  days: 30,   revenue: rev30d,     arps: arps(rev30d) },
      { period: "All",  days: 9999, revenue: revAllTime, arps: arps(revAllTime) },
    ],
  });
});

export default router;

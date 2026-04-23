import { Hono } from "hono";
import { db } from "../db/client.js";
import { tracking_links, accounts, campaigns, daily_snapshots } from "../db/schema.js";
import { eq, isNull, desc, inArray, sql, and, getTableColumns } from "drizzle-orm";

const router = new Hono();

// GET /tracking-links?account_id=&deleted=false
router.get("/", async (c) => {
  const accountId = c.req.query("account_id");
  const includeDeleted = c.req.query("deleted") === "true";

  const rows = await db
    .select({
      ...getTableColumns(tracking_links),
      account_display_name: accounts.display_name,
      account_username: accounts.username,
      account_avatar_thumb_url: accounts.avatar_thumb_url,
    })
    .from(tracking_links)
    .leftJoin(accounts, eq(tracking_links.account_id, accounts.id))
    .where(
      and(
        includeDeleted ? undefined : isNull(tracking_links.deleted_at),
        accountId ? eq(tracking_links.account_id, accountId) : undefined,
      )
    )
    .orderBy(desc(tracking_links.revenue));

  return c.json(rows);
});

// POST /tracking-links — create new (finds/creates campaign automatically)
router.post("/", async (c) => {
  const body = await c.req.json();
  const { account_id, campaign_name, campaign_id: providedCampaignId, ...rest } = body;

  let campaignId = providedCampaignId;
  if (!campaignId && account_id && campaign_name) {
    const existing = await db.select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.account_id, account_id), eq(campaigns.name, campaign_name)))
      .limit(1);
    if (existing.length > 0) {
      campaignId = existing[0].id;
    } else {
      const [newCamp] = await db.insert(campaigns)
        .values({ account_id, name: campaign_name, status: "active" })
        .returning({ id: campaigns.id });
      campaignId = newCamp.id;
    }
  }

  const [row] = await db.insert(tracking_links)
    .values({ account_id, campaign_name, campaign_id: campaignId, ...rest })
    .returning();
  return c.json(row, 201);
});

router.get("/:id", async (c) => {
  const [row] = await db
    .select()
    .from(tracking_links)
    .where(eq(tracking_links.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

router.put("/:id", async (c) => {
  const body = await c.req.json();
  const [row] = await db
    .update(tracking_links)
    .set({ ...body, updated_at: new Date() })
    .where(eq(tracking_links.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

// PATCH /tracking-links/:id/source-tag
router.patch("/:id/source-tag", async (c) => {
  const { source_tag, manually_tagged } = await c.req.json();
  const [row] = await db
    .update(tracking_links)
    .set({ source_tag, manually_tagged: manually_tagged ?? true, updated_at: new Date() })
    .where(eq(tracking_links.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

// POST /tracking-links/bulk-update — [{id, ...fields}]
router.post("/bulk-update", async (c) => {
  const updates: { id: string; [key: string]: any }[] = await c.req.json();
  for (const { id, ...fields } of updates) {
    if (!id) continue;
    await db.update(tracking_links).set({ ...fields, updated_at: new Date() }).where(eq(tracking_links.id, id));
  }
  return c.json({ updated: updates.length });
});

// PATCH /tracking-links/bulk-source-tag
router.patch("/bulk-source-tag", async (c) => {
  const { ids, source_tag } = await c.req.json();
  await db
    .update(tracking_links)
    .set({ source_tag, manually_tagged: true, updated_at: new Date() })
    .where(inArray(tracking_links.id, ids));
  return c.json({ success: true });
});

// PATCH /tracking-links/:id/clear-spend
router.patch("/:id/clear-spend", async (c) => {
  const [row] = await db
    .update(tracking_links)
    .set({
      cost_type: null, cost_value: null, cost_total: "0",
      cost_per_click: null, cost_per_lead: null, payment_type: null,
      profit: null, roi: null, cpc_real: null, cpl_real: null,
      updated_at: new Date(),
    })
    .where(eq(tracking_links.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

// DELETE (soft) /tracking-links/:id
router.delete("/:id", async (c) => {
  const [row] = await db
    .update(tracking_links)
    .set({ deleted_at: new Date() })
    .where(eq(tracking_links.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

// POST /tracking-links/:id/restore
router.post("/:id/restore", async (c) => {
  const [row] = await db
    .update(tracking_links)
    .set({ deleted_at: null, updated_at: new Date() })
    .where(eq(tracking_links.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

// GET /tracking-links/active-count
// Active = >= 1 new sub/day over the last 5 days (snapshot delta), matching useActiveLinkStatus.
router.get("/active-count", async (c) => {
  const accountIds = c.req.queries("account_id");

  const accountFilter = accountIds?.length
    ? sql`AND tl.account_id = ANY(${accountIds}::uuid[])`
    : sql``;

  const result = await db.execute<{ count: string }>(sql`
    WITH snapshots_7d AS (
      SELECT tracking_link_id, snapshot_date, subscribers
      FROM daily_snapshots
      WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'
        AND tracking_link_id IS NOT NULL
    ),
    latest AS (
      SELECT DISTINCT ON (tracking_link_id)
        tracking_link_id, snapshot_date, subscribers
      FROM snapshots_7d
      ORDER BY tracking_link_id, snapshot_date DESC
    ),
    earlier AS (
      SELECT DISTINCT ON (tracking_link_id)
        tracking_link_id, snapshot_date, subscribers
      FROM snapshots_7d
      WHERE snapshot_date <= CURRENT_DATE - INTERVAL '5 days'
      ORDER BY tracking_link_id, snapshot_date DESC
    ),
    active_links AS (
      SELECT l.tracking_link_id
      FROM latest l
      JOIN earlier e ON e.tracking_link_id = l.tracking_link_id
      WHERE l.snapshot_date != e.snapshot_date
        AND (l.subscribers - e.subscribers) > 0
        AND (l.subscribers - e.subscribers)::float /
            GREATEST(1, (l.snapshot_date - e.snapshot_date)) >= 1
    )
    SELECT COUNT(*) AS count
    FROM tracking_links tl
    JOIN active_links al ON al.tracking_link_id = tl.id
    WHERE tl.deleted_at IS NULL
    ${accountFilter}
  `);

  return c.json({ count: Number(result.rows[0]?.count ?? 0) });
});

export default router;

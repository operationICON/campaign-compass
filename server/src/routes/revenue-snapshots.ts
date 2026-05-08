import { Hono } from "hono";
import { db } from "../db/client.js";
import { account_revenue_snapshots, accounts } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

// GET /revenue-snapshots — return latest snapshot per account + grand total
router.get("/", async (c) => {
  const rows = await db
    .select({
      account_id: account_revenue_snapshots.account_id,
      display_name: accounts.display_name,
      username: accounts.username,
      net_total: account_revenue_snapshots.net_total,
      gross_total: account_revenue_snapshots.gross_total,
      last_synced_at: account_revenue_snapshots.last_synced_at,
      api_status: account_revenue_snapshots.api_status,
    })
    .from(account_revenue_snapshots)
    .innerJoin(accounts, eq(accounts.id, account_revenue_snapshots.account_id))
    .orderBy(sql`${account_revenue_snapshots.net_total}::numeric DESC`);

  const grandTotalNet = rows.reduce((sum, r) => sum + Number(r.net_total ?? 0), 0);
  const grandTotalGross = rows.reduce((sum, r) => sum + Number(r.gross_total ?? 0), 0);
  const lastSyncedAt = rows.length > 0
    ? rows.reduce((latest, r) =>
        r.last_synced_at && (!latest || r.last_synced_at > latest) ? r.last_synced_at : latest,
        null as Date | null)
    : null;

  return c.json({
    grand_total_net: grandTotalNet,
    grand_total_gross: grandTotalGross,
    last_synced_at: lastSyncedAt,
    account_count: rows.length,
    accounts: rows,
  });
});

// POST /revenue-snapshots/sync — trigger a fresh sync from the OF Earnings API
router.post("/sync", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const allAccounts = await db
    .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
    .from(accounts)
    .where(sql`${accounts.is_active} = true AND ${accounts.onlyfans_account_id} IS NOT NULL AND ${accounts.sync_excluded} = false`);

  const results: any[] = [];
  let grandTotal = 0;

  const today = new Date().toISOString().replace("T", " ").slice(0, 19);

  for (const acc of allAccounts) {
    const url = `${API_BASE}/${acc.onlyfans_account_id}/statistics/statements/earnings?start_date=2018-01-01+00:00:00&end_date=${encodeURIComponent(today)}&type=total`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const apiStatus = res.status;

      if (!res.ok) {
        results.push({ account: acc.display_name, status: apiStatus, error: `HTTP ${apiStatus}` });
        await db
          .insert(account_revenue_snapshots)
          .values({
            account_id: acc.id,
            net_total: "0",
            gross_total: "0",
            api_status: apiStatus,
            last_synced_at: new Date(),
            synced_from_date: "2018-01-01",
          })
          .onConflictDoUpdate({
            target: account_revenue_snapshots.account_id,
            set: { api_status: apiStatus, last_synced_at: new Date(), updated_at: new Date() },
          });
        continue;
      }

      const data = await res.json() as any;

      const totalObj = data?.data?.total;
      const netRaw =
        (typeof totalObj === "number" ? totalObj : null) ??
        data?.data?.total?.total ??
        data?.data?.total?.net ??
        data?.data?.total?.creator ??
        data?.data?.total?.creator_revenue ??
        data?.data?.total?.payout ??
        data?.data?.total?.revenue ??
        data?.data?.total?.earnings ??
        data?.data?.net ??
        data?.total?.net ??
        data?.net ??
        data?.data?.earnings ??
        data?.earnings ??
        null;

      const grossRaw =
        data?.data?.total?.gross ??
        data?.data?.gross ??
        data?.gross ??
        null;

      const net = Number(netRaw ?? 0);
      const gross = Number(grossRaw ?? net);
      grandTotal += net;

      await db
        .insert(account_revenue_snapshots)
        .values({
          account_id: acc.id,
          net_total: String(net),
          gross_total: String(gross),
          api_status: apiStatus,
          last_synced_at: new Date(),
          synced_from_date: "2018-01-01",
        })
        .onConflictDoUpdate({
          target: account_revenue_snapshots.account_id,
          set: {
            net_total: String(net),
            gross_total: String(gross),
            api_status: apiStatus,
            last_synced_at: new Date(),
            updated_at: new Date(),
          },
        });

      results.push({ account: acc.display_name, status: apiStatus, net, gross });
    } catch (err: any) {
      results.push({ account: acc.display_name, error: err.message });
    }
  }

  return c.json({ grand_total_net: grandTotal, account_count: allAccounts.length, results });
});

export default router;

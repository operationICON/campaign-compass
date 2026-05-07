import { Hono } from "hono";
import { db } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Call OFAPI's own aggregated-by-type endpoint for one account
async function fetchByType(ofAccountId: string, apiKey: string, dateFrom?: string, dateTo?: string) {
  const url = `${API_BASE}/${ofAccountId}/analytics/financial/transactions/by-type`;
  const body: Record<string, string> = {};
  if (dateFrom) body.date_from = dateFrom;
  if (dateTo)   body.date_to   = dateTo;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? 15);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`OFAPI ${res.status}`);
    return await res.json() as any;
  }
  throw new Error("Max retries exceeded");
}

function parseEarnings(json: any): { subscriptions: number; tips: number; messages: number; posts: number; total: number } {
  // Handle various response shapes OFAPI might return
  const d = json?.data ?? json?.result ?? json ?? {};
  const list: any[] = Array.isArray(d) ? d : (d.list ?? d.items ?? d.types ?? []);

  let subscriptions = 0, tips = 0, messages = 0, posts = 0;

  // Shape A: array of { type, amount/total/revenue }
  if (list.length > 0) {
    for (const item of list) {
      const t = (item.type ?? item.name ?? "").toLowerCase();
      const v = Number(item.amount ?? item.total ?? item.revenue ?? item.earnings ?? 0);
      if (t.includes("sub")) subscriptions += v;
      else if (t.includes("tip")) tips += v;
      else if (t.includes("message") || t === "ppv" || t.includes("chat")) messages += v;
      else if (t.includes("post")) posts += v;
    }
  } else {
    // Shape B: flat keys { subscriptions, tips, messages, posts, total }
    subscriptions = Number(d.subscriptions ?? d.subscription ?? 0);
    tips          = Number(d.tips ?? d.tip ?? 0);
    messages      = Number(d.messages ?? d.message ?? d.ppv ?? d.chat ?? 0);
    posts         = Number(d.posts ?? d.post ?? 0);
  }

  const total = subscriptions + tips + messages + posts
    || Number(d.total ?? d.totalEarnings ?? d.earnings ?? d.total_earnings ?? 0);

  return { subscriptions, tips, messages, posts, total };
}

// GET /earnings/by-account?account_ids=uuid1,uuid2&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get("/by-account", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const dateFrom       = c.req.query("date_from") || undefined;
  const dateTo         = c.req.query("date_to")   || undefined;
  const accountIdsRaw  = c.req.query("account_ids");
  const accountIds     = accountIdsRaw ? accountIdsRaw.split(",").filter(Boolean) : [];

  const accountList = await db
    .select({ id: accounts.id, onlyfans_account_id: accounts.onlyfans_account_id, display_name: accounts.display_name })
    .from(accounts)
    .where(and(
      eq(accounts.is_active, true),
      sql`accounts.sync_excluded IS NOT TRUE`,
      accountIds.length > 0 ? inArray(accounts.id, accountIds) : sql`1=1`,
    ));

  // Run up to 4 in parallel to stay within rate limits
  const BATCH = 4;
  const results: any[] = [];

  for (let i = 0; i < accountList.length; i += BATCH) {
    const batch = accountList.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (acc) => {
        if (!acc.onlyfans_account_id) return { account_id: acc.id, error: "no_of_id" };
        try {
          const raw = await fetchByType(acc.onlyfans_account_id, apiKey, dateFrom, dateTo);
          const earnings = parseEarnings(raw);
          return { account_id: acc.id, ...earnings };
        } catch (err: any) {
          return { account_id: acc.id, error: err.message, subscriptions: 0, tips: 0, messages: 0, posts: 0, total: 0 };
        }
      })
    );
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
    if (i + BATCH < accountList.length) await sleep(300);
  }

  return c.json(results);
});

export default router;

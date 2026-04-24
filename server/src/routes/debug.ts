import { Hono } from "hono";
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json() as any;

  if (body?.action === "call_endpoint") {
    const { url } = body;
    if (!url) return c.json({ error: "Missing url" }, 400);

    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
    if (!fullUrl.startsWith("https://app.onlyfansapi.com/")) {
      return c.json({ error: "URL not allowed — only https://app.onlyfansapi.com/ endpoints permitted" }, 403);
    }

    try {
      const start = Date.now();
      const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" } });
      const responseTimeMs = Date.now() - start;
      const bodyText = await res.text();
      let bodyParsed: any;
      try { bodyParsed = JSON.parse(bodyText); } catch { bodyParsed = bodyText; }
      return c.json({ url: fullUrl, status: res.status, status_text: res.statusText, response_time_ms: responseTimeMs, body: bodyParsed });
    } catch (err: any) {
      return c.json({ url: fullUrl, error: err.message }, 500);
    }
  }

  if (body?.action === "crosspoll_diag") {
    const [fans, links, spend, fanSample, spendSample] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as cnt FROM fans WHERE first_subscribe_link_id IS NOT NULL`),
      db.execute(sql`SELECT COUNT(*) as cnt FROM tracking_links WHERE deleted_at IS NULL AND external_tracking_link_id IS NOT NULL`),
      db.execute(sql`SELECT COUNT(*) as cnt FROM fan_spend`),
      db.execute(sql`SELECT fan_id, first_subscribe_link_id FROM fans WHERE first_subscribe_link_id IS NOT NULL LIMIT 3`),
      db.execute(sql`SELECT fan_id, account_id, revenue FROM fan_spend LIMIT 3`),
    ]);
    return c.json({
      fans_with_link: fans.rows[0]?.cnt,
      active_links: links.rows[0]?.cnt,
      fan_spend_rows: spend.rows[0]?.cnt,
      fan_samples: fanSample.rows,
      spend_samples: spendSample.rows,
    });
  }

  if (body?.action === "revenue_diag") {
    const [txCount, types, sample] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as cnt FROM transactions`),
      db.execute(sql`SELECT DISTINCT type, COUNT(*) as cnt FROM transactions GROUP BY type ORDER BY cnt DESC LIMIT 20`),
      db.execute(sql`SELECT account_id, type, revenue FROM transactions LIMIT 5`),
    ]);
    return c.json({
      transaction_count: txCount.rows[0]?.cnt,
      types: types.rows,
      sample: sample.rows,
    });
  }

  return c.json({ error: "Unknown action" }, 400);
});

export default router;

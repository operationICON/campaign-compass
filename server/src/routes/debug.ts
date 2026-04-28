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

  // Fetch a raw transaction from the API to see exactly what fields come back
  if (body?.action === "tx_sample") {

    const accRows = await db.execute(sql`
      SELECT id, onlyfans_account_id, display_name
      FROM accounts WHERE is_active = true AND onlyfans_account_id IS NOT NULL
      LIMIT 5
    `);
    const accounts = accRows.rows as any[];
    const results: any[] = [];

    for (const acc of accounts) {
      const url = `https://app.onlyfansapi.com/api/${acc.onlyfans_account_id}/transactions?limit=1`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        // Show first transaction with ALL its fields
        const list = parsed?.data?.list ?? parsed?.data ?? parsed?.transactions ?? parsed?.list ?? [];
        const firstTx = Array.isArray(list) ? list[0] : null;
        results.push({
          account: acc.display_name,
          status: res.status,
          top_keys: Object.keys(parsed ?? {}),
          tx_fields: firstTx ? Object.keys(firstTx) : null,
          first_tx: firstTx,
        });
      } catch (err: any) {
        results.push({ account: acc.display_name, error: err.message });
      }
    }
    return c.json({ results });
  }

  return c.json({ error: "Unknown action" }, 400);
});

export default router;

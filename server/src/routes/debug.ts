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

  // Test analytics endpoints — try global (no account in URL) and per-account variants
  if (body?.action === "analytics_test") {
    const accRows = await db.execute(sql`
      SELECT id, onlyfans_account_id, display_name
      FROM accounts WHERE is_active = true AND onlyfans_account_id IS NOT NULL
      LIMIT 2
    `);
    const accs = accRows.rows as any[];
    const today = new Date().toISOString().split("T")[0];
    const results: any[] = [];

    // 1. Try GLOBAL endpoint (no account ID) — this might be what OFAPI Summary uses
    const globalUrls = [
      `${API_BASE}/analytics/financial/transactions/by-type`,
      `${API_BASE}/analytics/financial/summary`,
      `${API_BASE}/analytics/summary`,
    ];
    for (const url of globalUrls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ date_from: "2018-01-01", date_to: today }),
        });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        results.push({ source: "global", url, status: res.status, net: parsed?.data?.total?.total ?? null, raw_keys: typeof parsed === "object" ? Object.keys(parsed ?? {}) : null });
      } catch (err: any) {
        results.push({ source: "global", url, error: err.message });
      }
    }

    // 2. Per-account (what we currently use) — check what data.total.total returns
    for (const acc of accs) {
      const url = `${API_BASE}/${acc.onlyfans_account_id}/analytics/financial/transactions/by-type`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ date_from: "2018-01-01", date_to: today }),
        });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const net = parsed?.data?.total?.total;
        const gross = parsed?.data?.total?.gross;
        const earliest = (parsed?.data?.total?.chartAmount ?? [])[0]?.date ?? null;
        results.push({ source: "per_account", account: acc.display_name, status: res.status, net, gross, earliest_date: earliest });
      } catch (err: any) {
        results.push({ source: "per_account", account: acc.display_name, error: err.message });
      }
    }

    // 3. Also show what's currently stored in ltv_total per account
    const stored = await db.execute(sql`
      SELECT display_name, ltv_total, ltv_updated_at FROM accounts WHERE is_active = true ORDER BY ltv_total::numeric DESC LIMIT 5
    `);
    return c.json({ api_tests: results, stored_ltv: stored.rows });
  }

  // Find which global OFAPI endpoint returns the Financial Analytics total ($1.99M)
  if (body?.action === "find_total") {
    const today = new Date().toISOString().split("T")[0];
    const dateFrom = "2018-01-01";
    const results: any[] = [];

    // Step 1: Fetch OFAPI accounts list to get acct_... IDs
    let ofapiAcctIds: string[] = [];
    let ofNumericIds: string[] = [];
    try {
      const accListRes = await fetch(`${API_BASE}/accounts`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const accListJson = await accListRes.json() as any;
      const accList: any[] = Array.isArray(accListJson) ? accListJson : (accListJson?.data ?? []);
      ofapiAcctIds = accList.filter((a: any) => a.id).map((a: any) => a.id);           // acct_... format
      ofNumericIds = accList.filter((a: any) => a.onlyfans_id).map((a: any) => a.onlyfans_id); // numeric format
      results.push({ id: "accounts_fetch", status: accListRes.status, ofapi_ids_found: ofapiAcctIds.length, sample_acct_id: ofapiAcctIds[0] ?? null, sample_numeric_id: ofNumericIds[0] ?? null });
    } catch (err: any) {
      results.push({ id: "accounts_fetch", error: err.message });
    }

    // Step 2: Try analytics endpoints with different ID formats and body shapes
    const variants = [
      { id: "global_no_ids",           method: "POST", url: `${API_BASE}/analytics/financial/transactions/by-type`, body: { date_from: dateFrom, date_to: today } },
      { id: "global_acct_ids",         method: "POST", url: `${API_BASE}/analytics/financial/transactions/by-type`, body: { date_from: dateFrom, date_to: today, account_ids: ofapiAcctIds } },
      { id: "global_numeric_ids",      method: "POST", url: `${API_BASE}/analytics/financial/transactions/by-type`, body: { date_from: dateFrom, date_to: today, account_ids: ofNumericIds } },
      { id: "summary_no_ids",          method: "POST", url: `${API_BASE}/analytics/financial/summary`,              body: { date_from: dateFrom, date_to: today } },
      { id: "summary_acct_ids",        method: "POST", url: `${API_BASE}/analytics/financial/summary`,              body: { date_from: dateFrom, date_to: today, account_ids: ofapiAcctIds } },
      { id: "earnings_no_ids",         method: "POST", url: `${API_BASE}/analytics/financial/earnings`,             body: { date_from: dateFrom, date_to: today } },
      { id: "overview_no_ids",         method: "POST", url: `${API_BASE}/analytics/financial/overview`,             body: { date_from: dateFrom, date_to: today } },
      { id: "global_get_no_filter",    method: "GET",  url: `${API_BASE}/analytics/financial/transactions/by-type?date_from=${dateFrom}&date_to=${today}`, body: null },
    ];

    for (const v of variants) {
      try {
        const opts: RequestInit = {
          method: v.method,
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
        };
        if (v.body) opts.body = JSON.stringify(v.body);
        const res = await fetch(v.url, opts);
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const total = parsed?.data?.total?.total ?? parsed?.data?.net ?? parsed?.data?.total ?? parsed?.total ?? parsed?.net ?? null;
        const gross = parsed?.data?.total?.gross ?? parsed?.data?.gross ?? parsed?.gross ?? null;
        results.push({ id: v.id, status: res.status, total, gross, top_keys: typeof parsed === "object" && parsed ? Object.keys(parsed) : null, data_keys: typeof parsed?.data === "object" && parsed?.data ? Object.keys(parsed.data) : null });
      } catch (err: any) {
        results.push({ id: v.id, error: err.message });
      }
    }
    return c.json({ results });
  }

  // Sum earnings across all accounts via statistics/statements/earnings endpoint (full history)
  if (body?.action === "sum_earnings") {
    const accRows = await db.execute(sql`
      SELECT id, onlyfans_account_id, display_name
      FROM accounts WHERE is_active = true AND onlyfans_account_id IS NOT NULL
      AND sync_excluded IS NOT TRUE
    `);
    const accounts = accRows.rows as any[];
    const today = new Date().toISOString().replace("T", " ").slice(0, 19);
    const results: any[] = [];
    let grandTotal = 0;

    for (const acc of accounts) {
      const url = `${API_BASE}/${acc.onlyfans_account_id}/statistics/statements/earnings?start_date=2018-01-01+00:00:00&end_date=${encodeURIComponent(today)}&type=total`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        // Try every common path for net earnings
        const net = parsed?.data?.total?.net
          ?? parsed?.data?.net
          ?? parsed?.total?.net
          ?? parsed?.net
          ?? parsed?.data?.total
          ?? parsed?.data?.earnings
          ?? parsed?.earnings
          ?? null;
        const gross = parsed?.data?.total?.gross ?? parsed?.data?.gross ?? parsed?.gross ?? null;
        grandTotal += Number(net ?? 0);
        results.push({
          account: acc.display_name,
          status: res.status,
          net,
          gross,
          raw_keys: typeof parsed === "object" && parsed ? Object.keys(parsed) : null,
          data_keys: typeof parsed?.data === "object" && parsed?.data ? Object.keys(parsed.data) : null,
          data_total_keys: typeof parsed?.data?.total === "object" ? Object.keys(parsed.data.total) : null,
          raw_sample: typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 300) : String(parsed).slice(0, 300),
        });
      } catch (err: any) {
        results.push({ account: acc.display_name, error: err.message });
      }
    }
    return c.json({ grand_total: grandTotal, account_count: accounts.length, results });
  }

  // Show per-account transaction counts, date ranges, and revenue sums from our DB
  if (body?.action === "tx_totals") {
    const rows = await db.execute(sql`
      SELECT
        a.display_name,
        a.onlyfans_account_id,
        a.ltv_total,
        a.ltv_updated_at,
        COUNT(t.id)                                    AS tx_count,
        MIN(t.date)                                    AS earliest_date,
        MAX(t.date)                                    AS latest_date,
        SUM(t.revenue::numeric)                        AS gross_sum,
        SUM(CASE
          WHEN t.revenue_net IS NOT NULL AND t.revenue_net::text != '' THEN t.revenue_net::numeric
          WHEN t.fee IS NOT NULL AND t.fee::text != ''                  THEN t.revenue::numeric - t.fee::numeric
          ELSE t.revenue::numeric * 0.80
        END)                                           AS net_sum,
        COUNT(CASE WHEN t.date IS NULL THEN 1 END)     AS null_date_count
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.is_active = true
      GROUP BY a.id, a.display_name, a.onlyfans_account_id, a.ltv_total, a.ltv_updated_at
      ORDER BY gross_sum DESC NULLS LAST
    `);
    const totals = rows.rows.reduce((acc: any, r: any) => ({
      tx_count:       acc.tx_count       + Number(r.tx_count       ?? 0),
      gross_sum:      acc.gross_sum      + Number(r.gross_sum      ?? 0),
      net_sum:        acc.net_sum        + Number(r.net_sum        ?? 0),
      ltv_total_sum:  acc.ltv_total_sum  + Number(r.ltv_total      ?? 0),
      null_date_count: acc.null_date_count + Number(r.null_date_count ?? 0),
    }), { tx_count: 0, gross_sum: 0, net_sum: 0, ltv_total_sum: 0, null_date_count: 0 });
    return c.json({ accounts: rows.rows, totals });
  }

  // Sum earnings across all accounts via statistics/statements/earnings endpoint (full history)
  if (body?.action === "sum_earnings") {
    const accRows = await db.execute(sql`
      SELECT id, onlyfans_account_id, display_name
      FROM accounts WHERE is_active = true AND onlyfans_account_id IS NOT NULL
      AND sync_excluded IS NOT TRUE
    `);
    const accounts = accRows.rows as any[];
    const today = new Date().toISOString().replace("T", " ").slice(0, 19);
    const results: any[] = [];
    let grandTotal = 0;

    for (const acc of accounts) {
      const url = `${API_BASE}/${acc.onlyfans_account_id}/statistics/statements/earnings?start_date=2018-01-01+00:00:00&end_date=${encodeURIComponent(today)}&type=total`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const net = parsed?.data?.total?.net
          ?? parsed?.data?.net
          ?? parsed?.total?.net
          ?? parsed?.net
          ?? parsed?.data?.total
          ?? parsed?.data?.earnings
          ?? parsed?.earnings
          ?? null;
        const gross = parsed?.data?.total?.gross ?? parsed?.data?.gross ?? parsed?.gross ?? null;
        grandTotal += Number(net ?? 0);
        results.push({
          account: (acc as any).display_name,
          status: res.status,
          net,
          gross,
          raw_keys: typeof parsed === "object" && parsed ? Object.keys(parsed) : null,
          data_keys: typeof parsed?.data === "object" && parsed?.data ? Object.keys(parsed.data) : null,
          data_total_keys: typeof parsed?.data?.total === "object" ? Object.keys(parsed.data.total) : null,
          raw_sample: typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 300) : String(parsed).slice(0, 300),
        });
      } catch (err: any) {
        results.push({ account: (acc as any).display_name, error: err.message });
      }
    }
    return c.json({ grand_total: grandTotal, account_count: accounts.length, results });
  }

  return c.json({ error: "Unknown action" }, 400);
});

export default router;

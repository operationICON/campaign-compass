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
        const totalObj = parsed?.data?.total;
        const net = (typeof totalObj === "number" ? totalObj : null)
          ?? parsed?.data?.total?.total
          ?? parsed?.data?.total?.net
          ?? parsed?.data?.total?.creator
          ?? parsed?.data?.total?.creator_revenue
          ?? parsed?.data?.total?.payout
          ?? parsed?.data?.total?.revenue
          ?? parsed?.data?.total?.earnings
          ?? parsed?.data?.net
          ?? parsed?.total?.net
          ?? parsed?.net
          ?? parsed?.data?.earnings
          ?? parsed?.earnings
          ?? null;
        const gross = parsed?.data?.total?.gross ?? parsed?.data?.gross ?? parsed?.gross ?? null;
        grandTotal += Number(net ?? 0);
        // Show data.total without chart arrays so we can see all scalar fields
        const totalScalars = typeof totalObj === "object" && totalObj
          ? Object.fromEntries(Object.entries(totalObj).filter(([, v]) => !Array.isArray(v)))
          : null;
        results.push({
          account: acc.display_name,
          status: res.status,
          net,
          gross,
          raw_sample: totalScalars ? JSON.stringify(totalScalars) : (typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 500) : String(parsed).slice(0, 500)),
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
        -- Tracking links revenue (what the dashboard Overview shows)
        COALESCE(SUM(tl.revenue::numeric), 0)          AS link_revenue,
        -- Transaction table stats
        -- Real individual transactions (last ~30 days from OFAPI)
        COUNT(CASE WHEN t.type != 'earnings_monthly' OR t.type IS NULL THEN 1 END)  AS tx_count,
        MIN(CASE WHEN t.type != 'earnings_monthly' OR t.type IS NULL THEN t.date END) AS earliest_real,
        MAX(CASE WHEN t.type != 'earnings_monthly' OR t.type IS NULL THEN t.date END) AS latest_real,
        -- Monthly earnings summaries (historical backfill)
        COUNT(CASE WHEN t.type = 'earnings_monthly' THEN 1 END)                      AS em_count,
        MIN(CASE WHEN t.type = 'earnings_monthly' THEN t.date END)                   AS earliest_em,
        -- Combined revenue (real txns + monthly summaries)
        COALESCE(SUM(CASE
          WHEN t.revenue_net IS NOT NULL AND t.revenue_net::numeric != 0 THEN t.revenue_net::numeric
          WHEN t.fee IS NOT NULL AND t.fee::numeric != 0                  THEN t.revenue::numeric - t.fee::numeric
          ELSE t.revenue::numeric * 0.80
        END), 0)                                       AS tx_net,
        COALESCE(SUM(t.revenue::numeric), 0)           AS tx_gross,
        -- How many rows used each net formula (real txns only)
        COUNT(CASE WHEN (t.type != 'earnings_monthly' OR t.type IS NULL) AND t.revenue_net IS NOT NULL AND t.revenue_net::numeric != 0 THEN 1 END) AS used_net_field,
        COUNT(CASE WHEN (t.type != 'earnings_monthly' OR t.type IS NULL) AND t.fee IS NOT NULL AND t.fee::numeric != 0
                    AND (t.revenue_net IS NULL OR t.revenue_net::numeric = 0) THEN 1 END)                                                          AS used_fee_calc,
        COUNT(CASE WHEN (t.type != 'earnings_monthly' OR t.type IS NULL)
                    AND (t.revenue_net IS NULL OR t.revenue_net::numeric = 0)
                    AND (t.fee IS NULL OR t.fee::numeric = 0)
                    AND t.id IS NOT NULL THEN 1 END)                                                                                               AS used_80pct
      FROM accounts a
      LEFT JOIN tracking_links tl ON tl.account_id = a.id
      LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.is_active = true
      GROUP BY a.id, a.display_name, a.onlyfans_account_id
      ORDER BY link_revenue DESC NULLS LAST
    `);
    const totals = rows.rows.reduce((acc: any, r: any) => ({
      tx_count:      acc.tx_count      + Number(r.tx_count      ?? 0),
      em_count:      acc.em_count      + Number(r.em_count      ?? 0),
      tx_gross:      acc.tx_gross      + Number(r.tx_gross      ?? 0),
      tx_net:        acc.tx_net        + Number(r.tx_net        ?? 0),
      link_revenue:  acc.link_revenue  + Number(r.link_revenue  ?? 0),
      used_net_field: acc.used_net_field + Number(r.used_net_field ?? 0),
      used_fee_calc:  acc.used_fee_calc  + Number(r.used_fee_calc  ?? 0),
      used_80pct:     acc.used_80pct     + Number(r.used_80pct     ?? 0),
    }), { tx_count: 0, em_count: 0, tx_gross: 0, tx_net: 0, link_revenue: 0, used_net_field: 0, used_fee_calc: 0, used_80pct: 0 });
    return c.json({ accounts: rows.rows, totals });
  }

  // Test what date-range params the transactions endpoint accepts
  if (body?.action === "tx_date_test") {
    const accRow = await db.execute(sql`
      SELECT onlyfans_account_id, display_name FROM accounts
      WHERE is_active = true AND onlyfans_account_id IS NOT NULL
      ORDER BY display_name LIMIT 1
    `);
    const acc = accRow.rows[0] as any;
    if (!acc) return c.json({ error: "No accounts found" }, 404);

    const acctId = acc.onlyfans_account_id;
    const oldDate = "2024-01-01";
    const today = new Date().toISOString().split("T")[0];
    const results: any[] = [];

    const variants = [
      { id: "no_params",          url: `${API_BASE}/${acctId}/transactions?limit=5` },
      { id: "start_date",         url: `${API_BASE}/${acctId}/transactions?limit=5&start_date=${oldDate}` },
      { id: "end_date",           url: `${API_BASE}/${acctId}/transactions?limit=5&end_date=${oldDate}` },
      { id: "date_from_to",       url: `${API_BASE}/${acctId}/transactions?limit=5&date_from=${oldDate}&date_to=${today}` },
      { id: "from_to",            url: `${API_BASE}/${acctId}/transactions?limit=5&from=${oldDate}&to=${today}` },
      { id: "after_before",       url: `${API_BASE}/${acctId}/transactions?limit=5&after=${oldDate}&before=${today}` },
      { id: "created_after",      url: `${API_BASE}/${acctId}/transactions?limit=5&created_after=${oldDate}` },
      { id: "created_at_gte",     url: `${API_BASE}/${acctId}/transactions?limit=5&created_at_gte=${oldDate}` },
      { id: "filter_date",        url: `${API_BASE}/${acctId}/transactions?limit=5&filter[created_at][gte]=${oldDate}` },
      { id: "start_date_spaced",  url: `${API_BASE}/${acctId}/transactions?limit=5&start_date=${oldDate}+00:00:00` },
    ];

    for (const v of variants) {
      try {
        const res = await fetch(v.url, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const list: any[] = parsed?.data?.list ?? parsed?.data ?? parsed?.transactions ?? (Array.isArray(parsed) ? parsed : []);
        const dates = list.map((t: any) => t.createdAt?.split("T")[0]).filter(Boolean).sort();
        results.push({
          id: v.id,
          status: res.status,
          count: list.length,
          earliest: dates[0] ?? null,
          latest: dates[dates.length - 1] ?? null,
          total_count: parsed?.data?.total ?? parsed?._meta?.total ?? parsed?.total ?? null,
          pagination_keys: typeof parsed === "object" ? Object.keys(parsed).filter(k => k.includes("pag") || k.includes("meta") || k.includes("next")) : [],
        });
      } catch (err: any) {
        results.push({ id: v.id, error: err.message });
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return c.json({ account: acc.display_name, acct_id: acctId, results });
  }

  // Probe the Financial Analytics endpoint — find the one that returns $1,977,515.19
  if (body?.action === "fin_analytics_probe") {
    const today = new Date().toISOString().split("T")[0];
    const startDate = "2018-01-01 00:00:00";
    const endDate   = `${today} 23:59:59`;
    const results: any[] = [];

    // Step 1a: fetch OFAPI /accounts to see what IDs look like
    let ofApiIds: string[] = [];
    let ofNumericIds: string[] = [];
    let ofAllKeys: string[] = [];
    let rawSample: any = null;
    try {
      const accRes = await fetch(`${API_BASE}/accounts`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
      const accJson = await accRes.json() as any;
      const accList: any[] = Array.isArray(accJson) ? accJson : (accJson?.data ?? []);
      rawSample = accList[0] ?? null;
      ofAllKeys = rawSample ? Object.keys(rawSample) : [];
      ofApiIds     = accList.filter((a: any) => a.id).map((a: any) => String(a.id));
      ofNumericIds = accList.filter((a: any) => a.onlyfans_id).map((a: any) => String(a.onlyfans_id));
      results.push({ id: "accounts_fetch", status: accRes.status, ofapi_count: ofApiIds.length, numeric_count: ofNumericIds.length,
        sample_first_account_keys: ofAllKeys,
        sample_id: ofApiIds[0] ?? null, sample_numeric: ofNumericIds[0] ?? null,
        all_ofapi_ids: ofApiIds, all_numeric_ids: ofNumericIds,
      });
    } catch (err: any) {
      results.push({ id: "accounts_fetch", error: err.message });
    }
    await new Promise(r => setTimeout(r, 300));

    // Step 1b: get DB account IDs — active accounts with actual revenue data (filters out Eva/broken auth)
    let dbOfIds: string[] = [];
    let dbOfIdsWithData: string[] = [];
    let dbOfIdsAsInts: number[] = [];
    try {
      const dbRows = await db.execute(sql`
        SELECT onlyfans_account_id, display_name, ltv_total FROM accounts
        WHERE is_active = true AND onlyfans_account_id IS NOT NULL AND sync_excluded IS NOT TRUE
        ORDER BY COALESCE(ltv_total::numeric, 0) DESC
      `);
      dbOfIds = (dbRows.rows as any[]).map(r => String(r.onlyfans_account_id));
      dbOfIdsWithData = (dbRows.rows as any[]).filter(r => Number(r.ltv_total ?? 0) > 0).map(r => String(r.onlyfans_account_id));
      dbOfIdsAsInts = dbOfIdsWithData.map(Number).filter(n => !isNaN(n));
      results.push({ id: "db_ids_fetch", status: 200, all_count: dbOfIds.length, with_data_count: dbOfIdsWithData.length,
        sample_all: dbOfIds[0] ?? null, sample_with_data: dbOfIdsWithData[0] ?? null,
        all_ids: dbOfIds, with_data_ids: dbOfIdsWithData,
      });
    } catch (err: any) {
      results.push({ id: "db_ids_fetch", error: err.message });
    }
    await new Promise(r => setTimeout(r, 200));

    // Step 2: try by-type endpoint — filtered to accounts with revenue data, and as integers
    const variants = [
      { id: "by_type_with_data",      body: { account_ids: dbOfIdsWithData, start_date: startDate, end_date: endDate } },
      { id: "by_type_as_integers",    body: { account_ids: dbOfIdsAsInts,   start_date: startDate, end_date: endDate } },
      { id: "by_type_ofapi_skip0",    body: { account_ids: ofApiIds.slice(1), start_date: startDate, end_date: endDate } },
      { id: "by_type_single_top",     body: { account_ids: [dbOfIdsWithData[0]], start_date: startDate, end_date: endDate } },
    ];

    for (const v of variants) {
      try {
        const res = await fetch(`${API_BASE}/analytics/financial/transactions/by-type`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(v.body),
        });
        const text = await res.text();
        let p: any;
        try { p = JSON.parse(text); } catch { p = text; }
        // Response: { data: { message: {count,gross,net}, new_subscription: {...}, tip: {...}, ... }, _meta: {...} }
        let net = 0, gross = 0, fees = 0;
        const typeBreakdown: Record<string, any> = {};
        const dataObj: Record<string, any> = (typeof p?.data === "object" && p.data) ? p.data : {};
        for (const key of Object.keys(dataObj)) {
          const val = dataObj[key];
          if (typeof val === "object" && val !== null) {
            const n = Number(val?.net ?? val?.total ?? val?.amount ?? 0);
            const g = Number(val?.gross ?? val?.gross_amount ?? 0);
            const f = Number(val?.fee ?? val?.fees ?? 0);
            const cnt = Number(val?.count ?? 0);
            const chartLen = (val?.chartAmount ?? val?.chart_amount ?? []).length;
            net += n; gross += g; fees += f;
            typeBreakdown[key] = { count: cnt, net: n, gross: g, fees: f, chart_entries: chartLen };
          }
        }
        results.push({ id: v.id, status: res.status,
          net: net > 0 ? net : null,
          gross: gross > 0 ? gross : null,
          fees: fees > 0 ? fees : null,
          chart_entries: 0,
          top_keys: typeof p === "object" && p ? Object.keys(p) : null,
          type_breakdown: typeBreakdown,
          raw_response: res.status === 200 ? (typeof p === "object" ? JSON.stringify(p).slice(0, 800) : String(p).slice(0, 800)) : undefined,
          raw_error: res.status >= 400 ? (typeof p === "object" ? JSON.stringify(p).slice(0, 400) : String(p).slice(0, 400)) : undefined,
        });
      } catch (err: any) { results.push({ id: v.id, error: err.message }); }
      await new Promise(r => setTimeout(r, 400));
    }
    return c.json({ results });
  }

  // Raw earnings endpoint probe — shows exact chartAmount structure
  if (body?.action === "raw_earnings") {
    const accRow = await db.execute(sql`
      SELECT onlyfans_account_id, display_name FROM accounts
      WHERE is_active = true AND onlyfans_account_id IS NOT NULL
      AND sync_excluded IS NOT TRUE
      ORDER BY display_name LIMIT 1
    `);
    const acc = accRow.rows[0] as any;
    if (!acc) return c.json({ error: "No accounts" }, 404);

    const today = new Date().toISOString().split("T")[0];
    const url = `${API_BASE}/${acc.onlyfans_account_id}/statistics/statements/earnings?start_date=2018-01-01+00:00:00&end_date=${today}+23:59:59&type=total`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    const chartAmount: any[] = parsed?.data?.total?.chartAmount ?? [];
    const totalScalars = typeof parsed?.data?.total === "object"
      ? Object.fromEntries(Object.entries(parsed.data.total).filter(([, v]) => !Array.isArray(v)))
      : null;

    return c.json({
      account: acc.display_name,
      status: res.status,
      top_keys: typeof parsed === "object" ? Object.keys(parsed ?? {}) : null,
      data_keys: typeof parsed?.data === "object" ? Object.keys(parsed.data ?? {}) : null,
      total_scalars: totalScalars,
      chartAmount_length: chartAmount.length,
      chartAmount_first3: chartAmount.slice(0, 3),
      chartAmount_last3: chartAmount.slice(-3),
    });
  }

  // Check revenue_monthly data stored on accounts
  if (body?.action === "rev_monthly_check") {
    const rows = await db.execute(sql`
      SELECT display_name, ltv_total, ltv_updated_at,
        revenue_monthly IS NOT NULL AS has_field,
        revenue_monthly::text AS monthly_raw
      FROM accounts WHERE is_active = true ORDER BY display_name
    `);
    const accounts = (rows.rows as any[]).map(r => {
      let monthly: Record<string, number> | null = null;
      try {
        // drizzle may auto-parse jsonb, or leave as string
        monthly = typeof r.monthly_raw === "string"
          ? JSON.parse(r.monthly_raw)
          : (r.monthly_raw ?? null);
      } catch {}
      const keys = monthly && typeof monthly === "object" ? Object.keys(monthly).sort() : [];
      const total = monthly && typeof monthly === "object"
        ? Object.values(monthly).reduce((s, v) => s + Number(v), 0) : 0;
      return {
        display_name: r.display_name,
        ltv_total: r.ltv_total,
        ltv_updated_at: r.ltv_updated_at,
        status: !r.has_field ? "NULL" : !monthly || keys.length === 0 ? "EMPTY" : "HAS DATA",
        month_count: keys.length,
        earliest_month: keys[0] ?? null,
        latest_month: keys[keys.length - 1] ?? null,
        total_net: total.toFixed(2),
      };
    });
    return c.json({ accounts });
  }

  return c.json({ error: "Unknown action" }, 400);
});

export default router;

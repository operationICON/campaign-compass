import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TimePeriod } from "./usePageFilters";

/**
 * useAccountLinkDeltas
 *
 * Per-link, per-period aggregates for ONE account (the model detail page),
 * computed from CUMULATIVE daily_snapshots + onlytraffic_orders.
 *
 * For each link we expose `cur` (current window) and `prev` (previous window
 * shifted back by the same length) with: subs, clicks, rev (snapshot deltas)
 * and spend (sum of OnlyTraffic order totals in window).
 *
 * Window resolution by TimePeriod:
 *   - "day"        → "since last sync": cur = MAX vs 2nd-MAX snapshot_date
 *                                       prev = 2nd-MAX vs 3rd-MAX
 *   - "week"       → cur = last 7 days, prev = 7-14 days ago
 *   - "month"      → cur = last 30 days, prev = 30-60 days ago
 *   - "prev_month" → cur = previous calendar month, prev = month before
 *   - custom range → cur = [from, to], prev = same length shifted back
 *   - "all"        → returns isAllTime=true; callers should use lifetime.
 *
 * Snapshot semantics (CRITICAL): values are cumulative totals.
 * Per-link delta = latestRow.value - earliestRow.value (clamped >= 0).
 * Duplicates per (link, date) deduped by MAX(subscribers).
 */

export interface PeriodAgg {
  subs: number;
  clicks: number;
  rev: number;
  spend: number;
  days: number; // distinct day span (latest_date - earliest_date)
}

export interface LinkDelta {
  cur: PeriodAgg;
  prev: PeriodAgg;
  hasCurrent: boolean; // true when at least 2 snapshots exist in cur window
}

interface SnapshotRow {
  tracking_link_id: string | null;
  snapshot_date: string | null;
  subscribers: number | null;
  clicks: number | null;
  revenue: number | null;
}

interface OrderRow {
  tracking_link_id: string | null;
  total_spent: number | null;
  order_created_at: string | null;
  status: string | null;
}

const ALLOWED_OT = new Set(["completed", "accepted", "active", "waiting"]);
const empty = (): PeriodAgg => ({ subs: 0, clicks: 0, rev: 0, spend: 0, days: 0 });

function dayDiff(a: string, b: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000
    )
  );
}

function shiftDate(d: string, daysBack: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return dt.toISOString().slice(0, 10);
}

interface Windows {
  /** "sync": last 2 snapshot dates. "range": fixed date window. */
  mode: "sync" | "range";
  curTo: string;
  curAnchor: string | null;
  prevTo: string | null;
  prevAnchor: string | null;
  /** Length of cur window in days (used for /day metrics when sync mode unknown). */
  rangeDays: number;
}

function resolveWindows(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null,
  allDates: string[]
): Windows | null {
  if (allDates.length === 0) return null;
  const maxDate = allDates[allDates.length - 1];

  if (customRange) {
    const to = customRange.to.toISOString().slice(0, 10);
    const from = customRange.from.toISOString().slice(0, 10);
    const len = Math.max(1, dayDiff(from, to));
    return {
      mode: "range",
      curTo: to,
      curAnchor: from,
      prevTo: from,
      prevAnchor: shiftDate(from, len),
      rangeDays: len,
    };
  }

  if (timePeriod === "day") {
    if (allDates.length < 2) {
      return { mode: "sync", curTo: maxDate, curAnchor: null, prevTo: null, prevAnchor: null, rangeDays: 1 };
    }
    const prevDate = allDates[allDates.length - 2];
    const prevPrev = allDates.length >= 3 ? allDates[allDates.length - 3] : null;
    return {
      mode: "sync",
      curTo: maxDate,
      curAnchor: prevDate,
      prevTo: prevDate,
      prevAnchor: prevPrev,
      rangeDays: 1,
    };
  }

  let len: number;
  let curTo = maxDate;
  let curAnchor: string;
  if (timePeriod === "week") {
    len = 7;
    curAnchor = shiftDate(maxDate, 7);
  } else if (timePeriod === "month") {
    len = 30;
    curAnchor = shiftDate(maxDate, 30);
  } else if (timePeriod === "prev_month") {
    const ref = new Date(maxDate + "T00:00:00Z");
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
    curTo = end.toISOString().slice(0, 10);
    curAnchor = start.toISOString().slice(0, 10);
    len = Math.max(1, dayDiff(curAnchor, curTo));
  } else {
    return null;
  }

  return {
    mode: "range",
    curTo,
    curAnchor,
    prevTo: curAnchor,
    prevAnchor: shiftDate(curAnchor, len),
    rangeDays: len,
  };
}

export function useAccountLinkDeltas(
  accountId: string | null,
  linkIds: string[],
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
) {
  const isAllTime = timePeriod === "all" && !customRange;

  const periodKey = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  const { data, isLoading } = useQuery({
    queryKey: ["account_link_deltas", accountId, periodKey, linkIds.length],
    enabled: !!accountId && !isAllTime,
    queryFn: async () => {
      if (!accountId) return null;

      // Fetch snapshots for this account
      const snapRows: SnapshotRow[] = [];
      let from = 0;
      const batch = 1000;
      while (true) {
        const { data: r, error } = await supabase
          .from("daily_snapshots")
          .select("tracking_link_id, snapshot_date, subscribers, clicks, revenue")
          .eq("account_id", accountId)
          .order("snapshot_date", { ascending: true })
          .range(from, from + batch - 1);
        if (error) throw error;
        if (!r?.length) break;
        snapRows.push(...r);
        if (r.length < batch) break;
        from += batch;
      }

      // Orders for spend (chunked by tracking_link_id)
      const orders: OrderRow[] = [];
      if (linkIds.length > 0) {
        const chunkSize = 200;
        for (let i = 0; i < linkIds.length; i += chunkSize) {
          const chunk = linkIds.slice(i, i + chunkSize);
          const { data: o, error } = await supabase
            .from("onlytraffic_orders")
            .select("tracking_link_id, total_spent, order_created_at, status")
            .in("tracking_link_id", chunk);
          if (error) throw error;
          orders.push(...(o || []));
        }
      }
      return { snapRows, orders };
    },
  });

  return useMemo(() => {
    if (isAllTime || !data) {
      return {
        isAllTime,
        isLoading,
        windows: null as Windows | null,
        deltas: {} as Record<string, LinkDelta>,
        accountTotals: { cur: empty(), prev: empty() },
      };
    }

    // Dedupe + group snapshots by link
    const dedup = new Map<string, SnapshotRow>();
    for (const r of data.snapRows) {
      const lid = String(r.tracking_link_id ?? "");
      const d = r.snapshot_date;
      if (!lid || !d) continue;
      const k = `${lid}|${d}`;
      const ex = dedup.get(k);
      if (!ex || Number(r.subscribers || 0) > Number(ex.subscribers || 0)) dedup.set(k, r);
    }
    const seriesByLink: Record<
      string,
      Array<{ date: string; subs: number; clicks: number; rev: number }>
    > = {};
    const allDatesSet = new Set<string>();
    for (const r of dedup.values()) {
      const lid = String(r.tracking_link_id);
      const d = r.snapshot_date as string;
      allDatesSet.add(d);
      (seriesByLink[lid] ||= []).push({
        date: d,
        subs: Math.max(0, Number(r.subscribers || 0)),
        clicks: Math.max(0, Number(r.clicks || 0)),
        rev: Math.max(0, Number(r.revenue || 0)),
      });
    }
    for (const lid of Object.keys(seriesByLink)) {
      seriesByLink[lid].sort((a, b) => a.date.localeCompare(b.date));
    }
    const allDates = Array.from(allDatesSet).sort();
    const windows = resolveWindows(timePeriod, customRange, allDates);
    if (!windows) {
      return {
        isAllTime: false,
        isLoading,
        windows: null as Windows | null,
        deltas: {} as Record<string, LinkDelta>,
        accountTotals: { cur: empty(), prev: empty() },
      };
    }

    // helper
    const latestOnOrBefore = (
      series: Array<{ date: string; subs: number; clicks: number; rev: number }>,
      bound: string
    ) => {
      let pick: typeof series[number] | null = null;
      for (const p of series) {
        if (p.date <= bound) pick = p;
        else break;
      }
      return pick;
    };

    // Build per-link deltas.
    //
    // BUG FIX: For "since last sync" (windows.mode === "sync"), we MUST anchor on
    // each link's own 2nd-most-recent snapshot (not the account's 2nd-most-recent
    // global date). Otherwise links whose previous snap is days/weeks before the
    // global anchor would inflate the delta with all the cumulative growth in
    // between — producing numbers near the lifetime cumulative total.
    //
    // For range modes (week/month/custom), `latestOnOrBefore` is correct: the
    // baseline is the cumulative value at (or before) the window start, so the
    // delta covers exactly the window length.
    const deltas: Record<string, LinkDelta> = {};
    for (const lid of Object.keys(seriesByLink)) {
      const s = seriesByLink[lid];
      const cur = empty();
      const prev = empty();
      let hasCurrent = false;

      if (windows.mode === "sync") {
        // Per-link snapshot pairs: latest = s[n-1], previous = s[n-2], prev-prev = s[n-3].
        const n = s.length;
        const curLatest = n >= 1 ? s[n - 1] : null;
        const curEarliest = n >= 2 ? s[n - 2] : null;
        if (curLatest && curEarliest && curLatest.date !== curEarliest.date) {
          cur.subs = Math.max(0, curLatest.subs - curEarliest.subs);
          cur.clicks = Math.max(0, curLatest.clicks - curEarliest.clicks);
          cur.rev = Math.max(0, curLatest.rev - curEarliest.rev);
          cur.days = Math.max(1, dayDiff(curEarliest.date, curLatest.date));
          hasCurrent = true;
        }
        const pl = curEarliest;
        const pe = n >= 3 ? s[n - 3] : null;
        if (pl && pe && pl.date !== pe.date) {
          prev.subs = Math.max(0, pl.subs - pe.subs);
          prev.clicks = Math.max(0, pl.clicks - pe.clicks);
          prev.rev = Math.max(0, pl.rev - pe.rev);
          prev.days = Math.max(1, dayDiff(pe.date, pl.date));
        }
      } else {
        const curLatest = latestOnOrBefore(s, windows.curTo);
        const curEarliest = windows.curAnchor ? latestOnOrBefore(s, windows.curAnchor) : null;
        if (curLatest && curEarliest && curLatest.date !== curEarliest.date) {
          cur.subs = Math.max(0, curLatest.subs - curEarliest.subs);
          cur.clicks = Math.max(0, curLatest.clicks - curEarliest.clicks);
          cur.rev = Math.max(0, curLatest.rev - curEarliest.rev);
          cur.days = Math.max(1, dayDiff(curEarliest.date, curLatest.date));
          hasCurrent = true;
        }
        if (windows.prevTo) {
          const pl = latestOnOrBefore(s, windows.prevTo);
          const pe = windows.prevAnchor ? latestOnOrBefore(s, windows.prevAnchor) : null;
          if (pl && pe && pl.date !== pe.date) {
            prev.subs = Math.max(0, pl.subs - pe.subs);
            prev.clicks = Math.max(0, pl.clicks - pe.clicks);
            prev.rev = Math.max(0, pl.rev - pe.rev);
            prev.days = Math.max(1, dayDiff(pe.date, pl.date));
          }
        }
      }
      deltas[lid] = { cur, prev, hasCurrent };
    }

    // Apply spend from orders. Window = (anchor, to] (date string compare on YYYY-MM-DD)
    for (const o of data.orders) {
      const lid = String(o.tracking_link_id ?? "");
      if (!lid || !o.order_created_at) continue;
      const status = String(o.status || "").toLowerCase();
      if (!ALLOWED_OT.has(status)) continue;
      const dt = (o.order_created_at as string).slice(0, 10);
      const amt = Number(o.total_spent || 0);
      const d = (deltas[lid] ||= { cur: empty(), prev: empty(), hasCurrent: false });
      if (windows.curAnchor) {
        if (dt > windows.curAnchor && dt <= windows.curTo) d.cur.spend += amt;
      } else if (dt === windows.curTo) {
        d.cur.spend += amt;
      }
      if (windows.prevTo && windows.prevAnchor) {
        if (dt > windows.prevAnchor && dt <= windows.prevTo) d.prev.spend += amt;
      } else if (windows.prevTo && dt === windows.prevTo) {
        d.prev.spend += amt;
      }
    }

    // Account totals
    const accountTotals = { cur: empty(), prev: empty() };
    for (const d of Object.values(deltas)) {
      accountTotals.cur.subs += d.cur.subs;
      accountTotals.cur.clicks += d.cur.clicks;
      accountTotals.cur.rev += d.cur.rev;
      accountTotals.cur.spend += d.cur.spend;
      accountTotals.prev.subs += d.prev.subs;
      accountTotals.prev.clicks += d.prev.clicks;
      accountTotals.prev.rev += d.prev.rev;
      accountTotals.prev.spend += d.prev.spend;
    }
    accountTotals.cur.days = windows.rangeDays;
    accountTotals.prev.days = windows.rangeDays;

    return { isAllTime: false, isLoading, windows, deltas, accountTotals };
  }, [data, isAllTime, isLoading, timePeriod, customRange]);
}

export function pctChange(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  if (!isFinite(cur) || !isFinite(prev)) return null;
  return ((cur - prev) / prev) * 100;
}

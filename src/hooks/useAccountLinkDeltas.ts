import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange, getOnlytrafficOrders } from "@/lib/api";
import type { TimePeriod } from "./usePageFilters";

export interface PeriodAgg {
  subs: number;
  clicks: number;
  rev: number;
  spend: number;
  days: number;
}

export interface LinkDelta {
  cur: PeriodAgg;
  prev: PeriodAgg;
  hasCurrent: boolean;
}

interface SnapshotRow {
  tracking_link_id: string | null;
  snapshot_date: string | null;
  subscribers: number | null;
  clicks: number | null;
  revenue: string | number | null;
}

interface OrderRow {
  tracking_link_id: string | null;
  total_spent: number | null;
  order_created_at: string | null;
  status: string | null;
}

interface Windows {
  mode: "sync" | "range";
  curTo: string;
  curAnchor: string | null;
  prevTo: string | null;
  prevAnchor: string | null;
  rangeDays: number;
}

const ALLOWED_OT = new Set(["completed", "accepted", "active", "waiting"]);
const empty = (): PeriodAgg => ({ subs: 0, clicks: 0, rev: 0, spend: 0, days: 0 });

function dayDiff(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000));
}

function shiftDate(d: string, daysBack: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return dt.toISOString().slice(0, 10);
}

function resolveWindows(timePeriod: TimePeriod, customRange: { from: Date; to: Date } | null, allDates: string[]): Windows | null {
  if (allDates.length === 0) return null;
  const maxDate = allDates[allDates.length - 1];

  if (customRange) {
    const to = customRange.to.toISOString().slice(0, 10);
    const from = customRange.from.toISOString().slice(0, 10);
    const len = Math.max(1, dayDiff(from, to));
    return { mode: "range", curTo: to, curAnchor: from, prevTo: from, prevAnchor: shiftDate(from, len), rangeDays: len };
  }

  if (timePeriod === "day") {
    if (allDates.length < 2) return { mode: "sync", curTo: maxDate, curAnchor: null, prevTo: null, prevAnchor: null, rangeDays: 1 };
    const prevDate = allDates[allDates.length - 2];
    const prevPrev = allDates.length >= 3 ? allDates[allDates.length - 3] : null;
    return { mode: "sync", curTo: maxDate, curAnchor: prevDate, prevTo: prevDate, prevAnchor: prevPrev, rangeDays: 1 };
  }

  let len: number; let curTo = maxDate; let curAnchor: string;
  if (timePeriod === "week") { len = 7; curAnchor = shiftDate(maxDate, 7); }
  else if (timePeriod === "month") { len = 30; curAnchor = shiftDate(maxDate, 30); }
  else if (timePeriod === "prev_month") {
    const ref = new Date(maxDate + "T00:00:00Z");
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
    curTo = end.toISOString().slice(0, 10);
    curAnchor = start.toISOString().slice(0, 10);
    len = Math.max(1, dayDiff(curAnchor, curTo));
  } else return null;

  return { mode: "range", curTo, curAnchor, prevTo: curAnchor, prevAnchor: shiftDate(curAnchor, len), rangeDays: len };
}

export function useAccountLinkDeltas(
  accountId: string | null,
  linkIds: string[],
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
) {
  const isAllTime = timePeriod === "all" && !customRange;
  const periodKey = customRange ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}` : timePeriod;

  const { data, isLoading } = useQuery({
    queryKey: ["account_link_deltas", accountId, periodKey, linkIds.length],
    enabled: !!accountId && !isAllTime,
    queryFn: async () => {
      if (!accountId) return null;

      const [snapRows, orders] = await Promise.all([
        getSnapshotsByDateRange({ account_ids: [accountId], cols: "slim" }),
        linkIds.length ? getOnlytrafficOrders({ tracking_link_ids: linkIds, active_only: true }) : Promise.resolve([]),
      ]);

      return { snapRows, orders };
    },
  });

  return useMemo(() => {
    if (isAllTime || !data) {
      return { isAllTime, isLoading, windows: null as Windows | null, deltas: {} as Record<string, LinkDelta>, accountTotals: { cur: empty(), prev: empty() } };
    }

    const dedup = new Map<string, SnapshotRow>();
    for (const r of data.snapRows as SnapshotRow[]) {
      const lid = String(r.tracking_link_id ?? "");
      const d = r.snapshot_date;
      if (!lid || !d) continue;
      const k = `${lid}|${d}`;
      const ex = dedup.get(k);
      if (!ex || Number(r.subscribers || 0) > Number(ex.subscribers || 0)) dedup.set(k, r);
    }

    const seriesByLink: Record<string, Array<{ date: string; subs: number; clicks: number; rev: number }>> = {};
    const allDatesSet = new Set<string>();
    for (const r of dedup.values()) {
      const lid = String(r.tracking_link_id);
      const d = r.snapshot_date as string;
      allDatesSet.add(d);
      (seriesByLink[lid] ||= []).push({ date: d, subs: Math.max(0, Number(r.subscribers || 0)), clicks: Math.max(0, Number(r.clicks || 0)), rev: Math.max(0, Number(r.revenue || 0)) });
    }
    for (const lid of Object.keys(seriesByLink)) seriesByLink[lid].sort((a, b) => a.date.localeCompare(b.date));
    const allDates = Array.from(allDatesSet).sort();
    const windows = resolveWindows(timePeriod, customRange, allDates);
    if (!windows) return { isAllTime: false, isLoading, windows: null as Windows | null, deltas: {} as Record<string, LinkDelta>, accountTotals: { cur: empty(), prev: empty() } };

    const latestOnOrBefore = (series: Array<{ date: string; subs: number; clicks: number; rev: number }>, bound: string) => {
      let pick: typeof series[number] | null = null;
      for (const p of series) { if (p.date <= bound) pick = p; else break; }
      return pick;
    };

    const deltas: Record<string, LinkDelta> = {};
    for (const lid of Object.keys(seriesByLink)) {
      const s = seriesByLink[lid];
      const cur = empty(); const prev = empty(); let hasCurrent = false;
      if (windows.mode === "sync") {
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
        const pl = curEarliest; const pe = n >= 3 ? s[n - 3] : null;
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
        } else if (curLatest && windows.curAnchor && !curEarliest) {
          // No snapshot at/before range start (custom range extends before coverage) —
          // sum daily rows within the window instead of boundary-matching.
          const anchor = windows.curAnchor;
          const inRange = s.filter(r => r.date >= anchor && r.date <= windows.curTo);
          if (inRange.length > 0) {
            cur.subs = inRange.reduce((sum, r) => sum + r.subs, 0);
            cur.clicks = inRange.reduce((sum, r) => sum + r.clicks, 0);
            cur.rev = inRange.reduce((sum, r) => sum + r.rev, 0);
            cur.days = windows.rangeDays;
            hasCurrent = true;
          }
        }
        if (windows.prevTo) {
          const pl2 = latestOnOrBefore(s, windows.prevTo);
          const pe2 = windows.prevAnchor ? latestOnOrBefore(s, windows.prevAnchor) : null;
          if (pl2 && pe2 && pl2.date !== pe2.date) {
            prev.subs = Math.max(0, pl2.subs - pe2.subs);
            prev.clicks = Math.max(0, pl2.clicks - pe2.clicks);
            prev.rev = Math.max(0, pl2.rev - pe2.rev);
            prev.days = Math.max(1, dayDiff(pe2.date, pl2.date));
          } else if (pl2 && windows.prevAnchor && !pe2) {
            const pAnchor = windows.prevAnchor;
            const inPrev = s.filter(r => r.date >= pAnchor && r.date <= windows.prevTo!);
            if (inPrev.length > 0) {
              prev.subs = inPrev.reduce((sum, r) => sum + r.subs, 0);
              prev.clicks = inPrev.reduce((sum, r) => sum + r.clicks, 0);
              prev.rev = inPrev.reduce((sum, r) => sum + r.rev, 0);
              prev.days = windows.rangeDays;
            }
          }
        }
      }
      deltas[lid] = { cur, prev, hasCurrent };
    }

    for (const o of data.orders as OrderRow[]) {
      const lid = String(o.tracking_link_id ?? "");
      if (!lid || !o.order_created_at) continue;
      if (!ALLOWED_OT.has(String(o.status || "").toLowerCase())) continue;
      const dt = (o.order_created_at as string).slice(0, 10);
      const amt = Number(o.total_spent || 0);
      const d = (deltas[lid] ||= { cur: empty(), prev: empty(), hasCurrent: false });
      if (windows.curAnchor) { if (dt > windows.curAnchor && dt <= windows.curTo) d.cur.spend += amt; }
      else if (dt === windows.curTo) { d.cur.spend += amt; }
      if (windows.prevTo && windows.prevAnchor) { if (dt > windows.prevAnchor && dt <= windows.prevTo) d.prev.spend += amt; }
      else if (windows.prevTo && dt === windows.prevTo) { d.prev.spend += amt; }
    }

    const accountTotals = { cur: empty(), prev: empty() };
    let maxCurDays = 0; let maxPrevDays = 0;
    for (const d of Object.values(deltas)) {
      accountTotals.cur.subs += d.cur.subs; accountTotals.cur.clicks += d.cur.clicks;
      accountTotals.cur.rev += d.cur.rev; accountTotals.cur.spend += d.cur.spend;
      accountTotals.prev.subs += d.prev.subs; accountTotals.prev.clicks += d.prev.clicks;
      accountTotals.prev.rev += d.prev.rev; accountTotals.prev.spend += d.prev.spend;
      if (d.cur.days > maxCurDays) maxCurDays = d.cur.days;
      if (d.prev.days > maxPrevDays) maxPrevDays = d.prev.days;
    }
    if (windows.mode === "sync") { accountTotals.cur.days = Math.max(1, maxCurDays); accountTotals.prev.days = Math.max(1, maxPrevDays); }
    else { accountTotals.cur.days = windows.rangeDays; accountTotals.prev.days = windows.rangeDays; }

    return { isAllTime: false, isLoading, windows, deltas, accountTotals };
  }, [data, isAllTime, isLoading, timePeriod, customRange]);
}

export function pctChange(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  if (!isFinite(cur) || !isFinite(prev)) return null;
  return ((cur - prev) / prev) * 100;
}

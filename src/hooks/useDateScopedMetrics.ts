import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TimePeriod } from "./usePageFilters";

/**
 * useDateScopedMetrics — Shared date-scoped aggregator.
 *
 * For "All Time" (no date filter): returns null aggregates so callers fall back
 * to lifetime totals from tracking_links + accounts.
 *
 * For any other period: aggregates from date-scoped sources:
 *   - subs / clicks / revenue → SUM(daily_snapshots.*) within range
 *   - spend → SUM(daily_snapshots.cost_total) + SUM(onlytraffic_orders.total_spent)
 *             within range, status IN ('completed','accepted','active','waiting')
 *
 * Derived metrics (profit, ROI, CPL, CVR, LTV/Sub, Subs/Day) are computed.
 *
 * Also exposes dataAvailable + earliestSnapshotDate for a UI note.
 */

export interface DateScopedTotals {
  isAllTime: boolean;
  /** True when at least one snapshot row exists in the selected window. */
  dataAvailable: boolean;
  /** YYYY-MM-DD of the earliest snapshot in the database (across all accounts). */
  earliestSnapshotDate: string | null;
  /** YYYY-MM-DD bounds of the resolved date window (null when All Time). */
  fromDate: string | null;
  toDate: string | null;
  /** Number of distinct days in the window (1-based). */
  dayCount: number;
  /** Aggregates — null when All Time (callers use lifetime sources instead). */
  subs: number | null;
  clicks: number | null;
  revenue: number | null;
  spend: number | null;
  profit: number | null;
  roi: number | null;
  cpl: number | null;
  cvr: number | null;
  ltvPerSub: number | null;
  subsPerDay: number | null;
  isLoading: boolean;
}

const ALLOWED_OT_STATUSES = ["completed", "accepted", "active", "waiting"];

function resolveDateRange(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null,
  serverMaxDate: string
): { from: string; to: string; dayCount: number } | null {
  if (customRange) {
    const from = customRange.from.toISOString().slice(0, 10);
    const to = customRange.to.toISOString().slice(0, 10);
    const days = Math.max(
      1,
      Math.round(
        (new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) /
          (24 * 60 * 60 * 1000)
      ) + 1
    );
    return { from, to, dayCount: days };
  }

  switch (timePeriod) {
    case "day":
      return { from: serverMaxDate, to: serverMaxDate, dayCount: 1 };
    case "week": {
      const d = new Date(serverMaxDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
      return { from: d.toISOString().slice(0, 10), to: serverMaxDate, dayCount: 7 };
    }
    case "month": {
      const dStart = new Date(serverMaxDate + "T00:00:00Z");
      dStart.setUTCDate(dStart.getUTCDate() - 30);
      const dEnd = new Date(serverMaxDate + "T00:00:00Z");
      dEnd.setUTCDate(dEnd.getUTCDate() - 1);
      return {
        from: dStart.toISOString().slice(0, 10),
        to: dEnd.toISOString().slice(0, 10),
        dayCount: 30,
      };
    }
    case "prev_month": {
      const ref = new Date(serverMaxDate + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      const days = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
      );
      return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        dayCount: days,
      };
    }
    case "all":
    default:
      return null;
  }
}

export function useDateScopedMetrics(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null,
  accountIds: string[] | null
): DateScopedTotals {
  const isAllTime = timePeriod === "all" && !customRange;

  // Earliest snapshot date in DB (for UI label) — cached for the session.
  const { data: earliestSnapshotDate = null } = useQuery({
    queryKey: ["daily_snapshots", "earliest_date"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: true })
        .limit(1);
      if (error) throw error;
      return (data?.[0]?.snapshot_date as string | null) ?? null;
    },
  });

  const accountKey = accountIds?.length ? accountIds.slice().sort().join(",") : "all";
  const periodKey = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  // Date-scoped aggregates
  const { data, isLoading } = useQuery({
    queryKey: ["date_scoped_metrics", periodKey, accountKey],
    enabled: !isAllTime,
    queryFn: async (): Promise<{
      fromDate: string;
      toDate: string;
      dayCount: number;
      snapshotRows: Array<{ subscribers: number | null; clicks: number | null; revenue: number | null; cost_total: number | null }>;
      otSpend: number;
    }> => {
      // Resolve server max snapshot date (per-account-scope if filtered)
      let serverMaxQuery = supabase
        .from("daily_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1);
      if (accountIds?.length) serverMaxQuery = serverMaxQuery.in("account_id", accountIds);
      const { data: latest, error: latestErr } = await serverMaxQuery;
      if (latestErr) throw latestErr;
      const serverMaxDate = latest?.[0]?.snapshot_date ?? new Date().toISOString().slice(0, 10);

      const range = resolveDateRange(timePeriod, customRange, serverMaxDate);
      if (!range) {
        return { fromDate: serverMaxDate, toDate: serverMaxDate, dayCount: 1, snapshotRows: [], otSpend: 0 };
      }

      // Snapshot aggregates (subs / clicks / revenue / cost_total)
      const snapshotRows: Array<{
        subscribers: number | null;
        clicks: number | null;
        revenue: number | null;
        cost_total: number | null;
      }> = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        let q = supabase
          .from("daily_snapshots")
          .select("subscribers, clicks, revenue, cost_total")
          .gte("snapshot_date", range.from)
          .lte("snapshot_date", range.to)
          .range(rangeFrom, rangeFrom + batchSize - 1);
        if (accountIds?.length) q = q.in("account_id", accountIds);
        const { data: rows, error } = await q;
        if (error) throw error;
        if (!rows?.length) break;
        snapshotRows.push(...rows);
        if (rows.length < batchSize) break;
        rangeFrom += batchSize;
      }

      // OT orders spend within the same window (filter by order_created_at)
      let otSpend = 0;
      let otFrom = 0;
      while (true) {
        let q = supabase
          .from("onlytraffic_orders")
          .select("total_spent, tracking_link_id")
          .gte("order_created_at", range.from + "T00:00:00Z")
          .lte("order_created_at", range.to + "T23:59:59Z")
          .in("status", ALLOWED_OT_STATUSES)
          .range(otFrom, otFrom + batchSize - 1);
        const { data: orders, error } = await q;
        if (error) throw error;
        if (!orders?.length) break;

        // If account-scoped, filter orders to ones whose tracking_link belongs
        // to one of the requested accounts. Tracking_links lookup is too heavy
        // here — skip account-level OT filtering and rely on snapshot.cost_total
        // (which IS account-scoped) for accurate per-model spend.
        for (const o of orders) otSpend += Number(o.total_spent || 0);
        if (orders.length < batchSize) break;
        otFrom += batchSize;
      }

      return {
        fromDate: range.from,
        toDate: range.to,
        dayCount: range.dayCount,
        snapshotRows,
        otSpend: accountIds?.length ? 0 : otSpend, // skip OT when account-scoped (avoids inflation)
      };
    },
  });

  return useMemo<DateScopedTotals>(() => {
    if (isAllTime) {
      return {
        isAllTime: true,
        dataAvailable: true,
        earliestSnapshotDate,
        fromDate: null,
        toDate: null,
        dayCount: 0,
        subs: null,
        clicks: null,
        revenue: null,
        spend: null,
        profit: null,
        roi: null,
        cpl: null,
        cvr: null,
        ltvPerSub: null,
        subsPerDay: null,
        isLoading: false,
      };
    }

    if (!data) {
      return {
        isAllTime: false,
        dataAvailable: false,
        earliestSnapshotDate,
        fromDate: null,
        toDate: null,
        dayCount: 0,
        subs: null,
        clicks: null,
        revenue: null,
        spend: null,
        profit: null,
        roi: null,
        cpl: null,
        cvr: null,
        ltvPerSub: null,
        subsPerDay: null,
        isLoading,
      };
    }

    const subs = data.snapshotRows.reduce((s, r) => s + Number(r.subscribers || 0), 0);
    const clicks = data.snapshotRows.reduce((s, r) => s + Number(r.clicks || 0), 0);
    const revenue = data.snapshotRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const snapshotSpend = data.snapshotRows.reduce((s, r) => s + Number(r.cost_total || 0), 0);
    const spend = snapshotSpend + Number(data.otSpend || 0);
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    const cpl = subs > 0 ? spend / subs : null;
    const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
    const ltvPerSub = subs > 0 ? revenue / subs : null;
    const subsPerDay = data.dayCount > 0 ? subs / data.dayCount : null;
    const dataAvailable = data.snapshotRows.length > 0;

    return {
      isAllTime: false,
      dataAvailable,
      earliestSnapshotDate,
      fromDate: data.fromDate,
      toDate: data.toDate,
      dayCount: data.dayCount,
      subs: dataAvailable ? subs : null,
      clicks: dataAvailable ? clicks : null,
      revenue: dataAvailable ? revenue : null,
      // Spend should still show even when no snapshot rows exist, if OT orders exist.
      spend: dataAvailable || data.otSpend > 0 ? spend : null,
      profit: dataAvailable ? profit : null,
      roi,
      cpl,
      cvr,
      ltvPerSub,
      subsPerDay,
      isLoading,
    };
  }, [isAllTime, data, isLoading, earliestSnapshotDate]);
}

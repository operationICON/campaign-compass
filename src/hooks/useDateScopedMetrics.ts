import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotLatestDate, getSnapshotEarliestDate, getSnapshotsByDateRange, getOnlytrafficOrders } from "@/lib/api";
import type { TimePeriod } from "./usePageFilters";

export interface DateScopedTotals {
  isAllTime: boolean;
  dataAvailable: boolean;
  earliestSnapshotDate: string | null;
  fromDate: string | null;
  toDate: string | null;
  dayCount: number;
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

function resolveDateRange(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null,
  serverMaxDate: string
): { from: string; to: string; dayCount: number } | null {
  if (customRange) {
    const from = customRange.from.toISOString().slice(0, 10);
    const to = customRange.to.toISOString().slice(0, 10);
    const days = Math.max(1, Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86400000) + 1);
    return { from, to, dayCount: days };
  }
  switch (timePeriod) {
    case "day": return { from: serverMaxDate, to: serverMaxDate, dayCount: 1 };
    case "week": {
      const d = new Date(serverMaxDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
      return { from: d.toISOString().slice(0, 10), to: serverMaxDate, dayCount: 7 };
    }
    case "month": {
      const dS = new Date(serverMaxDate + "T00:00:00Z"); dS.setUTCDate(dS.getUTCDate() - 30);
      const dE = new Date(serverMaxDate + "T00:00:00Z"); dE.setUTCDate(dE.getUTCDate() - 1);
      return { from: dS.toISOString().slice(0, 10), to: dE.toISOString().slice(0, 10), dayCount: 30 };
    }
    case "prev_month": {
      const ref = new Date(serverMaxDate + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), dayCount: days };
    }
    case "all": default: return null;
  }
}

export function useDateScopedMetrics(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null,
  accountIds: string[] | null
): DateScopedTotals {
  const isAllTime = timePeriod === "all" && !customRange;

  const { data: earliestSnapshotDate = null } = useQuery({
    queryKey: ["daily_snapshots", "earliest_date"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => { const r = await getSnapshotEarliestDate(); return r.date; },
  });

  const accountKey = accountIds?.length ? accountIds.slice().sort().join(",") : "all";
  const periodKey = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  const { data, isLoading } = useQuery({
    queryKey: ["date_scoped_metrics", periodKey, accountKey],
    enabled: !isAllTime,
    queryFn: async () => {
      const { date: serverMax } = await getSnapshotLatestDate(accountIds?.length === 1 ? accountIds[0] : undefined);
      const maxDate = serverMax ?? new Date().toISOString().slice(0, 10);
      const range = resolveDateRange(timePeriod, customRange, maxDate);
      if (!range) return { fromDate: maxDate, toDate: maxDate, dayCount: 1, snapshotRows: [], otSpend: 0 };

      const [snapshotRows, otOrders] = await Promise.all([
        getSnapshotsByDateRange({
          date_from: range.from,
          date_to: range.to,
          account_ids: accountIds?.length ? accountIds : undefined,
          cols: "slim",
        }),
        accountIds?.length ? Promise.resolve([]) : getOnlytrafficOrders({
          date_from: range.from,
          date_to: range.to,
          active_only: true,
        }),
      ]);

      const otSpend = (otOrders as any[]).reduce((s: number, o: any) => s + Number(o.total_spent || 0), 0);
      return { fromDate: range.from, toDate: range.to, dayCount: range.dayCount, snapshotRows, otSpend };
    },
  });

  return useMemo<DateScopedTotals>(() => {
    if (isAllTime) {
      return { isAllTime: true, dataAvailable: true, earliestSnapshotDate, fromDate: null, toDate: null, dayCount: 0, subs: null, clicks: null, revenue: null, spend: null, profit: null, roi: null, cpl: null, cvr: null, ltvPerSub: null, subsPerDay: null, isLoading: false };
    }
    if (!data) {
      return { isAllTime: false, dataAvailable: false, earliestSnapshotDate, fromDate: null, toDate: null, dayCount: 0, subs: null, clicks: null, revenue: null, spend: null, profit: null, roi: null, cpl: null, cvr: null, ltvPerSub: null, subsPerDay: null, isLoading };
    }
    const rows = data.snapshotRows as any[];
    const subs = rows.reduce((s, r) => s + Number(r.subscribers || 0), 0);
    const clicks = rows.reduce((s, r) => s + Number(r.clicks || 0), 0);
    const revenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const snapshotSpend = rows.reduce((s, r) => s + Number(r.cost_total || 0), 0);
    const spend = snapshotSpend + Number(data.otSpend || 0);
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    const cpl = subs > 0 ? spend / subs : null;
    const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
    const ltvPerSub = subs > 0 ? revenue / subs : null;
    const subsPerDay = data.dayCount > 0 ? subs / data.dayCount : null;
    const dataAvailable = rows.length > 0;
    return {
      isAllTime: false, dataAvailable, earliestSnapshotDate,
      fromDate: data.fromDate, toDate: data.toDate, dayCount: data.dayCount,
      subs: dataAvailable ? subs : null, clicks: dataAvailable ? clicks : null,
      revenue: dataAvailable ? revenue : null,
      spend: dataAvailable || data.otSpend > 0 ? spend : null,
      profit: dataAvailable ? profit : null, roi, cpl, cvr, ltvPerSub, subsPerDay, isLoading,
    };
  }, [isAllTime, data, isLoading, earliestSnapshotDate]);
}

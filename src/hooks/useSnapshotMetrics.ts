import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotLatestDate, getSnapshotDistinctDates, getSnapshotsByDateRange } from "@/lib/api";
import type { TimePeriod } from "./usePageFilters";

export interface SnapshotMetrics {
  clicks: number;
  subscribers: number;
  revenue: number;
  days: number;
}

interface SnapshotRow {
  tracking_link_id: string | null;
  snapshot_date: string | null;
  clicks: number | null;
  subscribers: number | null;
  revenue: string | number | null;
}

function toMetricValue(value: number | string | null | undefined) {
  return Number(value || 0);
}

export function buildSnapshotLookup(snapshotRows: SnapshotRow[]): Record<string, SnapshotMetrics> {
  const lookup: Record<string, SnapshotMetrics> = {};
  const datesPerLink: Record<string, Set<string>> = {};

  for (const row of snapshotRows) {
    const id = String(row.tracking_link_id ?? "").toLowerCase();
    if (!id) continue;

    if (!lookup[id]) {
      lookup[id] = { clicks: 0, subscribers: 0, revenue: 0, days: 0 };
      datesPerLink[id] = new Set();
    }

    lookup[id].clicks += toMetricValue(row.clicks);
    lookup[id].subscribers += toMetricValue(row.subscribers);
    lookup[id].revenue += toMetricValue(row.revenue);
    if (row.snapshot_date) datesPerLink[id].add(row.snapshot_date);
  }

  for (const id of Object.keys(lookup)) {
    lookup[id].days = datesPerLink[id]?.size || 0;
  }

  return lookup;
}

export function useSnapshotMetrics(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
) {
  const isAllTime = timePeriod === "all" && !customRange;

  const periodKey = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  const { data: snapshotRows = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots", periodKey],
    queryFn: async () => {
      if (isAllTime) return [];

      let fromDate: string;
      let toDate: string;

      if (customRange) {
        fromDate = customRange.from.toISOString().slice(0, 10);
        toDate = customRange.to.toISOString().slice(0, 10);
      } else {
        const { date: serverMaxDate } = await getSnapshotLatestDate();
        const maxDate = serverMaxDate ?? new Date().toISOString().slice(0, 10);

        switch (timePeriod) {
          case "day": {
            const distinctDates = await getSnapshotDistinctDates(2);
            toDate = distinctDates[0] ?? maxDate;
            fromDate = distinctDates[1] ?? toDate;
            break;
          }
          case "week": {
            const d = new Date(maxDate + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() - 7);
            fromDate = d.toISOString().slice(0, 10);
            toDate = maxDate;
            break;
          }
          case "month": {
            const d = new Date(maxDate + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() - 30);
            fromDate = d.toISOString().slice(0, 10);
            const dEnd = new Date(maxDate + "T00:00:00Z");
            dEnd.setUTCDate(dEnd.getUTCDate() - 1);
            toDate = dEnd.toISOString().slice(0, 10);
            break;
          }
          case "prev_month": {
            const ref = new Date(maxDate + "T00:00:00Z");
            const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
            const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
            fromDate = start.toISOString().slice(0, 10);
            toDate = end.toISOString().slice(0, 10);
            break;
          }
          default:
            return [];
        }
      }

      return getSnapshotsByDateRange({ date_from: fromDate, date_to: toDate, cols: "slim" });
    },
    enabled: !isAllTime,
  });

  const snapshotLookup = useMemo<Record<string, SnapshotMetrics> | null>(() => {
    if (isAllTime) return null;
    return buildSnapshotLookup(snapshotRows as SnapshotRow[]);
  }, [snapshotRows, isAllTime]);

  return { snapshotLookup, isAllTime, isLoading };
}

export function getSnapshotMetrics(
  link: any,
  snapshotLookup: Record<string, SnapshotMetrics> | null
): SnapshotMetrics {
  if (!snapshotLookup) {
    return {
      clicks: Number(link.clicks || 0),
      subscribers: Number(link.subscribers || 0),
      revenue: Number(link.revenue || 0),
      days: 0,
    };
  }
  const id = String(link.id ?? "").toLowerCase();
  return snapshotLookup[id] || { clicks: 0, subscribers: 0, revenue: 0, days: 0 };
}

export function applySnapshotToLinks(
  links: any[],
  snapshotLookup: Record<string, SnapshotMetrics> | null
): any[] {
  if (!snapshotLookup) return links;
  return links.map(l => {
    const m = getSnapshotMetrics(l, snapshotLookup);
    return { ...l, clicks: m.clicks, subscribers: m.subscribers, revenue: m.revenue, snapshotDays: m.days };
  });
}

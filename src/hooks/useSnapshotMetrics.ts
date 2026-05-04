import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotLatestDate, getSnapshotDistinctDates, getSnapshotsByDateRange } from "@/lib/api";
import type { TimePeriod } from "./usePageFilters";

export interface SnapshotMetrics {
  clicks: number;
  subscribers: number;
  revenue: number;
  days: number;
  hasData: boolean; // false if fewer than 2 snapshots in period → show "—" in cells
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
  // Group rows by tracking_link_id
  const byLink: Record<string, SnapshotRow[]> = {};
  for (const row of snapshotRows) {
    const id = String(row.tracking_link_id ?? "").toLowerCase();
    if (!id) continue;
    if (!byLink[id]) byLink[id] = [];
    byLink[id].push(row);
  }

  // Delta approach: latest snapshot value - earliest snapshot value within period.
  // daily_snapshots stores cumulative totals; delta gives the gain over the window.
  const lookup: Record<string, SnapshotMetrics> = {};
  for (const [id, rows] of Object.entries(byLink)) {
    const distinctDates = new Set(rows.map(r => r.snapshot_date).filter(Boolean));
    if (rows.length < 2) {
      // Can't compute a meaningful delta — show "—" in period cells
      lookup[id] = { clicks: 0, subscribers: 0, revenue: 0, days: distinctDates.size, hasData: false };
      continue;
    }
    const sorted = [...rows].sort((a, b) =>
      (a.snapshot_date ?? "").localeCompare(b.snapshot_date ?? "")
    );
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];
    lookup[id] = {
      clicks: Math.max(0, toMetricValue(latest.clicks) - toMetricValue(earliest.clicks)),
      subscribers: Math.max(0, toMetricValue(latest.subscribers) - toMetricValue(earliest.subscribers)),
      revenue: Math.max(0, toMetricValue(latest.revenue) - toMetricValue(earliest.revenue)),
      days: distinctDates.size,
      hasData: true,
    };
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
      hasData: true,
    };
  }
  const id = String(link.id ?? "").toLowerCase();
  return snapshotLookup[id] || { clicks: 0, subscribers: 0, revenue: 0, days: 0, hasData: false };
}

export function applySnapshotToLinks(
  links: any[],
  snapshotLookup: Record<string, SnapshotMetrics> | null
): any[] {
  if (!snapshotLookup) return links;
  return links.map(l => {
    const m = getSnapshotMetrics(l, snapshotLookup);
    return { ...l, _subscribers: l.subscribers, _clicks: l.clicks, clicks: m.clicks, subscribers: m.subscribers, revenue: m.revenue, snapshotDays: m.days, snapshotHasData: m.hasData };
  });
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TimePeriod } from "./usePageFilters";

export interface SnapshotMetrics {
  clicks: number;
  subscribers: number;
  revenue: number;
  days: number; // COUNT(DISTINCT snapshot_date) for this link
}

interface SnapshotRow {
  tracking_link_id: string | null;
  snapshot_date: string | null;
  clicks: number | null;
  subscribers: number | null;
  revenue: number | null;
}

function toMetricValue(value: number | null | undefined) {
  return Number(value || 0);
}

/**
 * Builds a lookup map by SUMming incremental daily_snapshot values
 * across the selected date range. Snapshots now store daily deltas,
 * so we simply accumulate them.
 */
export function buildSnapshotLookup(snapshotRows: SnapshotRow[]): Record<string, SnapshotMetrics> {
  const lookup: Record<string, SnapshotMetrics> = {};
  const datesPerLink: Record<string, Set<string>> = {};

  for (const row of snapshotRows) {
    const id = String(row.tracking_link_id ?? "").toLowerCase();
    if (!id) continue;

    const clicks = toMetricValue(row.clicks);
    const subscribers = toMetricValue(row.subscribers);
    const revenue = toMetricValue(row.revenue);

    if (!lookup[id]) {
      lookup[id] = { clicks: 0, subscribers: 0, revenue: 0, days: 0 };
      datesPerLink[id] = new Set();
    }

    lookup[id].clicks += clicks;
    lookup[id].subscribers += subscribers;
    lookup[id].revenue += revenue;
    if (row.snapshot_date) datesPerLink[id].add(row.snapshot_date);
  }

  // Set days count from distinct dates
  for (const id of Object.keys(lookup)) {
    lookup[id].days = datesPerLink[id]?.size || 0;
  }

  return lookup;
}

/**
 * Helper: fetch the server's CURRENT_DATE via a lightweight RPC-style query.
 * Returns YYYY-MM-DD string.
 */
async function fetchServerDate(): Promise<string> {
  const { data, error } = await supabase
    .from("daily_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) {
    return new Date().toISOString().slice(0, 10);
  }
  return data[0].snapshot_date;
}

/**
 * Fetches daily_snapshots for the selected time period and returns
 * a lookup map of tracking_link_id → per-period {clicks, subscribers, revenue, days}
 */
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
        const serverMaxDate = await fetchServerDate();

        switch (timePeriod) {
          case "day":
            fromDate = serverMaxDate;
            toDate = serverMaxDate;
            break;
          case "week": {
            const d = new Date(serverMaxDate + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() - 7);
            fromDate = d.toISOString().slice(0, 10);
            toDate = serverMaxDate;
            break;
          }
          case "month": {
            const d = new Date(serverMaxDate + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() - 30);
            fromDate = d.toISOString().slice(0, 10);
            toDate = serverMaxDate;
            break;
          }
          case "prev_month": {
            const dFrom = new Date(serverMaxDate + "T00:00:00Z");
            dFrom.setUTCDate(dFrom.getUTCDate() - 60);
            const dTo = new Date(serverMaxDate + "T00:00:00Z");
            dTo.setUTCDate(dTo.getUTCDate() - 31);
            fromDate = dFrom.toISOString().slice(0, 10);
            toDate = dTo.toISOString().slice(0, 10);
            break;
          }
          default:
            return [];
        }
      }

      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("daily_snapshots")
          .select("tracking_link_id, snapshot_date, clicks, subscribers, revenue")
          .gte("snapshot_date", fromDate)
          .lte("snapshot_date", toDate)
          .range(rangeFrom, rangeFrom + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        rangeFrom += batchSize;
      }
      return allRows;
    },
    enabled: !isAllTime,
  });

  const snapshotLookup = useMemo<Record<string, SnapshotMetrics> | null>(() => {
    if (isAllTime) return null;
    return buildSnapshotLookup(snapshotRows);
  }, [snapshotRows, isAllTime]);

  return { snapshotLookup, isAllTime, isLoading };
}

/**
 * Helper: get metrics for a link, using snapshot data if available,
 * otherwise falling back to the tracking_links row totals.
 */
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

/**
 * Returns a new array of links with clicks/subscribers/revenue
 * replaced by snapshot-period delta values. For "All Time" returns links unchanged.
 */
export function applySnapshotToLinks(
  links: any[],
  snapshotLookup: Record<string, SnapshotMetrics> | null
): any[] {
  if (!snapshotLookup) return links; // All Time — use originals
  return links.map(l => {
    const m = getSnapshotMetrics(l, snapshotLookup);
    return { ...l, clicks: m.clicks, subscribers: m.subscribers, revenue: m.revenue, snapshotDays: m.days };
  });
}

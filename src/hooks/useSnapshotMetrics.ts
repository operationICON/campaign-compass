import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subDays, startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import type { TimePeriod } from "./usePageFilters";

export interface SnapshotMetrics {
  clicks: number;
  subscribers: number;
  revenue: number;
}

interface SnapshotRow {
  tracking_link_id: string | null;
  clicks: number | null;
  subscribers: number | null;
  revenue: number | null;
}

function toMetricValue(value: number | null | undefined) {
  return Number(value || 0);
}

export function buildSnapshotLookup(snapshotRows: SnapshotRow[]): Record<string, SnapshotMetrics> {
  const accumulators: Record<
    string,
    {
      minClicks: number;
      maxClicks: number;
      minSubscribers: number;
      maxSubscribers: number;
      minRevenue: number;
      maxRevenue: number;
    }
  > = {};

  for (const row of snapshotRows) {
    const id = String(row.tracking_link_id ?? "").toLowerCase();
    if (!id) continue;

    const clicks = toMetricValue(row.clicks);
    const subscribers = toMetricValue(row.subscribers);
    const revenue = toMetricValue(row.revenue);

    if (!accumulators[id]) {
      accumulators[id] = {
        minClicks: clicks,
        maxClicks: clicks,
        minSubscribers: subscribers,
        maxSubscribers: subscribers,
        minRevenue: revenue,
        maxRevenue: revenue,
      };
      continue;
    }

    const current = accumulators[id];
    current.minClicks = Math.min(current.minClicks, clicks);
    current.maxClicks = Math.max(current.maxClicks, clicks);
    current.minSubscribers = Math.min(current.minSubscribers, subscribers);
    current.maxSubscribers = Math.max(current.maxSubscribers, subscribers);
    current.minRevenue = Math.min(current.minRevenue, revenue);
    current.maxRevenue = Math.max(current.maxRevenue, revenue);
  }

  const lookup: Record<string, SnapshotMetrics> = {};

  for (const [id, current] of Object.entries(accumulators)) {
    lookup[id] = {
      clicks: Math.max(0, current.maxClicks - current.minClicks),
      subscribers: Math.max(0, current.maxSubscribers - current.minSubscribers),
      revenue: Math.max(0, current.maxRevenue - current.minRevenue),
    };
  }

  return lookup;
}

/**
 * Fetches daily_snapshots for the selected time period and returns
 * a lookup map of tracking_link_id → per-period {clicks, subscribers, revenue}
 * derived from cumulative snapshots using MAX - MIN within the selected range.
 *
 * For "All Time" returns null lookup (callers should use tracking_links totals).
 */
export function useSnapshotMetrics(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
) {
  const isAllTime = timePeriod === "all" && !customRange;

  // Compute the snapshot_date range as YYYY-MM-DD strings
  const dateRange = useMemo(() => {
    if (customRange) {
      return {
        from: format(customRange.from, "yyyy-MM-dd"),
        to: format(customRange.to, "yyyy-MM-dd"),
      };
    }
    const now = new Date();
    const today = format(now, "yyyy-MM-dd");
    switch (timePeriod) {
      case "day": {
        // Use server's most recent snapshot date (avoids client/server timezone mismatch)
        return { from: "__latest__", to: "__latest__" };
      }
      case "week":
        return { from: format(subDays(now, 7), "yyyy-MM-dd"), to: today };
      case "month":
        return { from: format(subDays(now, 30), "yyyy-MM-dd"), to: today };
      case "prev_month": {
        const pm = subMonths(now, 1);
        return {
          from: format(startOfMonth(pm), "yyyy-MM-dd"),
          to: format(endOfMonth(pm), "yyyy-MM-dd"),
        };
      }
      case "since_sync":
        // Will be resolved in the query
        return { from: "__latest__", to: "__latest__" };
      case "all":
      default:
        return null;
    }
  }, [timePeriod, customRange]);

  const { data: snapshotRows = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots", timePeriod, dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!dateRange) return []; // All Time — skip

      let fromDate = dateRange.from;
      let toDate = dateRange.to;

      // Resolve "since_sync" to the most recent snapshot_date
      if (fromDate === "__latest__") {
        const { data: latest } = await supabase
          .from("daily_snapshots")
          .select("snapshot_date")
          .order("snapshot_date", { ascending: false })
          .limit(1);
        if (!latest || latest.length === 0) return [];
        const latestDate = latest[0].snapshot_date;
        fromDate = latestDate;
        toDate = latestDate;
      }

      // Fetch all matching rows (batched)
      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("daily_snapshots")
          .select("tracking_link_id, clicks, subscribers, revenue")
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

  // Build lookup: tracking_link_id (UUID) → period delta metrics
  const snapshotLookup = useMemo<Record<string, SnapshotMetrics> | null>(() => {
    if (isAllTime) return null; // Signal to callers: use tracking_links totals
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
    };
  }
  const id = String(link.id ?? "").toLowerCase();
  return snapshotLookup[id] || { clicks: 0, subscribers: 0, revenue: 0 };
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
    return { ...l, clicks: m.clicks, subscribers: m.subscribers, revenue: m.revenue };
  });
}

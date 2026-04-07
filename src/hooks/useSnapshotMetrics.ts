import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  // If no snapshots at all, fall back to JS date (unlikely in production)
  if (!data || data.length === 0) {
    return new Date().toISOString().slice(0, 10);
  }
  return data[0].snapshot_date;
}

/**
 * Fetches daily_snapshots for the selected time period and returns
 * a lookup map of tracking_link_id → per-period {clicks, subscribers, revenue}
 * derived from cumulative snapshots using MAX - MIN within the selected range.
 *
 * Date ranges are resolved using the DATABASE server date (MAX snapshot_date
 * or CURRENT_DATE offsets), not the browser clock.
 *
 * For "All Time" returns null lookup (callers should use tracking_links totals).
 */
export function useSnapshotMetrics(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
) {
  const isAllTime = timePeriod === "all" && !customRange;

  // Use a sentinel so the query key reflects the period type, not a JS-computed date
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
        // Resolve dates from the server, not the browser
        const serverMaxDate = await fetchServerDate();

        switch (timePeriod) {
          case "day":
          case "since_sync":
            // Both use MAX(snapshot_date)
            fromDate = serverMaxDate;
            toDate = serverMaxDate;
            break;
          case "week": {
            // CURRENT_DATE - 7 — use server max date as reference
            const d = new Date(serverMaxDate + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() - 7);
            fromDate = d.toISOString().slice(0, 10);
            toDate = serverMaxDate;
            break;
          }
          case "month": {
            // CURRENT_DATE - 30
            const d = new Date(serverMaxDate + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() - 30);
            fromDate = d.toISOString().slice(0, 10);
            toDate = serverMaxDate;
            break;
          }
          case "prev_month": {
            // CURRENT_DATE - 60 to CURRENT_DATE - 31
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

      // For single-day queries (fromDate === toDate), fetch the PREVIOUS
      // snapshot date too so we can compute the delta (cumulative values).
      let effectiveFrom = fromDate;
      if (fromDate === toDate) {
        const { data: prevRows } = await supabase
          .from("daily_snapshots")
          .select("snapshot_date")
          .lt("snapshot_date", fromDate)
          .order("snapshot_date", { ascending: false })
          .limit(1);
        if (prevRows && prevRows.length > 0) {
          effectiveFrom = prevRows[0].snapshot_date;
        }
      }

      // Fetch all matching rows (batched)
      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("daily_snapshots")
          .select("tracking_link_id, clicks, subscribers, revenue")
          .gte("snapshot_date", effectiveFrom)
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

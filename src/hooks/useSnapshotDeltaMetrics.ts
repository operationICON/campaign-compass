import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TimePeriod } from "./usePageFilters";

/**
 * Per-link delta metrics from CUMULATIVE daily_snapshots.
 *
 * For the selected window:
 *   latest  = snapshot with MAX(snapshot_date) WHERE snapshot_date <= window.end
 *   earlier = snapshot with MAX(snapshot_date) WHERE snapshot_date <= window.start
 *
 * Deltas (clamped >= 0):
 *   subs_gained    = latest.subscribers - earlier.subscribers
 *   clicks_gained  = latest.clicks      - earlier.clicks
 *   revenue_gained = latest.revenue     - earlier.revenue
 *   subs_per_day   = subs_gained / (latest.date - earlier.date)
 *
 * If no earlier snapshot or zero-day delta → null (callers display "—").
 *
 * Lifetime/All Time mode: the hook returns an empty lookup; callers should
 * fall back to tracking_links.subscribers / days_since_created.
 */
export interface SnapshotDelta {
  subsGained: number;
  clicksGained: number;
  revenueGained: number;
  subsPerDay: number | null;
  daysBetween: number | null;
}

interface RawRow {
  tracking_link_id: string | null;
  snapshot_date: string | null;
  subscribers: number | null;
  clicks: number | null;
  revenue: number | null;
}

async function resolveWindow(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
): Promise<{ start: string; end: string } | null> {
  // Helper: latest snapshot_date in DB
  const { data: latest } = await supabase
    .from("daily_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const serverMax = latest?.[0]?.snapshot_date ?? new Date().toISOString().slice(0, 10);

  if (customRange) {
    return {
      start: customRange.from.toISOString().slice(0, 10),
      end: customRange.to.toISOString().slice(0, 10),
    };
  }

  switch (timePeriod) {
    case "day": {
      // Last Sync — most recent two distinct snapshot_dates
      const { data: distinct } = await supabase
        .from("daily_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(500);
      const seen = new Set<string>();
      const dates: string[] = [];
      for (const r of distinct || []) {
        if (r.snapshot_date && !seen.has(r.snapshot_date)) {
          seen.add(r.snapshot_date);
          dates.push(r.snapshot_date);
          if (dates.length >= 2) break;
        }
      }
      if (dates.length < 2) return null;
      return { start: dates[1], end: dates[0] };
    }
    case "week": {
      const d = new Date(serverMax + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
      return { start: d.toISOString().slice(0, 10), end: serverMax };
    }
    case "month": {
      const d = new Date(serverMax + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 30);
      return { start: d.toISOString().slice(0, 10), end: serverMax };
    }
    case "prev_month": {
      const ref = new Date(serverMax + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
    case "all":
    default:
      return null;
  }
}

export function useSnapshotDeltaMetrics(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
) {
  const isAllTime = timePeriod === "all" && !customRange;
  const periodKey = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  const { data, isLoading } = useQuery({
    queryKey: ["snapshot_delta_metrics", periodKey],
    enabled: !isAllTime,
    queryFn: async (): Promise<{
      lookup: Record<string, SnapshotDelta>;
      windowStart: string | null;
      windowEnd: string | null;
    }> => {
      const win = await resolveWindow(timePeriod, customRange);
      if (!win) return { lookup: {}, windowStart: null, windowEnd: null };

      // Pull a small buffer before window.start to find the "earlier" snapshot
      // (most recent snapshot on or before start). 60-day buffer is generous.
      const bufferStart = new Date(win.start + "T00:00:00Z");
      bufferStart.setUTCDate(bufferStart.getUTCDate() - 60);
      const bufferStartStr = bufferStart.toISOString().slice(0, 10);

      const rows: RawRow[] = [];
      let from = 0;
      const batch = 1000;
      while (true) {
        const { data: r, error } = await supabase
          .from("daily_snapshots")
          .select("tracking_link_id, snapshot_date, subscribers, clicks, revenue")
          .gte("snapshot_date", bufferStartStr)
          .lte("snapshot_date", win.end)
          .order("snapshot_date", { ascending: true })
          .range(from, from + batch - 1);
        if (error) throw error;
        if (!r?.length) break;
        rows.push(...r);
        if (r.length < batch) break;
        from += batch;
      }

      // Group by tracking_link_id, snapshots already asc
      const byLink: Record<string, RawRow[]> = {};
      for (const r of rows) {
        const id = String(r.tracking_link_id ?? "").toLowerCase();
        if (!id || !r.snapshot_date) continue;
        (byLink[id] ||= []).push(r);
      }

      const lookup: Record<string, SnapshotDelta> = {};
      for (const id of Object.keys(byLink)) {
        const series = byLink[id];
        // latest = MAX snapshot_date <= win.end (last item, since asc + lte filter)
        const latest = series[series.length - 1];
        // earlier = MAX snapshot_date <= win.start
        let earlier: RawRow | null = null;
        for (let i = series.length - 1; i >= 0; i--) {
          const d = series[i].snapshot_date!;
          if (d <= win.start) { earlier = series[i]; break; }
        }
        if (!earlier || !latest || earlier.snapshot_date === latest.snapshot_date) {
          // No prior point — cannot compute delta
          lookup[id] = {
            subsGained: 0, clicksGained: 0, revenueGained: 0,
            subsPerDay: null, daysBetween: null,
          };
          continue;
        }
        const days = Math.max(
          1,
          Math.round(
            (new Date(latest.snapshot_date! + "T00:00:00Z").getTime() -
              new Date(earlier.snapshot_date! + "T00:00:00Z").getTime()) / 86400000
          )
        );
        const subsGained = Math.max(0, Number(latest.subscribers || 0) - Number(earlier.subscribers || 0));
        const clicksGained = Math.max(0, Number(latest.clicks || 0) - Number(earlier.clicks || 0));
        const revenueGained = Math.max(0, Number(latest.revenue || 0) - Number(earlier.revenue || 0));
        lookup[id] = {
          subsGained,
          clicksGained,
          revenueGained,
          subsPerDay: subsGained / days,
          daysBetween: days,
        };
      }

      return { lookup, windowStart: win.start, windowEnd: win.end };
    },
  });

  return useMemo(
    () => ({
      isAllTime,
      isLoading,
      deltaLookup: (data?.lookup ?? {}) as Record<string, SnapshotDelta>,
      windowStart: data?.windowStart ?? null,
      windowEnd: data?.windowEnd ?? null,
    }),
    [isAllTime, isLoading, data]
  );
}

export function getDelta(
  linkId: string,
  lookup: Record<string, SnapshotDelta>
): SnapshotDelta | null {
  return lookup[String(linkId).toLowerCase()] ?? null;
}

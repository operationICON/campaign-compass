import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotLatestDate, getSnapshotDistinctDates, getSnapshotsByDateRange } from "@/lib/api";
import type { TimePeriod } from "./usePageFilters";

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
  revenue: string | number | null;
}

async function resolveWindow(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
): Promise<{ start: string; end: string } | null> {
  if (customRange) {
    return {
      start: customRange.from.toISOString().slice(0, 10),
      end: customRange.to.toISOString().slice(0, 10),
    };
  }

  const { date: serverMax } = await getSnapshotLatestDate();
  const maxDate = serverMax ?? new Date().toISOString().slice(0, 10);

  switch (timePeriod) {
    case "day": {
      const dates = await getSnapshotDistinctDates(2);
      if (dates.length < 2) return null;
      return { start: dates[1], end: dates[0] };
    }
    case "week": {
      const d = new Date(maxDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
      return { start: d.toISOString().slice(0, 10), end: maxDate };
    }
    case "month": {
      const d = new Date(maxDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 30);
      return { start: d.toISOString().slice(0, 10), end: maxDate };
    }
    case "prev_month": {
      const ref = new Date(maxDate + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
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

      const bufferStart = new Date(win.start + "T00:00:00Z");
      bufferStart.setUTCDate(bufferStart.getUTCDate() - 60);
      const bufferStartStr = bufferStart.toISOString().slice(0, 10);

      const rows: RawRow[] = await getSnapshotsByDateRange({
        date_from: bufferStartStr,
        date_to: win.end,
        cols: "slim",
      });

      const byLink: Record<string, RawRow[]> = {};
      for (const r of rows) {
        const id = String(r.tracking_link_id ?? "").toLowerCase();
        if (!id || !r.snapshot_date) continue;
        (byLink[id] ||= []).push(r);
      }

      const lookup: Record<string, SnapshotDelta> = {};
      for (const id of Object.keys(byLink)) {
        const series = byLink[id].sort((a, b) => (a.snapshot_date! > b.snapshot_date! ? 1 : -1));
        const latest = series[series.length - 1];
        let earlier: RawRow | null = null;
        for (let i = series.length - 1; i >= 0; i--) {
          if (series[i].snapshot_date! <= win.start) { earlier = series[i]; break; }
        }
        if (!earlier || !latest || earlier.snapshot_date === latest.snapshot_date) {
          lookup[id] = { subsGained: 0, clicksGained: 0, revenueGained: 0, subsPerDay: null, daysBetween: null };
          continue;
        }
        const days = Math.max(1, Math.round(
          (new Date(latest.snapshot_date! + "T00:00:00Z").getTime() - new Date(earlier.snapshot_date! + "T00:00:00Z").getTime()) / 86400000
        ));
        const subsGained = Math.max(0, Number(latest.subscribers || 0) - Number(earlier.subscribers || 0));
        const clicksGained = Math.max(0, Number(latest.clicks || 0) - Number(earlier.clicks || 0));
        const revenueGained = Math.max(0, Number(latest.revenue || 0) - Number(earlier.revenue || 0));
        lookup[id] = { subsGained, clicksGained, revenueGained, subsPerDay: subsGained / days, daysBetween: days };
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

export function getDelta(linkId: string, lookup: Record<string, SnapshotDelta>): SnapshotDelta | null {
  return lookup[String(linkId).toLowerCase()] ?? null;
}

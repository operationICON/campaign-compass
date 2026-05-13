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
): Promise<{ start: string; end: string; exclusiveStart: boolean } | null> {
  if (customRange) {
    return {
      start: customRange.from.toISOString().slice(0, 10),
      end: customRange.to.toISOString().slice(0, 10),
      exclusiveStart: false,
    };
  }

  const { date: serverMax } = await getSnapshotLatestDate();
  const maxDate = serverMax ?? new Date().toISOString().slice(0, 10);

  switch (timePeriod) {
    case "day": {
      // Fetch 3 dates: [0]=today partial, [1]=yesterday complete, [2]=day-before
      const dates = await getSnapshotDistinctDates(3);
      if (dates.length < 2) return null;
      // Skip today's in-progress partial sync — show the last COMPLETE day instead.
      // The daily sync runs at 02:00 UTC and captures "today" (only ~2 hrs old),
      // so dates[0] is always partial. dates[1] is the previous complete day.
      if (dates.length >= 3) {
        return { start: dates[2], end: dates[1], exclusiveStart: true };
      }
      return { start: dates[1], end: dates[0], exclusiveStart: true };
    }
    case "week": {
      const d = new Date(maxDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
      return { start: d.toISOString().slice(0, 10), end: maxDate, exclusiveStart: false };
    }
    case "month": {
      const d = new Date(maxDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 30);
      return { start: d.toISOString().slice(0, 10), end: maxDate, exclusiveStart: false };
    }
    case "prev_month": {
      const ref = new Date(maxDate + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), exclusiveStart: false };
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

      // days = calendar size of the window (used as the per-day denominator).
      // Custom ranges are inclusive on both ends (May 1–2 = 2 days), so add 1.
      // Preset ranges (week/month) set start = maxDate - N, so diff already equals N — no +1.
      const rawDays = Math.round(
        (new Date(win.end + "T00:00:00Z").getTime() - new Date(win.start + "T00:00:00Z").getTime()) / 86400000
      );
      const windowDays = Math.max(1, customRange ? rawDays + 1 : rawDays);

      const lookup: Record<string, SnapshotDelta> = {};
      for (const id of Object.keys(byLink)) {
        // Normalize to YYYY-MM-DD before comparing — Drizzle may return dates as
        // full ISO timestamps ("2026-05-08T16:00:00.000Z") while win.start/end are
        // plain date strings ("2026-05-08"). String comparison fails otherwise.
        const series = byLink[id].sort((a, b) => {
          const da = (a.snapshot_date ?? "").slice(0, 10);
          const db = (b.snapshot_date ?? "").slice(0, 10);
          return da > db ? 1 : -1;
        });

        // Sum daily incremental rows inside the window.
        // "day" period uses exclusive start (two anchor dates); all other periods inclusive.
        const inWindow = series.filter(r => {
          const d = (r.snapshot_date ?? "").slice(0, 10);
          return (win.exclusiveStart ? d > win.start : d >= win.start) && d <= win.end;
        });
        if (!inWindow.length) {
          lookup[id] = { subsGained: 0, clicksGained: 0, revenueGained: 0, subsPerDay: null, daysBetween: null };
          continue;
        }

        const subsGained = inWindow.reduce((s, r) => s + Math.max(0, Number(r.subscribers || 0)), 0);
        const clicksGained = inWindow.reduce((s, r) => s + Math.max(0, Number(r.clicks || 0)), 0);
        const revenueGained = inWindow.reduce((s, r) => s + Math.max(0, Number(r.revenue || 0)), 0);
        lookup[id] = { subsGained, clicksGained, revenueGained, subsPerDay: subsGained / windowDays, daysBetween: windowDays };
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

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Computes "Active" status per tracking link based on subs/day over the
 * last 5 days, sourced from the cumulative `daily_snapshots` table.
 *
 * A link is Active iff:
 *   subs_per_day = (latest.subscribers - earlier.subscribers) /
 *                  (latest.snapshot_date - earlier.snapshot_date) >= 1
 * where `earlier` is the snapshot closest to today-5d (snapshot_date <= today-5d).
 *
 * Snapshots are CUMULATIVE — we always compute deltas between two points and
 * clamp negative deltas to 0. Links with fewer than two qualifying snapshots
 * are treated as Inactive.
 */
export interface ActiveLinkInfo {
  subsPerDay: number;
  isActive: boolean;
}

export function useActiveLinkStatus(accountId?: string | null) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["active_link_status_snapshots", accountId ?? "all"],
    queryFn: async () => {
      // Fetch a 7-day window so we can find snapshots both at "today" and at
      // "today - 5d" (allowing a small buffer for missing days).
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setUTCDate(fromDate.getUTCDate() - 7);
      const fromStr = fromDate.toISOString().slice(0, 10);

      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        let q = supabase
          .from("daily_snapshots")
          .select("tracking_link_id, snapshot_date, subscribers")
          .gte("snapshot_date", fromStr)
          .order("snapshot_date", { ascending: true });
        if (accountId) q = q.eq("account_id", accountId);
        const { data, error } = await q.range(rangeFrom, rangeFrom + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        rangeFrom += batchSize;
      }
      return allRows;
    },
  });

  const lookup = useMemo(() => {
    const map = new Map<string, ActiveLinkInfo>();
    if (!rows.length) return map;

    // Group snapshots by tracking_link_id (sorted asc by date thanks to query)
    const byLink: Record<string, { date: string; subs: number }[]> = {};
    for (const r of rows) {
      const id = String(r.tracking_link_id ?? "").toLowerCase();
      if (!id || !r.snapshot_date) continue;
      if (!byLink[id]) byLink[id] = [];
      byLink[id].push({ date: r.snapshot_date, subs: Number(r.subscribers || 0) });
    }

    // Threshold = today - 5d
    const today = new Date();
    const threshold = new Date(today);
    threshold.setUTCDate(threshold.getUTCDate() - 5);
    const thresholdStr = threshold.toISOString().slice(0, 10);

    for (const id of Object.keys(byLink)) {
      const series = byLink[id]; // already asc
      if (series.length < 2) {
        map.set(id, { subsPerDay: 0, isActive: false });
        continue;
      }
      const latest = series[series.length - 1];
      // Closest snapshot with date <= threshold (max date that satisfies)
      let earlier: { date: string; subs: number } | null = null;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].date <= thresholdStr) { earlier = series[i]; break; }
      }
      // Fallback: oldest in window if none satisfy threshold (still need 2 points)
      if (!earlier) earlier = series[0];
      if (earlier.date === latest.date) {
        map.set(id, { subsPerDay: 0, isActive: false });
        continue;
      }
      const subsDelta = Math.max(0, latest.subs - earlier.subs);
      const days = Math.max(
        1,
        Math.round(
          (new Date(latest.date + "T00:00:00Z").getTime() -
            new Date(earlier.date + "T00:00:00Z").getTime()) /
            86400000
        )
      );
      const spd = subsDelta / days;
      map.set(id, { subsPerDay: spd, isActive: spd >= 1 });
    }
    return map;
  }, [rows]);

  return { activeLookup: lookup, isLoading };
}

export function getActiveInfo(
  linkId: string,
  lookup: Map<string, ActiveLinkInfo>
): ActiveLinkInfo {
  return lookup.get(String(linkId).toLowerCase()) ?? { subsPerDay: 0, isActive: false };
}

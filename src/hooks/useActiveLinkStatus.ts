import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange } from "@/lib/api";

export interface ActiveLinkInfo {
  subsPerDay: number;
  isActive: boolean;
}

export function useActiveLinkStatus(accountId?: string | null) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["active_link_status_snapshots", accountId ?? "all"],
    queryFn: async () => {
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setUTCDate(fromDate.getUTCDate() - 7);
      const fromStr = fromDate.toISOString().slice(0, 10);

      return getSnapshotsByDateRange({
        date_from: fromStr,
        account_ids: accountId ? [accountId] : undefined,
        cols: "slim",
      });
    },
  });

  const lookup = useMemo(() => {
    const map = new Map<string, ActiveLinkInfo>();
    if (!rows.length) return map;

    const byLink: Record<string, { date: string; subs: number }[]> = {};
    for (const r of rows as any[]) {
      const id = String(r.tracking_link_id ?? "").toLowerCase();
      if (!id || !r.snapshot_date) continue;
      if (!byLink[id]) byLink[id] = [];
      byLink[id].push({ date: r.snapshot_date, subs: Number(r.subscribers || 0) });
    }

    const today = new Date();
    const threshold = new Date(today);
    threshold.setUTCDate(threshold.getUTCDate() - 5);
    const thresholdStr = threshold.toISOString().slice(0, 10);

    for (const id of Object.keys(byLink)) {
      const series = byLink[id].sort((a, b) => a.date.localeCompare(b.date));
      if (series.length < 2) { map.set(id, { subsPerDay: 0, isActive: false }); continue; }
      const latest = series[series.length - 1];
      let earlier: typeof series[0] | null = null;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].date <= thresholdStr) { earlier = series[i]; break; }
      }
      if (!earlier) earlier = series[0];
      if (earlier.date === latest.date) { map.set(id, { subsPerDay: 0, isActive: false }); continue; }
      const subsDelta = Math.max(0, latest.subs - earlier.subs);
      const days = Math.max(1, Math.round((new Date(latest.date + "T00:00:00Z").getTime() - new Date(earlier.date + "T00:00:00Z").getTime()) / 86400000));
      const spd = subsDelta / days;
      map.set(id, { subsPerDay: spd, isActive: spd >= 1 });
    }
    return map;
  }, [rows]);

  return { activeLookup: lookup, isLoading };
}

export function getActiveInfo(linkId: string, lookup: Map<string, ActiveLinkInfo>): ActiveLinkInfo {
  return lookup.get(String(linkId).toLowerCase()) ?? { subsPerDay: 0, isActive: false };
}

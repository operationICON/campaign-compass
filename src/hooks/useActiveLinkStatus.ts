import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange } from "@/lib/api";

export interface ActiveLinkInfo {
  subsPerDay: number;
  isActive: boolean;
}

const WINDOW_DAYS = 5;

export function useActiveLinkStatus(accountId?: string | null) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["active_link_status_snapshots", accountId ?? "all"],
    queryFn: async () => {
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setUTCDate(fromDate.getUTCDate() - WINDOW_DAYS);
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

    // Sum subs and clicks per link over the window
    const byLink: Record<string, { subs: number; clicks: number }> = {};
    for (const r of rows as any[]) {
      const id = String(r.tracking_link_id ?? "").toLowerCase();
      if (!id) continue;
      if (!byLink[id]) byLink[id] = { subs: 0, clicks: 0 };
      byLink[id].subs += Number(r.subscribers || 0);
      byLink[id].clicks += Number(r.clicks || 0);
    }

    // Active = any subs OR any clicks recorded in the 5-day window
    for (const id of Object.keys(byLink)) {
      const { subs, clicks } = byLink[id];
      const spd = subs / WINDOW_DAYS;
      map.set(id, { subsPerDay: spd, isActive: subs > 0 || clicks > 0 });
    }

    return map;
  }, [rows]);

  return { activeLookup: lookup, isLoading };
}

export function getActiveInfo(linkId: string, lookup: Map<string, ActiveLinkInfo>): ActiveLinkInfo {
  return lookup.get(String(linkId).toLowerCase()) ?? { subsPerDay: 0, isActive: false };
}

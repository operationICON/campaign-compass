import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange } from "@/lib/api";

export interface WindowRate {
  rate: number;       // subs / actualDays (true velocity)
  actualDays: number; // how many days of data exist in this window
  isFull: boolean;    // true when actualDays >= windowDays (full history)
}

export interface WindowRates {
  w3d: WindowRate | null;
  w7d: WindowRate | null;
  w14d: WindowRate | null;
}

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Pass a specific accountId to scope to one model, or null/"all" for all accounts.
export function useMultiWindowRates(accountId: string | null | "all") {
  const scopedId = accountId === "all" ? null : accountId;
  const { data: rows = [] } = useQuery({
    queryKey: ["multi_window_rates", scopedId ?? "all"],
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      getSnapshotsByDateRange({
        ...(scopedId ? { account_ids: [scopedId] } : {}),
        date_from: isoNDaysAgo(14),
        cols: "slim",
      }),
  });

  return useMemo(() => {
    const map = new Map<string, WindowRates>();
    if (!rows.length) return map;

    const byLink: Record<string, Array<{ date: string; subs: number }>> = {};
    for (const r of rows as any[]) {
      const id = String(r.tracking_link_id ?? "").toLowerCase();
      if (!id || !r.snapshot_date) continue;
      (byLink[id] ||= []).push({ date: r.snapshot_date, subs: Math.max(0, Number(r.subscribers || 0)) });
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const [id, snaps] of Object.entries(byLink)) {
      const rate = (windowDays: number): WindowRate | null => {
        const cutoff = isoNDaysAgo(windowDays);
        const inW = snaps.filter(s => s.date >= cutoff && s.date <= today);
        if (!inW.length) return null;
        const totalSubs = inW.reduce((s, r) => s + r.subs, 0);
        const actualDays = inW.length;
        return {
          rate: totalSubs / actualDays,   // always divide by actual days, not window size
          actualDays,
          isFull: actualDays >= windowDays,
        };
      };
      map.set(id, { w3d: rate(3), w7d: rate(7), w14d: rate(14) });
    }

    return map;
  }, [rows]);
}

export function getWindowRates(linkId: string, lookup: Map<string, WindowRates>): WindowRates {
  return lookup.get(String(linkId).toLowerCase()) ?? { w3d: null, w7d: null, w14d: null };
}

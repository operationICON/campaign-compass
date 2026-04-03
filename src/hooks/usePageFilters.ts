import { useState, useMemo, useEffect } from "react";
import { subDays, startOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export type TimePeriod = "all" | "day" | "week" | "month" | "prev_month" | "since_sync";

export const TIME_PERIODS: { key: TimePeriod; label: string }[] = [
  { key: "day", label: "Last Day" },
  { key: "week", label: "Last Week" },
  { key: "since_sync", label: "Since Last Sync" },
  { key: "month", label: "Last Month" },
  { key: "prev_month", label: "Prev Month" },
  { key: "all", label: "All Time" },
];

export interface DateFilter {
  from: string | null;
  to: string | null;
}

export function usePageFilters() {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | null>(null);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);

  // Fetch MAX(updated_at) from tracking_link_ltv for "since_sync"
  useEffect(() => {
    if (timePeriod !== "since_sync") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("tracking_link_ltv")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (!cancelled && !error && data && data.length > 0) {
        // Use the start of that day as the "since last sync" boundary
        setLastSyncDate(startOfDay(new Date(data[0].updated_at)).toISOString());
      }
    })();
    return () => { cancelled = true; };
  }, [timePeriod]);

  const dateFilter: DateFilter = useMemo(() => {
    if (customRange) {
      return {
        from: startOfDay(customRange.from).toISOString(),
        to: startOfDay(customRange.to).toISOString(),
      };
    }
    const now = new Date();
    switch (timePeriod) {
      case "day":
        return { from: subDays(now, 1).toISOString(), to: null };
      case "week":
        return { from: subDays(now, 7).toISOString(), to: null };
      case "month":
        return { from: subDays(now, 30).toISOString(), to: null };
      case "prev_month": {
        const pm = subMonths(now, 1);
        return {
          from: startOfMonth(pm).toISOString(),
          to: endOfMonth(pm).toISOString(),
        };
      }
      case "since_sync":
        return { from: lastSyncDate, to: null };
      case "all":
      default:
        return { from: null, to: null };
    }
  }, [timePeriod, customRange, lastSyncDate]);

  return {
    timePeriod,
    setTimePeriod,
    modelFilter,
    setModelFilter,
    customRange,
    setCustomRange,
    dateFilter,
  };
}

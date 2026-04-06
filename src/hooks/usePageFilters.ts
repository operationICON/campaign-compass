import { useState, useMemo, useEffect, useCallback } from "react";
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

const STORAGE_KEY_TIME = "global_time_period";
const STORAGE_KEY_MODEL = "global_model_filter";
const STORAGE_KEY_CUSTOM = "global_custom_range";

function loadTimePeriod(): TimePeriod {
  try {
    const v = localStorage.getItem(STORAGE_KEY_TIME);
    if (v && TIME_PERIODS.some(tp => tp.key === v)) return v as TimePeriod;
  } catch {}
  return "all";
}

function loadModelFilter(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_MODEL) || "all";
  } catch {}
  return "all";
}

function loadCustomRange(): { from: Date; to: Date } | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (v) {
      const parsed = JSON.parse(v);
      return { from: new Date(parsed.from), to: new Date(parsed.to) };
    }
  } catch {}
  return null;
}

export function usePageFilters() {
  const [timePeriod, setTimePeriodRaw] = useState<TimePeriod>(loadTimePeriod);
  const [modelFilter, setModelFilterRaw] = useState(loadModelFilter);
  const [customRange, setCustomRangeRaw] = useState<{ from: Date; to: Date } | null>(loadCustomRange);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);

  const setTimePeriod = useCallback((tp: TimePeriod) => {
    setTimePeriodRaw(tp);
    try { localStorage.setItem(STORAGE_KEY_TIME, tp); } catch {}
  }, []);

  const setModelFilter = useCallback((v: string) => {
    setModelFilterRaw(v);
    try { localStorage.setItem(STORAGE_KEY_MODEL, v); } catch {}
  }, []);

  const setCustomRange = useCallback((range: { from: Date; to: Date } | null) => {
    setCustomRangeRaw(range);
    try {
      if (range) {
        localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify({ from: range.from.toISOString(), to: range.to.toISOString() }));
      } else {
        localStorage.removeItem(STORAGE_KEY_CUSTOM);
      }
    } catch {}
  }, []);

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

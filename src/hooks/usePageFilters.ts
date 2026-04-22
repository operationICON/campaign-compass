import { useState, useMemo, useCallback } from "react";
import { subDays, startOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";

export type TimePeriod = "all" | "day" | "week" | "month" | "prev_month";
export type RevenueMode = "gross" | "net";

export const TIME_PERIODS: { key: TimePeriod; label: string }[] = [
  // "day" pill is now labeled "Last Sync" — resolves to the delta between
  // the two most recent distinct snapshot_dates (see useLastSyncRange + useSnapshotDeltaMetrics).
  { key: "day", label: "Last Sync" },
  { key: "week", label: "Last Week" },
  { key: "month", label: "Last Month" },
  { key: "prev_month", label: "Prev Month" },
  { key: "all", label: "All Time" },
];

export const NET_MULTIPLIER = 0.80;

export interface DateFilter {
  from: string | null;
  to: string | null;
}

const STORAGE_KEY_TIME = "global_time_period";
const STORAGE_KEY_MODEL = "global_model_filter";
const STORAGE_KEY_CUSTOM = "global_custom_range";
const STORAGE_KEY_REVENUE_MODE = "global_revenue_mode";

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

function loadRevenueMode(): RevenueMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_REVENUE_MODE);
    if (v === "net") return "net";
  } catch {}
  return "gross";
}

export function usePageFilters() {
  const [timePeriod, setTimePeriodRaw] = useState<TimePeriod>(loadTimePeriod);
  const [modelFilter, setModelFilterRaw] = useState(loadModelFilter);
  const [customRange, setCustomRangeRaw] = useState<{ from: Date; to: Date } | null>(loadCustomRange);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);
  const [revenueMode, setRevenueModeRaw] = useState<RevenueMode>(loadRevenueMode);

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

  const setRevenueMode = useCallback((mode: RevenueMode) => {
    setRevenueModeRaw(mode);
    try { localStorage.setItem(STORAGE_KEY_REVENUE_MODE, mode); } catch {}
  }, []);

  const revMultiplier = revenueMode === "net" ? NET_MULTIPLIER : 1;

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
      case "prev_month":
        return {
          from: subDays(now, 60).toISOString(),
          to: subDays(now, 31).toISOString(),
        };
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
    revenueMode,
    setRevenueMode,
    revMultiplier,
  };
}

import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format, differenceInDays, subDays, startOfMonth, endOfMonth, subMonths,
  startOfYear, endOfYear, addMonths, isBefore, isSameDay, isWithinInterval, startOfDay,
} from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ModelAvatar } from "@/components/ModelAvatar";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { fetchAccounts, fetchTrackingLinks } from "@/lib/supabase-helpers";
import { getSnapshotsByDateRange, getSnapshotLatestDate } from "@/lib/api";
import { isActiveAccount } from "@/lib/calc-helpers";
import { getEffectiveSource } from "@/lib/source-helpers";
import { usePageFilters } from "@/hooks/usePageFilters";

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_COLORS = [
  "#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#0891b2",
  "#e11d48", "#16a34a", "#ea580c", "#7c3aed", "#0d9488", "#c026d3",
  "#dc2626", "#2563eb", "#64748b", "#f97316", "#84cc16", "#06b6d4",
];

const CHART_COLORS = { subs: "#818cf8", clicks: "#10b981", rev: "#10b981", expenses: "#f97316" };
const SERIES_META = [
  { key: "subs",     label: "Subs",     color: "#818cf8" },
  { key: "clicks",   label: "Clicks",   color: "#06b6d4" },
  { key: "rev",      label: "Rev",      color: "#10b981" },
  { key: "expenses", label: "Expenses", color: "#f97316" },
] as const;
type SeriesKey = typeof SERIES_META[number]["key"];

const fmtC = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const fmtAxis = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return v === 0 ? "0" : `$${v}`;
};

// ── Date Picker helpers ───────────────────────────────────────────────────────

type Preset = { label: string; tp?: string; fn?: () => { from: Date; to: Date } };
const DATE_PRESETS: Preset[] = [
  { label: "Today",           fn: () => ({ from: startOfDay(new Date()), to: new Date() }) },
  { label: "Yesterday",       fn: () => { const y = subDays(new Date(), 1); return { from: startOfDay(y), to: y }; } },
  { label: "Last 7 Days",     tp: "week" },
  { label: "Last 30 Days",    tp: "month" },
  { label: "This Month",      fn: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Previous Month",  tp: "prev_month" },
  { label: "This Year",       fn: () => ({ from: startOfYear(new Date()), to: new Date() }) },
  { label: "Previous Year",   fn: () => { const y = subMonths(new Date(), 12); return { from: startOfYear(y), to: endOfYear(y) }; } },
];

const WEEK_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getMonthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0).getDate();
  const days: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  for (let d = 1; d <= last; d++) days.push(new Date(year, month, d));
  return days;
}

async function resolvePeriodDates(
  timePeriod: string,
  customRange: { from: Date; to: Date } | null,
): Promise<{ from: string; to: string; days: number } | null> {
  if (timePeriod === "all" && !customRange) return null;
  if (customRange) {
    const from = customRange.from.toISOString().slice(0, 10);
    const to   = customRange.to.toISOString().slice(0, 10);
    return { from, to, days: Math.max(1, differenceInDays(customRange.to, customRange.from) + 1) };
  }
  const { date: serverMax } = await getSnapshotLatestDate();
  const max = serverMax ?? new Date().toISOString().slice(0, 10);
  switch (timePeriod) {
    case "day": return { from: max, to: max, days: 1 };
    case "week": {
      const d = new Date(max + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 7);
      return { from: d.toISOString().slice(0, 10), to: max, days: 7 };
    }
    case "month": {
      const d = new Date(max + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 30);
      return { from: d.toISOString().slice(0, 10), to: max, days: 30 };
    }
    case "prev_month": {
      const ref   = new Date(max + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end   = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), days: Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) };
    }
    default: return null;
  }
}

interface AccountRow {
  id: string; displayName: string; username: string; avatarUrl: string | null;
  revenue: number; fans: number; spend: number; profit: number; roi: number | null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const {
    timePeriod, setTimePeriod, modelFilter, setModelFilter,
    customRange, setCustomRange, revenueMode, setRevenueMode, revMultiplier,
  } = usePageFilters();

  const [vis, setVis] = useState<Record<SeriesKey, boolean>>({ subs: true, clicks: false, rev: false, expenses: false });

  const isAllTime  = timePeriod === "all" && !customRange;
  const periodKey  = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: accounts = [] }                      = useQuery({ queryKey: ["accounts"],       queryFn: fetchAccounts });
  const { data: allLinks = [], isLoading: linksLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: fetchTrackingLinks });

  const { data: periodData, isLoading: snapLoading } = useQuery({
    queryKey: ["ov2_snapshots", periodKey],
    enabled: !isAllTime,
    queryFn: async () => {
      const range = await resolvePeriodDates(timePeriod, customRange);
      if (!range) return { rows: [], days: 0, from: null as string | null, to: null as string | null };
      const rows = await getSnapshotsByDateRange({ date_from: range.from, date_to: range.to, cols: "slim" });
      return { rows, days: range.days, from: range.from, to: range.to };
    },
  });

  const activeAccounts = useMemo(() => (accounts as any[]).filter(isActiveAccount), [accounts]);

  const acctIds = useMemo(() => {
    if (modelFilter !== "all") return new Set([modelFilter]);
    return new Set(activeAccounts.map((a: any) => a.id));
  }, [modelFilter, activeAccounts]);

  // Monthly trend last 12 months (for sparklines + all-time chart)
  const trendAccountIds = useMemo(() => {
    if (modelFilter !== "all") return [modelFilter];
    return activeAccounts.map((a: any) => a.id);
  }, [modelFilter, activeAccounts]);

  const { data: monthlyRows = [] } = useQuery({
    queryKey: ["ov2_monthly", trendAccountIds.join(",")],
    enabled: trendAccountIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end); start.setMonth(start.getMonth() - 11); start.setDate(1);
      return getSnapshotsByDateRange({
        date_from: start.toISOString().slice(0, 10),
        date_to:   end.toISOString().slice(0, 10),
        account_ids: trendAccountIds,
        cols: "slim",
      });
    },
  });

  const isLoading = linksLoading || (!isAllTime && snapLoading);

  // ── Monthly chart data (all-time + sparklines) ───────────────────────────

  const monthlyChartData = useMemo(() => {
    const byMonth: Record<string, { rev: number; expenses: number; subs: number; clicks: number }> = {};
    for (const r of monthlyRows as any[]) {
      const d = r.snapshot_date as string;
      if (!d || d.length < 7) continue;
      const m = d.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { rev: 0, expenses: 0, subs: 0, clicks: 0 };
      byMonth[m].rev      += Number(r.revenue    || 0) * revMultiplier;
      byMonth[m].expenses += Number(r.cost_total || 0);
      byMonth[m].subs     += Number(r.subscribers || 0);
      byMonth[m].clicks   += Number(r.clicks     || 0);
    }
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, d]) => ({
      label:    format(new Date(month + "-15T12:00:00Z"), "MMM yy"),
      rev:      Math.round(d.rev),
      expenses: Math.round(d.expenses),
      subs:     Math.round(d.subs),
      clicks:   Math.round(d.clicks),
      ltv:      d.subs > 0 ? Math.round((d.rev / d.subs) * 100) / 100 : 0,
    }));
  }, [monthlyRows, revMultiplier]);

  // ── Period daily chart data ───────────────────────────────────────────────

  const periodChartData = useMemo(() => {
    if (!periodData?.rows?.length) return [];
    const byDay: Record<string, { rev: number; expenses: number; subs: number; clicks: number }> = {};
    for (const r of periodData.rows as any[]) {
      const day = (r.snapshot_date as string)?.slice(0, 10);
      if (!day || !acctIds.has(r.account_id)) continue;
      if (!byDay[day]) byDay[day] = { rev: 0, expenses: 0, subs: 0, clicks: 0 };
      byDay[day].rev      += Number(r.revenue    || 0) * revMultiplier;
      byDay[day].expenses += Number(r.cost_total || 0);
      byDay[day].subs     += Number(r.subscribers || 0);
      byDay[day].clicks   += Number(r.clicks     || 0);
    }
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({
      label:    format(new Date(day + "T12:00:00Z"), "MMM d"),
      rev:      Math.round(d.rev),
      expenses: Math.round(d.expenses),
      subs:     Math.round(d.subs),
      clicks:   Math.round(d.clicks),
    }));
  }, [periodData, acctIds, revMultiplier]);

  const chartData = useMemo(
    () => isAllTime ? monthlyChartData : periodChartData,
    [isAllTime, monthlyChartData, periodChartData],
  );


  // ── Per-account rows ──────────────────────────────────────────────────────

  const accountRows = useMemo<AccountRow[]>(() => {
    const today = new Date();
    const periodDays = periodData?.days ?? 1;
    const snapRows   = (periodData?.rows ?? []) as any[];
    return activeAccounts.map((acc: any) => {
      const accLinks = (allLinks as any[]).filter((l: any) => l.account_id === acc.id);
      let revenue: number, fans: number, spend: number;
      if (isAllTime) {
        revenue = accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) * revMultiplier;
        fans    = accLinks.reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
        spend   = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
      } else {
        const snaps = snapRows.filter((r: any) => r.account_id === acc.id);
        revenue = snaps.reduce((s: number, r: any) => s + Number(r.revenue || 0), 0) * revMultiplier;
        fans    = snaps.reduce((s: number, r: any) => s + Number(r.subscribers || 0), 0);
        spend   = accLinks.reduce((s: number, l: any) => {
          const cost = Number(l.cost_total || 0);
          if (!cost) return s;
          return s + (cost / Math.max(1, differenceInDays(today, new Date(l.created_at)))) * periodDays;
        }, 0);
      }
      const profit = revenue - spend;
      return {
        id: acc.id,
        displayName: acc.display_name || acc.username || "Unknown",
        username: (acc.username || "unknown").replace("@", ""),
        avatarUrl: acc.avatar_thumb_url ?? null,
        revenue, fans, spend, profit,
        roi: spend > 0 ? (profit / spend) * 100 : null,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [activeAccounts, allLinks, periodData, isAllTime, revMultiplier]);

  const filteredRows = useMemo(
    () => modelFilter === "all" ? accountRows : accountRows.filter(r => r.id === modelFilter),
    [accountRows, modelFilter],
  );

  const totals = useMemo(() => {
    const revenue = filteredRows.reduce((s, r) => s + r.revenue, 0);
    const fans    = filteredRows.reduce((s, r) => s + r.fans, 0);
    const spend   = filteredRows.reduce((s, r) => s + r.spend, 0);
    const profit  = revenue - spend;
    const ltvPerSub = fans > 0 ? revenue / fans : null;
    return { revenue, fans, spend, profit, roi: spend > 0 ? (profit / spend) * 100 : null, ltvPerSub };
  }, [filteredRows]);

  // All-time fans + subs/day — always ignores period filter
  const allTimeFans = useMemo(() =>
    (allLinks as any[]).filter((l: any) => acctIds.has(l.account_id))
      .reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0),
  [allLinks, acctIds]);

  const allTimeSubsPerDay = useMemo(() => {
    const earliest = (allLinks as any[])
      .filter((l: any) => acctIds.has(l.account_id) && l.created_at)
      .reduce((min: Date | null, l: any) => {
        const d = new Date(l.created_at);
        return !min || d < min ? d : min;
      }, null as Date | null);
    if (!earliest || allTimeFans === 0) return null;
    return allTimeFans / Math.max(1, differenceInDays(new Date(), earliest));
  }, [allLinks, acctIds, allTimeFans]);

  // ── Marketer breakdown ────────────────────────────────────────────────────

  const marketerBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    const marketerKey = (l: any): string =>
      (l.onlytraffic_marketer as string | null)?.trim() || "Unassigned";

    if (isAllTime) {
      for (const l of allLinks as any[]) {
        if (!acctIds.has(l.account_id)) continue;
        const src = marketerKey(l);
        map[src] = (map[src] || 0) + Number(l.revenue || 0) * revMultiplier;
      }
    } else {
      const periodRows = (periodData?.rows ?? []) as any[];
      const acctPeriodRev: Record<string, number> = {};
      for (const r of periodRows) {
        if (!acctIds.has(r.account_id)) continue;
        acctPeriodRev[r.account_id] = (acctPeriodRev[r.account_id] || 0) + Number(r.revenue || 0);
      }
      const acctTotalRev: Record<string, number> = {};
      for (const l of allLinks as any[]) {
        if (!acctIds.has(l.account_id)) continue;
        acctTotalRev[l.account_id] = (acctTotalRev[l.account_id] || 0) + Number(l.revenue || 0);
      }
      for (const l of allLinks as any[]) {
        if (!acctIds.has(l.account_id)) continue;
        const total = acctTotalRev[l.account_id] || 0;
        if (!total) continue;
        const portion = Number(l.revenue || 0) / total;
        const src = marketerKey(l);
        map[src] = (map[src] || 0) + (acctPeriodRev[l.account_id] || 0) * portion * revMultiplier;
      }
    }
    const entries = Object.entries(map).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const total   = entries.reduce((s, [, v]) => s + v, 0);
    return entries.map(([name, value]) => ({ name, value, pct: total > 0 ? value / total : 0 }));
  }, [isAllTime, allLinks, periodData, acctIds, revMultiplier]);

  const marketerTotal = marketerBreakdown.reduce((s, r) => s + r.value, 0);
  const maxValue = Math.max(...accountRows.map(r => Math.max(r.revenue, r.spend)), 1);

  const periodLabel = useMemo(() => {
    if (customRange) return `${format(customRange.from, "MMM d, yyyy")} – ${format(customRange.to, "MMM d, yyyy")}`;
    switch (timePeriod) {
      case "day":        return "Last Sync";
      case "week":       return "Last 7 Days";
      case "month":      return "Last 30 Days";
      case "prev_month": return "Previous Month";
      default:           return "All Time";
    }
  }, [timePeriod, customRange]);

  const accountOptions = useMemo(() => activeAccounts.map((a: any) => ({
    id: a.id, username: a.username || "unknown", display_name: a.display_name,
    avatar_thumb_url: a.avatar_thumb_url, is_active: a.is_active,
  })), [activeAccounts]);

  const toggleSeries = (key: keyof typeof vis) =>
    setVis(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-4">

        {/* Header */}
        <div>
          <h1 className="text-[22px] font-bold text-foreground">Overview</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">{periodLabel}</p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <CombinedDatePicker
            timePeriod={timePeriod}
            customRange={customRange}
            onSelectCustom={(range) => { setCustomRange(range); setTimePeriod("all"); }}
            onSelectTp={(tp) => { setTimePeriod(tp); setCustomRange(null); }}
          />
          <AccountFilterDropdown value={modelFilter} onChange={setModelFilter} accounts={accountOptions} />
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {(["gross", "net"] as const).map(m => (
              <button key={m} onClick={() => setRevenueMode(m)}
                className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${revenueMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ MAIN ROW: KPI cards left, chart right ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">

          {/* 4 KPI cards */}
          <div className="flex flex-col gap-3">
            <KpiCard label="Total Revenue"
              value={isLoading ? "…" : fmtShort(totals.revenue)}
              sub={periodLabel} accent="#10b981" badge={revenueMode === "net" ? "NET" : undefined} />
            <KpiCard label="Total Spend"
              value={isLoading ? "…" : totals.spend > 0 ? fmtShort(totals.spend) : "—"}
              sub={isAllTime ? "All time" : `Est. · ${periodLabel}`}
              accent="#f97316" />
            <KpiCard label="Profit"
              value={isLoading ? "…" : fmtShort(totals.profit)}
              sub={totals.roi !== null ? `ROI ${totals.roi.toFixed(1)}%` : periodLabel}
              accent={totals.profit >= 0 ? "#10b981" : "#ef4444"}
              badge={revenueMode === "net" ? "NET" : undefined} />
            <KpiCard label="Subscribers"
              value={isLoading ? "…" : fmtN(allTimeFans)}
              sub={allTimeSubsPerDay ? `${allTimeSubsPerDay.toFixed(1)} subs/day · All time` : "All time"}
              accent="#818cf8" />
            <KpiCard label="LTV / Sub"
              value={isLoading ? "…" : totals.ltvPerSub !== null ? `$${totals.ltvPerSub.toFixed(2)}` : "—"}
              sub={`${revenueMode === "net" ? "Net" : "Gross"} · ${isAllTime ? "All time" : periodLabel}`}
              accent="#e879f9" badge={revenueMode === "net" ? "NET" : undefined} />
          </div>

          {/* Chart */}
          <div className="bg-card border border-border rounded-2xl p-5 flex flex-col">
            {/* Series toggles */}
            <div className="flex items-center gap-5 mb-4 shrink-0">
              {SERIES_META.map(({ key, label, color }) => (
                <button key={key} onClick={() => toggleSeries(key)}
                  className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest transition-opacity ${vis[key] ? "opacity-100" : "opacity-25"}`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  {label}
                </button>
              ))}
            </div>

            {chartData.length === 0 ? (
              <div className="flex-1 min-h-[180px] flex items-center justify-center text-muted-foreground text-sm">
                {isLoading ? "Loading…" : "No data"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={180} className="flex-1">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={54} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  {SERIES_META.map(({ key, label, color }) =>
                    vis[key] ? <Bar key={key} dataKey={key} name={label} fill={color} radius={[3, 3, 0, 0]} maxBarSize={32} /> : null
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ═══ BOTTOM ROW ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">

          {/* Revenue by Marketer */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="text-[14px] font-semibold text-foreground mb-5">Revenue by Marketer</h2>
            {marketerBreakdown.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No tagged links</div>
            ) : (
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0 overflow-y-auto space-y-3.5 pr-1" style={{ maxHeight: 340, scrollbarWidth: "thin" }}>
                  {marketerBreakdown.map((src, i) => (
                    <div key={src.name}>
                      <div className="flex items-center justify-between text-[12px] mb-1.5">
                        <span className="font-medium text-foreground truncate max-w-[150px]">{src.name}</span>
                        <span className="text-muted-foreground font-mono shrink-0 ml-2">{(src.pct * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${src.pct * 100}%`, background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="shrink-0 flex flex-col items-center" style={{ width: 120 }}>
                  <div className="relative" style={{ width: 120, height: 120 }}>
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={marketerBreakdown} cx="50%" cy="50%" innerRadius={35} outerRadius={52}
                          dataKey="value" strokeWidth={0} paddingAngle={2}>
                          {marketerBreakdown.map((_, i) => <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[18px] font-bold text-foreground leading-tight">{marketerBreakdown.length}</span>
                      <span className="text-[8px] text-muted-foreground uppercase tracking-wider">Marketers</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{fmtC(marketerTotal)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Revenue vs Spend by Model */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[14px] font-semibold text-foreground">Revenue vs Spend by Model</h2>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS.revenue }} /> Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS.spend }} /> Spend
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton-shimmer h-6 w-6 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton-shimmer h-2 w-24 rounded" />
                      <div className="skeleton-shimmer h-1.5 rounded" />
                      <div className="skeleton-shimmer h-1.5 w-3/4 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : accountRows.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <div className="overflow-y-auto space-y-3.5 pr-0.5" style={{ maxHeight: 380, scrollbarWidth: "thin" }}>
                {accountRows.map(row => {
                  const revW   = Math.min((row.revenue / maxValue) * 100, 100);
                  const spendW = Math.min((row.spend   / maxValue) * 100, 100);
                  const roiPos = row.roi !== null && row.roi >= 0;
                  return (
                    <div key={row.id} className="flex items-center gap-3">
                      <ModelAvatar avatarUrl={row.avatarUrl} name={row.username} size={26} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground mb-1.5 truncate">{row.displayName}</p>
                        <div className="h-[6px] bg-muted rounded-sm mb-1 overflow-hidden">
                          <div className="h-full rounded-sm transition-all duration-500"
                            style={{ width: `${revW}%`, background: CHART_COLORS.revenue }} />
                        </div>
                        <div className="h-[6px] bg-muted rounded-sm overflow-hidden">
                          <div className="h-full rounded-sm transition-all duration-500"
                            style={{ width: `${spendW}%`, background: CHART_COLORS.spend }} />
                        </div>
                      </div>
                      <span className={`text-[12px] font-mono font-semibold shrink-0 w-16 text-right ${row.roi !== null ? (roiPos ? "text-[#10b981]" : "text-destructive") : "text-muted-foreground"}`}>
                        {row.roi !== null ? `${Math.round(row.roi)}%` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-lg text-[12px] min-w-[140px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-mono text-foreground">{fmtAxis(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, accent, badge }: {
  label: string; value: string; sub: string; accent: string; badge?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl px-5 pt-4 pb-3.5 overflow-hidden"
      style={{ borderBottom: `3px solid ${accent}` }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        {badge && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary">{badge}</span>}
      </div>
      <p className="text-[28px] font-bold font-mono text-foreground leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1.5 truncate">{sub}</p>
    </div>
  );
}

// ── CombinedDatePicker ────────────────────────────────────────────────────────

function CombinedDatePicker({ timePeriod, customRange, onSelectCustom, onSelectTp }: {
  timePeriod: string;
  customRange: { from: Date; to: Date } | null;
  onSelectCustom: (r: { from: Date; to: Date }) => void;
  onSelectTp: (tp: string) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [leftMonth, setLeft]  = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [sel, setSel]         = useState<{ from: Date; to: Date | null } | null>(null);
  const [hover, setHover]     = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const rightMonth = addMonths(leftMonth, 1);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const buttonLabel = useMemo(() => {
    if (customRange) return `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`;
    switch (timePeriod) {
      case "day":        return "Last Sync";
      case "week":       return "Last 7 Days";
      case "month":      return "Last 30 Days";
      case "prev_month": return "Prev Month";
      case "all":        return "All Time";
      default:           return "Select range";
    }
  }, [timePeriod, customRange]);

  const handleDayClick = (day: Date) => {
    if (!sel || sel.to !== null) { setSel({ from: day, to: null }); setHover(null); }
    else {
      const from = isBefore(day, sel.from) ? day : sel.from;
      const to   = isBefore(day, sel.from) ? sel.from : day;
      setSel({ from, to });
    }
  };

  const handleApply = () => {
    if (sel?.from && sel?.to) {
      onSelectCustom({ from: startOfDay(sel.from), to: startOfDay(sel.to) });
      setOpen(false);
    }
  };

  const handlePreset = (p: Preset) => {
    if (p.tp) { onSelectTp(p.tp); setOpen(false); return; }
    if (p.fn) { const r = p.fn(); setSel({ from: r.from, to: r.to }); }
  };

  const inRange = (day: Date) => {
    if (!sel) return false;
    const end = sel.to ?? hover;
    if (!end) return false;
    const from = isBefore(end, sel.from) ? end : sel.from;
    const to   = isBefore(end, sel.from) ? sel.from : end;
    return isWithinInterval(day, { start: from, end: to });
  };
  const isStart = (d: Date) => !!(sel?.from && isSameDay(d, sel.from));
  const isEnd   = (d: Date) => { const e = sel?.to ?? hover; return !!(e && isSameDay(d, e)); };

  const renderMonth = (m: Date) => {
    const days = getMonthDays(m.getFullYear(), m.getMonth());
    return (
      <div className="w-[196px]">
        <p className="text-center text-[12px] font-semibold text-foreground mb-2">{format(m, "MMMM yyyy")}</p>
        <div className="grid grid-cols-7">
          {WEEK_DAYS.map(d => <div key={d} className="text-center text-[10px] text-muted-foreground py-1">{d}</div>)}
          {days.map((day, i) => {
            if (!day) return <div key={`e${i}`} />;
            const start = isStart(day), end = isEnd(day), range = inRange(day) && !start && !end;
            return (
              <button key={day.toISOString()} onClick={() => handleDayClick(day)}
                onMouseEnter={() => { if (sel && !sel.to) setHover(day); }}
                className={`h-7 text-[11px] transition-colors
                  ${start || end ? "bg-primary text-primary-foreground rounded-full font-bold" : ""}
                  ${range ? "bg-primary/15 text-foreground rounded-none" : ""}
                  ${!start && !end && !range ? "hover:bg-secondary rounded-full" : ""}
                `}>
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 border border-primary/25 text-primary text-[12px] font-medium hover:bg-primary/15 transition-colors">
        {buttonLabel}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-card rounded-2xl p-4 shadow-2xl"
          style={{ border: "1px solid hsl(var(--border))" }}>
          {/* Nav */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setLeft(subMonths(leftMonth, 1))} className="p-1 rounded hover:bg-secondary">
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex-1" />
            <button onClick={() => setLeft(addMonths(leftMonth, 1))} className="p-1 rounded hover:bg-secondary">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex gap-3">
            {/* Calendars */}
            <div className="flex gap-3">
              {renderMonth(leftMonth)}
              {renderMonth(rightMonth)}
            </div>
            {/* Presets */}
            <div className="w-[136px] flex flex-col border-l border-border pl-3 gap-0.5">
              {DATE_PRESETS.map(p => (
                <button key={p.label} onClick={() => handlePreset(p)}
                  className="text-left px-2 py-1.5 text-[12px] text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
                  {p.label}
                </button>
              ))}
              <div className="h-px bg-border my-1" />
              <button onClick={() => { onSelectTp("all"); setOpen(false); }}
                className="text-left px-2 py-1.5 text-[12px] text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
                All Time
              </button>
            </div>
          </div>

          {/* Apply */}
          <div className="flex justify-end pt-3 mt-3 border-t border-border">
            <button onClick={handleApply} disabled={!sel?.from || !sel?.to}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-all">
              Apply ✓
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { Users, DollarSign, TrendingUp, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ModelAvatar } from "@/components/ModelAvatar";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { fetchAccounts, fetchTrackingLinks, fetchTrackingLinkLtv } from "@/lib/supabase-helpers";
import { getSnapshotsByDateRange, getSnapshotLatestDate, getSnapshotAllTimeTotals } from "@/lib/api";
import { isActiveAccount, buildActiveLinkIdSet, filterLtvByActiveLinks } from "@/lib/calc-helpers";
import { getEffectiveSource } from "@/lib/source-helpers";
import { usePageFilters, TIME_PERIODS } from "@/hooks/usePageFilters";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  j: "#e11d48", m: "#0891b2", z: "#7c3aed", e: "#ea580c", a: "#2563eb",
  s: "#16a34a", d: "#9333ea", r: "#dc2626", k: "#0d9488", l: "#c026d3",
  f: "#f59e0b", b: "#6366f1",
};
const SOURCE_COLORS = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#64748b"];

function modelColor(name: string) {
  const first = (name || "?").replace("@", "").charAt(0).toLowerCase();
  return MODEL_COLORS[first] || "#6b7280";
}

const fmtC = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtC2 = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

async function resolvePeriodDates(
  timePeriod: string,
  customRange: { from: Date; to: Date } | null,
): Promise<{ from: string; to: string; days: number } | null> {
  if (timePeriod === "all" && !customRange) return null;
  if (customRange) {
    const from = customRange.from.toISOString().slice(0, 10);
    const to = customRange.to.toISOString().slice(0, 10);
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
      const dS = new Date(max + "T00:00:00Z"); dS.setUTCDate(dS.getUTCDate() - 30);
      const dE = new Date(max + "T00:00:00Z"); dE.setUTCDate(dE.getUTCDate() - 1);
      return { from: dS.toISOString().slice(0, 10), to: dE.toISOString().slice(0, 10), days: 30 };
    }
    case "prev_month": {
      const ref = new Date(max + "T00:00:00Z");
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), days: Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) };
    }
    default: return null;
  }
}

interface AccountRow {
  id: string; displayName: string; username: string; avatarUrl: string | null;
  revenue: number; fans: number; spend: number; profit: number; roi: number | null; ltvPerFan: number | null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { timePeriod, setTimePeriod, modelFilter, setModelFilter, customRange, setCustomRange, revenueMode, setRevenueMode, revMultiplier } = usePageFilters();

  const isAllTime = timePeriod === "all" && !customRange;
  const periodKey = customRange ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}` : timePeriod;

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: allLinks = [], isLoading: linksLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: fetchTrackingLinks });
  const { data: ltvRaw = [] } = useQuery({ queryKey: ["tracking_link_ltv"], queryFn: fetchTrackingLinkLtv });
  const { data: allTimeTotals } = useQuery({ queryKey: ["snapshot_alltime_totals", "all"], queryFn: () => getSnapshotAllTimeTotals(), staleTime: 5 * 60 * 1000 });

  const { data: periodData, isLoading: snapshotsLoading } = useQuery({
    queryKey: ["overview_snapshots", periodKey],
    enabled: !isAllTime,
    queryFn: async () => {
      const range = await resolvePeriodDates(timePeriod, customRange);
      if (!range) return { rows: [], days: 0, from: null as string | null, to: null as string | null };
      const rows = await getSnapshotsByDateRange({ date_from: range.from, date_to: range.to, cols: "slim" });
      return { rows, days: range.days, from: range.from, to: range.to };
    },
  });

  const activeAccounts = useMemo(() => accounts.filter(isActiveAccount), [accounts]);
  const activeLinkIdSet = useMemo(() => buildActiveLinkIdSet(allLinks as any[]), [allLinks]);
  // keep LTV available for future use
  const _ltv = useMemo(() => filterLtvByActiveLinks(ltvRaw as any[], activeLinkIdSet), [ltvRaw, activeLinkIdSet]); void _ltv;

  // Monthly trend — last 12 months, always scoped to active accounts
  const activeAccountIds = useMemo(() => activeAccounts.map((a: any) => a.id), [activeAccounts]);
  const trendAccountIds = useMemo(() => {
    if (modelFilter !== "all") return [modelFilter];
    return activeAccountIds;
  }, [modelFilter, activeAccountIds]);

  const { data: monthlyRows = [] } = useQuery({
    queryKey: ["monthly_trend_rows", trendAccountIds.join(",")],
    enabled: trendAccountIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end);
      start.setMonth(start.getMonth() - 11);
      start.setDate(1);
      return getSnapshotsByDateRange({
        date_from: start.toISOString().slice(0, 10),
        date_to: end.toISOString().slice(0, 10),
        account_ids: trendAccountIds,
        cols: "slim",
      });
    },
  });

  const isLoading = linksLoading || (!isAllTime && snapshotsLoading);

  // ── Derived: per-account rows ─────────────────────────────────────────────

  const accountRows = useMemo<AccountRow[]>(() => {
    const today = new Date();
    const periodDays = periodData?.days ?? 1;
    const snapRows = (periodData?.rows ?? []) as any[];
    return activeAccounts.map((acc: any) => {
      const accLinks = (allLinks as any[]).filter((l: any) => l.account_id === acc.id);
      let revenue: number, fans: number, spend: number;
      if (isAllTime) {
        revenue = accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) * revMultiplier;
        fans = accLinks.reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
        spend = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
      } else {
        const accSnaps = snapRows.filter((r: any) => r.account_id === acc.id);
        revenue = accSnaps.reduce((s: number, r: any) => s + Number(r.revenue || 0), 0) * revMultiplier;
        fans = accSnaps.reduce((s: number, r: any) => s + Number(r.subscribers || 0), 0);
        spend = accLinks.reduce((s: number, l: any) => {
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
        ltvPerFan: fans > 0 ? revenue / fans : null,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [activeAccounts, allLinks, periodData, isAllTime, revMultiplier]);

  const filteredRows = useMemo(
    () => modelFilter === "all" ? accountRows : accountRows.filter(r => r.id === modelFilter),
    [accountRows, modelFilter]
  );

  const totals = useMemo(() => {
    const revenue = filteredRows.reduce((s, r) => s + r.revenue, 0);
    const fans = filteredRows.reduce((s, r) => s + r.fans, 0);
    const spend = filteredRows.reduce((s, r) => s + r.spend, 0);
    const profit = revenue - spend;
    return { revenue, fans, spend, profit, roi: spend > 0 ? (profit / spend) * 100 : null };
  }, [filteredRows]);

  // All-time subs + subs/day
  const allTimeFans = useMemo(() => {
    const acctIds = modelFilter === "all" ? new Set(activeAccounts.map((a: any) => a.id)) : new Set([modelFilter]);
    return (allLinks as any[]).filter((l: any) => acctIds.has(l.account_id)).reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
  }, [allLinks, activeAccounts, modelFilter]);

  const allTimeSubsPerDay = useMemo(() => {
    const acctIds = modelFilter === "all" ? new Set(activeAccounts.map((a: any) => a.id)) : new Set([modelFilter]);
    const earliest = (allLinks as any[]).filter((l: any) => acctIds.has(l.account_id) && l.created_at)
      .reduce((min: Date | null, l: any) => { const d = new Date(l.created_at); return !min || d < min ? d : min; }, null as Date | null);
    if (!earliest || allTimeFans === 0) return null;
    return allTimeFans / Math.max(1, differenceInDays(new Date(), earliest));
  }, [allLinks, activeAccounts, modelFilter, allTimeFans]);

  // Global LTV/Sub
  const globalLtvPerFan = useMemo(() => {
    if (allTimeTotals?.subscribers && allTimeTotals.subscribers > 0) return (allTimeTotals.revenue * revMultiplier) / allTimeTotals.subscribers;
    const totalRev = (allLinks as any[]).reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) * revMultiplier;
    const totalSubs = (allLinks as any[]).reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
    return totalSubs > 0 ? totalRev / totalSubs : null;
  }, [allTimeTotals, allLinks, revMultiplier]);

  // Monthly chart data
  const monthlyChartData = useMemo(() => {
    const byMonth: Record<string, { revenue: number; spend: number; subs: number }> = {};
    for (const r of monthlyRows as any[]) {
      const d = r.snapshot_date as string;
      if (!d || d.length < 7) continue;
      const m = d.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { revenue: 0, spend: 0, subs: 0 };
      byMonth[m].revenue += Number(r.revenue || 0) * revMultiplier;
      byMonth[m].spend += Number(r.cost_total || 0);
      byMonth[m].subs += Number(r.subscribers || 0);
    }
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, d]) => ({
      month: format(new Date(month + "-15T12:00:00Z"), "MMM yy"),
      revenue: Math.round(d.revenue),
      spend: Math.round(d.spend),
      profit: Math.round(d.revenue - d.spend),
      subs: d.subs,
    }));
  }, [monthlyRows, revMultiplier]);

  const sparkLast6 = monthlyChartData.slice(-6);

  // Source breakdown
  const sourceBreakdown = useMemo(() => {
    const acctIds = modelFilter === "all" ? new Set(activeAccounts.map((a: any) => a.id)) : new Set([modelFilter]);
    const map: Record<string, number> = {};
    for (const l of allLinks as any[]) {
      if (!acctIds.has(l.account_id)) continue;
      const src = getEffectiveSource(l) || "Untagged";
      map[src] = (map[src] || 0) + Number(l.revenue || 0) * revMultiplier;
    }
    const entries = Object.entries(map).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return entries.map(([name, value]) => ({ name, value, pct: total > 0 ? value / total : 0 }));
  }, [allLinks, activeAccounts, modelFilter, revMultiplier]);

  const sourcePieTotal = sourceBreakdown.reduce((s, r) => s + r.value, 0);

  // Per-model bar scale
  const maxValue = Math.max(...accountRows.map(r => Math.max(r.revenue, r.spend)), 1);

  const periodLabel = useMemo(() => {
    if (customRange) return `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`;
    return TIME_PERIODS.find(t => t.key === timePeriod)?.label ?? "All Time";
  }, [timePeriod, customRange]);

  const accountOptions = useMemo(() => activeAccounts.map((a: any) => ({
    id: a.id, username: a.username || "unknown", display_name: a.display_name,
    avatar_thumb_url: a.avatar_thumb_url, is_active: a.is_active,
  })), [activeAccounts]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground">Overview</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{periodLabel}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {TIME_PERIODS.map(tp => {
              const active = timePeriod === tp.key && !customRange;
              return (
                <button key={tp.key} onClick={() => { setTimePeriod(tp.key); setCustomRange(null); }}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {tp.label}
                </button>
              );
            })}
          </div>
          <AccountFilterDropdown value={modelFilter} onChange={setModelFilter} accounts={accountOptions} />
          <DateRangePicker value={customRange} onChange={setCustomRange} />
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {(["gross", "net"] as const).map(mode => (
              <button key={mode} onClick={() => setRevenueMode(mode)}
                className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${revenueMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ MAIN ROW: chart + KPI cards ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_268px] gap-4">

          {/* Monthly cash flow chart */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold text-foreground">Monthly Cash Flow</h2>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" />
                  Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#ef4444" }} />
                  Spend
                </span>
              </div>
            </div>

            {monthlyChartData.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                {isLoading ? "Loading…" : "No data yet"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={monthlyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={56} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="spend" name="Spend" stroke="#ef4444" strokeWidth={2} fill="url(#spendGrad)" dot={false} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Right KPI cards */}
          <div className="flex flex-col gap-4">
            <SummaryCard
              label="Total Revenue"
              value={isLoading ? "…" : fmtShort(totals.revenue)}
              sub={periodLabel}
              icon={<DollarSign className="h-4 w-4" />}
              bg="hsl(var(--primary) / 0.08)"
              iconColor="hsl(var(--primary))"
              sparkData={sparkLast6}
              sparkKey="revenue"
              sparkColor="hsl(var(--primary))"
              badge={revenueMode === "net" ? "NET" : undefined}
            />
            <SummaryCard
              label="Total Spend"
              value={isLoading ? "…" : totals.spend > 0 ? fmtShort(totals.spend) : "—"}
              sub={isAllTime ? "All time · ad spend" : `Est. · ${periodLabel}`}
              icon={<TrendingUp className="h-4 w-4" />}
              bg="hsl(38 92% 50% / 0.08)"
              iconColor="#f59e0b"
              sparkData={sparkLast6}
              sparkKey="spend"
              sparkColor="#f59e0b"
            />
            <SummaryCard
              label="Profit"
              value={isLoading ? "…" : totals.spend > 0 || totals.revenue > 0 ? fmtShort(totals.profit) : "—"}
              sub={totals.roi !== null ? `ROI ${totals.roi.toFixed(1)}%` : isAllTime ? "All time" : periodLabel}
              icon={<TrendingUp className="h-4 w-4" />}
              bg={totals.profit >= 0 ? "hsl(142 76% 36% / 0.08)" : "hsl(0 84% 60% / 0.08)"}
              iconColor={totals.profit >= 0 ? "#16a34a" : "#ef4444"}
              sparkData={sparkLast6}
              sparkKey="profit"
              sparkColor={totals.profit >= 0 ? "#16a34a" : "#ef4444"}
              badge={revenueMode === "net" ? "NET" : undefined}
            />
          </div>
        </div>

        {/* ═══ BOTTOM ROW: source breakdown + per-model bars ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">

          {/* Source breakdown */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="text-[14px] font-semibold text-foreground mb-5">Revenue by Source</h2>

            {sourceBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No tagged links</div>
            ) : (
              <div className="flex items-start gap-4">
                {/* Bars */}
                <div className="flex-1 space-y-4 min-w-0">
                  {sourceBreakdown.map((src, i) => (
                    <div key={src.name}>
                      <div className="flex items-center justify-between text-[12px] mb-1.5">
                        <span className="text-foreground font-medium truncate max-w-[160px]">{src.name}</span>
                        <span className="text-muted-foreground font-mono shrink-0 ml-2">{(src.pct * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${src.pct * 100}%`, background: SOURCE_COLORS[i] ?? "#6b7280" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Donut */}
                <div className="shrink-0 flex flex-col items-center justify-center" style={{ width: 140 }}>
                  <div className="relative" style={{ width: 140, height: 140 }}>
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie data={sourceBreakdown} cx="50%" cy="50%" innerRadius={42} outerRadius={62} dataKey="value" strokeWidth={0} paddingAngle={2}>
                          {sourceBreakdown.map((_, i) => (
                            <Cell key={i} fill={SOURCE_COLORS[i] ?? "#6b7280"} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[18px] font-bold text-foreground leading-tight">{sourceBreakdown.length}</span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Sources</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 text-center">{fmtC(sourcePieTotal)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Per-model revenue vs spend */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[14px] font-semibold text-foreground">Revenue vs Spend by Model</h2>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary inline-block" /> Revenue</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#f97316" }} /> Spend</span>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-5">
                {[...Array(4)].map((_, i) => (
                  <div key={i}>
                    <div className="skeleton-shimmer h-3 w-32 rounded mb-2" />
                    <div className="skeleton-shimmer h-2 rounded mb-1.5" />
                    <div className="skeleton-shimmer h-2 w-3/4 rounded" />
                  </div>
                ))}
              </div>
            ) : accountRows.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data</div>
            ) : (
              <div className="space-y-4">
                {accountRows.map(row => {
                  const revW = Math.min((row.revenue / maxValue) * 100, 100);
                  const spendW = Math.min((row.spend / maxValue) * 100, 100);
                  const isNeg = row.roi !== null && row.roi < 0;
                  const hasSpend = row.spend > 0;
                  return (
                    <div key={row.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <ModelAvatar avatarUrl={row.avatarUrl} name={row.username} size={24} />
                          <span className="text-[13px] font-medium text-foreground truncate">{row.displayName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {isNeg && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                          <span className={`text-[12px] font-mono font-semibold ${isNeg ? "text-destructive" : hasSpend ? "text-primary" : "text-muted-foreground"}`}>
                            {row.roi !== null ? `${row.roi.toFixed(0)}%` : "—"}
                          </span>
                        </div>
                      </div>
                      {/* Revenue bar */}
                      <div className="h-[7px] bg-muted rounded-sm mb-1 overflow-hidden">
                        <div className="h-full bg-primary rounded-sm transition-all duration-500" style={{ width: `${revW}%` }} />
                      </div>
                      {/* Spend bar */}
                      <div className="h-[7px] bg-muted rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-all duration-500"
                          style={{ width: `${spendW}%`, background: isNeg ? "#ef4444" : "#f97316" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom totals */}
            {!isLoading && accountRows.length > 0 && (
              <div className="mt-5 pt-4 border-t border-border flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Total</span>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-foreground">{fmtC(accountRows.reduce((s, r) => s + r.revenue, 0))}</span>
                  <span className="text-muted-foreground">rev</span>
                  <span className="font-mono text-muted-foreground">{fmtC(accountRows.reduce((s, r) => s + r.spend, 0))}</span>
                  <span className="text-muted-foreground">spend</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ EXTRA ROW: 5 summary pills ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <PillStat label="New Fans" value={isLoading ? "…" : fmtN(totals.fans)} sub={isAllTime ? "All time" : periodLabel} />
          <PillStat label="Subscribers" value={isLoading ? "…" : fmtN(allTimeFans)}
            sub={allTimeSubsPerDay ? `${allTimeSubsPerDay.toFixed(1)}/day · All time` : "All time"} />
          <PillStat label="LTV/Sub" value={globalLtvPerFan ? fmtC2(globalLtvPerFan) : "—"}
            sub={`All time · ${revenueMode === "net" ? "net" : "gross"}`} />
          <PillStat label="Profit" value={totals.spend > 0 ? fmtC(totals.profit) : "—"}
            sub={isAllTime ? "All time" : periodLabel}
            positive={totals.profit >= 0} />
          <PillStat label="ROI" value={totals.roi !== null ? `${totals.roi.toFixed(1)}%` : "—"}
            sub={isAllTime ? "All time" : periodLabel}
            positive={totals.roi !== null && totals.roi >= 0} />
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

function SummaryCard({
  label, value, sub, icon, bg, iconColor, sparkData, sparkKey, sparkColor, badge,
}: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  bg: string; iconColor: string; sparkData: any[]; sparkKey: string; sparkColor: string; badge?: string;
}) {
  return (
    <div className="rounded-2xl p-4 flex flex-col justify-between flex-1" style={{ background: bg, border: "1px solid hsl(var(--border))" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            {badge && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary">{badge}</span>}
          </div>
          <p className="text-[22px] font-semibold font-mono text-foreground leading-tight">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>
        </div>
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: iconColor + "22", color: iconColor }}>
          {icon}
        </div>
      </div>
      {sparkData.length > 1 && (
        <div className="-mx-1 mt-3">
          <ResponsiveContainer width="100%" height={44}>
            <LineChart data={sparkData}>
              <Line type="monotone" dataKey={sparkKey} stroke={sparkColor} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function PillStat({ label, value, sub, positive }: { label: string; value: string; sub: string; positive?: boolean }) {
  const valueColor = positive === true ? "text-primary" : positive === false ? "text-destructive" : "text-foreground";
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-[16px] font-semibold font-mono ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>
    </div>
  );
}

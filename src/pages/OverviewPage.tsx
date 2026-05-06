import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, Users, DollarSign, BarChart3, Percent } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ModelAvatar } from "@/components/ModelAvatar";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { fetchAccounts, fetchTrackingLinks, fetchTrackingLinkLtv } from "@/lib/supabase-helpers";
import { getSnapshotsByDateRange, getSnapshotLatestDate, getSnapshotAllTimeTotals } from "@/lib/api";
import { isActiveAccount, buildActiveLinkIdSet, filterLtvByActiveLinks } from "@/lib/calc-helpers";
import { usePageFilters, TIME_PERIODS } from "@/hooks/usePageFilters";

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  j: "#e11d48", m: "#0891b2", z: "#7c3aed", e: "#ea580c", a: "#2563eb",
  s: "#16a34a", d: "#9333ea", r: "#dc2626", k: "#0d9488", l: "#c026d3",
  f: "#f59e0b", b: "#6366f1",
};

function modelColor(name: string) {
  const first = (name || "?").replace("@", "").charAt(0).toLowerCase();
  return MODEL_COLORS[first] || "#6b7280";
}

const fmtC = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtC2 = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (v: number) => v.toLocaleString("en-US");

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
      const d = new Date(max + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
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
      return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        days: Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1),
      };
    }
    default: return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountRow {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  revenue: number;
  fans: number;
  spend: number;
  profit: number;
  roi: number | null;
  ltvPerFan: number | null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const {
    timePeriod, setTimePeriod,
    modelFilter, setModelFilter,
    customRange, setCustomRange,
    revenueMode, setRevenueMode,
    revMultiplier,
  } = usePageFilters();

  const isAllTime = timePeriod === "all" && !customRange;

  const periodKey = customRange
    ? `custom_${customRange.from.toISOString()}_${customRange.to.toISOString()}`
    : timePeriod;

  // ── Data queries ─────────────────────────────────────────────────────────

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  const { data: allLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: fetchTrackingLinks,
  });

  const { data: ltvRaw = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });

  const { data: allTimeTotals } = useQuery({
    queryKey: ["snapshot_alltime_totals", "all"],
    queryFn: () => getSnapshotAllTimeTotals(),
    staleTime: 5 * 60 * 1000,
  });

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

  const isLoading = linksLoading || (!isAllTime && snapshotsLoading);

  // ── Derived data ─────────────────────────────────────────────────────────

  const activeAccounts = useMemo(() => accounts.filter(isActiveAccount), [accounts]);

  const activeLinkIdSet = useMemo(() => buildActiveLinkIdSet(allLinks as any[]), [allLinks]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ltv = useMemo(
    () => filterLtvByActiveLinks(ltvRaw as any[], activeLinkIdSet),
    [ltvRaw, activeLinkIdSet]
  );

  const accountRows = useMemo<AccountRow[]>(() => {
    const today = new Date();
    const periodDays = periodData?.days ?? 1;
    const snapRows = (periodData?.rows ?? []) as any[];

    return activeAccounts
      .map((acc: any) => {
        const accLinks = (allLinks as any[]).filter((l: any) => l.account_id === acc.id);

        let revenue: number;
        let fans: number;
        let spend: number;

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
            const daysSince = Math.max(1, differenceInDays(today, new Date(l.created_at)));
            return s + (cost / daysSince) * periodDays;
          }, 0);
        }

        const profit = revenue - spend;
        const roi = spend > 0 ? (profit / spend) * 100 : null;
        const ltvPerFan = fans > 0 ? revenue / fans : null;

        return {
          id: acc.id,
          displayName: acc.display_name || acc.username || "Unknown",
          username: (acc.username || "unknown").replace("@", ""),
          avatarUrl: acc.avatar_thumb_url ?? null,
          revenue,
          fans,
          spend,
          profit,
          roi,
          ltvPerFan,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [activeAccounts, allLinks, periodData, isAllTime, revMultiplier]);

  // KPI totals — filtered by model dropdown
  const filteredRows = useMemo(
    () => (modelFilter === "all" ? accountRows : accountRows.filter(r => r.id === modelFilter)),
    [accountRows, modelFilter]
  );

  const totals = useMemo(() => {
    const revenue = filteredRows.reduce((s, r) => s + r.revenue, 0);
    const fans = filteredRows.reduce((s, r) => s + r.fans, 0);
    const spend = filteredRows.reduce((s, r) => s + r.spend, 0);
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    return { revenue, fans, spend, profit, roi };
  }, [filteredRows]);

  // All-time subscriber stats — always from allLinks regardless of period filter
  const allTimeFans = useMemo(() => {
    const acctIds = modelFilter === "all"
      ? new Set(activeAccounts.map((a: any) => a.id))
      : new Set([modelFilter]);
    return (allLinks as any[])
      .filter((l: any) => acctIds.has(l.account_id))
      .reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
  }, [allLinks, activeAccounts, modelFilter]);

  const allTimeSubsPerDay = useMemo(() => {
    const acctIds = modelFilter === "all"
      ? new Set(activeAccounts.map((a: any) => a.id))
      : new Set([modelFilter]);
    const earliest = (allLinks as any[])
      .filter((l: any) => acctIds.has(l.account_id) && l.created_at)
      .reduce((min: Date | null, l: any) => {
        const d = new Date(l.created_at);
        return !min || d < min ? d : min;
      }, null as Date | null);
    if (!earliest || allTimeFans === 0) return null;
    return allTimeFans / Math.max(1, differenceInDays(new Date(), earliest));
  }, [allLinks, activeAccounts, modelFilter, allTimeFans]);

  // Global LTV/Sub — always all-time from snapshot totals
  const globalLtvPerFan = useMemo(() => {
    if (allTimeTotals?.subscribers && allTimeTotals.subscribers > 0) {
      return (allTimeTotals.revenue * revMultiplier) / allTimeTotals.subscribers;
    }
    const totalRev = (allLinks as any[]).reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) * revMultiplier;
    const totalSubs = (allLinks as any[]).reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
    return totalSubs > 0 ? totalRev / totalSubs : null;
  }, [allTimeTotals, allLinks, revMultiplier]);

  // Chart data — always shows all models regardless of filter
  const pieData = useMemo(
    () =>
      accountRows
        .filter(r => r.revenue > 0)
        .map(r => ({ name: r.displayName, username: r.username, value: r.revenue, color: modelColor(r.username) })),
    [accountRows]
  );
  const pieTotal = pieData.reduce((s, r) => s + r.value, 0);

  const periodLabel = useMemo(() => {
    if (customRange)
      return `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`;
    return TIME_PERIODS.find(t => t.key === timePeriod)?.label ?? "All Time";
  }, [timePeriod, customRange]);

  const accountOptions = useMemo(
    () =>
      activeAccounts.map((a: any) => ({
        id: a.id,
        username: a.username || "unknown",
        display_name: a.display_name,
        avatar_thumb_url: a.avatar_thumb_url,
        is_active: a.is_active,
      })),
    [activeAccounts]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-[22px] font-medium text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{periodLabel}</p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {TIME_PERIODS.map(tp => {
              const active = timePeriod === tp.key && !customRange;
              return (
                <button
                  key={tp.key}
                  onClick={() => { setTimePeriod(tp.key); setCustomRange(null); }}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tp.label}
                </button>
              );
            })}
          </div>

          <AccountFilterDropdown
            value={modelFilter}
            onChange={setModelFilter}
            accounts={accountOptions}
          />

          <DateRangePicker value={customRange} onChange={setCustomRange} />

          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {(["gross", "net"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setRevenueMode(mode)}
                className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  revenueMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard hero label="Revenue" value={fmtC(totals.revenue)} sub={periodLabel}
            badge={revenueMode === "net" ? "NET" : "GROSS"}
            icon={<DollarSign className="h-4 w-4 text-white" />} loading={isLoading} />

          <KpiCard label="New Fans" value={isLoading ? "…" : fmtN(totals.fans)}
            sub={isAllTime ? "All time" : periodLabel}
            icon={<Users className="h-4 w-4 text-primary" />} loading={isLoading} />

          <KpiCard
            label="Subscribers"
            value={isLoading ? "…" : fmtN(allTimeFans)}
            sub={allTimeSubsPerDay !== null ? `${allTimeSubsPerDay.toFixed(1)} subs/day · All time` : "All time"}
            icon={<Users className="h-4 w-4 text-primary" />} loading={isLoading} />

          <KpiCard label="LTV/Sub" value={globalLtvPerFan !== null ? fmtC2(globalLtvPerFan) : "—"}
            sub="All time · revenue per new fan"
            badge={revenueMode === "net" ? "NET" : "GROSS"}
            icon={<TrendingUp className="h-4 w-4 text-primary" />} loading={isLoading} />

          <KpiCard label="Spend" value={totals.spend > 0 ? fmtC(totals.spend) : "—"}
            sub={isAllTime ? "All time · total ad spend" : `Est. · ${periodLabel}`}
            icon={<BarChart3 className="h-4 w-4 text-primary" />} loading={isLoading} />

          <KpiCard
            label="Profit"
            value={totals.spend > 0 || totals.revenue > 0 ? fmtC(totals.profit) : "—"}
            sub={isAllTime ? "All time · revenue minus spend" : periodLabel}
            badge={revenueMode === "net" ? "NET" : "GROSS"}
            positive={totals.profit >= 0}
            icon={<Percent className="h-4 w-4 text-primary" />} loading={isLoading} />
        </div>

        {/* Chart + Table */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">

          {/* Donut chart */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h2 className="text-[13px] font-semibold text-foreground mb-4">Revenue by Model</h2>
            {isLoading || pieData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                {isLoading ? "Loading…" : "No data"}
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: number, name: string) => [
                        `${fmtC(value)} · ${pieTotal > 0 ? ((value / pieTotal) * 100).toFixed(1) : 0}%`,
                        name,
                      ]}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "hsl(var(--foreground))",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-3 space-y-2">
                  {pieData.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                        <span className="text-foreground font-medium truncate max-w-[140px]">{entry.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-muted-foreground font-mono">{fmtC(entry.value)}</span>
                        <span className="text-muted-foreground w-10 text-right">
                          {pieTotal > 0 ? `${((entry.value / pieTotal) * 100).toFixed(0)}%` : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Per-model table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-[13px] font-semibold text-foreground">Per Model Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Model", "Revenue", "New Fans", "LTV/Sub", "Spend", "Profit", "ROI"].map(col => (
                      <th
                        key={col}
                        className={`py-3 px-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${
                          col === "Model" ? "text-left" : "text-right"
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-3 px-4">
                          <div className="skeleton-shimmer h-4 w-32 rounded" />
                        </td>
                        {[...Array(6)].map((_, j) => (
                          <td key={j} className="py-3 px-4 text-right">
                            <div className="skeleton-shimmer h-4 w-16 rounded ml-auto" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : accountRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">
                        No data
                      </td>
                    </tr>
                  ) : (
                    accountRows.map(row => {
                      const highlighted = modelFilter === row.id;
                      const hasSpend = row.spend > 0;
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                            highlighted ? "bg-primary/5" : ""
                          }`}
                        >
                          {/* Model */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <ModelAvatar avatarUrl={row.avatarUrl} name={row.username} size={30} />
                              <div>
                                <div className="text-[13px] font-medium text-foreground leading-tight">
                                  {row.displayName}
                                </div>
                                <div className="text-[11px] text-muted-foreground">@{row.username}</div>
                              </div>
                            </div>
                          </td>

                          {/* Revenue */}
                          <td className="py-3 px-4 text-right font-mono text-[13px] text-foreground">
                            {fmtC(row.revenue)}
                          </td>

                          {/* New Fans */}
                          <td className="py-3 px-4 text-right font-mono text-[13px] text-foreground">
                            {fmtN(row.fans)}
                          </td>

                          {/* LTV/Sub */}
                          <td className="py-3 px-4 text-right font-mono text-[13px] text-foreground">
                            {row.ltvPerFan !== null ? fmtC2(row.ltvPerFan) : "—"}
                          </td>

                          {/* Spend */}
                          <td className="py-3 px-4 text-right font-mono text-[13px] text-muted-foreground">
                            {hasSpend ? fmtC(row.spend) : "—"}
                          </td>

                          {/* Profit */}
                          <td className={`py-3 px-4 text-right font-mono text-[13px] ${
                            !hasSpend ? "text-muted-foreground" : row.profit >= 0 ? "text-primary" : "text-destructive"
                          }`}>
                            {hasSpend ? fmtC(row.profit) : "—"}
                          </td>

                          {/* ROI */}
                          <td className={`py-3 px-4 text-right font-mono text-[13px] ${
                            row.roi === null ? "text-muted-foreground" : row.roi >= 0 ? "text-primary" : "text-destructive"
                          }`}>
                            {row.roi !== null ? `${row.roi.toFixed(0)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Totals row */}
                {!isLoading && accountRows.length > 1 && (() => {
                  const totalRevenue = accountRows.reduce((s, r) => s + r.revenue, 0);
                  const totalFans = accountRows.reduce((s, r) => s + r.fans, 0);
                  const totalSpend = accountRows.reduce((s, r) => s + r.spend, 0);
                  const totalProfit = totalRevenue - totalSpend;
                  const totalRoi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : null;
                  return (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/20">
                        <td className="py-3 px-4 text-[12px] font-semibold text-muted-foreground">
                          Total
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[13px] font-semibold text-foreground">
                          {fmtC(totalRevenue)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[13px] font-semibold text-foreground">
                          {fmtN(totalFans)}
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">—</td>
                        <td className="py-3 px-4 text-right font-mono text-[13px] font-semibold text-muted-foreground">
                          {totalSpend > 0 ? fmtC(totalSpend) : "—"}
                        </td>
                        <td className={`py-3 px-4 text-right font-mono text-[13px] font-semibold ${
                          totalSpend === 0 ? "text-muted-foreground" : totalProfit >= 0 ? "text-primary" : "text-destructive"
                        }`}>
                          {totalSpend > 0 ? fmtC(totalProfit) : "—"}
                        </td>
                        <td className={`py-3 px-4 text-right font-mono text-[13px] font-semibold ${
                          totalRoi === null ? "text-muted-foreground" : totalRoi >= 0 ? "text-primary" : "text-destructive"
                        }`}>
                          {totalRoi !== null ? `${totalRoi.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, badge, hero, positive, loading,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  badge?: string;
  hero?: boolean;
  positive?: boolean;
  loading?: boolean;
}) {
  const shimmer = (
    <>
      <div className="skeleton-shimmer h-7 w-24 rounded mb-1" />
      <div className="skeleton-shimmer h-3 w-32 rounded mt-2" />
    </>
  );

  if (hero) {
    return (
      <div
        className="rounded-2xl p-5 flex flex-col"
        style={{
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">{icon}</div>
          <span className="text-[11px] text-white/80 font-medium uppercase tracking-wider">{label}</span>
          {badge && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/10 text-white/60">
              {badge}
            </span>
          )}
        </div>
        {loading ? shimmer : (
          <>
            <p className="text-[20px] font-medium font-mono text-white">{value}</p>
            <p className="text-[11px] text-white/60 mt-1">{sub}</p>
          </>
        )}
      </div>
    );
  }

  const valueColor =
    positive === true ? "text-primary"
    : positive === false ? "text-destructive"
    : "text-foreground";

  return (
    <div
      className="bg-card border border-border rounded-2xl p-5 flex flex-col"
      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">{icon}</div>
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
        {badge && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
            {badge}
          </span>
        )}
      </div>
      {loading ? shimmer : (
        <>
          <p className={`text-[20px] font-medium font-mono ${valueColor}`}>{value}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
        </>
      )}
    </div>
  );
}

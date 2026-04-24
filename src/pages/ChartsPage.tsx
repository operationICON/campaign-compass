import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchDailyMetrics, fetchTrackingLinks, fetchAccounts, fetchTransactions } from "@/lib/supabase-helpers";
import { usePageFilters } from "@/hooks/usePageFilters";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { PageFilterBar } from "@/components/PageFilterBar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format, subDays } from "date-fns";
import { RefreshButton } from "@/components/RefreshButton";
import { ModelAvatar } from "@/components/ModelAvatar";
import { calcStatus } from "@/lib/calc-helpers";

// ── Palette ───────────────────────────────────────────────────────────────────
const MODEL_COLORS = ["#0891b2", "#16a34a", "#d97706", "#7c3aed", "#ec4899", "#f97316", "#64748b"];
const STATUS_COLORS: Record<string, string> = {
  SCALE: "#16a34a", WATCH: "#0891b2", LOW: "#d97706",
  KILL: "#dc2626", NO_SPEND: "#94a3b8", TESTING: "#64748b", INACTIVE: "#475569",
};
const CAT_COLORS: Record<string, string> = {
  OnlyTraffic: "#0891b2", Manual: "#d97706", Untagged: "#94a3b8",
};

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCShort = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
const fmtP = (v: number) => `${v.toFixed(1)}%`;
const fmtN = (v: number) => v.toLocaleString("en-US");

const TT: any = {
  contentStyle: {
    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
    borderRadius: 10, color: "hsl(var(--foreground))", fontSize: 12,
  },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { timePeriod, setTimePeriod, modelFilter, setModelFilter, customRange, setCustomRange, revenueMode, setRevenueMode } = usePageFilters();
  const { snapshotLookup, isLoading: snapshotLoading } = useSnapshotMetrics(timePeriod, customRange);

  const { data: metrics = [], isLoading: metricsLoading } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: rawLinks = [], isLoading: linksLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions"], queryFn: () => fetchTransactions() });

  const isLoading = metricsLoading || linksLoading || accountsLoading || snapshotLoading;

  const links = useMemo(() => applySnapshotToLinks(rawLinks as any[], snapshotLookup), [rawLinks, snapshotLookup]);

  // Filter by model if selected
  const filteredLinks = useMemo(() => {
    if (modelFilter === "all") return links;
    return links.filter((l: any) => l.account_id === modelFilter);
  }, [links, modelFilter]);

  const accountColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accounts as any[]).forEach((a, i) => { map[a.id] = MODEL_COLORS[i % MODEL_COLORS.length]; });
    return map;
  }, [accounts]);

  const accountNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accounts as any[]).forEach(a => { map[a.id] = a.display_name || a.username || a.id; });
    return map;
  }, [accounts]);

  const modelNames = useMemo(() => (accounts as any[]).map(a => a.display_name || a.username || a.id), [accounts]);

  // ── Summary KPIs ─────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const revenue = filteredLinks.reduce((s, l: any) => s + Number(l.revenue || 0), 0);
    const spend = filteredLinks.reduce((s, l: any) => s + Number(l.cost_total || 0), 0);
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    const subs = filteredLinks.reduce((s, l: any) => s + (l.subscribers || 0), 0);
    const withSpend = filteredLinks.filter((l: any) => Number(l.cost_total || 0) > 0).length;
    return { revenue, spend, profit, roi, subs, withSpend };
  }, [filteredLinks]);

  // ── Daily Revenue + Subscribers Trend (30 days) ───────────────────────────
  const dailyTrend = useMemo(() => {
    const today = new Date();
    const keys: string[] = [];
    for (let i = 29; i >= 0; i--) keys.push(format(subDays(today, i), "yyyy-MM-dd"));
    const rows: Record<string, any> = {};
    keys.forEach(d => { rows[d] = { date: format(new Date(d + "T00:00:00"), "MMM d"), revenue: 0, subscribers: 0 }; });
    (metrics as any[]).forEach(m => {
      if (!rows[m.date]) return;
      rows[m.date].revenue += Number(m.revenue || 0);
      rows[m.date].subscribers += Number(m.subscribers || 0);
    });
    return Object.values(rows);
  }, [metrics]);

  // ── Daily Revenue by Model ────────────────────────────────────────────────
  const dailyRevenueByModel = useMemo(() => {
    const today = new Date();
    const keys: string[] = [];
    for (let i = 29; i >= 0; i--) keys.push(format(subDays(today, i), "yyyy-MM-dd"));
    const rows: Record<string, any> = {};
    keys.forEach(d => { rows[d] = { date: format(new Date(d + "T00:00:00"), "MMM d") }; });
    (metrics as any[]).forEach(m => {
      if (!rows[m.date]) return;
      const name = accountNameMap[m.account_id] || m.account_id;
      rows[m.date][name] = (rows[m.date][name] || 0) + Number(m.revenue || 0);
    });
    return Object.values(rows);
  }, [metrics, accountNameMap]);

  // ── Daily Subscribers by Model ────────────────────────────────────────────
  const dailySubsByModel = useMemo(() => {
    const today = new Date();
    const keys: string[] = [];
    for (let i = 29; i >= 0; i--) keys.push(format(subDays(today, i), "yyyy-MM-dd"));
    const rows: Record<string, any> = {};
    keys.forEach(d => { rows[d] = { date: format(new Date(d + "T00:00:00"), "MMM d") }; });
    (metrics as any[]).forEach(m => {
      if (!rows[m.date]) return;
      const name = accountNameMap[m.account_id] || m.account_id;
      rows[m.date][name] = (rows[m.date][name] || 0) + Number(m.subscribers || 0);
    });
    return Object.values(rows);
  }, [metrics, accountNameMap]);

  // ── Top 10 by ROI ─────────────────────────────────────────────────────────
  const topByRoi = useMemo(() => {
    return filteredLinks
      .filter((l: any) => Number(l.cost_total || 0) > 0)
      .map((l: any) => {
        const rev = Number(l.revenue || 0);
        const spend = Number(l.cost_total || 0);
        const roi = ((rev - spend) / spend) * 100;
        const status = calcStatus(l);
        return { name: (l.campaign_name || "Unknown").slice(0, 30), roi, status, color: STATUS_COLORS[status] || "#94a3b8" };
      })
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 10);
  }, [filteredLinks]);

  // ── Top 10 by Revenue ─────────────────────────────────────────────────────
  const topByRevenue = useMemo(() => {
    return [...filteredLinks]
      .sort((a: any, b: any) => Number(b.revenue || 0) - Number(a.revenue || 0))
      .slice(0, 10)
      .map((l: any, i: number) => ({
        name: (l.campaign_name || "Unknown").slice(0, 30),
        revenue: Number(l.revenue || 0),
        spend: Number(l.cost_total || 0),
        color: accountColorMap[l.account_id] || MODEL_COLORS[i % MODEL_COLORS.length],
      }));
  }, [filteredLinks, accountColorMap]);

  // ── Revenue & Spend by Traffic Category ──────────────────────────────────
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { revenue: number; spend: number }> = {
      OnlyTraffic: { revenue: 0, spend: 0 },
      Manual: { revenue: 0, spend: 0 },
      Untagged: { revenue: 0, spend: 0 },
    };
    filteredLinks.forEach((l: any) => {
      const cat = l.traffic_category === "OnlyTraffic" ? "OnlyTraffic"
        : l.traffic_category ? "Manual" : "Untagged";
      map[cat].revenue += Number(l.revenue || 0);
      map[cat].spend += Number(l.cost_total || 0);
    });
    return Object.entries(map)
      .filter(([, v]) => v.revenue > 0 || v.spend > 0)
      .map(([name, v]) => ({ name, revenue: v.revenue, spend: v.spend }));
  }, [filteredLinks]);

  // ── Campaign Status Distribution ──────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLinks.forEach((l: any) => {
      const s = calcStatus(l);
      map[s] = (map[s] || 0) + 1;
    });
    const order = ["SCALE", "WATCH", "LOW", "KILL", "NO_SPEND", "TESTING", "INACTIVE"];
    return order.filter(s => map[s] > 0).map(s => ({ name: s, count: map[s], color: STATUS_COLORS[s] }));
  }, [filteredLinks]);

  // ── Revenue by Transaction Type ───────────────────────────────────────────
  const txByType = useMemo(() => {
    const map: Record<string, number> = {};
    (transactions as any[]).forEach(t => {
      const type = (t.type || "other").replace(/_/g, " ");
      map[type] = (map[type] || 0) + Number(t.revenue || 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [transactions]);
  const totalTx = txByType.reduce((s, r) => s + r.value, 0);

  // ── Model legend renderer ─────────────────────────────────────────────────
  const ModelLegend = ({ payload }: any) => (
    <div className="flex flex-wrap gap-3 justify-center mt-1">
      {(payload || []).map((entry: any) => {
        const acc = (accounts as any[]).find(a => a.display_name === entry.value || a.username === entry.value);
        return (
          <div key={entry.value} className="flex items-center gap-1.5">
            <ModelAvatar avatarUrl={acc?.avatar_thumb_url} name={entry.value} size={16} />
            <span style={{ color: entry.color, fontSize: 11 }}>{entry.value}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Charts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Visual performance overview across campaigns and models</p>
          </div>
          <RefreshButton queryKeys={["daily_metrics", "tracking_links", "accounts", "transactions"]} />
        </div>

        <PageFilterBar
          timePeriod={timePeriod}
          onTimePeriodChange={setTimePeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          modelFilter={modelFilter}
          onModelFilterChange={setModelFilter}
          accounts={(accounts as any[]).map(a => ({ id: a.id, username: a.username || "", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
          revenueMode={revenueMode}
          onRevenueModeChange={setRevenueMode}
        />

        {/* Summary Strip */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard label="Revenue" value={fmtCShort(summary.revenue)} color="#16a34a" />
            <SummaryCard label="Spend" value={fmtCShort(summary.spend)} color="#dc2626" />
            <SummaryCard label="Profit" value={fmtCShort(summary.profit)} color={summary.profit >= 0 ? "#16a34a" : "#dc2626"} />
            <SummaryCard label="ROI" value={summary.roi != null ? fmtP(summary.roi) : "—"} color={(summary.roi ?? 0) >= 0 ? "#16a34a" : "#dc2626"} />
            <SummaryCard label="Subscribers" value={fmtN(summary.subs)} color="#7c3aed" />
            <SummaryCard label="Paid Campaigns" value={fmtN(summary.withSpend)} color="#0891b2" />
          </div>
        )}

        {/* Row 1 — Full-width: Revenue & Subscriber Trend */}
        <ChartCard title="Revenue & Subscribers — Last 30 Days" description="Daily total revenue (area) and new subscribers (line)">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={dailyTrend} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} width={56} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={36} />
              <Tooltip {...TT} formatter={(v: number, name: string) => name === "revenue" ? [fmtC(v), "Revenue"] : [fmtN(v), "Subs"]} />
              <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} fill="url(#revGrad)" />
              <Line yAxisId="right" type="monotone" dataKey="subscribers" stroke="#7c3aed" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Row 2 — Revenue by Model | Subscribers by Model */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Revenue by Model — Last 30 Days" description="Stacked daily revenue per model">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyRevenueByModel} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} width={52} />
                <Tooltip {...TT} formatter={(v: number, name: string) => [fmtC(v), name]} />
                <Legend content={<ModelLegend />} />
                {modelNames.map((name: string, i: number) => (
                  <Area key={name} type="monotone" dataKey={name} stackId="1"
                    stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
                    fill={MODEL_COLORS[i % MODEL_COLORS.length]} fillOpacity={0.4} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Subscribers by Model — Last 30 Days" description="Stacked daily new subscribers per model">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailySubsByModel} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={36} />
                <Tooltip {...TT} />
                <Legend content={<ModelLegend />} />
                {modelNames.map((name: string, i: number) => (
                  <Area key={name} type="monotone" dataKey={name} stackId="1"
                    stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
                    fill={MODEL_COLORS[i % MODEL_COLORS.length]} fillOpacity={0.4} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Row 3 — Top 10 by ROI | Top 10 by Revenue */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Top 10 Campaigns by ROI" description="Only campaigns with spend. Color = status badge.">
            {topByRoi.length === 0 ? (
              <Empty text="No campaigns with spend data" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topByRoi} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={150} />
                  <Tooltip {...TT} formatter={(v: number, _: string, p: any) => [`${v.toFixed(1)}% (${p.payload.status})`, "ROI"]} />
                  <Bar dataKey="roi" radius={[0, 4, 4, 0]}>
                    {topByRoi.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Top 10 Campaigns by Revenue" description="Highest earning campaigns. Color = model.">
            {topByRevenue.length === 0 ? (
              <Empty text="No revenue data" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topByRevenue} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={150} />
                  <Tooltip {...TT} formatter={(v: number) => [fmtC(v), "Revenue"]} />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {topByRevenue.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Row 4 — Traffic Category Breakdown | Portfolio Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Revenue & Spend by Traffic Category" description="How revenue and spend are distributed across traffic types">
            {categoryBreakdown.length === 0 ? (
              <Empty text="No traffic category data" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={categoryBreakdown} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} width={56} />
                  <Tooltip {...TT} formatter={(v: number, name: string) => [fmtC(v), name === "revenue" ? "Revenue" : "Spend"]} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#16a34a" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="spend" name="Spend" fill="#dc2626" fillOpacity={0.75} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Campaign Portfolio Health" description="How many campaigns fall into each performance status">
            {statusCounts.length === 0 ? (
              <Empty text="No campaign data" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={statusCounts} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} allowDecimals={false} width={36} />
                  <Tooltip {...TT} formatter={(v: number) => [v, "Campaigns"]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {statusCounts.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Row 5 — Transaction Type Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Revenue by Transaction Type" description="How revenue breaks down across subscription types">
            {txByType.length === 0 ? (
              <Empty text="No transaction data" />
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="60%" height={220}>
                  <PieChart>
                    <Pie data={txByType} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" nameKey="name">
                      {txByType.map((_, i) => <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />)}
                    </Pie>
                    <Tooltip {...TT} formatter={(v: number) => [fmtC(v), "Revenue"]} />
                    <text x="50%" y="47%" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10}>Total</text>
                    <text x="50%" y="56%" textAnchor="middle" fill="hsl(var(--foreground))" fontSize={15} fontWeight="bold">
                      {fmtCShort(totalTx)}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {txByType.map((t, i) => (
                    <div key={t.name} className="flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                        <span className="text-muted-foreground capitalize truncate">{t.name}</span>
                      </div>
                      <span className="font-mono font-semibold text-foreground shrink-0">{fmtC(t.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>

          {/* Spend by Traffic Category donut */}
          <ChartCard title="Spend Distribution" description="How total spend is split across traffic categories">
            {categoryBreakdown.length === 0 ? (
              <Empty text="No spend data" />
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="60%" height={220}>
                  <PieChart>
                    <Pie
                      data={categoryBreakdown.filter(c => c.spend > 0)}
                      cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                      dataKey="spend" nameKey="name"
                    >
                      {categoryBreakdown.filter(c => c.spend > 0).map((entry, i) => (
                        <Cell key={i} fill={CAT_COLORS[entry.name] || MODEL_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip {...TT} formatter={(v: number) => [fmtC(v), "Spend"]} />
                    <text x="50%" y="47%" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10}>Total</text>
                    <text x="50%" y="56%" textAnchor="middle" fill="hsl(var(--foreground))" fontSize={15} fontWeight="bold">
                      {fmtCShort(categoryBreakdown.reduce((s, c) => s + c.spend, 0))}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {categoryBreakdown.filter(c => c.spend > 0).map(c => (
                    <div key={c.name} className="flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CAT_COLORS[c.name] || "#94a3b8" }} />
                        <span className="text-muted-foreground">{c.name}</span>
                      </div>
                      <span className="font-mono font-semibold text-foreground">{fmtC(c.spend)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>
        </div>

      </div>
    </DashboardLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3" style={{ borderTop: `3px solid ${color}` }}>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className="font-mono font-bold text-lg text-foreground">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">{text}</div>
  );
}

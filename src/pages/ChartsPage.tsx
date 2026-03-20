import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchDailyMetrics, fetchTrackingLinks, fetchAccounts, fetchTransactions } from "@/lib/supabase-helpers";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { format, subDays } from "date-fns";

const MODEL_COLORS = ["hsl(24,95%,53%)", "hsl(40,96%,53%)", "hsl(0,72%,51%)", "hsl(15,80%,45%)", "hsl(30,75%,40%)", "hsl(38,92%,50%)", "hsl(263,70%,50%)"];
const TYPE_COLORS = ["hsl(24,95%,53%)", "hsl(40,96%,53%)", "hsl(0,72%,51%)", "hsl(38,92%,50%)", "hsl(263,70%,50%)"];

const tooltipStyle = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 14, color: "hsl(var(--foreground))", fontSize: 12 },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

export default function ChartsPage() {
  const { data: metrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions"], queryFn: () => fetchTransactions() });

  // Map account IDs to colors consistently
  const accountColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a: any, i: number) => { map[a.id] = MODEL_COLORS[i % MODEL_COLORS.length]; });
    return map;
  }, [accounts]);

  const accountNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a: any) => { map[a.id] = a.display_name; });
    return map;
  }, [accounts]);

  // Multi-line revenue chart per model (last 30 days)
  const dailyRevenueByModel = useMemo(() => {
    const today = new Date();
    const dateKeys: string[] = [];
    for (let i = 29; i >= 0; i--) dateKeys.push(format(subDays(today, i), "yyyy-MM-dd"));

    const rows: Record<string, any> = {};
    dateKeys.forEach(d => { rows[d] = { date: format(new Date(d), "MMM d") }; });

    metrics.forEach((m: any) => {
      if (!rows[m.date]) return;
      const accId = m.account_id;
      const name = accountNameMap[accId] || accId;
      rows[m.date][name] = (rows[m.date][name] || 0) + Number(m.revenue);
    });
    return Object.values(rows);
  }, [metrics, accountNameMap]);

  const modelNames = useMemo(() => accounts.map((a: any) => a.display_name), [accounts]);

  // Revenue by transaction type (donut)
  const revenueByType = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach((t: any) => {
      const type = t.type || "other";
      map[type] = (map[type] || 0) + Number(t.revenue);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [transactions]);
  const totalTxRevenue = useMemo(() => revenueByType.reduce((s, r) => s + r.value, 0), [revenueByType]);

  // Top 10 campaigns bar
  const topCampaigns = useMemo(() => {
    return [...links]
      .sort((a: any, b: any) => Number(b.revenue) - Number(a.revenue))
      .slice(0, 10)
      .map((l: any) => ({
        name: (l.campaign_name || "Unknown").slice(0, 30),
        revenue: Number(l.revenue),
        color: accountColorMap[l.account_id] || MODEL_COLORS[0],
      }));
  }, [links, accountColorMap]);

  // Daily subscribers area chart per model
  const dailySubsByModel = useMemo(() => {
    const today = new Date();
    const dateKeys: string[] = [];
    for (let i = 29; i >= 0; i--) dateKeys.push(format(subDays(today, i), "yyyy-MM-dd"));

    const rows: Record<string, any> = {};
    dateKeys.forEach(d => { rows[d] = { date: format(new Date(d), "MMM d") }; });

    metrics.forEach((m: any) => {
      if (!rows[m.date]) return;
      const name = accountNameMap[m.account_id] || m.account_id;
      rows[m.date][name] = (rows[m.date][name] || 0) + Number(m.subscribers);
    });
    return Object.values(rows);
  }, [metrics, accountNameMap]);

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Revenue Charts</h1>
          <p className="text-sm text-muted-foreground">Visual analytics across all accounts</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 30-day Revenue by Model - Multi Line */}
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h2 className="text-sm font-bold text-foreground mb-4">Daily Revenue by Model (30 Days)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailyRevenueByModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, ""]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {modelNames.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={MODEL_COLORS[i % MODEL_COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Revenue by Type Donut */}
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h2 className="text-sm font-bold text-foreground mb-4">Revenue by Transaction Type</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={revenueByType} cx="50%" cy="50%" innerRadius={70} outerRadius={110}
                  dataKey="value" nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: "hsl(var(--muted-foreground))" }}
                >
                  {revenueByType.map((_, i) => (
                    <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />
                {/* Center text */}
                <text x="50%" y="47%" textAnchor="middle" fill="#888" fontSize={11}>Total</text>
                <text x="50%" y="55%" textAnchor="middle" fill="#fff" fontSize={16} fontWeight="bold">
                  ${totalTxRevenue >= 1000 ? `${(totalTxRevenue/1000).toFixed(1)}k` : totalTxRevenue.toFixed(0)}
                </text>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Top 10 Campaigns */}
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h2 className="text-sm font-bold text-foreground mb-4">Top 10 Campaigns by Revenue</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topCampaigns} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" tick={{ fill: "#888", fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#888", fontSize: 9 }} width={160} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {topCampaigns.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Daily Subscribers Area */}
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h2 className="text-sm font-bold text-foreground mb-4">Daily Subscribers by Model (30 Days)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailySubsByModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: "#888", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#888", fontSize: 10 }} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />
                {modelNames.map((name, i) => (
                  <Area key={name} type="monotone" dataKey={name} stackId="1" stroke={MODEL_COLORS[i % MODEL_COLORS.length]} fill={MODEL_COLORS[i % MODEL_COLORS.length]} fillOpacity={0.3} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

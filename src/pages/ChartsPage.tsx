import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchDailyMetrics, fetchTrackingLinks, fetchAccounts, fetchTransactions } from "@/lib/supabase-helpers";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subDays } from "date-fns";

const COLORS = ["#059669", "#34d399", "#f59e0b", "#ef4444", "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6"];

export default function ChartsPage() {
  const { data: metrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions"], queryFn: () => fetchTransactions() });

  // Line chart: daily revenue last 30 days
  const dailyRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = format(subDays(today, i), "yyyy-MM-dd");
      map[d] = 0;
    }
    metrics.forEach((m: any) => {
      if (map[m.date] !== undefined) map[m.date] += Number(m.revenue);
    });
    return Object.entries(map).map(([date, revenue]) => ({ date: format(new Date(date), "MMM d"), revenue }));
  }, [metrics]);

  // Bar chart: revenue by account
  const revenueByAccount = useMemo(() => {
    const map: Record<string, { name: string; revenue: number }> = {};
    accounts.forEach((a: any) => { map[a.id] = { name: a.display_name, revenue: 0 }; });
    links.forEach((l: any) => {
      if (map[l.account_id]) map[l.account_id].revenue += Number(l.revenue);
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [links, accounts]);

  // Bar chart: top 10 campaigns
  const topCampaigns = useMemo(() => {
    return [...links]
      .sort((a: any, b: any) => Number(b.revenue) - Number(a.revenue))
      .slice(0, 10)
      .map((l: any) => ({ name: (l.campaign_name || "Unknown").slice(0, 25), revenue: Number(l.revenue) }));
  }, [links]);

  // Pie chart: revenue by transaction type
  const revenueByType = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach((t: any) => {
      const type = t.type || "other";
      map[type] = (map[type] || 0) + Number(t.revenue);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const tooltipStyle = {
    contentStyle: { background: "#111113", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, color: "#fff", fontSize: 12 },
    labelStyle: { color: "#888" },
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Revenue Charts</h1>
          <p className="text-sm text-muted-foreground">Visual analytics across all accounts</p>
        </div>

        {/* Daily Revenue Line Chart */}
        <div className="bg-card border border-border rounded-[10px] p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Daily Revenue (Last 30 Days)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: "#888", fontSize: 11 }} />
              <YAxis tick={{ fill: "#888", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
              <Line type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* Revenue by Account */}
          <div className="bg-card border border-border rounded-[10px] p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Revenue by Model</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={revenueByAccount}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 11 }} />
                <YAxis tick={{ fill: "#888", fontSize: 11 }} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top 10 Campaigns */}
          <div className="bg-card border border-border rounded-[10px] p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Top 10 Campaigns by Revenue</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topCampaigns} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" tick={{ fill: "#888", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#888", fontSize: 10 }} width={150} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#34d399" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue by Transaction Type */}
        <div className="bg-card border border-border rounded-[10px] p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Revenue by Transaction Type</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={revenueByType} cx="50%" cy="50%" outerRadius={100} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {revenueByType.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#888" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </DashboardLayout>
  );
}

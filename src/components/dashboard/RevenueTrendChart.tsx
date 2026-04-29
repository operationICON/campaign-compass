import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { format, subDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { getSnapshotsByDateRange } from "@/lib/api";
import { TrendingUp } from "lucide-react";

const fmtRevAxis = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}k`
  : `$${v.toFixed(0)}`;

const fmtRevTip = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtXDate(d: string, totalPoints: number) {
  try {
    const dt = new Date(d + "T00:00:00Z");
    if (totalPoints <= 8)  return format(dt, "EEE d");   // Mon 1
    if (totalPoints <= 35) return format(dt, "MMM d");   // Apr 1
    return format(dt, "MMM d");
  } catch { return d; }
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    color: "hsl(var(--foreground))",
    fontSize: 12,
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
  },
  labelStyle: { color: "hsl(var(--muted-foreground))", marginBottom: 6, fontWeight: 600 },
  cursor: { stroke: "hsl(var(--border))", strokeWidth: 1 },
};

interface Props {
  snapshotRows: any[];
  isLoading: boolean;
  isAllTime: boolean;
  agencyAccountIds: string[] | null;
  revMultiplier: number;
}

export function RevenueTrendChart({ snapshotRows, isLoading, isAllTime, agencyAccountIds, revMultiplier }: Props) {
  // For All Time mode — fetch last 30 days for direction context
  const { data: allTimeRows = [], isLoading: allTimeLoading } = useQuery({
    queryKey: ["trend_chart_30d", agencyAccountIds?.join(",") ?? "all"],
    queryFn: () => {
      const to = new Date().toISOString().slice(0, 10);
      const from = subDays(new Date(), 29).toISOString().slice(0, 10);
      return getSnapshotsByDateRange({
        date_from: from,
        date_to: to,
        account_ids: agencyAccountIds ?? undefined,
        cols: "slim",
      });
    },
    enabled: isAllTime,
    staleTime: 300_000,
  });

  const rows = isAllTime ? allTimeRows : snapshotRows;
  const loading = isLoading || (isAllTime && allTimeLoading);

  // Aggregate: multiple rows per day (one per tracking link) → sum per date
  const chartData = useMemo(() => {
    const byDate = new Map<string, { date: string; revenue: number; subs: number; spend: number }>();
    for (const row of rows) {
      const d = String(row.date ?? "").slice(0, 10);
      if (!d) continue;
      const existing = byDate.get(d) ?? { date: d, revenue: 0, subs: 0, spend: 0 };
      existing.revenue += Number(row.revenue ?? 0) * revMultiplier;
      existing.subs    += Number(row.subscribers ?? 0);
      existing.spend   += Number((row as any).cost_total ?? 0);
      byDate.set(d, existing);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, revMultiplier]);

  const total = chartData.length;
  const tickInterval = total <= 8 ? 0 : total <= 14 ? 1 : total <= 31 ? 4 : 13;

  // Summary stats for header chips
  const totalRev  = chartData.reduce((s, d) => s + d.revenue, 0);
  const totalSubs = chartData.reduce((s, d) => s + d.subs,    0);

  // Trend direction: compare first half vs second half
  const mid = Math.floor(chartData.length / 2);
  const firstHalfRev  = chartData.slice(0, mid).reduce((s, d) => s + d.revenue, 0);
  const secondHalfRev = chartData.slice(mid).reduce((s, d) => s + d.revenue, 0);
  const trendUp = secondHalfRev >= firstHalfRev;

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex flex-col items-center justify-center h-52 gap-3">
        <TrendingUp className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground text-center">
          No snapshot data for this period.<br />Run a Dashboard Sync to build the trend chart.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Revenue Trend</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            trendUp
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-red-500/15 text-red-400"
          }`}>
            {trendUp ? "↑ trending up" : "↓ trending down"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="hidden sm:flex items-center gap-1.5">
            <span className="text-foreground font-semibold tabular-nums">{fmtRevTip(totalRev)}</span>
            revenue
          </span>
          <span className="hidden sm:flex items-center gap-1.5">
            <span className="text-emerald-500 font-semibold tabular-nums">{totalSubs.toLocaleString()}</span>
            new subs
          </span>
          <span className="text-[10px] opacity-60">
            {isAllTime ? "last 30 days" : `${total} days`}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded bg-cyan-400 inline-block" />
          Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded bg-emerald-500 inline-block" />
          New Subs
        </span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            interval={tickInterval}
            tickFormatter={d => fmtXDate(d, total)}
          />

          {/* Left Y: revenue */}
          <YAxis
            yAxisId="rev"
            orientation="left"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={fmtRevAxis}
            width={48}
          />

          {/* Right Y: subs */}
          <YAxis
            yAxisId="subs"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            width={32}
          />

          <Tooltip
            {...TOOLTIP_STYLE}
            labelFormatter={d => {
              try { return format(new Date(d + "T00:00:00Z"), "EEEE, MMM d yyyy"); }
              catch { return d; }
            }}
            formatter={(value: number, name: string) => {
              if (name === "revenue") return [fmtRevTip(value), "Revenue"];
              if (name === "subs")    return [value.toLocaleString(), "New Subs"];
              if (name === "spend")   return [fmtRevTip(value), "Spend"];
              return [value, name];
            }}
          />

          <Area
            yAxisId="rev"
            type="monotone"
            dataKey="revenue"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#revGrad)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#22d3ee" }}
          />

          <Line
            yAxisId="subs"
            type="monotone"
            dataKey="subs"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#10b981" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import {
  X, ExternalLink, MousePointerClick, Users, DollarSign,
  TrendingUp, BarChart3, UserCheck
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { fetchDailyMetrics } from "@/lib/supabase-helpers";

interface CampaignDetailSlideInProps {
  link: any;
  cost: number;
  onClose: () => void;
  onSetCost: () => void;
}

function getStatus(link: any, cost: number) {
  const revenue = Number(link.revenue || 0);
  const clicks = link.clicks || 0;
  const subs = link.subscribers || 0;
  const daysSinceCreated = differenceInDays(new Date(), new Date(link.created_at));

  if (clicks === 0 && subs === 0 && revenue === 0) {
    return daysSinceCreated >= 3
      ? { label: "DEAD", emoji: "💀", color: "bg-destructive/20 text-destructive" }
      : { label: "NO DATA", emoji: "⏳", color: "bg-secondary text-muted-foreground" };
  }
  if (cost > 0) {
    const roi = ((revenue - cost) / cost) * 100;
    if (roi >= 100) return { label: "SCALE", emoji: "🚀", color: "bg-primary/20 text-primary" };
    if (roi >= 0) return { label: "WATCH", emoji: "👀", color: "bg-warning/20 text-warning" };
    if (roi >= -50) return { label: "LOW", emoji: "📉", color: "bg-warning/20 text-warning" };
    return { label: "KILL", emoji: "🔴", color: "bg-destructive/20 text-destructive" };
  }
  if (revenue > 500) return { label: "SCALE", emoji: "🚀", color: "bg-primary/20 text-primary" };
  if (revenue > 0) return { label: "WATCH", emoji: "👀", color: "bg-warning/20 text-warning" };
  return { label: "LOW", emoji: "📉", color: "bg-warning/20 text-warning" };
}

export function CampaignDetailSlideIn({ link, cost, onClose, onSetCost }: CampaignDetailSlideInProps) {
  const revenue = Number(link.revenue || 0);
  const profit = cost > 0 ? revenue - cost : null;
  const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : null;
  const epc = link.clicks > 0 ? revenue / link.clicks : 0;
  const arps = link.subscribers > 0 ? revenue / link.subscribers : 0;
  const status = getStatus(link, cost);
  const createdDate = new Date(link.created_at);
  const daysActive = differenceInDays(new Date(), createdDate);
  const isValidCreated = !isNaN(createdDate.getTime());

  const { data: dailyMetrics = [] } = useQuery({
    queryKey: ["daily_metrics", link.id],
    queryFn: () => fetchDailyMetrics([link.id]),
  });

  const chartData = useMemo(() => {
    return dailyMetrics
      .map((m: any) => ({
        date: m.date,
        revenue: Number(m.revenue || 0),
        clicks: Number(m.clicks || 0),
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [dailyMetrics]);

  const username = link.accounts?.username || link.accounts?.display_name || "Unknown";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[460px] bg-card border-l border-border z-50 animate-slide-in-right overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground leading-tight truncate">
                {link.campaign_name || "Unnamed Campaign"}
              </h2>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary truncate block mt-0.5 transition-colors"
              >
                {link.url}
              </a>
              <p className="text-xs text-muted-foreground mt-1">@{username}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Created + Status */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {isValidCreated ? (
                <>Created {format(createdDate, "MMM d, yyyy")} · Active for {daysActive} days</>
              ) : (
                "Created date unknown"
              )}
            </p>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${status.color}`}>
              {status.emoji} {status.label}
            </span>
          </div>

          {/* Performance Timeline */}
          <div className="bg-secondary/30 border border-border rounded-lg p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Revenue Timeline</h3>
            {chartData.length > 1 ? (
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(240 5% 50%)" }}
                      tickFormatter={(v) => format(new Date(v), "MMM d")}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(240 5% 50%)" }}
                      tickFormatter={(v) => `$${v}`}
                      axisLine={false}
                      tickLine={false}
                      width={45}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "hsl(240 4% 7%)",
                        border: "1px solid hsl(240 4% 16%)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(v) => format(new Date(v), "MMM d, yyyy")}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(160 84% 39%)"
                      strokeWidth={2}
                      fill="url(#revGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground">
                Not enough data points for a timeline
              </div>
            )}
          </div>

          {/* Key Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: MousePointerClick, label: "Clicks", value: link.clicks.toLocaleString() },
              { icon: Users, label: "Subscribers", value: link.subscribers.toLocaleString() },
              { icon: DollarSign, label: "Revenue", value: `$${revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, highlight: true },
              { icon: TrendingUp, label: "EPC", value: `$${epc.toFixed(2)}` },
              { icon: BarChart3, label: "ARPS", value: `$${arps.toFixed(2)}` },
              { icon: UserCheck, label: "Spenders", value: link.spenders.toLocaleString() },
            ].map((stat) => (
              <div key={stat.label} className="bg-secondary/30 border border-border rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <stat.icon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className={`font-mono text-sm font-bold ${stat.highlight ? "text-primary" : "text-foreground"}`}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Cost Section */}
          <div className="bg-secondary/30 border border-border rounded-lg p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Cost & Profitability</h3>
            {cost > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Ad Spend</span>
                  <span className="font-mono text-sm text-foreground">${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Profit</span>
                  <span className={`font-mono text-sm font-bold ${profit! >= 0 ? "text-primary" : "text-destructive"}`}>
                    {profit! >= 0 ? "+" : ""}${Math.abs(profit!).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">ROI</span>
                  <span className={`font-mono text-sm font-bold ${roi! >= 0 ? "text-primary" : "text-destructive"}`}>
                    {roi!.toFixed(1)}%
                  </span>
                </div>
                <button
                  onClick={onSetCost}
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit Cost
                </button>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-muted-foreground mb-2">No cost data set</p>
                <button
                  onClick={onSetCost}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  Set Cost
                </button>
              </div>
            )}
          </div>

          {/* View on OnlyFans */}
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            View on OnlyFans
          </a>
        </div>
      </div>
    </>
  );
}

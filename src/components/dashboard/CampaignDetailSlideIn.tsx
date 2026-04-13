import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import {
  X, ExternalLink, MousePointerClick, Users, DollarSign,
  TrendingUp, BarChart3, UserCheck, Calendar, Activity
} from "lucide-react";
import { XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { fetchDailyMetrics } from "@/lib/supabase-helpers";

const STATUS_STYLES: Record<string, string> = {
  SCALE: "bg-primary/15 text-primary",
  WATCH: "bg-warning/15 text-warning",
  LOW: "bg-warning/15 text-warning",
  KILL: "bg-destructive/15 text-destructive",
  DEAD: "bg-destructive/15 text-destructive",
  "NO SPEND": "bg-secondary text-muted-foreground",
  NO_DATA: "bg-secondary text-muted-foreground",
};
const STATUS_EMOJI: Record<string, string> = {
  SCALE: "🟢", WATCH: "🟡", LOW: "🟠", KILL: "🔴", DEAD: "💀", "NO SPEND": "⚪", NO_DATA: "⚪",
};
const COST_TYPE_STYLES: Record<string, string> = {
  CPC: "bg-info/15 text-info",
  CPL: "bg-primary/15 text-primary",
  FIXED: "bg-warning/15 text-warning",
};

interface CampaignDetailSlideInProps {
  link: any;
  cost: number;
  onClose: () => void;
  onSetCost: () => void;
}

export function CampaignDetailSlideIn({ link, cost, onClose, onSetCost }: CampaignDetailSlideInProps) {
  const revenue = Number(link.revenue || 0);
  const ltv = Number(link.ltv || 0);
  const effectiveRev = ltv > 0 ? ltv : revenue;
  const ltvBased = ltv > 0;
  const profit = Number(link.profit || 0);
  const roi = Number(link.roi || 0);
  const epc = link.clicks > 0 ? revenue / link.clicks : 0;
  const ltvPerSub = Number(link.ltv_per_sub || 0);
  const cvr = Number(link.cvr || 0);
  const cplReal = Number(link.cpl_real || 0);
  const cpcReal = Number(link.cpc_real || 0);
  const costTotal = Number(link.cost_total || 0);
  const status = link.status || "NO_DATA";
  const hasCost = link.cost_type && costTotal > 0;
  const createdDate = new Date(link.created_at);
  const daysActive = differenceInDays(new Date(), createdDate);
  const isValidCreated = !isNaN(createdDate.getTime());

  const username = link.accounts?.username || link.accounts?.display_name || "Unknown";
  const initials = (username || "??").replace("@", "").slice(0, 2).toUpperCase();

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
        subscribers: Number(m.subscribers || 0),
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [dailyMetrics]);

  const activityLog = useMemo(() => {
    if (chartData.length === 0) return [];
    return chartData
      .map((d: any, i: number) => ({
        date: d.date,
        label: i === 0 ? "First synced" : "Updated",
        clicks: d.clicks,
        subscribers: d.subscribers,
        revenue: d.revenue,
      }))
      .slice(-10);
  }, [chartData]);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-card border-l border-border z-50 animate-slide-in-right overflow-y-auto">
        <div className="p-6 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground leading-tight">
                {link.campaign_name || "Unnamed Tracking Link"}
              </h2>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-bold text-primary">{initials}</span>
                </div>
                <span className="text-xs text-muted-foreground">@{username}</span>
              </div>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mt-1.5 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="truncate max-w-[300px]">{link.url}</span>
              </a>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Created + Status */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />
              {isValidCreated ? (
                <>
                  Created {format(createdDate, "MMM d, yyyy")}
                  {(() => {
                    const calcDate = link.calculated_at ? new Date(link.calculated_at) : null;
                    const daysSinceActivity = calcDate && !isNaN(calcDate.getTime()) ? differenceInDays(new Date(), calcDate) : 999;
                    const isRecentlyActive = daysSinceActivity <= 30 && (link.clicks > 0 || Number(link.revenue || 0) > 0);
                    if (isRecentlyActive) {
                      return <> · <span className="text-primary">Active for {daysActive} days</span></>;
                    }
                    return <> · <span className="text-muted-foreground">Inactive for {daysSinceActivity < 999 ? `${daysSinceActivity} days` : "unknown"}</span></>;
                  })()}
                </>
              ) : "Created date unknown"}
            </p>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${STATUS_STYLES[status] || STATUS_STYLES.NO_DATA}`}>
              {STATUS_EMOJI[status] || "⚪"} {status.replace("_", " ")}
            </span>
          </div>

          {/* Performance Timeline */}
          <div className="bg-secondary/30 border border-border rounded-lg p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Performance Timeline</h3>
            {chartData.length > 1 ? (
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="revGradientDetail" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => format(new Date(v), "MMM d")} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} width={45} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px", color: "hsl(var(--foreground))" }}
                      labelFormatter={(v) => format(new Date(v), "MMM d, yyyy")}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, "LTV"]}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#revGradientDetail)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[120px] flex items-center justify-center">
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  Timeline builds after multiple syncs<br />— check back tomorrow
                </p>
              </div>
            )}
          </div>

          {/* Key Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: MousePointerClick, label: "Clicks", value: link.clicks.toLocaleString() },
              { icon: Users, label: "Subscribers", value: link.subscribers.toLocaleString() },
              { icon: TrendingUp, label: "CVR", value: `${(cvr * 100).toFixed(1)}%` },
              { icon: DollarSign, label: "Revenue", value: fmtC(revenue) },
              
              { icon: BarChart3, label: "EPC", value: `$${epc.toFixed(2)}` },
              { icon: UserCheck, label: "LTV/Sub", value: ltvPerSub > 0 ? `$${ltvPerSub.toFixed(2)}` : "—" },
              { icon: UserCheck, label: "Spender %", value: Number(link.spender_rate || 0) > 0 ? `${Number(link.spender_rate).toFixed(1)}%` : "—" },
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
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Spend & Profitability</h3>
            {hasCost ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${COST_TYPE_STYLES[link.cost_type] || "bg-secondary text-muted-foreground"}`}>
                    {link.cost_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] text-muted-foreground">
                    ${Number(link.cost_value || 0).toFixed(4)} per {link.cost_type === "CPC" ? "click" : link.cost_type === "CPL" ? "sub" : "fixed"}
                  </span>
                </div>
                {[
                  { label: "Total Spend", value: fmtC(costTotal), color: "text-foreground" },
                  { label: "CPC (Real)", value: `$${cpcReal.toFixed(4)}`, color: "text-foreground" },
                  { label: "CPL (Real)", value: `$${cplReal.toFixed(4)}`, color: "text-foreground" },
                  { label: "Profit", value: `${profit >= 0 ? "+" : ""}${fmtC(Math.abs(profit))}`, color: profit >= 0 ? "text-primary" : "text-destructive" },
                  { label: "ROI", value: `${roi.toFixed(1)}%`, color: roi >= 0 ? "text-primary" : "text-destructive" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <span className={`font-mono text-sm font-bold ${row.color}`}>{row.value}</span>
                  </div>
                ))}
                <button
                  onClick={onSetCost}
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit Spend
                </button>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-muted-foreground mb-2">No spend data set</p>
                <button
                  onClick={onSetCost}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  Set Spend
                </button>
              </div>
            )}
          </div>

          {/* Activity Log */}
          <div className="bg-secondary/30 border border-border rounded-lg p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Activity className="h-3 w-3" />
              Activity Log
            </h3>
            {activityLog.length > 0 ? (
              <div className="space-y-0">
                {activityLog.map((entry: any, i: number) => (
                  <div key={entry.date} className={`flex gap-3 ${i < activityLog.length - 1 ? "pb-3 border-b border-border/50 mb-3" : ""}`}>
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-foreground font-medium">
                        {format(new Date(entry.date), "MMM d, yyyy")} — {entry.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {entry.clicks.toLocaleString()} clicks · {entry.subscribers.toLocaleString()} subs · ${entry.revenue.toFixed(2)} LTV
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">No activity recorded yet</p>
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

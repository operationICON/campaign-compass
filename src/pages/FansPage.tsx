import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getFanStats, getFans, getFan, updateFan, streamSync, getAccounts, getTransactionTotals, getTransactionTypeTotals, getTransactionsByMonth, getTrackingLinks, getCampaignRevenueByType, getCrossPollFans } from "@/lib/api";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, DollarSign, TrendingUp, RefreshCw,
  Search, ChevronDown, ChevronRight, ChevronLeft, GitMerge, X,
  ExternalLink, ArrowLeft, Award, Eye, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmt$(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtNum(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return "—"; }
}
function fmtShortDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return "—"; }
}
function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "MMM d, h:mmaaa"); }
  catch { return "—"; }
}
function timeAgo(d: string | null | undefined) {
  if (!d) return "—";
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); }
  catch { return "—"; }
}

const TX_TYPE_META: Record<string, { label: string; color: string }> = {
  campaigns:              { label: "Campaigns",     color: "bg-primary/15 text-primary" },
  new_subscription:       { label: "New Sub",       color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  recurring_subscription: { label: "Resub",         color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  tip:                    { label: "Tips",           color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  message:                { label: "Message",        color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  post:                   { label: "Posts",          color: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  subscriptions:          { label: "Subscriptions",  color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
};
function txMeta(type: string | null) {
  return TX_TYPE_META[type ?? ""] ?? { label: type ?? "Other", color: "bg-muted text-muted-foreground" };
}

const TYPE_BAR_COLOR: Record<string, string> = {
  campaigns:              "#6366f1",
  new_subscription:       "#6366f1",
  recurring_subscription: "#22d3ee",
  tip:                    "#f59e0b",
  message:                "#10b981",
  post:                   "#8b5cf6",
  subscriptions:          "#22d3ee",
};

// ─── Revenue breakdown by type ────────────────────────────────────────────────
function RevenueBreakdown({ txs }: { txs: any[] }) {
  const breakdown = useMemo(() => {
    const map = new Map<string, { revenue: number; count: number }>();
    for (const tx of txs) {
      const type = tx.type ?? "other";
      const rev = Number(tx.revenue ?? 0);
      if (rev <= 0) continue;
      const cur = map.get(type) ?? { revenue: 0, count: 0 };
      cur.revenue += rev;
      cur.count += 1;
      map.set(type, cur);
    }
    return [...map.entries()].map(([type, d]) => ({ type, ...d })).sort((a, b) => b.revenue - a.revenue);
  }, [txs]);

  const total = breakdown.reduce((s, b) => s + b.revenue, 0);
  if (breakdown.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-border/40 bg-muted/10">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2.5">Revenue by Source</div>
      <div className="space-y-2.5">
        {breakdown.map(b => {
          const meta = txMeta(b.type);
          const pct = total > 0 ? (b.revenue / total) * 100 : 0;
          const color = TYPE_BAR_COLOR[b.type] ?? "#64748b";
          return (
            <div key={b.type}>
              <div className="flex items-center justify-between mb-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", meta.color)}>{meta.label}</span>
                  <span className="text-muted-foreground">{b.count} tx</span>
                </div>
                <div className="flex items-center gap-2 tabular-nums">
                  <span className="font-semibold">{fmt$(b.revenue)}</span>
                  <span className="text-muted-foreground w-8 text-right">{pct.toFixed(0)}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-border/40 flex justify-between text-xs">
        <span className="text-muted-foreground">{txs.filter(tx => Number(tx.revenue ?? 0) > 0).length} revenue transactions</span>
        <span className="font-bold tabular-nums text-emerald-500">{fmt$(total)}</span>
      </div>
    </div>
  );
}

// ─── Account revenue chart ────────────────────────────────────────────────────
function AccountRevenueChart({ accountId }: { accountId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["tx_by_month", accountId],
    queryFn: () => getTransactionsByMonth(accountId),
    staleTime: 300_000,
  });

  const chartData = useMemo(() => {
    const byMonth = new Map<string, { month: string; total: number; message: number; tip: number; subscription: number; post: number }>();
    for (const row of data) {
      const m = row.month?.slice(0, 7) ?? "";
      if (!m) continue;
      const cur = byMonth.get(m) ?? { month: m, total: 0, message: 0, tip: 0, subscription: 0, post: 0 };
      const rev = Number(row.revenue ?? 0);
      const t = (row.type ?? "").toLowerCase();
      cur.total += rev;
      if (t.includes("message") || t === "ppv" || t === "chat") cur.message += rev;
      else if (t.includes("tip")) cur.tip += rev;
      else if (t.includes("sub")) cur.subscription += rev;
      else if (t.includes("post")) cur.post += rev;
      byMonth.set(m, cur);
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [data]);

  const typeTotals = useMemo(() => {
    return chartData.reduce((acc, d) => ({
      total: acc.total + d.total,
      message: acc.message + d.message,
      tip: acc.tip + d.tip,
      subscription: acc.subscription + d.subscription,
      post: acc.post + d.post,
    }), { total: 0, message: 0, tip: 0, subscription: 0, post: 0 });
  }, [chartData]);

  if (isLoading) return <Skeleton className="h-56 w-full rounded-xl" />;
  if (chartData.length === 0) return (
    <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center h-40 text-xs text-muted-foreground">
      No transaction history — run Rev Breakdown sync first
    </div>
  );

  const fmtY = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header row: total + type chips */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex flex-wrap items-end gap-4 mb-1">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Total Earnings</div>
            <div className="text-3xl font-bold tabular-nums text-emerald-500">{fmt$(typeTotals.total)}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          {[
            { label: "Messages", value: typeTotals.message, color: "text-emerald-400", dot: "#10b981" },
            { label: "Tips",     value: typeTotals.tip,     color: "text-amber-400",   dot: "#f59e0b" },
            { label: "Subs",     value: typeTotals.subscription, color: "text-indigo-400", dot: "#6366f1" },
            { label: "Posts",    value: typeTotals.post,    color: "text-violet-400",  dot: "#8b5cf6" },
          ].filter(b => b.value > 0).map(b => (
            <div key={b.label} className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: b.dot }} />
              <div>
                <div className="text-[10px] text-muted-foreground">{b.label}</div>
                <div className={cn("text-sm font-bold tabular-nums", b.color)}>{fmt$(b.value)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="acRevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={m => { try { return format(new Date(m + "-01"), "MMM yy"); } catch { return m; } }}
          />
          <YAxis tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={fmtY} width={44}
          />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
            labelStyle={{ color: "hsl(var(--muted-foreground))", fontWeight: 600 }}
            labelFormatter={m => { try { return format(new Date(m + "-01"), "MMMM yyyy"); } catch { return m; } }}
            formatter={(v: number) => [fmt$(v), "Revenue"]}
          />
          <Area type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2.5}
            fill="url(#acRevGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: "#10b981" }} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Historical label */}
      <div className="px-5 pb-3 text-[10px] text-muted-foreground">
        Historical performance · {chartData.length} month{chartData.length !== 1 ? "s" : ""} of data
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", color ?? "bg-primary/10")}>
          <Icon className={cn("w-4 h-4", color ? "text-white" : "text-primary")} />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── Account fan card ─────────────────────────────────────────────────────────
function AccountFanCard({ account, stats, isLoading, totalSubs, rank, typeTotals, onClick }: {
  account: any; stats: any | null; isLoading: boolean;
  totalSubs: number; rank: number; typeTotals?: Array<{ type: string; revenue: number; count: number }>; onClick: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const spenderPct = totalSubs > 0 ? (stats?.spenders ?? 0) / totalSubs * 100 : 0;
  const hasData = stats && (stats.total_fans > 0 || stats.total_revenue > 0);
  const breakdownTotal = typeTotals?.reduce((s, b) => s + b.revenue, 0) ?? 0;

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all group relative overflow-hidden"
    >
      {/* Rank badge */}
      {rank <= 3 && hasData && (
        <div className={cn(
          "absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
          rank === 1 ? "bg-amber-500/20 text-amber-400" :
          rank === 2 ? "bg-slate-400/20 text-slate-400" :
                       "bg-orange-600/20 text-orange-500"
        )}>
          {rank}
        </div>
      )}

      {/* Account header */}
      <div className="flex items-center gap-2.5 mb-3">
        {account.avatar_thumb_url ? (
          <img src={account.avatar_thumb_url} alt={account.display_name}
            className="w-10 h-10 rounded-full object-cover border-2 border-border flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground flex-shrink-0">
            {account.display_name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 pr-5">
          <div className="font-bold text-sm truncate">{account.display_name}</div>
          {isLoading ? (
            <Skeleton className="h-4 w-24 mt-0.5" />
          ) : hasData ? (
            <div className="text-sm font-bold text-emerald-500 tabular-nums">{fmt$(stats.total_revenue)}</div>
          ) : (
            <div className="text-xs text-muted-foreground">No fan data yet</div>
          )}
        </div>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : hasData ? (
        <>
          {/* 4-stat grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Subs</div>
              <div className="text-base font-bold tabular-nums">{totalSubs > 0 ? fmtNum(totalSubs) : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spenders</div>
              <div className="text-base font-bold tabular-nums text-emerald-500">{fmtNum(stats.spenders)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg / Spender</div>
              <div className="text-xs font-semibold tabular-nums">{fmt$(stats.avg_per_spender)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cross-Poll</div>
              <div className="text-xs font-semibold tabular-nums text-violet-500">{fmtNum(stats.cross_poll_fans)}</div>
            </div>
          </div>

          {/* Conversion bar */}
          {totalSubs > 0 ? (
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
                <span>{fmtNum(stats.spenders)} spenders of {fmtNum(totalSubs)} subs</span>
                <span className="font-bold text-foreground">{spenderPct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, spenderPct)}%` }} />
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">No subscriber count — sync tracking links first</div>
          )}

          {/* Revenue breakdown dropdown */}
          {typeTotals && typeTotals.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/40">
              <button
                onClick={e => { e.stopPropagation(); setShowBreakdown(v => !v); }}
                className="flex items-center justify-between w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors group/btn"
              >
                <span className="uppercase tracking-wide font-semibold">Revenue by type</span>
                <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", showBreakdown && "rotate-180")} />
              </button>
              {showBreakdown && (
                <div className="mt-2.5 space-y-2">
                  {typeTotals.map(b => {
                    const meta = txMeta(b.type);
                    const pct = breakdownTotal > 0 ? (b.revenue / breakdownTotal) * 100 : 0;
                    const color = TYPE_BAR_COLOR[b.type] ?? "#64748b";
                    return (
                      <div key={b.type}>
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0", meta.color)}>{meta.label}</span>
                            {b.count > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{fmtNum(b.count)} tx</span>}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] tabular-nums shrink-0">
                            <span className="font-semibold">{fmt$(b.revenue)}</span>
                            <span className="text-muted-foreground w-7 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-[10px] pt-1 border-t border-border/30">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-bold tabular-nums text-emerald-500">{fmt$(breakdownTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-muted-foreground py-2">Run a fan sync to load data</div>
      )}

      <div className="mt-2 flex items-center justify-end">
        <span className="text-[11px] text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-1">
          View fans <ChevronRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

// ─── Fan avatar ───────────────────────────────────────────────────────────────
function FanAvatar({ fan, size = 28 }: { fan: any; size?: number }) {
  const initials = ((fan.username ?? fan.fan_id) as string).slice(0, 2).toUpperCase();
  if (fan.avatar_url) {
    return (
      <img src={fan.avatar_url} alt={fan.username ?? fan.fan_id}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className="rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0"
      style={{ width: size, height: size }}>
      {initials}
    </div>
  );
}

// ─── Fan detail dropdown (expandable row) ────────────────────────────────────
function FanDetailDropdown({ fan, allTrackingLinks, accountMap }: {
  fan: any;
  allTrackingLinks: any[];
  accountMap: Record<string, any>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["fan_detail", fan.id],
    queryFn: () => getFan(fan.id),
    staleTime: 60_000,
  });

  const txs: any[]        = data?.transactions ?? [];
  const accountStats: any[] = data?.account_stats ?? [];

  // Build a map of all tracking links for quick lookup
  const tlLookup = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tl of allTrackingLinks) m[tl.id] = tl;
    return m;
  }, [allTrackingLinks]);

  const s = useMemo(() => {
    const subCount   = txs.filter(t => ["new_subscription","recurring_subscription"].includes(t.type)).length;
    const subSpend   = txs.filter(t => ["new_subscription","recurring_subscription"].includes(t.type)).reduce((a,t) => a + Number(t.revenue ?? 0), 0);
    const msgCount   = txs.filter(t => ["message","chat"].includes(t.type)).length;
    const ppvRev     = txs.filter(t => ["ppv","chat"].includes(t.type)).reduce((a,t) => a + Number(t.revenue ?? 0), 0);
    const postRev    = txs.filter(t => t.type === "post").reduce((a,t) => a + Number(t.revenue ?? 0), 0);
    const tipRev     = txs.filter(t => t.type === "tip").reduce((a,t) => a + Number(t.revenue ?? 0), 0);
    const biggest    = [...txs].filter(t => Number(t.revenue ?? 0) > 0)
                         .sort((a,b) => Number(b.revenue) - Number(a.revenue)).slice(0, 10);
    const first = fan.first_transaction_at ? new Date(fan.first_transaction_at).getTime() : null;
    const last  = fan.last_transaction_at  ? new Date(fan.last_transaction_at).getTime()  : null;
    const daysActive       = first && last ? Math.max(1, Math.round((last - first) / 86400000)) : 0;
    const lastActivityDays = last ? Math.round((Date.now() - last) / 86400000) : null;
    const msgPerDay = daysActive > 0 ? msgCount / daysActive : 0;
    // Per-account revenue from transactions (more accurate than fan_account_stats)
    const perAcctRevMap: Record<string, number> = {};
    for (const t of txs) {
      if (t.account_id && Number(t.revenue ?? 0) > 0)
        perAcctRevMap[t.account_id] = (perAcctRevMap[t.account_id] ?? 0) + Number(t.revenue);
    }
    return { subCount, subSpend, msgCount, ppvRev, postRev, tipRev, biggest, daysActive, lastActivityDays, msgPerDay, perAcctRevMap };
  }, [txs, fan]);

  const acquisitionTl  = fan.first_subscribe_link_id ? tlLookup[fan.first_subscribe_link_id] : null;
  const acquisitionAcc = acquisitionTl?.account_id ? accountMap[acquisitionTl.account_id] : null;
  const totalRev       = Number(fan.total_revenue ?? 0);
  const isCrossPoll    = fan.is_cross_poll || accountStats.length > 1;

  const StatRow = ({ label, value, dot, highlight }: { label: string; value: string; dot?: string; highlight?: string }) => (
    <div className="flex items-center justify-between py-1.5 text-xs border-b border-border/20 last:border-0">
      <span className="text-muted-foreground flex items-center gap-1.5">
        {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
        {label}
      </span>
      <span className={cn("tabular-nums font-semibold", highlight ?? "")}>{value}</span>
    </div>
  );

  if (isLoading) return (
    <div className="p-4 flex gap-3">
      {[1,2,3].map(i => <Skeleton key={i} className="h-28 flex-1 rounded-xl" />)}
    </div>
  );

  return (
    <div className="px-5 py-4 bg-muted/5 border-t border-border/30 space-y-4">

      {/* ── Metrics strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-emerald-400 font-bold text-base tabular-nums">{fmt$(totalRev)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Lifetime Value</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="font-bold text-base">{s.daysActive || "—"}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Days Active</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="font-bold text-base">{s.lastActivityDays != null ? `${s.lastActivityDays}d` : "—"}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Last Activity</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className={cn("font-bold text-base", isCrossPoll ? "text-violet-400" : "text-muted-foreground")}>
            {isCrossPoll ? accountStats.length : "1"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Accounts</div>
        </div>
      </div>

      {/* ── Main grid: campaign + revenue + cross-poll ────────── */}
      <div className={cn("grid gap-3", isCrossPoll ? "grid-cols-3" : "grid-cols-2")}>

        {/* Campaign Attribution */}
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
            Acquisition Campaign
          </div>
          {acquisitionTl ? (
            <>
              <div className="text-xs">
                <div className="text-muted-foreground mb-0.5">Campaign</div>
                <div className="font-medium truncate">
                  {acquisitionTl.campaign_name || acquisitionTl.external_tracking_link_id || "Unnamed"}
                </div>
              </div>
              {acquisitionAcc && (
                <div className="text-xs">
                  <div className="text-muted-foreground mb-0.5">Model</div>
                  <div className="font-medium">{acquisitionAcc.display_name || acquisitionAcc.username}</div>
                </div>
              )}
              {fan.first_subscribe_date && (
                <div className="text-xs">
                  <div className="text-muted-foreground mb-0.5">Subscribed</div>
                  <div className="font-medium">{fmtDateTime(fan.first_subscribe_date)}</div>
                  <div className="text-muted-foreground">{timeAgo(fan.first_subscribe_date)}</div>
                </div>
              )}
              {acquisitionTl.subscribers != null && (
                <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground flex justify-between">
                  <span>Campaign subs</span>
                  <span className="font-semibold text-foreground">{fmtNum(acquisitionTl.subscribers)}</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No campaign attribution — fan may have subscribed directly.</p>
          )}
        </div>

        {/* Revenue Breakdown */}
        <div className="bg-card border border-border rounded-xl p-3">
          <div className="text-xs font-semibold flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Revenue Breakdown
          </div>
          <StatRow label="Subscriptions" value={`${fmtNum(s.subCount)} · ${fmt$(s.subSpend)}`} dot="#6366f1" />
          <StatRow label="PPV / Messages" value={fmt$(s.ppvRev)}  dot="#10b981" highlight="text-emerald-400" />
          <StatRow label="Posts"          value={fmt$(s.postRev)} dot="#8b5cf6" />
          <StatRow label="Tips"           value={fmt$(s.tipRev)}  dot="#f59e0b" highlight="text-amber-400" />
          <StatRow label="Messages (count)" value={`${fmtNum(s.msgCount)} · ${s.msgPerDay > 0 ? s.msgPerDay.toFixed(2)+"/day" : "—"}`} dot="#60a5fa" />
        </div>

        {/* Cross-Poll Accounts — only when relevant */}
        {isCrossPoll && (
          <div className="bg-card border border-violet-500/30 rounded-xl p-3">
            <div className="text-xs font-semibold flex items-center gap-1.5 mb-2 text-violet-400">
              <GitMerge className="w-3 h-3" />
              Cross-Pollination · {accountStats.length} accounts
            </div>
            <div className="space-y-2">
              {accountStats.map((stat: any, i: number) => {
                const acc = accountMap[stat.account_id];
                // Use tx-derived revenue (more accurate than fan_account_stats.total_revenue)
                const rev = s.perAcctRevMap[stat.account_id] ?? Number(stat.total_revenue ?? 0);
                const tl = stat.first_subscribe_link_id
                  ? tlLookup[stat.first_subscribe_link_id] : null;
                return (
                  <div key={i} className="py-2 border-b border-border/20 last:border-0">
                    <div className="flex items-center gap-2.5">
                      {acc?.avatar_thumb_url
                        ? <img src={acc.avatar_thumb_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                        : <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center text-[9px] font-bold text-violet-400 shrink-0">
                            {(acc?.display_name || stat.account_display_name || "?").slice(0,2).toUpperCase()}
                          </div>}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {acc?.display_name || stat.account_display_name || "Unknown"}
                        </div>
                        {stat.first_transaction_at && (
                          <div className="text-[10px] text-muted-foreground">since {fmtShortDate(stat.first_transaction_at)}</div>
                        )}
                      </div>
                      <span className={cn("text-xs font-bold tabular-nums shrink-0", rev > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                        {rev > 0 ? fmt$(rev) : "—"}
                      </span>
                    </div>
                    {tl && (
                      <div className="ml-9 mt-1 text-[10px] text-muted-foreground flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/60 inline-block" />
                        {tl.campaign_name || tl.external_tracking_link_id || "Unnamed campaign"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Biggest transactions ───────────────────────────────── */}
      {s.biggest.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/40 text-xs font-semibold">Top Transactions</div>
          {s.biggest.map((tx: any, i: number) => {
            const meta = txMeta(tx.type);
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-border/20 last:border-0 text-xs hover:bg-muted/20 transition-colors">
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0", meta.color)}>{meta.label}</span>
                <span className="font-bold tabular-nums w-16 shrink-0 text-emerald-400">{fmt$(Number(tx.revenue))}</span>
                <span className="text-muted-foreground flex-1 truncate">{tx.description || "—"}</span>
                <span className="text-muted-foreground shrink-0">{fmtDateTime(tx.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Inline transaction list ──────────────────────────────────────────────────
function InlineTxList({ fanDbId, showAccount, accountMap }: {
  fanDbId: string; showAccount: boolean; accountMap: Record<string, any>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["fan_detail", fanDbId],
    queryFn: () => getFan(fanDbId),
    staleTime: 60_000,
  });

  const transactions = data?.transactions ?? [];

  if (isLoading) return (
    <div className="px-4 pb-3 pt-1 space-y-1.5">
      {[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full rounded" />)}
    </div>
  );

  if (transactions.length === 0) return (
    <p className="px-4 pb-3 text-xs text-muted-foreground">No transactions found</p>
  );

  return (
    <div className="pb-3">
      <RevenueBreakdown txs={transactions} />
      <div className="px-4 pt-3">
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Date</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Type</th>
              {showAccount && <th className="text-left px-3 py-2 font-medium text-muted-foreground">Account</th>}
              <th className="text-right px-3 py-2 font-medium text-muted-foreground w-24">Amount</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground w-20">Net</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 100).map((tx: any, i: number) => {
              const meta = txMeta(tx.type);
              const rev = Number(tx.revenue ?? 0);
              const net = Number(tx.revenue_net ?? tx.revenue ?? 0);
              const acc = accountMap[tx.account_id];
              return (
                <tr key={tx.id ?? i} className={cn("border-b border-border/30 last:border-0", i % 2 === 0 ? "" : "bg-muted/20")}>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtShortDate(tx.date)}</td>
                  <td className="px-3 py-2">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", meta.color)}>{meta.label}</span>
                  </td>
                  {showAccount && (
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-32">{acc?.display_name ?? "—"}</td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{rev > 0 ? fmt$(rev) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {net !== rev && net > 0 ? fmt$(net) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {transactions.length > 100 && (
          <p className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border/40">
            Showing 100 of {transactions.length} transactions
          </p>
        )}
      </div>
      </div>
    </div>
  );
}

// ─── Fan edit panel ───────────────────────────────────────────────────────────
function FanEditPanel({ fan, onClose, onUpdated }: { fan: any; onClose: () => void; onUpdated: () => void }) {
  const [notesInput, setNotesInput] = useState(fan.notes ?? "");
  const [saving, setSaving] = useState(false);

  const { data: fanDetail } = useQuery({
    queryKey: ["fan_detail", fan.id],
    queryFn: () => getFan(fan.id),
    staleTime: 60_000,
  });
  const detailTxs = fanDetail?.transactions ?? [];

  async function saveNotes() {
    setSaving(true);
    try {
      await updateFan(fan.id, { notes: notesInput });
      onUpdated();
      toast.success("Notes saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  const totalRevenue = Number(fan.total_revenue ?? 0);

  return (
    <div className="flex flex-col h-full">
      <div className="p-5 border-b border-border flex items-start gap-3">
        <FanAvatar fan={fan} size={40} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{fan.username ? `@${fan.username}` : fan.fan_id}</div>
          {fan.username && <div className="text-xs text-muted-foreground">{fan.fan_id}</div>}
          <div className="flex items-center gap-2 mt-2">
            {totalRevenue > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 font-medium">{fmt$(totalRevenue)}</span>
            )}
            {fan.is_cross_poll && (
              <span className="text-xs bg-violet-100 text-violet-700 rounded px-1.5 py-0.5 font-medium flex items-center gap-1">
                <GitMerge className="w-2.5 h-2.5" /> Cross-poll
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{fmt$(totalRevenue)}</div>
            <div className="text-xs text-muted-foreground">Total Revenue</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{fmtNum(fan.total_transactions)}</div>
            <div className="text-xs text-muted-foreground">Transactions</div>
          </div>
        </div>

        {detailTxs.length > 0 && (
          <div className="rounded-xl border border-border overflow-hidden -mx-1">
            <RevenueBreakdown txs={detailTxs} />
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>First seen</span><span className="text-foreground">{fmtDate(fan.first_transaction_at)}</span></div>
          <div className="flex justify-between"><span>Last seen</span><span className="text-foreground">{fmtDate(fan.last_transaction_at)}</span></div>
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</div>
          <textarea value={notesInput} onChange={e => setNotesInput(e.target.value)} rows={4}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary bg-background"
            placeholder="Add notes about this fan..." />
          <div className="flex justify-end mt-2">
            <Button size="sm" onClick={saveNotes} disabled={saving}>Save notes</Button>
          </div>
        </div>

        {fan.first_subscribe_account && (
          <div className="text-xs space-y-1.5 bg-muted/30 rounded-lg p-3">
            <div className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">Attribution</div>
            <div className="flex justify-between"><span className="text-muted-foreground">Subscribed via</span><span>{fan.first_subscribe_account}</span></div>
            {fan.first_subscribe_date && <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{fmtDate(fan.first_subscribe_date)}</span></div>}
          </div>
        )}

        {fan.username && (
          <a href={`https://onlyfans.com/${fan.username}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> View on OnlyFans
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Sort pill ────────────────────────────────────────────────────────────────
type FanSortKey = "revenue" | "transactions" | "last_seen";
function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors border",
        active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      )}>
      {label}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const FANS_PER_PAGE = 50;

export default function FansPage() {
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountGridFilter, setAccountGridFilter] = useState<string[]>([]);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [spendersOnly, setSpendersOnly] = useState(true);
  const [sortKey, setSortKey] = useState<FanSortKey>("revenue");
  const [fanPage, setFanPage] = useState(1);
  const [expandedFans, setExpandedFans] = useState<Set<string>>(new Set());
  const [editFan, setEditFan] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setCampaignFilter("all");
    setSearch("");
    setExpandedFans(new Set());
    setFanPage(1);
    setSortKey("revenue");
  }, [selectedAccountId]);

  useEffect(() => { setFanPage(1); }, [debouncedSearch, campaignFilter, spendersOnly, sortKey]);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await getAccounts() || []).filter((a: any) => a.is_active && !a.sync_excluded),
  });

  const globalStatsQuery = useQuery({
    queryKey: ["fan_stats", "all"],
    queryFn: () => getFanStats(),
    staleTime: 60_000,
    enabled: selectedAccountId === null,
  });

  const accountStatsQueries = useQueries({
    queries: accounts.map((acc: any) => ({
      queryKey: ["fan_stats", acc.id],
      queryFn: () => getFanStats({ account_id: acc.id }),
      staleTime: 60_000,
      enabled: selectedAccountId === null,
    })),
  });

  const accountStatsMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((acc: any, i: number) => {
      if (accountStatsQueries[i]?.data) map[acc.id] = accountStatsQueries[i].data;
    });
    return map;
  }, [accounts, accountStatsQueries]);

  // Sort accounts by fan revenue descending for the grid
  const sortedAccounts = useMemo(() => {
    const sorted = [...accounts].sort((a: any, b: any) => {
      const revA = Number(accountStatsMap[a.id]?.total_revenue ?? 0);
      const revB = Number(accountStatsMap[b.id]?.total_revenue ?? 0);
      return revB - revA;
    });
    if (accountGridFilter.length === 0) return sorted;
    return sorted.filter((a: any) => accountGridFilter.includes(a.id));
  }, [accounts, accountStatsMap, accountGridFilter]);


  const selectedAccount = useMemo(
    () => selectedAccountId ? accounts.find((a: any) => a.id === selectedAccountId) : null,
    [accounts, selectedAccountId]
  );

  const selectedStatsQuery = useQuery({
    queryKey: ["fan_stats", selectedAccountId],
    queryFn: () => getFanStats({ account_id: selectedAccountId! }),
    staleTime: 60_000,
    enabled: !!selectedAccountId,
  });

  const { data: allTrackingLinks = [] } = useQuery({
    queryKey: ["tracking_links_all"],
    queryFn: () => getTrackingLinks(),
    staleTime: 300_000,
  });

  const activeAccountIds = useMemo(() => new Set((accounts as any[]).map((a: any) => a.id)), [accounts]);

  const subsPerAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tl of allTrackingLinks as any[]) {
      if (tl.account_id && activeAccountIds.has(tl.account_id))
        map[tl.account_id] = (map[tl.account_id] ?? 0) + Number(tl.subscribers || 0);
    }
    return map;
  }, [allTrackingLinks, activeAccountIds]);

  const totalSubsAll = useMemo(
    () => Object.values(subsPerAccount).reduce((a, b) => a + b, 0),
    [subsPerAccount]
  );

  const { data: trackingLinks = [] } = useQuery({
    queryKey: ["tracking_links", selectedAccountId],
    queryFn: () => getTrackingLinks({ account_id: selectedAccountId! }),
    enabled: !!selectedAccountId,
  });

  const tlMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tl of trackingLinks as any[]) m[tl.id] = tl;
    return m;
  }, [trackingLinks]);

  const fansQuery = useQuery({
    queryKey: ["fans_list", selectedAccountId, campaignFilter, debouncedSearch, spendersOnly],
    queryFn: () => getFans({
      account_id: selectedAccountId || undefined,
      tracking_link_id: campaignFilter !== "all" ? campaignFilter : undefined,
      search: debouncedSearch || undefined,
      spenders_only: spendersOnly || undefined,
      sort_by: "total_revenue",
      sort_dir: "desc",
      limit: 500,
    }),
    enabled: !!selectedAccountId,
    staleTime: 30_000,
  });

  const txTotalsQuery = useQuery({
    queryKey: ["tx_totals"],
    queryFn: () => getTransactionTotals(),
    staleTime: 60_000,
    enabled: selectedAccountId === null,
  });

  const txTypeTotalsQuery = useQuery({
    queryKey: ["tx_type_totals"],
    queryFn: () => getTransactionTypeTotals() as Promise<Array<{ account_id: string | null; type: string | null; revenue: number; tx_count: number }>>,
    staleTime: 60_000,
    enabled: selectedAccountId === null,
  });

  const campaignRevenueByTypeQuery = useQuery({
    queryKey: ["campaign_revenue_by_type"],
    queryFn: () => getCampaignRevenueByType(),
    staleTime: 120_000,
  });

  const crossPollQuery = useQuery({
    queryKey: ["cross_poll_fans"],
    queryFn: () => getCrossPollFans(1000),
    staleTime: 120_000,
    enabled: selectedAccountId === null,
  });

  const campaignTypeMap = useMemo(() => {
    const map: Record<string, any> = {};
    for (const row of (campaignRevenueByTypeQuery.data ?? [])) {
      map[row.tracking_link_id] = row;
    }
    return map;
  }, [campaignRevenueByTypeQuery.data]);


  const accountTxRevMap = useMemo(() => {
    const rows = txTypeTotalsQuery.data ?? [];
    const map = new Map<string, { new_sub: number; resub: number; tip: number; message: number; post: number }>();
    for (const r of rows) {
      if (!r.account_id) continue;
      const cur = map.get(r.account_id) ?? { new_sub: 0, resub: 0, tip: 0, message: 0, post: 0 };
      const rev = Number(r.revenue ?? 0);
      const t = r.type ?? "";
      if (t === "new_subscription") cur.new_sub += rev;
      else if (t === "recurring_subscription") cur.resub += rev;
      else if (t === "tip") cur.tip += rev;
      else if (["message","chat","ppv"].includes(t)) cur.message += rev;
      else if (t === "post") cur.post += rev;
      map.set(r.account_id, cur);
    }
    return map;
  }, [txTypeTotalsQuery.data]);

  const rawFans = fansQuery.data?.fans ?? [];
  const totalFans = fansQuery.data?.total ?? 0;
  const globalStats = globalStatsQuery.data;
  const selectedStats = selectedStatsQuery.data;
  const isLoadingFans = fansQuery.isLoading;
  const txCount = txTotalsQuery.data?.count ?? 0;
  const txGrandTotal = txTotalsQuery.data?.total ?? 0;

  const txTypeSummary = useMemo(() => {
    const rows = txTypeTotalsQuery.data ?? [];
    const map = new Map<string, { revenue: number; count: number }>();
    for (const r of rows) {
      const type = r.type ?? "other";
      const rev = Number(r.revenue ?? 0);
      const cur = map.get(type) ?? { revenue: 0, count: 0 };
      cur.revenue += rev;
      cur.count += Number(r.tx_count ?? 0);
      map.set(type, cur);
    }
    return [...map.entries()].map(([type, d]) => ({ type, ...d })).sort((a, b) => b.revenue - a.revenue);
  }, [txTypeTotalsQuery.data]);

  // Per-account tx counts by type (from transactions table — last 30 days)
  const txCountPerAccount = useMemo(() => {
    const rows = txTypeTotalsQuery.data ?? [];
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!r.account_id) continue;
      const accMap = map.get(r.account_id) ?? new Map<string, number>();
      accMap.set(r.type ?? "other", Number(r.tx_count ?? 0));
      map.set(r.account_id, accMap);
    }
    return map;
  }, [txTypeTotalsQuery.data]);

  const txTypePerAccount = useMemo(() => {
    const map = new Map<string, Array<{ type: string; revenue: number; count: number }>>();
    for (const acc of (accounts as any[])) {
      const accTxCounts = txCountPerAccount.get(acc.id) ?? new Map<string, number>();
      const camp  = (allTrackingLinks as any[]).filter((tl: any) => !tl.deleted_at && tl.account_id === acc.id).reduce((s: number, tl: any) => s + Number(tl.revenue ?? 0), 0);
      const tips  = Number(acc.ltv_tips ?? 0);
      const subs  = Number(acc.ltv_subscriptions ?? 0);
      const posts = Number(acc.ltv_posts ?? 0);
      const total = Number(acc.ltv_total ?? 0);
      const msg   = Math.max(0, total - camp - tips - subs - posts);
      const subCount = (accTxCounts.get("new_subscription") ?? 0) + (accTxCounts.get("recurring_subscription") ?? 0);
      const arr = [
        { type: "campaigns",     revenue: camp, count: subCount },
        { type: "message",       revenue: msg,  count: (accTxCounts.get("message") ?? 0) + (accTxCounts.get("chat") ?? 0) + (accTxCounts.get("ppv") ?? 0) },
        { type: "tip",           revenue: tips, count: accTxCounts.get("tip") ?? 0 },
        { type: "subscriptions", revenue: subs, count: subCount },
        { type: "post",          revenue: posts, count: accTxCounts.get("post") ?? 0 },
      ].filter(r => r.revenue > 0);
      if (arr.length > 0) map.set(acc.id, arr);
    }
    return map;
  }, [accounts, allTrackingLinks, txCountPerAccount]);


  // Client-side sort
  const sortedFans = useMemo(() => {
    return [...rawFans].sort((a, b) => {
      if (sortKey === "revenue")      return Number(b.total_revenue ?? 0) - Number(a.total_revenue ?? 0);
      if (sortKey === "transactions") return (b.total_transactions ?? 0) - (a.total_transactions ?? 0);
      if (sortKey === "last_seen")    return (b.last_transaction_at ?? "").localeCompare(a.last_transaction_at ?? "");
      return 0;
    });
  }, [rawFans, sortKey]);

  const totalFanPages = Math.max(1, Math.ceil(sortedFans.length / FANS_PER_PAGE));
  const safePage = Math.min(fanPage, totalFanPages);
  const paginatedFans = sortedFans.slice((safePage - 1) * FANS_PER_PAGE, safePage * FANS_PER_PAGE);

  const accountMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of accounts) m[(a as any).id] = a;
    return m;
  }, [accounts]);

  const allTlMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tl of allTrackingLinks as any[]) m[tl.id] = tl;
    return m;
  }, [allTrackingLinks]);

  // Cross-poll grouped: account (DESTINATION) → campaign (source) → fans
  // Only counts revenue on OTHER accounts — skips each fan's acquisition/home account
  // so the total matches the true cross-pollination contribution, not total fan spend.
  const crossPollByAccount = useMemo(() => {
    type CampEntry = { campaignName: string; tlId: string | null; revenue: number; revBefore: number; revAfter: number; fanCount: number; fans: any[] };
    type AccEntry  = { revenue: number; revBefore: number; revAfter: number; fanCount: number; byCampaign: Map<string, CampEntry> };
    const map = new Map<string, AccEntry>();

    for (const fan of crossPollQuery.data ?? []) {
      // Resolve home account: prefer acquired_via_account_id, fall back to the account
      // that owns their first tracking link.
      const homeTl     = fan.first_subscribe_link_id ? allTlMap[fan.first_subscribe_link_id] : null;
      const homeAccId  = fan.acquired_via_account_id || homeTl?.account_id || null;

      for (const par of fan.per_account_revenue) {
        // Skip the fan's own acquisition account — that's regular revenue, not cross-poll.
        if (homeAccId && par.account_id === homeAccId) continue;

        const accId     = par.account_id;
        const rev       = Number(par.revenue ?? 0);
        const revBefore = Number(par.rev_before ?? 0);
        const revAfter  = Number(par.rev_after  ?? 0);
        if (!map.has(accId)) map.set(accId, { revenue: 0, revBefore: 0, revAfter: 0, fanCount: 0, byCampaign: new Map() });
        const acc = map.get(accId)!;
        acc.revenue   += rev;
        acc.revBefore += revBefore;
        acc.revAfter  += revAfter;
        acc.fanCount  += 1;

        const tl      = fan.first_subscribe_link_id ? allTlMap[fan.first_subscribe_link_id] : null;
        const campKey = fan.first_subscribe_link_id ?? "none";
        const campName = tl?.campaign_name || tl?.external_tracking_link_id || "Direct / Unknown";
        if (!acc.byCampaign.has(campKey))
          acc.byCampaign.set(campKey, { campaignName: campName, tlId: fan.first_subscribe_link_id, revenue: 0, revBefore: 0, revAfter: 0, fanCount: 0, fans: [] });
        const camp = acc.byCampaign.get(campKey)!;
        camp.revenue   += rev;
        camp.revBefore += revBefore;
        camp.revAfter  += revAfter;
        camp.fanCount  += 1;
        camp.fans.push(fan);
      }
    }
    return map;
  }, [crossPollQuery.data, allTlMap]);

  const [expandedCpAccounts,  setExpandedCpAccounts]  = useState<Set<string>>(new Set());
  const [expandedCpCampaigns, setExpandedCpCampaigns] = useState<Set<string>>(new Set());
  const [expandedCpFans,      setExpandedCpFans]      = useState<Set<string>>(new Set());

  function toggleCpAccount(id: string)  { setExpandedCpAccounts(p  => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleCpCampaign(id: string) { setExpandedCpCampaigns(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleCpFan(id: string)      { setExpandedCpFans(p      => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  function toggleExpand(fanId: string) {
    setExpandedFans(prev => {
      const next = new Set(prev);
      if (next.has(fanId)) next.delete(fanId); else next.add(fanId);
      return next;
    });
  }

  async function handleSync(full = false) {
    setSyncing(true);
    setSyncProgress(full ? "Starting full historical sync..." : "Starting sync...");
    try {
      await streamSync("/sync/fans", { triggered_by: "manual", ...(full ? { full: true } : {}) }, msg => setSyncProgress(msg));
      await queryClient.invalidateQueries({ queryKey: ["fans_list"] });
      await queryClient.invalidateQueries({ queryKey: ["fan_stats"] });
      toast.success(full ? "Full fan sync complete" : "Fan sync complete");
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally { setSyncing(false); setSyncProgress(null); }
  }

  const showStart = (safePage - 1) * FANS_PER_PAGE + 1;
  const showEnd   = Math.min(safePage * FANS_PER_PAGE, sortedFans.length);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-0">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            {selectedAccountId && (
              <button onClick={() => setSelectedAccountId(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">Accounts</span>
              </button>
            )}

            {selectedAccount ? (
              <div className="flex items-center gap-3">
                {selectedAccount.avatar_thumb_url ? (
                  <img src={selectedAccount.avatar_thumb_url} alt={selectedAccount.display_name}
                    className="w-9 h-9 rounded-full object-cover border border-border" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {selectedAccount.display_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-bold">{selectedAccount.display_name}</h1>
                  <p className="text-xs text-muted-foreground">Fan analytics · click <Eye className="inline w-3 h-3" /> to view details</p>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-xl font-bold">Fans</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Select a model to view fan analytics</p>
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => handleSync(true)} disabled={syncing} title="Re-fetch all historical transactions (ignores incremental cutoff)">
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncing && "animate-spin")} />
            Full Sync
          </Button>
          <Button size="sm" onClick={() => handleSync()} disabled={syncing}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncing && "animate-spin")} />
            Sync Fans
          </Button>
        </div>

        {syncProgress && (
          <div className="mx-6 mt-4 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 flex items-center gap-3">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" />
            <p className="text-xs text-muted-foreground">{syncProgress}</p>
          </div>
        )}

        {selectedAccountId === null ? (
          // ── GRID VIEW ──────────────────────────────────────────────────────
          <div className="px-6 py-4 flex flex-col gap-4">

            {/* Global KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {globalStatsQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              ) : (
                <>
                  <KpiCard label="Total Fans" value={fmtNum(globalStats?.total_fans)} icon={Users} />
                  <KpiCard label="Spenders" value={fmtNum(globalStats?.spenders)}
                    sub={totalSubsAll > 0 ? `${((globalStats.spenders / totalSubsAll) * 100).toFixed(1)}% of ${fmtNum(totalSubsAll)} subs` : undefined}
                    icon={DollarSign} color="bg-emerald-500" />
                  <KpiCard label="Transactions" value={fmtNum(txCount)} sub={txCount > 0 ? `${txTypeSummary.slice(0,2).map(t => txMeta(t.type).label + " " + fmtNum(t.count)).join(" · ")}` : undefined} icon={TrendingUp} color="bg-primary" />
                  <KpiCard label="Avg / Spender" value={fmt$(globalStats?.avg_per_spender)} icon={DollarSign} />
                  <KpiCard label="Cross-Poll" value={fmtNum(globalStats?.cross_poll_fans)} sub={fmt$(globalStats?.cross_poll_revenue)} icon={GitMerge} color="bg-violet-500" />
                </>
              )}
            </div>

            {/* Revenue by Type + Account carousel — side by side */}
            {(() => {
              const scroll = (dir: 1 | -1) => carouselRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });

              const campRev  = (allTrackingLinks as any[]).filter((tl: any) => !tl.deleted_at && activeAccountIds.has(tl.account_id)).reduce((s, tl) => s + Number(tl.revenue ?? 0), 0);
              const tips     = (accounts as any[]).reduce((s, a) => s + Number(a.ltv_tips ?? 0), 0);
              const subs     = (accounts as any[]).reduce((s, a) => s + Number(a.ltv_subscriptions ?? 0), 0);
              const posts    = (accounts as any[]).reduce((s, a) => s + Number(a.ltv_posts ?? 0), 0);
              const ltvTotal = (accounts as any[]).reduce((s, a) => s + Number(a.ltv_total ?? 0), 0);
              const messages = Math.max(0, ltvTotal - campRev - tips - subs - posts);
              const total    = ltvTotal;
              const pct = (v: number) => total > 0 ? (v / total) * 100 : 0;
              const typeRows = [
                { label: "Campaigns",     revenue: campRev,  color: "#6366f1", badgeClass: "bg-primary/15 text-primary" },
                { label: "Message",       revenue: messages, color: "#10b981", badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
                { label: "Tips",          revenue: tips,     color: "#f59e0b", badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
                { label: "Subscriptions", revenue: subs,     color: "#22d3ee", badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
                { label: "Posts",         revenue: posts,    color: "#8b5cf6", badgeClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
              ].filter(r => r.revenue > 0);

              return (
                <div className="grid grid-cols-5 gap-3">

                  {/* Revenue by Transaction Type — col 1, matches Total Fans KPI width */}
                  {total > 0 && (
                    <div className="col-span-1 flex flex-col">
                      <div className="flex items-center h-9 mb-3">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Revenue by Type</h2>
                      </div>
                      <div className="bg-card border border-border rounded-xl overflow-hidden flex-1 flex flex-col">
                        <div className="px-3 py-3 flex flex-col justify-between flex-1">
                          {[
                            ...typeRows,
                            { label: "TOTAL", revenue: total, color: "", badgeClass: "", isTotal: true },
                          ].map((r: any) => r.isTotal ? (
                            <div key="total" className="border-t border-border/40 pt-2 flex items-center justify-between">
                              <span className="text-xs font-bold text-foreground">TOTAL</span>
                              <span className="text-[11px] font-bold text-foreground tabular-nums">{fmt$(total)}</span>
                            </div>
                          ) : (
                            <div key={r.label}>
                              <div className="flex items-center justify-between mb-1">
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0", r.badgeClass)}>{r.label}</span>
                                <div className="flex items-center gap-1.5 tabular-nums ml-1 min-w-0">
                                  <span className="text-[11px] font-semibold truncate">{fmt$(r.revenue)}</span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">{pct(r.revenue).toFixed(1)}%</span>
                                </div>
                              </div>
                              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct(r.revenue)}%`, background: r.color }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Account cards — remaining 4 cols */}
                  <div className={total > 0 ? "col-span-4" : "col-span-5"}>
                    <div className="flex items-center justify-between mb-3 h-9">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Accounts</h2>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{sortedAccounts.length}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Sorted by fan revenue</span>
                        <AccountFilterDropdown
                          value={accountGridFilter}
                          onChange={setAccountGridFilter}
                          accounts={accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
                        />
                        <button onClick={() => scroll(-1)} className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button onClick={() => scroll(1)} className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {accountsLoading ? (
                      <div className="flex gap-4 overflow-x-auto pb-2">
                        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 w-72 rounded-xl shrink-0" />)}
                      </div>
                    ) : accounts.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="font-semibold">No active accounts</p>
                      </div>
                    ) : (
                      <div ref={carouselRef} className="flex items-start gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth" style={{ scrollbarWidth: "none" }}>
                        {sortedAccounts.map((acc: any, i: number) => {
                          const origIdx = accounts.findIndex((a: any) => a.id === acc.id);
                          return (
                            <div key={acc.id} className="shrink-0 w-72 snap-start">
                              <AccountFanCard
                                account={acc}
                                stats={accountStatsMap[acc.id] ?? null}
                                isLoading={accountStatsQueries[origIdx]?.isLoading ?? false}
                                totalSubs={subsPerAccount[acc.id] ?? 0}
                                rank={i + 1}
                                typeTotals={txTypePerAccount.get(acc.id)}
                                onClick={() => setSelectedAccountId(acc.id)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </div>
              );
            })()}

            {/* ── SPENDERS ACCOUNT SUMMARY ───────────────────────────────── */}
            <div>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Spenders</h2>
              </div>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Account","Spenders","Campaigns","New Subs","Resub","Tips","Messages","Posts","Total"].map((h, i) => (
                          <th key={h} className={cn("px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide", i > 0 ? "text-right" : "text-left")}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAccounts.length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-muted-foreground">No accounts</td></tr>
                      ) : sortedAccounts.map((acc: any) => {
                        const tx = accountTxRevMap.get(acc.id) ?? { new_sub: 0, resub: 0, tip: 0, message: 0, post: 0 };
                        const campCount = (allTrackingLinks as any[]).filter((tl: any) => !tl.deleted_at && tl.account_id === acc.id).length;
                        const spenders = accountStatsMap[acc.id]?.spenders ?? 0;
                        const total = Number(acc.ltv_total ?? 0);
                        return (
                          <tr key={acc.id} onClick={() => setSelectedAccountId(acc.id)}
                            className="border-b border-border/30 hover:bg-muted/30 cursor-pointer transition-colors group">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                {acc.avatar_thumb_url
                                  ? <img src={acc.avatar_thumb_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                                  : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">{acc.display_name.slice(0,2).toUpperCase()}</div>}
                                <span className="font-medium group-hover:text-primary transition-colors">{acc.display_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums"><span className="text-emerald-500 font-semibold">{fmtNum(spenders)}</span></td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{campCount}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-indigo-400 text-xs font-medium">{tx.new_sub > 0 ? fmt$(tx.new_sub) : "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-cyan-400 text-xs font-medium">{tx.resub > 0 ? fmt$(tx.resub) : "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-amber-400 text-xs font-medium">{tx.tip > 0 ? fmt$(tx.tip) : "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 text-xs font-medium">{tx.message > 0 ? fmt$(tx.message) : "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-violet-400 text-xs font-medium">{tx.post > 0 ? fmt$(tx.post) : "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums"><span className="font-bold text-emerald-500">{fmt$(total)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ── CROSS-POLL FANS ──────────────────────────────────────────── */}
            {(() => {
              const cpFans    = crossPollQuery.data ?? [];
              const cpEntries = [...crossPollByAccount.entries()];
              const cpTotal   = cpEntries.reduce((s, [, v]) => s + v.revenue, 0);
              const cpBefore  = cpEntries.reduce((s, [, v]) => s + v.revBefore, 0);
              const cpAfter   = cpEntries.reduce((s, [, v]) => s + v.revAfter,  0);
              const cpCount   = cpFans.length;
              if (!crossPollQuery.isLoading && cpCount === 0) return null;

              return (
                <div>
                  {/* Section header */}
                  <div className="flex items-center gap-2 mb-3">
                    <GitMerge className="w-4 h-4 text-violet-400" />
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cross-Poll Earnings</h2>
                    {cpCount > 0 && (
                      <span className="text-xs bg-violet-500/15 text-violet-400 px-2 py-0.5 rounded-full font-medium">
                        {fmtNum(cpCount)} fans
                      </span>
                    )}
                  </div>

                  {crossPollQuery.isLoading ? (
                    <div className="space-y-2">
                      {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
                    </div>
                  ) : (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      {/* Table header */}
                      <div className="grid items-center px-4 py-2 bg-muted/30 border-b border-border/60 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                        style={{ gridTemplateColumns: "1fr 60px 110px" }}>
                        <span>Account / Campaign</span>
                        <span className="text-right">Fans</span>
                        <span className="text-right">Revenue</span>
                      </div>

                      {/* Grand total row */}
                      <div className="grid items-center px-4 py-2.5 border-b border-border/40 bg-violet-500/5"
                        style={{ gridTemplateColumns: "1fr 60px 110px" }}>
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          <GitMerge className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          All Accounts
                        </div>
                        <span className="text-right text-xs text-muted-foreground tabular-nums">{fmtNum(cpCount)}</span>
                        <span className="text-right font-bold text-sm text-emerald-400 tabular-nums">{fmt$(cpTotal)}</span>
                      </div>

                      {/* Account rows */}
                      {sortedAccounts.map((acc: any) => {
                        const cpAcc = crossPollByAccount.get(acc.id);
                        if (!cpAcc) return null;
                        const isAccOpen = expandedCpAccounts.has(acc.id);

                        return (
                          <div key={acc.id} className="border-b border-border/30 last:border-0">
                            {/* Account row */}
                            <button
                              onClick={() => toggleCpAccount(acc.id)}
                              className="w-full grid items-center px-4 py-2.5 hover:bg-muted/20 transition-colors text-left"
                              style={{ gridTemplateColumns: "1fr 60px 110px" }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", isAccOpen && "rotate-90")} />
                                {acc.avatar_thumb_url
                                  ? <img src={acc.avatar_thumb_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                                  : <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center text-[9px] font-bold text-violet-400 shrink-0">{acc.display_name.slice(0,2).toUpperCase()}</div>}
                                <span className="font-medium text-sm truncate">{acc.display_name}</span>
                              </div>
                              <span className="text-right text-xs text-muted-foreground tabular-nums">{fmtNum(cpAcc.fanCount)}</span>
                              <span className="text-right font-semibold text-sm text-emerald-400 tabular-nums">{fmt$(cpAcc.revenue)}</span>
                            </button>

                            {/* Campaign rows */}
                            {isAccOpen && (
                              <div className="border-t border-border/20 bg-muted/5">
                                {[...cpAcc.byCampaign.entries()]
                                  .sort(([,a],[,b]) => b.revenue - a.revenue)
                                  .map(([campKey, camp]) => {
                                    const campId     = acc.id + ":" + campKey;
                                    const isCampOpen = expandedCpCampaigns.has(campId);
                                    return (
                                      <div key={campKey} className="border-b border-border/15 last:border-0">
                                        {/* Campaign row */}
                                        {(() => {
                                          const tl = camp.tlId ? allTlMap[camp.tlId] : null;
                                          return (
                                        <button
                                          onClick={() => toggleCpCampaign(campId)}
                                          className="w-full grid items-center pl-10 pr-4 py-2.5 hover:bg-muted/20 transition-colors text-left"
                                          style={{ gridTemplateColumns: "1fr 60px 110px" }}
                                        >
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <ChevronRight className={cn("w-3 h-3 text-muted-foreground/60 shrink-0 transition-transform", isCampOpen && "rotate-90")} />
                                            <div className="min-w-0">
                                              <div className="text-xs font-semibold truncate">{camp.campaignName}</div>
                                              {tl?.url ? (
                                                <span className="text-[10px] text-sky-500 truncate block max-w-xs" title={tl.url}>
                                                  {tl.url}
                                                </span>
                                              ) : (
                                                <span className="text-[10px] text-muted-foreground/40">No URL</span>
                                              )}
                                            </div>
                                          </div>
                                          <span className="text-right text-[11px] text-muted-foreground/70 tabular-nums">{fmtNum(camp.fanCount)}</span>
                                          <span className="text-right text-xs font-medium text-emerald-400 tabular-nums">{fmt$(camp.revenue)}</span>
                                        </button>
                                          );
                                        })()}

                                        {/* Campaign detail card + fan rows */}
                                        {isCampOpen && (() => {
                                          const tl = camp.tlId ? allTlMap[camp.tlId] : null;
                                          return (
                                          <div className="border-t border-border/10">
                                            {/* Campaign info card */}
                                            <div className="mx-10 my-3 rounded-xl border border-border/50 bg-card overflow-hidden">
                                              <div className="px-4 py-3 bg-muted/20 border-b border-border/40 flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                  <div className="font-semibold text-sm">{camp.campaignName}</div>
                                                  {tl?.url ? (
                                                    <a href={tl.url} target="_blank" rel="noopener noreferrer"
                                                      className="text-xs text-sky-400 hover:text-sky-300 break-all mt-0.5 block">
                                                      {tl.url}
                                                    </a>
                                                  ) : (
                                                    <span className="text-xs text-muted-foreground/50 mt-0.5 block">No URL set</span>
                                                  )}
                                                  {tl?.created_at && (
                                                    <div className="text-[10px] text-muted-foreground mt-1">
                                                      Added {fmtDate(tl.created_at)}
                                                      {tl?.source_tag && <span className="ml-2 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tl.source_tag}</span>}
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="shrink-0 text-right">
                                                  <div className="text-xs text-muted-foreground">Cross-poll rev</div>
                                                  <div className="font-bold text-sm text-emerald-400 tabular-nums">{fmt$(camp.revenue)}</div>
                                                  <div className="text-[10px] text-muted-foreground mt-1">{fmtNum(camp.fanCount)} fan{camp.fanCount !== 1 ? "s" : ""}</div>
                                                </div>
                                              </div>
                                              <div className="grid grid-cols-3 divide-x divide-border/30">
                                                <div className="px-3 py-2 text-center">
                                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Revenue</div>
                                                  <div className="text-sm font-semibold tabular-nums text-emerald-400">{fmt$(camp.revenue)}</div>
                                                </div>
                                                <div className="px-3 py-2 text-center">
                                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Fans</div>
                                                  <div className="text-sm font-semibold tabular-nums">{fmtNum(camp.fanCount)}</div>
                                                </div>
                                                <div className="px-3 py-2 text-center">
                                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg / Fan</div>
                                                  <div className="text-sm font-semibold tabular-nums text-emerald-400">{camp.fanCount > 0 ? fmt$(camp.revenue / camp.fanCount) : "—"}</div>
                                                </div>
                                              </div>
                                            </div>

                                            {/* Fan list */}
                                            <div className="bg-muted/10">
                                            {camp.fans
                                              .sort((a, b) => Number(b.total_revenue ?? 0) - Number(a.total_revenue ?? 0))
                                              .map(fan => {
                                                const isFanOpen = expandedCpFans.has(fan.id);
                                                const accRev    = fan.per_account_revenue.find((p: any) => p.account_id === acc.id);
                                                const fanAccRev = Number(accRev?.revenue ?? 0);
                                                const fanBefore = Number(accRev?.rev_before ?? 0);
                                                const fanAfter  = Number(accRev?.rev_after  ?? 0);
                                                const otherAccs = fan.per_account_revenue.filter((p: any) => p.account_id !== acc.id);
                                                return (
                                                  <Fragment key={fan.id}>
                                                    <div
                                                      onClick={() => toggleCpFan(fan.id)}
                                                      className={cn(
                                                        "grid items-center pl-16 pr-4 py-2 cursor-pointer hover:bg-muted/30 transition-colors border-t border-border/10",
                                                        isFanOpen && "bg-muted/20"
                                                      )}
                                                      style={{ gridTemplateColumns: "1fr 60px 110px" }}
                                                    >
                                                      <div className="flex items-center gap-2 min-w-0">
                                                        <ChevronRight className={cn("w-2.5 h-2.5 text-muted-foreground/50 shrink-0 transition-transform", isFanOpen && "rotate-90")} />
                                                        {fan.avatar_url
                                                          ? <img src={fan.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                                                          : <div className="w-5 h-5 rounded-full bg-violet-500/15 flex items-center justify-center text-[8px] font-bold text-violet-400 shrink-0">
                                                              {((fan.username ?? fan.fan_id) as string).slice(0,2).toUpperCase()}
                                                            </div>}
                                                        <div className="min-w-0">
                                                          <div className="text-[11px] font-medium truncate">{fan.display_name || fan.username || fan.fan_id}</div>
                                                          <div className="flex items-center gap-1 mt-0.5">
                                                            {otherAccs.map((p: any) => {
                                                              const oa = accountMap[p.account_id];
                                                              return oa?.avatar_thumb_url
                                                                ? <img key={p.account_id} src={oa.avatar_thumb_url} alt={oa.display_name} title={`${oa.display_name} · ${fmt$(Number(p.revenue))}`} className="w-3.5 h-3.5 rounded-full object-cover" />
                                                                : <div key={p.account_id} title={`${oa?.display_name || p.account_id} · ${fmt$(Number(p.revenue))}`} className="w-3.5 h-3.5 rounded-full bg-muted flex items-center justify-center text-[7px] font-bold text-muted-foreground">
                                                                    {(oa?.display_name || "?").slice(0,2).toUpperCase()}
                                                                  </div>;
                                                            })}
                                                          </div>
                                                        </div>
                                                      </div>
                                                      <span className="text-right text-[10px] text-muted-foreground/50">—</span>
                                                      <span className="text-right text-[11px] font-medium text-emerald-400 tabular-nums">{fmt$(fanAccRev)}</span>
                                                    </div>
                                                    {isFanOpen && (
                                                      <div className="pl-14 pr-4 pb-3 border-t border-border/10">
                                                        <FanDetailDropdown fan={fan} allTrackingLinks={allTrackingLinks as any[]} accountMap={accountMap} />
                                                      </div>
                                                    )}
                                                  </Fragment>
                                                );
                                              })}
                                            </div>{/* /fan list */}
                                          </div>
                                          );
                                        })()}
                                      </div>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

          </div>

        ) : (
          // ── DETAIL VIEW ────────────────────────────────────────────────────
          <div className="p-6 flex flex-col gap-5">

            {/* Revenue trend chart — monthly from transactions */}
            <AccountRevenueChart accountId={selectedAccountId!} />

            {/* Fan metrics row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {selectedStatsQuery.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              ) : (
                <>
                  <KpiCard label="Total Fans" value={fmtNum(selectedStats?.total_fans)} icon={Users} />
                  <KpiCard label="Spenders" value={fmtNum(selectedStats?.spenders)}
                    sub={selectedAccountId && subsPerAccount[selectedAccountId] > 0
                      ? `${((selectedStats.spenders / subsPerAccount[selectedAccountId]) * 100).toFixed(1)}% of ${fmtNum(subsPerAccount[selectedAccountId])} subs`
                      : undefined}
                    icon={DollarSign} color="bg-emerald-500" />
                  <KpiCard label="Avg / Spender" value={fmt$(selectedStats?.avg_per_spender)} icon={DollarSign} />
                  <KpiCard label="Cross-Poll" value={fmtNum(selectedStats?.cross_poll_fans)} sub={fmt$(selectedStats?.cross_poll_revenue)} icon={GitMerge} color="bg-violet-500" />
                </>
              )}
            </div>

            {/* Filter + sort bar */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search fan or username..." value={search}
                  onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              {/* Campaign filter */}
              {(trackingLinks as any[]).length > 0 && (
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                  <SelectTrigger className="w-52 h-8 text-sm">
                    <SelectValue placeholder="All campaigns" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All campaigns</SelectItem>
                    {(trackingLinks as any[]).map((tl: any) => (
                      <SelectItem key={tl.id} value={tl.id}>
                        {tl.campaign_name || tl.external_tracking_link_id || tl.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Spenders toggle */}
              <button onClick={() => setSpendersOnly(v => !v)}
                className={cn("h-8 px-3 rounded-md border text-xs font-medium transition-colors",
                  spendersOnly
                    ? "bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                )}>
                Spenders only
              </button>

              {/* Sort pills */}
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-muted-foreground mr-1">Sort:</span>
                <SortPill label="Revenue"  active={sortKey === "revenue"}      onClick={() => setSortKey("revenue")} />
                <SortPill label="Txns"     active={sortKey === "transactions"} onClick={() => setSortKey("transactions")} />
                <SortPill label="Recent"   active={sortKey === "last_seen"}    onClick={() => setSortKey("last_seen")} />
              </div>
            </div>

            {/* Fan count + pagination summary */}
            {!isLoadingFans && sortedFans.length > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground -mb-2">
                <span>Showing {fmtNum(showStart)}–{fmtNum(showEnd)} of {fmtNum(sortedFans.length)} fans</span>
                {totalFans > 500 && (
                  <span className="text-amber-500">Showing top 500 — use search to find specific fans</span>
                )}
              </div>
            )}

            {/* Fan table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fan</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Campaign</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lifetime Value</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Messages</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Subscription Start</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Last Active</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Subscription</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingFans ? (
                    Array.from({ length: 15 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {[180, 130, 100, 60, 120, 120, 70, 64].map((w, j) => (
                          <td key={j} className={cn("px-4 py-3", j === 1 ? "hidden lg:table-cell" : j === 4 ? "hidden md:table-cell" : j === 5 ? "hidden md:table-cell" : j === 6 ? "hidden lg:table-cell" : "")}>
                            <Skeleton className="h-4 rounded" style={{ width: w }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : paginatedFans.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center">
                        <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        {totalFans === 0 && txCount > 0 ? (
                          <>
                            <p className="font-semibold text-sm">No fan profiles for this account</p>
                            <p className="text-xs text-muted-foreground mt-1">Run a Fan Sync to build profiles.</p>
                            <Button size="sm" className="mt-3" onClick={handleSync} disabled={syncing}>
                              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncing && "animate-spin")} />
                              Sync Fans Now
                            </Button>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">No fans match your filters</p>
                        )}
                      </td>
                    </tr>
                  ) : (
                    paginatedFans.map((fan: any, rowIdx: number) => {
                      const rev      = Number(fan.total_revenue ?? 0);
                      const tips     = Number(fan.tip_revenue ?? 0);
                      const msgCount = Number(fan.message_count ?? 0);
                      const isSpender = rev > 0;
                      const globalRank = (safePage - 1) * FANS_PER_PAGE + rowIdx + 1;
                      const isTopFan = globalRank === 1 && sortKey === "revenue";
                      const statusVal = (fan.status ?? "").toLowerCase();
                      const subDate = fan.first_subscribe_date || fan.first_transaction_at;

                      const isExpanded = expandedFans.has(fan.id);
                      return (
                        <Fragment key={fan.id}>
                          <tr
                            onClick={() => toggleExpand(fan.id)}
                            className={cn(
                              "border-b border-border/40 cursor-pointer hover:bg-muted/20 transition-colors",
                              isExpanded && "bg-muted/10"
                            )}>
                            {/* Fan */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-150", isExpanded && "rotate-90")} />
                                <FanAvatar fan={fan} size={32} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-sm truncate max-w-40">
                                      {fan.display_name || fan.username || fan.fan_id}
                                    </span>
                                    {isTopFan && <Award className="w-3 h-3 text-amber-400 shrink-0" title="Top spender" />}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate max-w-40">
                                    @{fan.username || fan.fan_id}
                                    {fan.is_cross_poll && <span className="ml-1.5 text-violet-500">· cross-poll</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            {/* Campaign */}
                            {(() => {
                              const tl = fan.first_subscribe_link_id ? allTlMap[fan.first_subscribe_link_id] : null;
                              return (
                                <td className="px-4 py-3 hidden lg:table-cell">
                                  {tl ? (
                                    <>
                                      <div className="text-xs font-medium truncate max-w-40" title={tl.campaign_name || tl.external_tracking_link_id || tl.id}>
                                        {tl.campaign_name || tl.external_tracking_link_id || "—"}
                                      </div>
                                      {tl.url ? (
                                        <a href={tl.url} target="_blank" rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="text-[11px] text-sky-500 hover:text-sky-400 truncate max-w-40 block"
                                          title={tl.url}>
                                          {tl.url.replace(/^https?:\/\//, "").slice(0, 36)}{tl.url.length > 42 ? "…" : ""}
                                        </a>
                                      ) : (
                                        <span className="text-[11px] text-muted-foreground/50">No URL</span>
                                      )}
                                    </>
                                  ) : <span className="text-muted-foreground text-xs">—</span>}
                                </td>
                              );
                            })()}
                            {/* Lifetime Value */}
                            <td className="px-4 py-3">
                              <div className={cn("font-semibold tabular-nums text-sm", isSpender ? "" : "text-muted-foreground")}>
                                {isSpender ? fmt$(rev) : "—"}
                              </div>
                              {tips > 0 && <div className="text-xs text-muted-foreground">Tips: {fmt$(tips)}</div>}
                            </td>
                            {/* Messages */}
                            <td className="px-4 py-3">
                              <span className="tabular-nums text-sm">{msgCount > 0 ? fmtNum(msgCount) : "—"}</span>
                            </td>
                            {/* Subscription Start */}
                            <td className="px-4 py-3 hidden md:table-cell">
                              {subDate ? (
                                <>
                                  <div className="text-sm">{fmtDateTime(subDate)}</div>
                                  <div className="text-xs text-muted-foreground">{timeAgo(subDate)}</div>
                                </>
                              ) : <span className="text-muted-foreground text-sm">—</span>}
                            </td>
                            {/* Last Active */}
                            <td className="px-4 py-3 hidden md:table-cell">
                              {fan.last_transaction_at ? (
                                <>
                                  <div className="text-sm">{fmtDateTime(fan.last_transaction_at)}</div>
                                  <div className="text-xs text-muted-foreground">{timeAgo(fan.last_transaction_at)}</div>
                                </>
                              ) : <span className="text-muted-foreground text-sm">—</span>}
                            </td>
                            {/* Subscription status */}
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {statusVal ? (
                                <span className={cn(
                                  "px-2.5 py-1 rounded-full text-xs font-semibold",
                                  statusVal === "active"   ? "bg-emerald-500/20 text-emerald-400" :
                                  statusVal === "expired"  ? "bg-red-500/20 text-red-400" :
                                  statusVal === "inactive" ? "bg-yellow-500/20 text-yellow-400" :
                                                             "bg-muted text-muted-foreground"
                                )}>
                                  {statusVal.charAt(0).toUpperCase() + statusVal.slice(1)}
                                </span>
                              ) : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            {/* Actions */}
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={e => { e.stopPropagation(); setEditFan(fan); }}
                                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  title="Edit notes">
                                  <Sparkles className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="border-b border-border/40">
                              <td colSpan={8} className="p-0">
                                <FanDetailDropdown fan={fan} allTrackingLinks={allTrackingLinks as any[]} accountMap={accountMap} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Bottom pagination */}
              {totalFanPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
                  <span className="text-xs text-muted-foreground">
                    Page {safePage} of {totalFanPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setFanPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                      className="p-1.5 rounded hover:bg-secondary disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {Array.from({ length: Math.min(totalFanPages, 7) }, (_, i) => {
                      const pg = totalFanPages <= 7 ? i + 1
                        : safePage <= 4 ? i + 1
                        : safePage >= totalFanPages - 3 ? totalFanPages - 6 + i
                        : safePage - 3 + i;
                      return (
                        <button key={pg} onClick={() => setFanPage(pg)}
                          className={cn("w-8 h-8 rounded text-xs font-medium transition-colors",
                            pg === safePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          )}>
                          {pg}
                        </button>
                      );
                    })}
                    <button onClick={() => setFanPage(p => Math.min(totalFanPages, p + 1))} disabled={safePage >= totalFanPages}
                      className="p-1.5 rounded hover:bg-secondary disabled:opacity-30">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fan edit sheet */}
      <Sheet open={!!editFan} onOpenChange={open => { if (!open) setEditFan(null); }}>
        <SheetContent className="w-[380px] sm:max-w-[380px] overflow-y-auto p-0">
          {editFan && (
            <FanEditPanel fan={editFan} onClose={() => setEditFan(null)}
              onUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ["fans_list"] });
                queryClient.invalidateQueries({ queryKey: ["fan_detail", editFan.id] });
              }} />
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

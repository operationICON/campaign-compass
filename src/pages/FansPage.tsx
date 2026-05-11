import { useState, useMemo, useEffect, useRef } from "react";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getFanStats, getFans, getFan, getFanSpendersBreakdown, updateFan, streamSync, getAccounts, getTransactionTotals, getTransactionTypeTotals, getTransactionsByMonth, getTrackingLinks, getCampaignRevenueByType } from "@/lib/api";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, DollarSign, TrendingUp, RefreshCw,
  Search, ChevronDown, ChevronRight, ChevronLeft, GitMerge, X,
  ExternalLink, ArrowLeft, Award,
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

const TX_TYPE_META: Record<string, { label: string; color: string }> = {
  new_subscription:       { label: "New Sub",  color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  recurring_subscription: { label: "Resub",    color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  tip:                    { label: "Tip",       color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  message:                { label: "Message",   color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  post:                   { label: "Post",      color: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
};
function txMeta(type: string | null) {
  return TX_TYPE_META[type ?? ""] ?? { label: type ?? "Other", color: "bg-muted text-muted-foreground" };
}

const TYPE_BAR_COLOR: Record<string, string> = {
  new_subscription:       "#6366f1",
  recurring_subscription: "#22d3ee",
  tip:                    "#f59e0b",
  message:                "#10b981",
  post:                   "#8b5cf6",
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
  totalSubs: number; rank: number; typeTotals?: Array<{ type: string; revenue: number }>; onClick: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const spenderPct = totalSubs > 0 ? (stats?.spenders ?? 0) / totalSubs * 100 : 0;
  const hasData = stats && (stats.total_fans > 0 || stats.total_revenue > 0);
  const breakdownTotal = typeTotals?.reduce((s, b) => s + b.revenue, 0) ?? 0;

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all group relative overflow-hidden"
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
      <div className="flex items-center gap-3 mb-4">
        {account.avatar_thumb_url ? (
          <img src={account.avatar_thumb_url} alt={account.display_name}
            className="w-12 h-12 rounded-full object-cover border-2 border-border flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground flex-shrink-0">
            {account.display_name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 pr-6">
          <div className="font-bold text-sm truncate">{account.display_name}</div>
          {isLoading ? (
            <Skeleton className="h-4 w-24 mt-1" />
          ) : hasData ? (
            <div className="text-base font-bold text-emerald-500 tabular-nums">{fmt$(stats.total_revenue)}</div>
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Subs</div>
              <div className="text-lg font-bold tabular-nums">{totalSubs > 0 ? fmtNum(totalSubs) : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spenders</div>
              <div className="text-lg font-bold tabular-nums text-emerald-500">{fmtNum(stats.spenders)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg / Spender</div>
              <div className="text-sm font-semibold tabular-nums">{fmt$(stats.avg_per_spender)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cross-Poll</div>
              <div className="text-sm font-semibold tabular-nums text-violet-500">{fmtNum(stats.cross_poll_fans)}</div>
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
            <div className="mt-3 pt-3 border-t border-border/40">
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
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", meta.color)}>{meta.label}</span>
                          <div className="flex items-center gap-2 text-[10px] tabular-nums">
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

      <div className="mt-4 flex items-center justify-end">
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
  const [spendersModelFilter, setSpendersModelFilter] = useState<string[]>([]);
  const [spendersCampaignFilter, setSpendersCampaignFilter] = useState<string>("all");
  const [spendersSearch, setSpendersSearch] = useState("");
  const [campaignsSearch, setCampaignsSearch] = useState("");
  const [spendersPage, setSpendersPage] = useState(1);
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
  useEffect(() => { setSpendersPage(1); }, [spendersModelFilter, spendersCampaignFilter, spendersSearch]);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await getAccounts() || []).filter((a: any) => a.is_active),
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

  const subsPerAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tl of allTrackingLinks as any[]) {
      if (tl.account_id) map[tl.account_id] = (map[tl.account_id] ?? 0) + Number(tl.subscribers || 0);
    }
    return map;
  }, [allTrackingLinks]);

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
    queryFn: () => getTransactionTypeTotals() as Promise<Array<{ account_id: string | null; type: string | null; revenue: number }>>,
    staleTime: 60_000,
    enabled: selectedAccountId === null,
  });

  const campaignRevenueByTypeQuery = useQuery({
    queryKey: ["campaign_revenue_by_type"],
    queryFn: () => getCampaignRevenueByType(),
    staleTime: 120_000,
  });

  const campaignTypeMap = useMemo(() => {
    const map: Record<string, any> = {};
    for (const row of (campaignRevenueByTypeQuery.data ?? [])) {
      map[row.tracking_link_id] = row;
    }
    return map;
  }, [campaignRevenueByTypeQuery.data]);

  const spendersBreakdownQuery = useQuery({
    queryKey: ["fans_spenders_breakdown", spendersModelFilter.length === 1 ? spendersModelFilter[0] : null, spendersCampaignFilter, spendersSearch],
    queryFn: () => getFanSpendersBreakdown({
      account_id: spendersModelFilter.length === 1 ? spendersModelFilter[0] : undefined,
      tracking_link_id: spendersCampaignFilter !== "all" ? spendersCampaignFilter : undefined,
      search: spendersSearch || undefined,
      limit: 10000,
    }),
    staleTime: 60_000,
    enabled: selectedAccountId === null,
  });

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
      map.set(type, cur);
    }
    return [...map.entries()].map(([type, d]) => ({ type, ...d })).sort((a, b) => b.revenue - a.revenue);
  }, [txTypeTotalsQuery.data]);

  const txTypePerAccount = useMemo(() => {
    const map = new Map<string, Array<{ type: string; revenue: number }>>();
    for (const r of (txTypeTotalsQuery.data ?? [])) {
      const accId = r.account_id;
      if (!accId) continue;
      const type = r.type ?? "other";
      const rev = Number(r.revenue ?? 0);
      if (rev <= 0) continue;
      const arr = map.get(accId) ?? [];
      arr.push({ type, revenue: rev });
      map.set(accId, arr);
    }
    for (const [key, arr] of map.entries()) {
      map.set(key, arr.sort((a, b) => b.revenue - a.revenue));
    }
    return map;
  }, [txTypeTotalsQuery.data]);

  const SPENDERS_PER_PAGE = 50;
  const spendersServerTotal = spendersBreakdownQuery.data?.total ?? 0;
  const spendersRows = useMemo(() => {
    const raw = spendersBreakdownQuery.data?.rows ?? [];
    if (spendersModelFilter.length > 1) {
      return raw.filter((r: any) => {
        const ids: string[] = (r.account_ids ?? "").split(",").filter(Boolean);
        return spendersModelFilter.some(m => ids.includes(m));
      });
    }
    return raw;
  }, [spendersBreakdownQuery.data, spendersModelFilter]);

  const spendersTotalPages = Math.max(1, Math.ceil(spendersRows.length / SPENDERS_PER_PAGE));
  const safeSpendersPage = Math.min(spendersPage, spendersTotalPages);
  const paginatedSpenders = spendersRows.slice(
    (safeSpendersPage - 1) * SPENDERS_PER_PAGE,
    safeSpendersPage * SPENDERS_PER_PAGE
  );

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

  // Max revenue for relative bar per fan
  const maxFanRevenue = useMemo(
    () => Math.max(...rawFans.map(f => Number(f.total_revenue ?? 0)), 1),
    [rawFans]
  );

  const accountMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of accounts) m[(a as any).id] = a;
    return m;
  }, [accounts]);

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
                  <p className="text-xs text-muted-foreground">Fan analytics · click a fan to expand transactions</p>
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
                  <KpiCard label="Fan Revenue" value={fmt$(globalStats?.total_revenue)} icon={TrendingUp} color="bg-primary" />
                  <KpiCard label="Avg / Spender" value={fmt$(globalStats?.avg_per_spender)} icon={DollarSign} />
                  <KpiCard label="Cross-Poll" value={fmtNum(globalStats?.cross_poll_fans)} sub={fmt$(globalStats?.cross_poll_revenue)} icon={GitMerge} color="bg-violet-500" />
                </>
              )}
            </div>

            {/* Revenue breakdown + reconciliation */}
            {txTypeSummary.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                  <h3 className="text-sm font-semibold">Revenue by Transaction Type</h3>
                  {(() => {
                    const fanTotal = globalStats?.total_revenue ?? 0;
                    const delta = Math.abs(txGrandTotal - fanTotal);
                    const pct = txGrandTotal > 0 ? (delta / txGrandTotal) * 100 : 0;
                    const matched = pct < 1;
                    return (
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", matched ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
                        {matched ? "✓ Reconciled" : `⚠ ${fmt$(delta)} delta — run Fan Sync`}
                      </span>
                    );
                  })()}
                </div>
                <div className="px-5 py-4 space-y-3">
                  {txTypeSummary.map(b => {
                    const meta = txMeta(b.type);
                    const pct = txGrandTotal > 0 ? (b.revenue / txGrandTotal) * 100 : 0;
                    const color = TYPE_BAR_COLOR[b.type] ?? "#64748b";
                    return (
                      <div key={b.type}>
                        <div className="flex items-center justify-between mb-1 text-xs">
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", meta.color)}>{meta.label}</span>
                          <div className="flex items-center gap-3 tabular-nums">
                            <span className="font-semibold">{fmt$(b.revenue)}</span>
                            <span className="text-muted-foreground w-8 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const campTotal = (campaignRevenueByTypeQuery.data ?? [])
                      .reduce((s, r) => s + Number(r.total_revenue), 0);
                    const unattributed = txGrandTotal - campTotal;
                    return (
                      <div className="pt-3 border-t border-border/40 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Campaign</span>
                          <span className="font-semibold text-foreground tabular-nums">{fmt$(campTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Unattributed</span>
                          <span className="font-semibold text-foreground tabular-nums">{fmt$(unattributed)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                          <span className="font-semibold text-foreground">Total</span>
                          <span className="font-bold text-foreground tabular-nums">{fmt$(txGrandTotal)}</span>
                        </div>
                        <div className="flex justify-end pt-0.5">
                          <span className="text-muted-foreground text-[11px]">{fmtNum(txCount)} transactions</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Account cards — sorted by fan revenue */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Accounts</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{sortedAccounts.length}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Sorted by fan revenue</span>
                  <AccountFilterDropdown
                    value={accountGridFilter}
                    onChange={setAccountGridFilter}
                    accounts={accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
                  />
                </div>
              </div>

              {accountsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="font-semibold">No active accounts</p>
                  <p className="text-sm mt-1">Add accounts in Settings to get started.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedAccounts.map((acc: any, i: number) => {
                    const origIdx = accounts.findIndex((a: any) => a.id === acc.id);
                    return (
                      <AccountFanCard
                        key={acc.id}
                        account={acc}
                        stats={accountStatsMap[acc.id] ?? null}
                        isLoading={accountStatsQueries[origIdx]?.isLoading ?? false}
                        totalSubs={subsPerAccount[acc.id] ?? 0}
                        rank={i + 1}
                        typeTotals={txTypePerAccount.get(acc.id)}
                        onClick={() => setSelectedAccountId(acc.id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── ALL SPENDERS TABLE ─────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">All Spenders</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{spendersRows.length}</span>
                  {!spendersBreakdownQuery.isLoading && (() => {
                    const kpiSpenders = globalStats?.spenders ?? 0;
                    const loaded = spendersRows.length;
                    const serverTotal = spendersServerTotal;
                    const matched = loaded >= serverTotal && Math.abs(loaded - kpiSpenders) <= 2;
                    if (kpiSpenders === 0) return null;
                    return (
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", matched ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
                        {matched ? `✓ All ${kpiSpenders.toLocaleString()} spenders loaded` : `${loaded.toLocaleString()} of ${kpiSpenders.toLocaleString()} — run Fan Sync to reconcile`}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <AccountFilterDropdown
                  value={spendersModelFilter}
                  onChange={setSpendersModelFilter}
                  accounts={accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
                />
                <select
                  value={spendersCampaignFilter}
                  onChange={e => setSpendersCampaignFilter(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="all">All Campaigns</option>
                  {(allTrackingLinks as any[])
                    .filter((tl: any) => !tl.deleted_at)
                    .map((tl: any) => (
                      <option key={tl.id} value={tl.id}>{tl.campaign_name || tl.id}</option>
                    ))}
                </select>
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search fan…"
                    value={spendersSearch}
                    onChange={e => setSpendersSearch(e.target.value)}
                    className="w-full h-10 pl-8 pr-3 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fan</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Model</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campaign</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-indigo-400 uppercase tracking-wide">New Subs</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-cyan-400 uppercase tracking-wide">Resub</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-amber-400 uppercase tracking-wide">Tips</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-emerald-400 uppercase tracking-wide">Messages</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-violet-400 uppercase tracking-wide">Posts</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-foreground uppercase tracking-wide">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spendersBreakdownQuery.isLoading ? (
                        Array.from({ length: 10 }).map((_, i) => (
                          <tr key={i} className="border-b border-border/40">
                            <td colSpan={9} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td>
                          </tr>
                        ))
                      ) : paginatedSpenders.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-xs">No spenders found</td>
                        </tr>
                      ) : paginatedSpenders.map((fan: any, i: number) => {
                        const fanName = fan.username ? `@${fan.username}` : fan.display_name || fan.fan_id;
                        const accountIds: string[] = (fan.account_ids ?? "").split(",").filter(Boolean);
                        const primaryAccId = fan.acquired_via_account_id || accountIds[0];
                        const primaryAcc = primaryAccId ? (accounts as any[]).find((a: any) => a.id === primaryAccId) : null;
                        const campaignLink = fan.first_subscribe_link_id
                          ? (allTrackingLinks as any[]).find((tl: any) => tl.id === fan.first_subscribe_link_id)
                          : null;
                        const newSubRev = Number(fan.new_sub_revenue ?? 0);
                        const resubRev  = Number(fan.resub_revenue ?? 0);
                        const tipRev    = Number(fan.tip_revenue ?? 0);
                        const msgRev    = Number(fan.message_revenue ?? 0);
                        const postRev   = Number(fan.post_revenue ?? 0);
                        return (
                          <tr key={fan.id ?? i} className={cn("border-b border-border/30 hover:bg-muted/20 transition-colors", i % 2 === 0 ? "" : "bg-muted/10")}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {fan.avatar_url ? (
                                  <img src={fan.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                                ) : (
                                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">
                                    {(fan.username || fan.fan_id || "?").slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                                <span className="font-medium truncate max-w-[140px]">{fanName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {primaryAcc ? (
                                <div className="flex items-center gap-1.5">
                                  {primaryAcc.avatar_thumb_url ? (
                                    <img src={primaryAcc.avatar_thumb_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary flex-shrink-0">
                                      {(primaryAcc.display_name || "?").slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="text-xs text-muted-foreground truncate max-w-[100px]">{primaryAcc.display_name}</span>
                                </div>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
                                {campaignLink?.campaign_name || (fan.first_subscribe_link_id ? "Unknown" : "—")}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-indigo-400 text-xs font-medium">{newSubRev > 0 ? fmt$(newSubRev) : "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-cyan-400 text-xs font-medium">{resubRev > 0 ? fmt$(resubRev) : "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-amber-400 text-xs font-medium">{tipRev > 0 ? fmt$(tipRev) : "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-emerald-400 text-xs font-medium">{msgRev > 0 ? fmt$(msgRev) : "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-violet-400 text-xs font-medium">{postRev > 0 ? fmt$(postRev) : "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-500">{fmt$(Number(fan.total_revenue ?? 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {spendersTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                    <span>Showing {(safeSpendersPage - 1) * SPENDERS_PER_PAGE + 1}–{Math.min(safeSpendersPage * SPENDERS_PER_PAGE, spendersRows.length)} of {spendersRows.length}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSpendersPage(p => Math.max(1, p - 1))} disabled={safeSpendersPage === 1}
                        className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span>{safeSpendersPage} / {spendersTotalPages}</span>
                      <button onClick={() => setSpendersPage(p => Math.min(spendersTotalPages, p + 1))} disabled={safeSpendersPage === spendersTotalPages}
                        className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

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
                    <th className="w-8 px-3 py-2.5" />
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Fan</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Campaign</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">First seen</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Last seen</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-14">Txns</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {isLoadingFans ? (
                    Array.from({ length: 15 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {[28, 160, 120, 80, 80, 80, 32, 0].map((w, j) => (
                          <td key={j} className={cn("px-3 py-3", j === 2 ? "hidden lg:table-cell" : j === 3 || j === 4 ? "hidden md:table-cell" : "")}>
                            {w > 0 && <Skeleton className={`h-4 rounded`} style={{ width: w }} />}
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
                      const rev = Number(fan.total_revenue ?? 0);
                      const isSpender = rev > 0;
                      const isExpanded = expandedFans.has(fan.id);
                      const campaignTl = fan.first_subscribe_link_id ? tlMap[fan.first_subscribe_link_id] : null;
                      const revPct = isSpender ? (rev / maxFanRevenue) * 100 : 0;
                      const globalRank = (safePage - 1) * FANS_PER_PAGE + rowIdx + 1;
                      const isTopFan = globalRank === 1 && sortKey === "revenue";

                      return (
                        <>
                          <tr key={fan.id}
                            onClick={() => toggleExpand(fan.id)}
                            className={cn(
                              "border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors",
                              isExpanded && "bg-muted/20"
                            )}>
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <FanAvatar fan={fan} size={26} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-sm truncate max-w-40">
                                      {fan.username ? `@${fan.username}` : fan.fan_id}
                                    </span>
                                    {isTopFan && (
                                      <Award className="w-3 h-3 text-amber-400 flex-shrink-0" title="Top spender" />
                                    )}
                                  </div>
                                  {fan.is_cross_poll && (
                                    <span className="text-[10px] text-violet-500 flex items-center gap-0.5">
                                      <GitMerge className="w-2.5 h-2.5" /> cross-poll
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 hidden lg:table-cell">
                              {campaignTl ? (
                                <span className="text-xs text-muted-foreground truncate max-w-36 block">
                                  {campaignTl.campaign_name || campaignTl.external_tracking_link_id || "—"}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/40">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                              {fmtShortDate(fan.first_transaction_at)}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                              {fmtShortDate(fan.last_transaction_at)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={cn("font-semibold tabular-nums text-sm", isSpender ? "text-emerald-500" : "text-muted-foreground")}>
                                {isSpender ? fmt$(rev) : "—"}
                              </span>
                              {isSpender && (
                                <div className="w-full h-1 bg-muted rounded-full mt-1">
                                  <div className="h-full bg-emerald-500/50 rounded-full"
                                    style={{ width: `${revPct}%` }} />
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                              {fan.total_transactions ?? "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right"
                              onClick={e => { e.stopPropagation(); setEditFan(fan); }}>
                              <span className="text-xs text-muted-foreground hover:text-primary transition-colors">Edit</span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${fan.id}-tx`} className="bg-muted/10 border-b border-border/50">
                              <td />
                              <td colSpan={7} className="py-0">
                                <InlineTxList fanDbId={fan.id} accountMap={accountMap} showAccount={false} />
                              </td>
                            </tr>
                          )}
                        </>
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

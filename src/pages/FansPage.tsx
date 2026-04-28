import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getFanStats, getFans, getFan, updateFan, streamSync, getAccounts, getTransactionTotals, getTrackingLinks } from "@/lib/api";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, DollarSign, TrendingUp, RefreshCw,
  Search, ChevronDown, ChevronRight, GitMerge, X,
  ExternalLink, ArrowLeft,
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

// ─── Account fan card (grid view) ─────────────────────────────────────────────
function AccountFanCard({ account, stats, isLoading, totalSubs, onClick }: {
  account: any;
  stats: any | null;
  isLoading: boolean;
  totalSubs: number;
  onClick: () => void;
}) {
  const spenderPct = totalSubs > 0
    ? (stats?.spenders ?? 0) / totalSubs * 100
    : 0;

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all group"
    >
      {/* Account header */}
      <div className="flex items-center gap-3 mb-4">
        {account.avatar_thumb_url ? (
          <img
            src={account.avatar_thumb_url}
            alt={account.display_name}
            className="w-12 h-12 rounded-full object-cover border-2 border-border flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground flex-shrink-0">
            {account.display_name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-bold text-sm truncate">{account.display_name}</div>
          {isLoading ? (
            <Skeleton className="h-4 w-24 mt-1" />
          ) : stats?.total_revenue > 0 ? (
            <div className="text-sm font-semibold text-emerald-500 tabular-nums">{fmt$(stats.total_revenue)}</div>
          ) : (
            <div className="text-xs text-muted-foreground">No revenue yet</div>
          )}
        </div>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Subs</div>
              <div className="text-xl font-bold tabular-nums">{totalSubs > 0 ? fmtNum(totalSubs) : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spenders</div>
              <div className="text-xl font-bold tabular-nums text-emerald-500">{fmtNum(stats.spenders)}</div>
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

          {/* Spender conversion bar */}
          {totalSubs > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{fmtNum(stats.spenders ?? 0)} spenders of {fmtNum(totalSubs)} subs</span>
                <span className="font-semibold">{spenderPct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, spenderPct)}%` }}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-muted-foreground py-2">No fan data — run a fan sync first</div>
      )}

      <div className="mt-4 flex items-center justify-end">
        <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">View fans →</span>
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
function InlineTxList({ fanDbId, showAccount, accountMap }: { fanDbId: string; showAccount: boolean; accountMap: Record<string, any> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["fan_detail", fanDbId],
    queryFn: () => getFan(fanDbId),
    staleTime: 60_000,
  });

  const transactions = data?.transactions ?? [];

  if (isLoading) {
    return (
      <div className="px-4 pb-3 pt-1 space-y-1.5">
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full rounded" />)}
      </div>
    );
  }
  if (transactions.length === 0) {
    return <p className="px-4 pb-3 text-xs text-muted-foreground">No transactions found</p>;
  }

  return (
    <div className="px-4 pb-3 pt-1">
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Date</th>
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
  );
}

// ─── Fan edit panel ───────────────────────────────────────────────────────────
function FanEditPanel({ fan, onClose, onUpdated }: { fan: any; onClose: () => void; onUpdated: () => void }) {
  const [notesInput, setNotesInput] = useState(fan.notes ?? "");
  const [saving, setSaving] = useState(false);

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

        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>First seen</span><span className="text-foreground">{fmtDate(fan.first_transaction_at)}</span></div>
          <div className="flex justify-between"><span>Last seen</span><span className="text-foreground">{fmtDate(fan.last_transaction_at)}</span></div>
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</div>
          <textarea
            value={notesInput}
            onChange={e => setNotesInput(e.target.value)}
            rows={4}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary bg-background"
            placeholder="Add notes about this fan..."
          />
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
          <a
            href={`https://onlyfans.com/${fan.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" /> View on OnlyFans
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function FansPage() {
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [spendersOnly, setSpendersOnly] = useState(true);
  const [expandedFans, setExpandedFans] = useState<Set<string>>(new Set());
  const [editFan, setEditFan] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset filters when navigating between accounts
  useEffect(() => {
    setCampaignFilter("all");
    setSearch("");
    setExpandedFans(new Set());
  }, [selectedAccountId]);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await getAccounts() || []).filter((a: any) => a.is_active),
  });

  // Global stats (all accounts combined)
  const globalStatsQuery = useQuery({
    queryKey: ["fan_stats", "all"],
    queryFn: () => getFanStats(),
    staleTime: 60_000,
    enabled: selectedAccountId === null,
  });

  // Per-account stats for grid cards (parallel)
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

  // Selected account
  const selectedAccount = useMemo(
    () => selectedAccountId ? accounts.find((a: any) => a.id === selectedAccountId) : null,
    [accounts, selectedAccountId]
  );

  // Per-account stats for detail view
  const selectedStatsQuery = useQuery({
    queryKey: ["fan_stats", selectedAccountId],
    queryFn: () => getFanStats({ account_id: selectedAccountId! }),
    staleTime: 60_000,
    enabled: !!selectedAccountId,
  });

  // All tracking links — used to derive real subscriber counts per account
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

  // Tracking links for campaign filter (selected account only)
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

  // Fan list (only when account selected)
  const fansQuery = useQuery({
    queryKey: ["fans_list", selectedAccountId, campaignFilter, debouncedSearch, spendersOnly],
    queryFn: () => getFans({
      account_id: selectedAccountId || undefined,
      tracking_link_id: campaignFilter !== "all" ? campaignFilter : undefined,
      search: debouncedSearch || undefined,
      spenders_only: spendersOnly || undefined,
      sort_by: "total_revenue",
      sort_dir: "desc",
      limit: 5000,
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

  const fans = fansQuery.data?.fans ?? [];
  const totalFans = fansQuery.data?.total ?? 0;
  const globalStats = globalStatsQuery.data;
  const selectedStats = selectedStatsQuery.data;
  const isLoadingFans = fansQuery.isLoading;
  const txCount = txTotalsQuery.data?.count ?? 0;

  const accountMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of accounts) m[(a as any).id] = a;
    return m;
  }, [accounts]);

  function toggleExpand(fanId: string) {
    setExpandedFans(prev => {
      const next = new Set(prev);
      if (next.has(fanId)) next.delete(fanId);
      else next.add(fanId);
      return next;
    });
  }

  async function handleSync() {
    setSyncing(true);
    setSyncProgress("Starting sync...");
    try {
      await streamSync("/sync/fans", { triggered_by: "manual" }, msg => setSyncProgress(msg));
      await queryClient.invalidateQueries({ queryKey: ["fans_list"] });
      await queryClient.invalidateQueries({ queryKey: ["fan_stats"] });
      toast.success("Fan sync complete");
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally { setSyncing(false); setSyncProgress(null); }
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-0">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            {selectedAccountId && (
              <button
                onClick={() => setSelectedAccountId(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mr-1"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Accounts</span>
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold">
                {selectedAccount ? selectedAccount.display_name : "Fans"}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedAccount ? "Fan analytics · click a fan to see transactions" : "Select an account to view fan analytics"}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncing && "animate-spin")} />
            Sync Fans
          </Button>
        </div>

        {/* sync progress */}
        {syncProgress && (
          <div className="mx-6 mt-4 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 flex items-center gap-3">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" />
            <p className="text-xs text-muted-foreground">{syncProgress}</p>
          </div>
        )}

        {selectedAccountId === null ? (
          // ── GRID VIEW ──────────────────────────────────────────────────────
          <div className="p-6 flex flex-col gap-6">

            {/* Global KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {globalStatsQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              ) : (
                <>
                  <KpiCard label="Total Fans" value={fmtNum(globalStats?.total_fans)} icon={Users} />
                  <KpiCard
                    label="Spenders"
                    value={fmtNum(globalStats?.spenders)}
                    sub={totalSubsAll > 0 ? `${((globalStats.spenders / totalSubsAll) * 100).toFixed(1)}% of ${fmtNum(totalSubsAll)} subs` : undefined}
                    icon={DollarSign} color="bg-emerald-500"
                  />
                  <KpiCard label="Fan Revenue" value={fmt$(globalStats?.total_revenue)} icon={TrendingUp} color="bg-primary" />
                  <KpiCard label="Avg / Spender" value={fmt$(globalStats?.avg_per_spender)} icon={DollarSign} />
                  <KpiCard label="Cross-Poll" value={fmtNum(globalStats?.cross_poll_fans)} sub={fmt$(globalStats?.cross_poll_revenue)} icon={GitMerge} color="bg-violet-500" />
                </>
              )}
            </div>

            {/* Account cards */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Accounts
                </h2>
                <span className="text-xs text-muted-foreground">{accounts.length} active</span>
              </div>

              {accountsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-semibold">No active accounts</p>
                  <p className="text-sm mt-1">Add accounts in Settings to get started.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {accounts.map((acc: any, i: number) => (
                    <AccountFanCard
                      key={acc.id}
                      account={acc}
                      stats={accountStatsMap[acc.id] ?? null}
                      isLoading={accountStatsQueries[i]?.isLoading ?? false}
                      totalSubs={subsPerAccount[acc.id] ?? 0}
                      onClick={() => setSelectedAccountId(acc.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

        ) : (
          // ── DETAIL VIEW ────────────────────────────────────────────────────
          <div className="p-6 flex flex-col gap-5">

            {/* Per-account KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {selectedStatsQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              ) : (
                <>
                  <KpiCard label="Total Fans" value={fmtNum(selectedStats?.total_fans)} icon={Users} />
                  <KpiCard
                    label="Spenders"
                    value={fmtNum(selectedStats?.spenders)}
                    sub={selectedAccountId && subsPerAccount[selectedAccountId] > 0
                      ? `${((selectedStats.spenders / subsPerAccount[selectedAccountId]) * 100).toFixed(1)}% of ${fmtNum(subsPerAccount[selectedAccountId])} subs`
                      : undefined}
                    icon={DollarSign} color="bg-emerald-500"
                  />
                  <KpiCard label="Fan Revenue" value={fmt$(selectedStats?.total_revenue)} icon={TrendingUp} color="bg-primary" />
                  <KpiCard label="Avg / Spender" value={fmt$(selectedStats?.avg_per_spender)} icon={DollarSign} />
                  <KpiCard label="Cross-Poll" value={fmtNum(selectedStats?.cross_poll_fans)} sub={fmt$(selectedStats?.cross_poll_revenue)} icon={GitMerge} color="bg-violet-500" />
                </>
              )}
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search fan or username..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              {(trackingLinks as any[]).length > 0 && (
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                  <SelectTrigger className="w-56 h-8 text-sm">
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

              <button
                onClick={() => setSpendersOnly(v => !v)}
                className={cn(
                  "h-8 px-3 rounded-md border text-xs font-medium transition-colors",
                  spendersOnly
                    ? "bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                )}
              >
                Spenders only
              </button>

              <span className="text-xs text-muted-foreground ml-auto">{fmtNum(totalFans)} fans</span>
            </div>

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
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-16">Txns</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {isLoadingFans ? (
                    Array.from({ length: 15 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-3 py-3"><Skeleton className="h-3 w-3" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-4 w-40" /></td>
                        <td className="px-3 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-32" /></td>
                        <td className="px-3 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-3 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                        <td />
                      </tr>
                    ))
                  ) : fans.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        {selectedStats?.total_fans === 0 && txCount > 0 ? (
                          <>
                            <p className="font-semibold text-sm">No fan profiles yet for this account</p>
                            <p className="text-xs text-muted-foreground mt-1">Run a Fan Sync to build profiles.</p>
                            <Button size="sm" className="mt-3" onClick={handleSync} disabled={syncing}>
                              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncing && "animate-spin")} />
                              Sync Fans Now
                            </Button>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground font-medium">No fans match your filters</p>
                        )}
                      </td>
                    </tr>
                  ) : (
                    fans.map((fan: any) => {
                      const rev = Number(fan.total_revenue ?? 0);
                      const isSpender = rev > 0;
                      const isExpanded = expandedFans.has(fan.id);
                      const campaignTl = fan.first_subscribe_link_id ? tlMap[fan.first_subscribe_link_id] : null;
                      return (
                        <>
                          <tr
                            key={fan.id}
                            onClick={() => toggleExpand(fan.id)}
                            className={cn(
                              "border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors",
                              isExpanded && "bg-muted/20"
                            )}
                          >
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <FanAvatar fan={fan} size={26} />
                                <div className="min-w-0">
                                  <div className="font-medium text-sm truncate max-w-44">
                                    {fan.username ? `@${fan.username}` : fan.fan_id}
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
                                <span className="text-xs text-muted-foreground truncate max-w-40 block">
                                  {campaignTl.campaign_name || campaignTl.external_tracking_link_id || "—"}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/50">—</span>
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
                            </td>
                            <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                              {fan.total_transactions ?? "—"}
                            </td>
                            <td
                              className="px-3 py-2.5 text-right"
                              onClick={e => { e.stopPropagation(); setEditFan(fan); }}
                            >
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
            </div>
          </div>
        )}
      </div>

      {/* Fan edit sheet */}
      <Sheet open={!!editFan} onOpenChange={open => { if (!open) setEditFan(null); }}>
        <SheetContent className="w-[380px] sm:max-w-[380px] overflow-y-auto p-0">
          {editFan && (
            <FanEditPanel
              fan={editFan}
              onClose={() => setEditFan(null)}
              onUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ["fans_list"] });
                queryClient.invalidateQueries({ queryKey: ["fan_detail", editFan.id] });
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

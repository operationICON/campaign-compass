import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  ExternalLink, Tag,
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
  new_subscription:       { label: "New Sub",    color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  recurring_subscription: { label: "Resub",      color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  tip:                    { label: "Tip",         color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  message:                { label: "Message",     color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  post:                   { label: "Post",        color: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
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
function InlineTxList({ fanDbId, accountMap, showAccount }: { fanDbId: string; accountMap: Record<string, any>; showAccount: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["fan_detail", fanDbId],
    queryFn: () => getFan(fanDbId),
    staleTime: 60_000,
  });

  const transactions = data?.transactions ?? [];

  if (isLoading) {
    return (
      <div className="px-4 pb-3 pt-1 space-y-1.5">
        {[0,1,2].map(i => <Skeleton key={i} className="h-8 w-full rounded" />)}
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
  const [accountFilter, setAccountFilter] = useState<string>("all");
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

  // Reset campaign filter when account changes
  useEffect(() => { setCampaignFilter("all"); }, [accountFilter]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await getAccounts() || []).filter((a: any) => a.is_active),
  });

  const { data: trackingLinks = [] } = useQuery({
    queryKey: ["tracking_links", accountFilter],
    queryFn: () => getTrackingLinks(accountFilter !== "all" ? { account_id: accountFilter } : {}),
    enabled: accountFilter !== "all",
  });

  const statsQuery = useQuery({
    queryKey: ["fan_stats", accountFilter],
    queryFn: () => getFanStats(accountFilter !== "all" ? { account_id: accountFilter } : {}),
    staleTime: 60_000,
  });

  const fansQuery = useQuery({
    queryKey: ["fans_list", accountFilter, campaignFilter, debouncedSearch, spendersOnly],
    queryFn: () => getFans({
      account_id: accountFilter !== "all" ? accountFilter : undefined,
      tracking_link_id: campaignFilter !== "all" ? campaignFilter : undefined,
      search: debouncedSearch || undefined,
      spenders_only: spendersOnly || undefined,
      sort_by: "total_revenue",
      sort_dir: "desc",
      limit: 5000,
    }),
    staleTime: 30_000,
  });

  const txTotalsQuery = useQuery({
    queryKey: ["tx_totals"],
    queryFn: () => getTransactionTotals(),
    staleTime: 60_000,
  });

  const fans = fansQuery.data?.fans ?? [];
  const total = fansQuery.data?.total ?? 0;
  const stats = statsQuery.data;
  const isLoading = fansQuery.isLoading;
  const txCount = txTotalsQuery.data?.count ?? 0;
  const noFansYet = !isLoading && fans.length === 0 && total === 0 && !debouncedSearch && !spendersOnly && accountFilter === "all";

  const accountMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of accounts) m[a.id] = a;
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
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h1 className="text-xl font-bold">Fans</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Revenue analytics and fan attribution</p>
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

        {/* account tabs */}
        <div className="flex items-center gap-0 px-6 border-b border-border overflow-x-auto">
          {[{ id: "all", display_name: "All Accounts" }, ...accounts].map((a: any) => (
            <button
              key={a.id}
              onClick={() => setAccountFilter(a.id)}
              className={cn(
                "px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors shrink-0",
                accountFilter === a.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {a.display_name}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-5 p-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {statsQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            ) : (
              <>
                <KpiCard label="Total Fans" value={fmtNum(stats?.total_fans)} icon={Users} />
                <KpiCard label="Spenders" value={fmtNum(stats?.spenders)} sub={stats?.total_fans ? `${((stats.spenders / stats.total_fans) * 100).toFixed(1)}% of fans` : undefined} icon={DollarSign} color="bg-emerald-500" />
                <KpiCard label="Fan Revenue" value={fmt$(stats?.total_revenue)} icon={TrendingUp} color="bg-primary" />
                <KpiCard label="Avg / Spender" value={fmt$(stats?.avg_per_spender)} icon={DollarSign} />
                <KpiCard label="Cross-Poll" value={fmtNum(stats?.cross_poll_fans)} sub={fmt$(stats?.cross_poll_revenue)} icon={GitMerge} color="bg-violet-500" />
              </>
            )}
          </div>

          {/* filters */}
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

            {accountFilter !== "all" && trackingLinks.length > 0 && (
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

            <span className="text-xs text-muted-foreground ml-auto">{fmtNum(total)} fans</span>
          </div>

          {/* fan table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-8 px-3 py-2.5" />
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Fan</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">First seen</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Last seen</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-16">Txns</th>
                  <th className="text-center px-3 py-2.5 font-medium text-muted-foreground w-16 hidden lg:table-cell">XP</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 15 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-3 py-3"><Skeleton className="h-3 w-3" /></td>
                      <td className="px-3 py-3"><Skeleton className="h-4 w-40" /></td>
                      <td className="px-3 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-3 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-3 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      <td className="px-3 py-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="hidden lg:table-cell" />
                      <td />
                    </tr>
                  ))
                ) : fans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-0">
                      {noFansYet ? (
                        <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
                          <Users className="w-10 h-10 text-muted-foreground/30" />
                          <div className="text-center">
                            <p className="font-semibold">No fan profiles yet</p>
                            {txCount > 0 ? (
                              <p className="text-sm text-muted-foreground mt-1">
                                You have {fmtNum(txCount)} transactions — run a Fan Sync to build profiles.
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground mt-1">Run a Dashboard Sync first, then Fan Sync.</p>
                            )}
                          </div>
                          <Button size="sm" onClick={handleSync} disabled={syncing}>
                            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncing && "animate-spin")} />
                            Sync Fans Now
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-muted-foreground">
                          <Users className="w-7 h-7 mx-auto mb-2 opacity-30" />
                          <p className="text-sm font-medium">No fans match your filters</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  fans.map((fan: any) => {
                    const rev = Number(fan.total_revenue ?? 0);
                    const isSpender = rev > 0;
                    const isExpanded = expandedFans.has(fan.id);
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
                          <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                            {fmtShortDate(fan.first_transaction_at)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                            {fmtShortDate(fan.last_transaction_at)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={cn("font-semibold tabular-nums text-sm", isSpender ? "text-emerald-600" : "text-muted-foreground")}>
                              {isSpender ? fmt$(rev) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                            {fan.total_transactions ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                            {fan.is_cross_poll && (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/40">
                                <GitMerge className="w-2.5 h-2.5 text-violet-600" />
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right" onClick={e => { e.stopPropagation(); setEditFan(fan); }}>
                            <span className="text-xs text-muted-foreground hover:text-primary transition-colors">Edit</span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${fan.id}-tx`} className="bg-muted/10 border-b border-border/50">
                            <td />
                            <td colSpan={7} className="py-0">
                              <InlineTxList
                                fanDbId={fan.id}
                                accountMap={accountMap}
                                showAccount={accountFilter === "all"}
                              />
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
      </div>

      {/* fan edit sheet */}
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

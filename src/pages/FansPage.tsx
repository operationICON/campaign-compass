import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getFanStats, getFans, getFan, updateFan, streamSync, getAccounts } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Users, DollarSign, TrendingUp, ArrowUpDown, RefreshCw,
  Search, ChevronDown, ChevronUp, GitMerge, X, ExternalLink,
  Tag, FileText, Activity,
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
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}
function fmtRelative(d: string | null | undefined) {
  if (!d) return "—";
  try {
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    if (ms < 86_400_000 * 30) return `${Math.floor(ms / 86_400_000)}d ago`;
    return fmtDate(d);
  } catch { return "—"; }
}

// ─── types ────────────────────────────────────────────────────────────────────
interface Fan {
  id: string;
  fan_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  status: string | null;
  tags: string[] | null;
  notes: string | null;
  total_revenue: string | null;
  total_transactions: number | null;
  first_transaction_at: string | null;
  last_transaction_at: string | null;
  is_cross_poll: boolean | null;
  is_new_fan: boolean | null;
  first_subscribe_account: string | null;
  acquired_via_account_id: string | null;
  account_count: number;
}

type SortKey = "total_revenue" | "total_transactions" | "last_transaction_at" | "first_transaction_at" | "fan_id";
type SortDir = "asc" | "desc";

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", accent ?? "bg-primary/10")}>
          <Icon className={cn("w-4 h-4", accent ? "text-white" : "text-primary")} />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── fan avatar ───────────────────────────────────────────────────────────────
function FanAvatar({ fan, size = 32 }: { fan: Fan; size?: number }) {
  const initials = (fan.username ?? fan.fan_id).slice(0, 2).toUpperCase();
  if (fan.avatar_url) {
    return (
      <img
        src={fan.avatar_url}
        alt={fan.username ?? fan.fan_id}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function FansPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [spendersOnly, setSpendersOnly] = useState(false);
  const [crossPollOnly, setCrossPollOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("total_revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedFanId, setSelectedFanId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);

  // debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const data = await getAccounts();
      return (data || []).filter((a: any) => a.is_active);
    },
  });

  const statsQuery = useQuery({
    queryKey: ["fan_stats", accountFilter],
    queryFn: () => getFanStats(accountFilter !== "all" ? { account_id: accountFilter } : {}),
    staleTime: 60_000,
  });

  const fansQuery = useQuery({
    queryKey: ["fans_list", accountFilter, debouncedSearch, spendersOnly, crossPollOnly, sortBy, sortDir],
    queryFn: () => getFans({
      account_id: accountFilter !== "all" ? accountFilter : undefined,
      search: debouncedSearch || undefined,
      spenders_only: spendersOnly || undefined,
      cross_poll_only: crossPollOnly || undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      limit: 5000,
    }),
    staleTime: 30_000,
  });

  const selectedFanQuery = useQuery({
    queryKey: ["fan_detail", selectedFanId],
    queryFn: () => selectedFanId ? getFan(selectedFanId) : null,
    enabled: !!selectedFanId,
    staleTime: 30_000,
  });

  const fans = fansQuery.data?.fans ?? [];
  const total = fansQuery.data?.total ?? 0;
  const stats = statsQuery.data;
  const isLoading = fansQuery.isLoading;

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  async function handleSync() {
    setSyncing(true);
    setSyncProgress("Starting sync...");
    try {
      await streamSync("/sync/fans", { triggered_by: "manual" }, (msg) => setSyncProgress(msg));
      await queryClient.invalidateQueries({ queryKey: ["fans_list"] });
      await queryClient.invalidateQueries({ queryKey: ["fan_stats"] });
      toast.success("Fan sync complete");
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  async function handleBootstrap() {
    setBootstrapping(true);
    setSyncProgress("Bootstrapping from transactions...");
    try {
      await streamSync("/sync/fans/bootstrap", { triggered_by: "manual" }, (msg) => setSyncProgress(msg));
      await queryClient.invalidateQueries({ queryKey: ["fans_list"] });
      await queryClient.invalidateQueries({ queryKey: ["fan_stats"] });
      toast.success("Fan bootstrap complete");
    } catch (err: any) {
      toast.error(`Bootstrap failed: ${err.message}`);
    } finally {
      setBootstrapping(false);
      setSyncProgress(null);
    }
  }

  const selectedFanData = selectedFanQuery.data;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Fans</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Revenue analytics and fan attribution</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={handleBootstrap}
              disabled={bootstrapping || syncing}
            >
              <RefreshCw className={cn("w-4 h-4 mr-1.5", bootstrapping && "animate-spin")} />
              Bootstrap
            </Button>
            <Button
              size="sm"
              onClick={handleSync}
              disabled={syncing || bootstrapping}
            >
              <RefreshCw className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
              Sync Fans
            </Button>
          </div>
        </div>

        {/* sync progress */}
        {syncProgress && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-4 py-2 flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" />
            {syncProgress}
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {statsQuery.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          ) : (
            <>
              <KpiCard label="Total Fans" value={fmtNum(stats?.total_fans)} icon={Users} />
              <KpiCard label="Spenders" value={fmtNum(stats?.spenders)} sub={stats?.total_fans ? `${((stats.spenders / stats.total_fans) * 100).toFixed(1)}% of fans` : undefined} icon={DollarSign} accent="bg-emerald-500" />
              <KpiCard label="Total Revenue" value={fmt$(stats?.total_revenue)} icon={TrendingUp} accent="bg-primary" />
              <KpiCard label="Avg / Spender" value={fmt$(stats?.avg_per_spender)} icon={DollarSign} />
              <KpiCard label="Cross-Poll Fans" value={fmtNum(stats?.cross_poll_fans)} sub="spent on other accounts" icon={GitMerge} accent="bg-violet-500" />
              <KpiCard label="Cross-Poll Rev" value={fmt$(stats?.cross_poll_revenue)} icon={GitMerge} accent="bg-violet-600" />
            </>
          )}
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search fan ID or username..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => setSpendersOnly(v => !v)}
            className={cn(
              "h-9 px-3 rounded-md border text-sm font-medium transition-colors",
              spendersOnly
                ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            Spenders only
          </button>

          <button
            onClick={() => setCrossPollOnly(v => !v)}
            className={cn(
              "h-9 px-3 rounded-md border text-sm font-medium transition-colors",
              crossPollOnly
                ? "bg-violet-50 border-violet-400 text-violet-700"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            Cross-poll only
          </button>

          <span className="text-sm text-muted-foreground ml-auto">
            {fmtNum(total)} fans
          </span>
        </div>

        {/* table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-64">
                    <button onClick={() => toggleSort("fan_id")} className="flex items-center gap-1.5 hover:text-foreground">
                      Fan <SortIcon col="fan_id" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    <button onClick={() => toggleSort("first_transaction_at")} className="flex items-center gap-1.5 hover:text-foreground">
                      First seen <SortIcon col="first_transaction_at" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    <button onClick={() => toggleSort("last_transaction_at")} className="flex items-center gap-1.5 hover:text-foreground">
                      Last seen <SortIcon col="last_transaction_at" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    <button onClick={() => toggleSort("total_revenue")} className="flex items-center gap-1.5 hover:text-foreground ml-auto">
                      Revenue <SortIcon col="total_revenue" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    <button onClick={() => toggleSort("total_transactions")} className="flex items-center gap-1.5 hover:text-foreground ml-auto">
                      Txns <SortIcon col="total_transactions" />
                    </button>
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Accounts</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">XP</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 20 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-10 ml-auto" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-8 mx-auto" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-8 mx-auto" /></td>
                    </tr>
                  ))
                ) : fans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground">
                      <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No fans found</p>
                      <p className="text-xs mt-1">Run Bootstrap to populate fans from existing transactions</p>
                    </td>
                  </tr>
                ) : (
                  fans.map((fan: Fan) => {
                    const rev = Number(fan.total_revenue ?? 0);
                    const isSpender = rev > 0;
                    return (
                      <tr
                        key={fan.id}
                        onClick={() => setSelectedFanId(fan.id)}
                        className={cn(
                          "border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors",
                          selectedFanId === fan.id && "bg-primary/5"
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <FanAvatar fan={fan} size={30} />
                            <div className="min-w-0">
                              <div className="font-medium truncate max-w-48">
                                {fan.username ? `@${fan.username}` : fan.fan_id}
                              </div>
                              {fan.username && (
                                <div className="text-xs text-muted-foreground truncate max-w-48">{fan.fan_id}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {fmtDate(fan.first_transaction_at)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>{fmtRelative(fan.last_transaction_at)}</span>
                            </TooltipTrigger>
                            <TooltipContent>{fmtDate(fan.last_transaction_at)}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={cn("font-medium tabular-nums", isSpender ? "text-emerald-600" : "text-muted-foreground")}>
                            {isSpender ? fmt$(rev) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                          {fan.total_transactions ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-muted-foreground">{fan.account_count ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {fan.is_cross_poll && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-600">
                                  <GitMerge className="w-3 h-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Cross-poll: spent on multiple accounts</TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* fan detail side panel */}
      <Sheet open={!!selectedFanId} onOpenChange={open => { if (!open) setSelectedFanId(null); }}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto p-0">
          {selectedFanQuery.isLoading ? (
            <div className="p-6 flex flex-col gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : selectedFanData ? (
            <FanDetailPanel
              fan={selectedFanData.fan}
              accountStats={selectedFanData.account_stats}
              transactions={selectedFanData.transactions}
              accounts={accounts}
              onClose={() => setSelectedFanId(null)}
              onUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ["fan_detail", selectedFanId] });
                queryClient.invalidateQueries({ queryKey: ["fans_list"] });
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

// ─── Fan detail panel ─────────────────────────────────────────────────────────
function FanDetailPanel({ fan, accountStats, transactions, accounts, onClose, onUpdated }: {
  fan: any;
  accountStats: any[];
  transactions: any[];
  accounts: any[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "transactions">("overview");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(fan.notes ?? "");
  const [saving, setSaving] = useState(false);

  const accountMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of accounts) m[a.id] = a;
    return m;
  }, [accounts]);

  const totalRevenue = Number(fan.total_revenue ?? 0);
  const isSpender = totalRevenue > 0;

  async function saveNotes() {
    setSaving(true);
    try {
      await updateFan(fan.id, { notes: notesInput });
      onUpdated();
      setEditingNotes(false);
      toast.success("Notes saved");
    } catch {
      toast.error("Failed to save notes");
    } finally { setSaving(false); }
  }

  const txByType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of transactions) {
      const type = t.type ?? "other";
      m[type] = (m[type] ?? 0) + Number(t.revenue ?? 0);
    }
    return m;
  }, [transactions]);

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <FanAvatar fan={fan} size={44} />
            <div>
              <div className="font-semibold text-lg leading-tight">
                {fan.username ? `@${fan.username}` : fan.fan_id}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{fan.fan_id}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fan.is_cross_poll && (
              <Badge variant="outline" className="text-violet-600 border-violet-300 bg-violet-50 gap-1">
                <GitMerge className="w-3 h-3" /> Cross-poll
              </Badge>
            )}
            {isSpender && (
              <Badge className="bg-emerald-100 text-emerald-700 border-0">Spender</Badge>
            )}
          </div>
        </div>

        {/* quick stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{fmt$(totalRevenue)}</div>
            <div className="text-xs text-muted-foreground">Total Revenue</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{fmtNum(fan.total_transactions)}</div>
            <div className="text-xs text-muted-foreground">Transactions</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{accountStats.length}</div>
            <div className="text-xs text-muted-foreground">Accounts</div>
          </div>
        </div>

        <div className="flex gap-1 mt-4 text-xs text-muted-foreground">
          <span>First seen {fmtDate(fan.first_transaction_at)}</span>
          <span>·</span>
          <span>Last seen {fmtRelative(fan.last_transaction_at)}</span>
        </div>
      </div>

      {/* tabs */}
      <div className="flex border-b border-border">
        {(["overview", "transactions"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-3 text-sm font-medium capitalize border-b-2 transition-colors",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "transactions" ? `Transactions (${transactions.length})` : "Overview"}
          </button>
        ))}
      </div>

      {/* content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "overview" && (
          <div className="flex flex-col gap-5">
            {/* per-account breakdown */}
            {accountStats.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Account Breakdown</div>
                <div className="flex flex-col gap-2">
                  {accountStats
                    .sort((a, b) => Number(b.total_revenue ?? 0) - Number(a.total_revenue ?? 0))
                    .map((stat: any) => {
                      const acc = accountMap[stat.account_id];
                      const accName = stat.account_display_name ?? acc?.display_name ?? stat.account_id;
                      const rev = Number(stat.total_revenue ?? 0);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
                      return (
                        <div key={stat.account_id} className="bg-muted/30 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm truncate max-w-40">{accName}</span>
                            <span className="font-semibold tabular-nums text-sm">{fmt$(rev)}</span>
                          </div>
                          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                            <span>{stat.total_transactions} txns</span>
                            <span>{pct.toFixed(1)}%</span>
                          </div>
                          {/* revenue type breakdown */}
                          {(Number(stat.subscription_revenue) > 0 || Number(stat.tip_revenue) > 0 || Number(stat.message_revenue) > 0) && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {Number(stat.subscription_revenue) > 0 && (
                                <span className="text-xs text-muted-foreground">Subs: {fmt$(Number(stat.subscription_revenue))}</span>
                              )}
                              {Number(stat.tip_revenue) > 0 && (
                                <span className="text-xs text-muted-foreground">Tips: {fmt$(Number(stat.tip_revenue))}</span>
                              )}
                              {Number(stat.message_revenue) > 0 && (
                                <span className="text-xs text-muted-foreground">Msgs: {fmt$(Number(stat.message_revenue))}</span>
                              )}
                              {Number(stat.post_revenue) > 0 && (
                                <span className="text-xs text-muted-foreground">Posts: {fmt$(Number(stat.post_revenue))}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* attribution */}
            {(fan.first_subscribe_account || fan.first_subscribe_date) && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Attribution</div>
                <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-1.5">
                  {fan.first_subscribe_account && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">First subscribed via</span>
                      <span className="font-medium">{fan.first_subscribe_account}</span>
                    </div>
                  )}
                  {fan.first_subscribe_date && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Subscribe date</span>
                      <span className="font-medium">{fmtDate(fan.first_subscribe_date)}</span>
                    </div>
                  )}
                  {fan.is_new_fan != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">New fan</span>
                      <span className="font-medium">{fan.is_new_fan ? "Yes" : "No"}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* notes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</div>
                {!editingNotes && (
                  <button onClick={() => { setNotesInput(fan.notes ?? ""); setEditingNotes(true); }} className="text-xs text-primary hover:underline">
                    {fan.notes ? "Edit" : "Add note"}
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={notesInput}
                    onChange={e => setNotesInput(e.target.value)}
                    rows={3}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                    placeholder="Add notes about this fan..."
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditingNotes(false)}>Cancel</Button>
                    <Button size="sm" onClick={saveNotes} disabled={saving}>Save</Button>
                  </div>
                </div>
              ) : fan.notes ? (
                <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">{fan.notes}</div>
              ) : (
                <div className="text-sm text-muted-foreground italic">No notes</div>
              )}
            </div>
          </div>
        )}

        {tab === "transactions" && (
          <div className="flex flex-col gap-2">
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No transactions</p>
            ) : (
              transactions.map((tx: any) => {
                const rev = Number(tx.revenue ?? 0);
                const type = tx.type ?? "other";
                return (
                  <div key={tx.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium capitalize">{type}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(tx.date)}</span>
                    </div>
                    <span className={cn("font-semibold tabular-nums text-sm", rev > 0 ? "text-emerald-600" : "text-muted-foreground")}>
                      {rev > 0 ? fmt$(rev) : "—"}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

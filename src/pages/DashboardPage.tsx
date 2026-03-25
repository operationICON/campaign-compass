import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchSyncSettings, triggerSync } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  RefreshCw, TrendingUp, Users, Tag, BarChart3, PieChart, X
} from "lucide-react";
import { InsightsSection } from "@/components/dashboard/InsightsSection";


type SortKey = "campaign_name" | "revenue" | "profit" | "roi" | "profit_per_sub" | "subscribers";
type TimePeriod = "all" | "day" | "week" | "since_sync" | "month" | "prev_month";

const PERIOD_MAP: Record<TimePeriod, string> = {
  all: "all_time",
  day: "last_day",
  week: "last_week",
  since_sync: "since_last_sync",
  month: "last_month",
  prev_month: "prev_month",
};


export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [selectedModel, setSelectedModel] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [sortBy, setSortBy] = useState("LTV");
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(1);
  const [tableExpanded, setTableExpanded] = useState(() => {
    const saved = localStorage.getItem("dashboard-table-expanded");
    return saved !== null ? saved === "true" : true;
  });

  const toggleTableExpanded = () => {
    setTableExpanded(prev => {
      localStorage.setItem("dashboard-table-expanded", String(!prev));
      return !prev;
    });
  };

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: syncSettings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });

  // Category mapping for group filter
  const CATEGORY_MAP: Record<string, string> = {
    "jessie_ca_xo": "Female", "zoey.skyy": "Female", "ella_cherryy": "Female",
    "miakitty.ts": "Trans", "aylin_bigts": "Trans",
  };

  const getAccountCategory = (account: any) => {
    const username = (account.username || "").replace("@", "");
    return CATEGORY_MAP[username] || "Female";
  };

  // Accounts filtered by group
  const groupFilteredAccounts = useMemo(() => {
    if (groupFilter === "all") return accounts;
    return accounts.filter((a: any) => getAccountCategory(a) === groupFilter);
  }, [accounts, groupFilter]);

  // Active filter count (excluding time period)
  const activeFilterCount = (groupFilter !== "all" ? 1 : 0) + (selectedModel !== "all" ? 1 : 0);

  const periodParam = PERIOD_MAP[timePeriod];
  const modelParam = selectedModel !== "all" ? selectedModel : null;

  // True LTV from accounts table (earnings stats from OF API)
  const accountLtv = useMemo(() => {
    let filtered = modelParam ? accounts.filter((a: any) => a.id === modelParam) : accounts;
    if (!modelParam && groupFilter !== "all") {
      filtered = filtered.filter((a: any) => getAccountCategory(a) === groupFilter);
    }
    const getLtvField = () => {
      if (timePeriod === "day") return "ltv_last_day";
      if (timePeriod === "week") return "ltv_last_7d";
      if (timePeriod === "month" || timePeriod === "since_sync") return "ltv_last_30d";
      return "ltv_total";
    };
    const field = getLtvField();
    const total = filtered.reduce((sum: number, a: any) => sum + Number(a[field] || 0), 0);
    const breakdown = {
      subscriptions: filtered.reduce((s: number, a: any) => s + Number(a.ltv_subscriptions || 0), 0),
      tips: filtered.reduce((s: number, a: any) => s + Number(a.ltv_tips || 0), 0),
      messages: filtered.reduce((s: number, a: any) => s + Number(a.ltv_messages || 0), 0),
      posts: filtered.reduce((s: number, a: any) => s + Number(a.ltv_posts || 0), 0),
    };
    return { total, breakdown };
  }, [accounts, modelParam, groupFilter, timePeriod]);

  // RPC: get_ltv_by_period (still used for period subs data)
  const { data: periodData, isLoading: isPeriodLoading } = useQuery({
    queryKey: ["ltv_by_period", periodParam, modelParam],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ltv_by_period", {
        p_period: periodParam,
        p_account_id: modelParam,
      });
      if (error) throw error;
      return data as { period: string; total_ltv: number; total_new_subs: number; ltv_per_sub: number; data_available: boolean };
    },
  });

  const syncFrequency = useMemo(() => {
    const s = syncSettings.find((s: any) => s.key === "sync_frequency_days");
    return s ? parseInt(s.value) : 3;
  }, [syncSettings]);

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(undefined, true, (msg) => toast.info(msg, { id: 'sync-progress' })),
    onSuccess: (data) => {
      toast.success(`Sync complete — ${data?.accounts_synced ?? 0} accounts synced`, { id: 'sync-progress' });
      ["tracking_links", "accounts", "daily_metrics", "sync_logs", "transaction_totals"].forEach(k =>
        queryClient.invalidateQueries({ queryKey: [k] })
      );
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
  });

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tracking_links' }, () => {
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const lastSynced = useMemo(() => {
    const syncTimes = accounts.map((a: any) => a.last_synced_at).filter(Boolean).sort().reverse();
    return syncTimes[0] ?? null;
  }, [accounts]);

  const nextSyncDays = useMemo(() => {
    if (!lastSynced) return null;
    const nextDate = new Date(new Date(lastSynced).getTime() + syncFrequency * 86400000);
    return Math.max(0, differenceInDays(nextDate, new Date()));
  }, [lastSynced, syncFrequency]);

  const timeFilteredLinks = useMemo(() => links, [links, timePeriod]);

  const filteredLinks = useMemo(() => {
    const groupAccountIds = groupFilter !== "all"
      ? new Set(groupFilteredAccounts.map((a: any) => a.id))
      : null;
    return timeFilteredLinks.filter((link: any) => {
      if (groupAccountIds && !groupAccountIds.has(link.account_id)) return false;
      if (selectedModel !== "all" && link.account_id !== selectedModel) return false;
      if (sourceFilter !== "all" && (link.source_tag || "Untagged") !== sourceFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(link.campaign_name || "").toLowerCase().includes(q) &&
            !(link.accounts?.username || "").toLowerCase().includes(q) &&
            !(link.accounts?.display_name || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [timeFilteredLinks, selectedModel, groupFilter, groupFilteredAccounts, sourceFilter, searchQuery]);

  const enrichedLinks = useMemo(() => {
    return filteredLinks.map((link: any) => {
      const spend = Number(link.cost_total || 0);
      const revenue = Number(link.revenue || 0);
      const profit = spend > 0 ? revenue - spend : null;
      const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
      const profitPerSub = (profit !== null && link.subscribers > 0) ? profit / link.subscribers : null;
      return { ...link, spend, profit, roi, profitPerSub };
    });
  }, [filteredLinks]);

  const sortedLinks = useMemo(() => {
    return [...enrichedLinks].sort((a, b) => {
      if (sortKey === "campaign_name") {
        const av = (a.campaign_name || "").toLowerCase();
        const bv = (b.campaign_name || "").toLowerCase();
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === "profit_per_sub") {
        const av = a.profitPerSub ?? -Infinity;
        const bv = b.profitPerSub ?? -Infinity;
        return sortAsc ? av - bv : bv - av;
      }
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
  }, [enrichedLinks, sortKey, sortAsc]);

  // KPI calculations — consistent formula across all pages
  // Total LTV = SUM(tracking_links.revenue)
  // Total Spend = SUM(tracking_links.cost_total) WHERE cost_total > 0
  // Total Profit = Total LTV - Total Spend (NOT sum of individual profits)
  // Avg Profit/Sub = Total Profit / paid subscribers
  const agencyAccountIds = useMemo(() => {
    if (modelParam) return [modelParam];
    if (groupFilter !== "all") return groupFilteredAccounts.map((a: any) => a.id);
    return null;
  }, [modelParam, groupFilter, groupFilteredAccounts]);

  const filteredLinksForKpi = useMemo(() => {
    if (!agencyAccountIds) return links;
    const idSet = new Set(agencyAccountIds);
    return links.filter((l: any) => idSet.has(l.account_id));
  }, [links, agencyAccountIds]);

  const totalLtv = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0), [filteredLinksForKpi]);
  const totalSpend = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => {
    const cost = Number(l.cost_total || 0);
    return s + (cost > 0 ? cost : 0);
  }, 0), [filteredLinksForKpi]);
  const totalProfit = totalSpend > 0 ? totalLtv - totalSpend : null;
  const paidSubscribers = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => {
    return Number(l.cost_total || 0) > 0 ? s + (l.subscribers || 0) : s;
  }, 0), [filteredLinksForKpi]);
  const totalSubs = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => s + (l.subscribers || 0), 0), [filteredLinksForKpi]);
  const avgProfitPerSub = (totalProfit !== null && paidSubscribers > 0) ? totalProfit / paidSubscribers : null;
  const ltvPerSub = totalSubs > 0 ? totalLtv / totalSubs : null;

  // Period data for fallback display
  const periodSubs = periodData?.total_new_subs ?? 0;
  const periodDataAvailable = periodData?.data_available ?? false;
  const showFallback = timePeriod !== "all" && !periodDataAvailable;

  // Unattributed subs calculation
  const unattributedStats = useMemo(() => {
    // Filter to sync_enabled accounts only for accurate calculation
    let accts = accounts.filter((a: any) => a.sync_enabled !== false);
    if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);
    const acctIds = new Set(accts.map((a: any) => a.id));
    const accountTotalSubs = accts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    // Only count attributed subs from the same sync_enabled accounts
    const fLinks = links.filter((l: any) => acctIds.has(l.account_id));
    const attributedSubs = fLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const syncEnabledCount = accounts.filter((a: any) => a.sync_enabled !== false).length;
    const totalAccountCount = accounts.length;
    const allSyncing = syncEnabledCount >= totalAccountCount;
    // If attributed > total, show warning
    const isOverflow = attributedSubs > accountTotalSubs;
    const unattributed = Math.max(0, accountTotalSubs - attributedSubs);
    const pct = accountTotalSubs > 0 ? (unattributed / accountTotalSubs) * 100 : 0;
    return { accountTotalSubs, attributedSubs, unattributed, pct, isOverflow, allSyncing, syncEnabledCount, totalAccountCount };
  }, [accounts, links, modelParam, groupFilter]);

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    links.forEach((l: any) => s.add(l.source_tag || "Untagged"));
    return Array.from(s).sort();
  }, [links]);


  const getSubsPerDay = (link: any) => {
    if (!link.created_at) return null;
    const days = differenceInDays(new Date(), new Date(link.created_at));
    return days >= 1 ? link.subscribers / days : null;
  };

  const getStatus = (link: any) => {
    const status = link.status;
    if (status === "SCALE") return { label: "Scale", color: "bg-primary/10 text-primary" };
    if (status === "WATCH") return { label: "Watch", color: "bg-[hsl(38_92%_50%)]/10 text-[hsl(38_92%_50%)]" };
    if (status === "LOW") return { label: "Low", color: "bg-[hsl(38_92%_50%)]/10 text-[hsl(38_92%_50%)]" };
    if (status === "KILL") return { label: "Kill", color: "bg-destructive/10 text-destructive" };
    if (status === "DEAD") return { label: "Dead", color: "bg-muted text-muted-foreground" };
    if (link.spend > 0 && link.roi !== null) {
      if (link.roi > 150) return { label: "Scale", color: "bg-primary/10 text-primary" };
      if (link.roi >= 50) return { label: "Watch", color: "bg-[hsl(38_92%_50%)]/10 text-[hsl(38_92%_50%)]" };
      if (link.roi >= 0) return { label: "Low", color: "bg-[hsl(38_92%_50%)]/10 text-[hsl(38_92%_50%)]" };
      return { label: "Kill", color: "bg-destructive/10 text-destructive" };
    }
    return { label: "No Spend", color: "bg-muted text-muted-foreground" };
  };

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtP = (v: number) => `${v.toFixed(1)}%`;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, sortField, align = "left" }: { label: string; sortField: SortKey; align?: string }) => (
    <th
      onClick={() => toggleSort(sortField)}
      className={`px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)}
      </span>
    </th>
  );

  const totalPages = Math.max(1, Math.ceil(sortedLinks.length / perPage));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * perPage;
  const endIdx = Math.min(safePage * perPage, sortedLinks.length);
  const paginatedLinks = sortedLinks.slice(startIdx, endIdx);

  const TIME_PERIODS: { key: TimePeriod; label: string }[] = [
    { key: "day", label: "Last Day" },
    { key: "week", label: "Last Week" },
    { key: "since_sync", label: "Since Last Sync" },
    { key: "month", label: "Last Month" },
    { key: "prev_month", label: "Prev Month" },
    { key: "all", label: "All Time" },
  ];


  return (
    <DashboardLayout>
      <div className="space-y-8">

        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Campaign Tracker</h1>
            <div className="flex items-center gap-2 mt-1">
              {lastSynced && (
                <span className="text-xs text-muted-foreground">
                  Last synced {format(new Date(lastSynced), "MMM d, HH:mm")}
                </span>
              )}
              {nextSyncDays !== null && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  Next sync in {nextSyncDays}d
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {accounts.length > 0 && (
              <span className="text-[11px] text-muted-foreground bg-secondary border border-border px-2.5 py-1 rounded-full">
                {accounts.filter((a: any) => a.sync_enabled !== false).length} of {accounts.length} accounts active
              </span>
            )}
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50 hover:opacity-90"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>

        {/* ═══ FILTER BAR: Group + Account + Time Period ═══ */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Group dropdown */}
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setSelectedModel("all");
              setPage(1);
            }}
            className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Groups</option>
            <option value="Female">Female</option>
            <option value="Trans">Trans</option>
          </select>

          {/* Account dropdown */}
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); setPage(1); }}
            className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Accounts</option>
            {groupFilteredAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.display_name} {a.username ? `(@${a.username.replace("@","")})` : ""}
              </option>
            ))}
          </select>

          {/* Time period pills */}
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {TIME_PERIODS.map((tp) => (
              <button
                key={tp.key}
                onClick={() => setTimePeriod(tp.key)}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  timePeriod === tp.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tp.label}
              </button>
            ))}
          </div>

          {/* Active filter count */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setGroupFilter("all"); setSelectedModel("all"); }}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-secondary border border-border px-2.5 py-1 rounded-full hover:text-foreground transition-colors"
            >
              {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* ═══ 5 KPI CARDS ═══ */}
        {(() => {
          // Subs/Day from daily_metrics
          const subsPerDayCalc = (() => {
            const syncedAcctIds = new Set(accounts.filter((a: any) => a.sync_enabled !== false).map((a: any) => a.id));
            const relevantMetrics = dailyMetrics.filter((m: any) => syncedAcctIds.has(m.account_id));
            const dates = [...new Set(relevantMetrics.map((m: any) => m.date))].sort().reverse();
            if (dates.length < 2) return null;
            const latest = dates[0];
            const previous = dates[1];
            const latestSubs = relevantMetrics.filter((m: any) => m.date === latest).reduce((s: number, m: any) => s + (m.subscribers || 0), 0);
            const prevSubs = relevantMetrics.filter((m: any) => m.date === previous).reduce((s: number, m: any) => s + (m.subscribers || 0), 0);
            const daysBetween = Math.max(1, differenceInDays(new Date(latest), new Date(previous)));
            return (latestSubs - prevSubs) / daysBetween;
          })();

          // Avg CPL
          const avgCpl = paidSubscribers > 0 ? totalSpend / paidSubscribers : null;

          const periodLabel = TIME_PERIODS.find(t => t.key === timePeriod)?.label || "All Time";

          return (isLoading || isPeriodLoading) ? (
            <div className="grid grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-2xl p-5">
                  <div className="skeleton-shimmer h-3 w-20 rounded mb-3" />
                  <div className="skeleton-shimmer h-8 w-28 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-4">
              {/* Card 1 — Profit/Sub */}
              <div className="bg-card border border-border rounded-2xl p-5" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Profit/Sub</span>
                </div>
                {avgProfitPerSub !== null ? (
                  <p className={`text-[18px] font-bold font-mono ${avgProfitPerSub >= 0 ? "text-primary" : "text-destructive"}`}>{fmtC(avgProfitPerSub)}</p>
                ) : (
                  <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Per acquired subscriber · {periodLabel}</p>
              </div>

              {/* Card 2 — LTV/Sub */}
              <div className="bg-card border border-border rounded-2xl p-5 group relative" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">LTV/Sub</span>
                </div>
                {(() => {
                  const syncedAccts = accounts.filter((a: any) => a.sync_enabled !== false);
                  let filtered = modelParam ? syncedAccts.filter((a: any) => a.id === modelParam) : syncedAccts;
                  if (!modelParam && groupFilter !== "all") filtered = filtered.filter((a: any) => getAccountCategory(a) === groupFilter);
                  const getLtvField = () => {
                    if (timePeriod === "day") return "ltv_last_day";
                    if (timePeriod === "week") return "ltv_last_7d";
                    if (timePeriod === "month" || timePeriod === "since_sync") return "ltv_last_30d";
                    return "ltv_total";
                  };
                  const totalAccLtv = filtered.reduce((s: number, a: any) => s + Number(a[getLtvField()] || 0), 0);
                  const totalAccSubs = filtered.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
                  const val = totalAccSubs > 0 ? totalAccLtv / totalAccSubs : null;
                  return val !== null ? (
                    <p className="text-[22px] font-bold font-mono text-foreground">{fmtC(val)}</p>
                  ) : (
                    <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
                  );
                })()}
                <p className="text-[11px] text-muted-foreground mt-1">All subscribers · {periodLabel}</p>
              </div>

              {/* Card 3 — Avg CPL */}
              <div className="bg-card border border-border rounded-2xl p-5" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Tag className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Avg CPL</span>
                </div>
                {avgCpl !== null ? (
                  <p className="text-[22px] font-bold font-mono text-foreground">{fmtC(avgCpl)}</p>
                ) : (
                  <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Cost per subscriber · {periodLabel}</p>
              </div>

              {/* Card 4 — Subs/Day */}
              <div className="bg-card border border-border rounded-2xl p-5" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <BarChart3 className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Subs/Day</span>
                </div>
                {subsPerDayCalc !== null ? (
                  <p className="text-[22px] font-bold font-mono text-primary">+{Math.round(subsPerDayCalc)}/day</p>
                ) : (
                  <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Agency-wide daily growth · {periodLabel}</p>
              </div>

              {/* Card 5 — Unattributed Subs */}
              <div className="bg-card border border-border rounded-2xl p-5 group relative" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-[hsl(38_92%_50%)]/10 flex items-center justify-center">
                    <PieChart className="h-4 w-4 text-[hsl(38_92%_50%)]" />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Unattributed</span>
                </div>
                {unattributedStats.isOverflow ? (
                  <p className="text-[22px] font-bold font-mono text-[hsl(38_92%_50%)]">Sync needed</p>
                ) : unattributedStats.accountTotalSubs > 0 ? (
                  <p className={`text-[22px] font-bold font-mono ${
                    unattributedStats.pct <= 20 ? "text-primary" :
                    unattributedStats.pct <= 30 ? "text-muted-foreground" :
                    "text-[hsl(38_92%_50%)]"
                  }`}>{unattributedStats.pct.toFixed(1)}%</p>
                ) : (
                  <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Traffic with no campaign · {periodLabel}</p>
                {!unattributedStats.allSyncing && (
                  <p className="text-[10px] text-[hsl(38_92%_50%)] mt-1">
                    {unattributedStats.syncEnabledCount}/{unattributedStats.totalAccountCount} accounts syncing
                  </p>
                )}
                {/* Tooltip */}
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl p-3 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 min-w-[220px]">
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total account subs</span><span className="font-mono text-foreground">{unattributedStats.accountTotalSubs.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Attributed to links</span><span className="font-mono text-foreground">{unattributedStats.attributedSubs.toLocaleString()}</span></div>
                    <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="font-bold text-foreground">Unattributed</span><span className="font-mono font-bold">{unattributedStats.unattributed.toLocaleString()} ({unattributedStats.pct.toFixed(1)}%)</span></div>
                    <p className="text-muted-foreground mt-2 leading-relaxed">~20% is normal due to OnlyFans tracking limitations</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}


        {/* ═══ INSIGHTS SECTION ═══ */}
        <InsightsSection
          links={links}
          accounts={accounts}
          dailyMetrics={dailyMetrics}
          groupFilter={groupFilter}
          selectedModel={selectedModel}
          getAccountCategory={getAccountCategory}
        />

      </div>

      {/* SLIDE-INS */}
      {selectedLink && (
        <CampaignDetailSlideIn
          link={selectedLink}
          cost={Number(selectedLink.cost_total || 0)}
          onClose={() => setSelectedLink(null)}
          onSetCost={() => { setCostSlideIn(selectedLink); setSelectedLink(null); }}
        />
      )}
      {costSlideIn && (
        <CostSettingSlideIn
          link={costSlideIn}
          onClose={() => setCostSlideIn(null)}
          onSaved={() => {
            setCostSlideIn(null);
            queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
            toast.success("Spend saved & metrics recalculated");
          }}
        />
      )}
    </DashboardLayout>
  );
}

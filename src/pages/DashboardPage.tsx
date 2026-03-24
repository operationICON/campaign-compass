import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchSyncSettings, triggerSync } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  RefreshCw, DollarSign, TrendingUp, PiggyBank, Users,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search, Pencil
} from "lucide-react";

const MODEL_CATEGORIES: Record<string, { label: string; color: string }> = {
  Jess: { label: "Female", color: "bg-blue-100 text-blue-700" },
  Zoey: { label: "Female", color: "bg-blue-100 text-blue-700" },
  Mia: { label: "Trans", color: "bg-purple-100 text-purple-700" },
  Flor: { label: "Female", color: "bg-blue-100 text-blue-700" },
  Aylin: { label: "Trans", color: "bg-purple-100 text-purple-700" },
};

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

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: syncSettings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });

  // RPC: get_ltv_by_period
  const periodParam = PERIOD_MAP[timePeriod];
  const modelParam = selectedModel !== "all" ? selectedModel : null;
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
      ["tracking_links", "accounts", "daily_metrics", "sync_logs"].forEach(k =>
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
    return timeFilteredLinks.filter((link: any) => {
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
  }, [timeFilteredLinks, selectedModel, sourceFilter, searchQuery]);

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

  // KPI calculations — use RPC for LTV when period is not all_time
  const totalSpend = enrichedLinks.reduce((s: number, l: any) => s + l.spend, 0);
  const totalSubs = enrichedLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);

  // Use RPC data for LTV/subs when available, fallback to client-side
  const periodLtv = periodData?.total_ltv ?? 0;
  const periodSubs = periodData?.total_new_subs ?? 0;
  const periodDataAvailable = periodData?.data_available ?? false;
  const showFallback = timePeriod !== "all" && !periodDataAvailable;

  const avgLtvPerSub = showFallback
    ? (totalSubs > 0 ? enrichedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) / totalSubs : 0)
    : (periodData?.ltv_per_sub ?? (totalSubs > 0 ? enrichedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) / totalSubs : 0));

  const effectiveLtv = showFallback
    ? enrichedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0)
    : periodLtv;
  const effectiveSubs = showFallback ? totalSubs : (periodSubs || totalSubs);

  const totalProfit = totalSpend > 0 ? effectiveLtv - totalSpend : null;
  const avgProfitPerSub = (totalProfit !== null && effectiveSubs > 0) ? totalProfit / effectiveSubs : null;

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    links.forEach((l: any) => s.add(l.source_tag || "Untagged"));
    return Array.from(s).sort();
  }, [links]);

  const sourcePerformance = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; subs: number; ltv: number; spend: number; profit: number; profitPerSub: number | null }> = {};
    enrichedLinks.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!map[src]) map[src] = { source: src, campaigns: 0, subs: 0, ltv: 0, spend: 0, profit: 0, profitPerSub: null };
      map[src].campaigns++;
      map[src].subs += l.subscribers || 0;
      map[src].ltv += Number(l.revenue || 0);
      map[src].spend += l.spend;
      if (l.profit !== null) map[src].profit += l.profit;
    });
    return Object.values(map).map(s => ({
      ...s,
      profitPerSub: s.subs > 0 && s.spend > 0 ? s.profit / s.subs : null,
      roi: s.spend > 0 ? (s.profit / s.spend) * 100 : null,
    })).sort((a, b) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity));
  }, [enrichedLinks]);

  const modelPerformance = useMemo(() => {
    const map: Record<string, { id: string; display_name: string; username: string | null; avatar: string | null; performer_top: number | null; ltv: number; spend: number; profit: number | null; subs: number; campaigns: number }> = {};
    timeFilteredLinks.forEach((l: any) => {
      const accId = l.account_id;
      if (!map[accId]) {
        const acc = accounts.find((a: any) => a.id === accId);
        map[accId] = {
          id: accId,
          display_name: acc?.display_name || l.accounts?.display_name || "Unknown",
          username: acc?.username || l.accounts?.username || null,
          avatar: acc?.avatar_thumb_url || l.accounts?.avatar_thumb_url || null,
          performer_top: acc?.performer_top ?? null,
          ltv: 0, spend: 0, profit: null, subs: 0, campaigns: 0,
        };
      }
      map[accId].ltv += Number(l.revenue || 0);
      map[accId].spend += Number(l.cost_total || 0);
      map[accId].subs += l.subscribers || 0;
      map[accId].campaigns++;
    });
    return Object.values(map).map(m => ({
      ...m,
      profit: m.spend > 0 ? m.ltv - m.spend : null,
      roi: m.spend > 0 ? ((m.ltv - m.spend) / m.spend) * 100 : null,
      profitPerSub: m.spend > 0 && m.subs > 0 ? (m.ltv - m.spend) / m.subs : null,
    })).sort((a, b) => b.ltv - a.ltv);
  }, [timeFilteredLinks, accounts]);

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

  const TREND_PERIODS: { key: TrendPeriod; label: string }[] = [
    { key: "week", label: "Last Week" },
    { key: "month", label: "Last Month" },
    { key: "3months", label: "3 Months" },
    { key: "6months", label: "6 Months" },
    { key: "all", label: "All Time" },
  ];

  const getCategory = (name: string) => {
    for (const [key, val] of Object.entries(MODEL_CATEGORIES)) {
      if (name.toLowerCase().includes(key.toLowerCase())) return val;
    }
    return { label: "Female", color: "bg-blue-100 text-blue-700" };
  };

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
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50 hover:opacity-90"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {/* ═══ TIME PERIOD SELECTOR ═══ */}
        <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden w-fit">
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

        {/* ═══ SECTION 1 — AGENCY KPI ROW ═══ */}
        {(isLoading || isPeriodLoading) ? (
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-5">
                <div className="skeleton-shimmer h-3 w-20 rounded mb-3" />
                <div className="skeleton-shimmer h-8 w-28 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {/* Avg LTV/Sub — hero */}
            <div className="bg-primary rounded-2xl p-5 text-primary-foreground shadow-md">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 opacity-80" />
                <span className="text-xs opacity-70 font-medium uppercase tracking-wider">Avg LTV/Sub</span>
              </div>
              <p className="text-[28px] font-bold font-mono leading-tight">{fmtC(avgLtvPerSub)}</p>
              {showFallback && (
                <p className="text-[10px] opacity-60 mt-1">Showing all time — builds with each sync</p>
              )}
            </div>
            {/* Total Spend */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <PiggyBank className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Spend</span>
              </div>
              {totalSpend > 0 ? (
                <p className="text-xl font-bold font-mono text-foreground">{fmtC(totalSpend)}</p>
              ) : (
                <p className="text-xl font-bold font-mono text-muted-foreground">No spend data</p>
              )}
            </div>
            {/* Total Profit */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Profit</span>
              </div>
              {totalProfit !== null ? (
                <p className={`text-xl font-bold font-mono ${totalProfit >= 0 ? "text-primary" : "text-destructive"}`}>{fmtC(totalProfit)}</p>
              ) : (
                <>
                  <p className="text-xl font-bold font-mono text-muted-foreground">—</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Enter spend to calculate</p>
                </>
              )}
            </div>
            {/* Avg Profit/Sub — PRIMARY */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Avg Profit/Sub</span>
              </div>
              {avgProfitPerSub !== null ? (
                <p className={`text-[22px] font-bold font-mono ${avgProfitPerSub >= 0 ? "text-primary" : "text-destructive"}`}>{fmtC(avgProfitPerSub)}</p>
              ) : (
                <>
                  <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Enter spend to calculate</p>
                </>
              )}
            </div>
          </div>
        )}


        {/* ═══ SECTION 2 — CAMPAIGN PROFITABILITY ═══ */}
        <div>
          <h2 className="text-[16px] font-bold text-foreground mb-1">Campaign Profitability</h2>
          <p className="text-xs text-muted-foreground mb-4">Profit per subscriber per campaign and source</p>

          {/* Filter bar */}
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <select
              value={selectedModel}
              onChange={(e) => { setSelectedModel(e.target.value); setPage(1); }}
              className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Models</option>
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Sources</option>
              {trafficSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="relative flex-1 max-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder="Search campaigns..."
                className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                const map: Record<string, SortKey> = { "Profit/Sub": "profit_per_sub", "LTV": "revenue", "Profit": "profit", "ROI": "roi", "Subs": "subscribers" };
                setSortKey(map[e.target.value] || "revenue");
                setSortAsc(false);
                setPage(1);
              }}
              className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
            >
              {["Profit/Sub", "LTV", "Profit", "ROI", "Subs"].map(s => <option key={s} value={s}>Sort: {s}</option>)}
            </select>
          </div>

          {/* Campaign table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center">
                <div className="space-y-3 max-w-lg mx-auto">
                  {[...Array(5)].map((_, i) => <div key={i} className="skeleton-shimmer h-10 rounded-lg" />)}
                </div>
              </div>
            ) : !sortedLinks.length ? (
              <div className="p-16 text-center">
                <p className="text-muted-foreground">No campaigns found</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-border bg-muted/30">
                        <SortHeader label="Campaign" sortField="campaign_name" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Model</th>
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Source</th>
                        <SortHeader label="Subs" sortField="subscribers" align="right" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Subs/Day</th>
                        <SortHeader label="LTV" sortField="revenue" align="right" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Spend</th>
                        <SortHeader label="Profit" sortField="profit" align="right" />
                        <SortHeader label="Profit/Sub" sortField="profit_per_sub" align="right" />
                        <SortHeader label="ROI" sortField="roi" align="right" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedLinks.map((link: any) => {
                        const status = getStatus(link);
                        const subsPerDay = getSubsPerDay(link);
                        const isScale = status.label === "Scale";
                        const isKillDead = status.label === "Kill" || status.label === "Dead";
                        const noSpend = link.spend <= 0;

                        return (
                          <tr
                            key={link.id}
                            onClick={() => setSelectedLink(link)}
                            className={`border-b border-border transition-all duration-200 cursor-pointer group ${
                              noSpend ? "opacity-80" : ""
                            } ${isScale ? "border-l-2 border-l-primary" : isKillDead ? "border-l-2 border-l-destructive" : "hover:border-l-2 hover:border-l-primary"}`}
                          >
                            <td className="px-3 py-3">
                              <p className="text-[13px] font-medium text-foreground">{link.campaign_name || "—"}</p>
                              <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{link.url || ""}</p>
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-xs text-muted-foreground">@{link.accounts?.username || "—"}</span>
                            </td>
                            <td className="px-3 py-3"><TagBadge tagName={link.source_tag} /></td>
                            <td className="px-3 py-3 text-right font-mono text-xs text-foreground">{(link.subscribers || 0).toLocaleString()}</td>
                            <td className="px-3 py-3 text-right font-mono text-xs">
                              {subsPerDay !== null ? (
                                <span className="text-primary font-medium">{subsPerDay.toFixed(1)}/day</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-[13px] font-semibold text-primary">{fmtC(Number(link.revenue || 0))}</td>
                            <td className="px-3 py-3 text-right font-mono text-xs">
                              {link.spend > 0 ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-foreground">{fmtC(link.spend)}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }}
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }}
                                  className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                                >Set</button>
                              )}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-xs font-semibold ${link.profit !== null ? (link.profit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                              {link.profit !== null ? fmtC(link.profit) : "—"}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-[14px] font-bold ${link.profitPerSub !== null ? (link.profitPerSub >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                              {link.profitPerSub !== null ? fmtC(link.profitPerSub) : "—"}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-xs font-semibold ${link.roi !== null ? (link.roi >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                              {link.roi !== null ? fmtP(link.roi) : "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-block min-w-[80px] px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${status.color}`}>
                                {status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    Showing {startIdx + 1}–{endIdx} of {sortedLinks.length} campaigns
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Rows:</span>
                      {[10, 25, 50, 100].map(n => (
                        <button key={n} onClick={() => { setPerPage(n); setPage(1); }}
                          className={`px-2 py-0.5 text-xs rounded ${perPage === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >{n}</button>
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
                          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                        </button>
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 7) pageNum = i + 1;
                          else if (safePage <= 4) pageNum = i + 1;
                          else if (safePage >= totalPages - 3) pageNum = totalPages - 6 + i;
                          else pageNum = safePage - 3 + i;
                          return (
                            <button key={pageNum} onClick={() => setPage(pageNum)}
                              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                                pageNum === safePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                              }`}
                            >{pageNum}</button>
                          );
                        })}
                        <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Source Performance */}
          <div className="bg-card border border-border rounded-2xl p-5 mt-6">
            <h3 className="text-[14px] font-bold text-foreground mb-4">Performance by Source</h3>
            {sourcePerformance.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tag your campaigns in Tracking Links to see performance by source</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Source</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Campaigns</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Subs</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">LTV</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Spend</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Profit</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right font-bold">Profit/Sub</th>
                      <th className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourcePerformance.map((s) => (
                      <tr key={s.source} className={`border-b border-border last:border-0 ${s.source === "Untagged" ? "opacity-60" : ""}`}>
                        <td className="px-3 py-2"><TagBadge tagName={s.source === "Untagged" ? null : s.source} /></td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-foreground">{s.campaigns}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-foreground">{s.subs.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-primary font-semibold">{fmtC(s.ltv)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-foreground">{s.spend > 0 ? fmtC(s.spend) : "—"}</td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${s.spend > 0 ? (s.profit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                          {s.spend > 0 ? fmtC(s.profit) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono text-[13px] font-bold ${s.profitPerSub !== null ? (s.profitPerSub >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                          {s.profitPerSub !== null ? fmtC(s.profitPerSub) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${s.roi !== null ? ((s.roi ?? 0) >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                          {s.roi !== null ? fmtP(s.roi) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ═══ SECTION 3 — MODEL PERFORMANCE (with photos) ═══ */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold text-foreground">Model Performance</h2>
            <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
              {TREND_PERIODS.map((tp) => (
                <button
                  key={tp.key}
                  onClick={() => setTrendPeriod(tp.key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    trendPeriod === tp.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {modelPerformance.map((m) => {
              const cat = getCategory(m.display_name);
              return (
                <div key={m.id} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/40 transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    {m.avatar ? (
                      <img src={m.avatar} alt={m.display_name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
                        {m.display_name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-foreground">{m.display_name}</p>
                      {m.username && <p className="text-[10px] text-muted-foreground">@{m.username}</p>}
                    </div>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.label}</span>
                  <div className="space-y-2 mt-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">LTV</span>
                      <p className="text-lg font-bold font-mono text-primary">{fmtC(m.ltv)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">ROI</span>
                        <p className={`text-sm font-bold font-mono ${m.roi !== null ? ((m.roi ?? 0) >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                          {m.roi !== null ? fmtP(m.roi) : "—"}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Profit/Sub</span>
                        <p className={`text-sm font-bold font-mono ${m.profitPerSub !== null ? ((m.profitPerSub ?? 0) >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                          {m.profitPerSub !== null ? fmtC(m.profitPerSub) : "—"}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {m.campaigns} campaigns · {m.subs.toLocaleString()} subs
                    </p>
                    {trendPeriod !== "all" && (
                      <p className="text-[9px] text-muted-foreground italic">Building data... more syncs needed</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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

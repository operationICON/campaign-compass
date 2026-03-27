import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchSyncSettings, triggerSync } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import {
  RefreshCw, TrendingUp, Users, Tag, BarChart3, PieChart, X,
  DollarSign, Activity, Award, Percent
} from "lucide-react";
import { InsightsSection } from "@/components/dashboard/InsightsSection";
import { RefreshButton } from "@/components/RefreshButton";
import { KpiCardCustomizer, useKpiCardVisibility, type DashboardKpiCardId } from "@/components/dashboard/KpiCardCustomizer";


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
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | null>(null);

  const { enabledCards, toggleCard, isVisible } = useKpiCardVisibility();

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

  // KPI calculations
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

  const totalSpend = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => {
    const cost = Number(l.cost_total || 0);
    return s + (cost > 0 ? cost : 0);
  }, 0), [filteredLinksForKpi]);
  const totalRevenue = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0), [filteredLinksForKpi]);
  const totalLtv = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => s + Number(l.ltv || 0), 0), [filteredLinksForKpi]);
  const totalEffective = totalLtv > 0 ? totalLtv : totalRevenue;
  const totalProfit = totalSpend > 0 ? totalEffective - totalSpend : null;
  const paidSubscribers = useMemo(() => filteredLinksForKpi.reduce((s: number, l: any) => {
    return Number(l.cost_total || 0) > 0 ? s + (l.subscribers || 0) : s;
  }, 0), [filteredLinksForKpi]);
  const avgProfitPerSub = (totalProfit !== null && paidSubscribers > 0) ? totalProfit / paidSubscribers : null;

  const unattributedStats = useMemo(() => {
    let accts = [...accounts];
    if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);
    const acctIds = new Set(accts.map((a: any) => a.id));
    const accountTotalSubs = accts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    const fLinks = links.filter((l: any) => acctIds.has(l.account_id));
    const rawAttributed = fLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    // Attributed can exceed current subscribers_count (cumulative vs active), cap at total
    const attributedSubs = Math.min(rawAttributed, accountTotalSubs);
    const unattributed = accountTotalSubs - attributedSubs;
    const pct = accountTotalSubs > 0 ? (unattributed / accountTotalSubs) * 100 : 0;
    return { accountTotalSubs, attributedSubs, unattributed, pct, isOverflow: false };
  }, [accounts, links, modelParam, groupFilter]);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
            <KpiCardCustomizer enabledCards={enabledCards} toggleCard={toggleCard} />
            <RefreshButton queryKeys={["tracking_links", "accounts", "daily_metrics", "sync_settings"]} />
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

        {/* ═══ FILTER BAR: Group + Account + Time Period + Custom Range ═══ */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Group dropdown */}
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setSelectedModel("all");
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
            onChange={(e) => { setSelectedModel(e.target.value); }}
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
                onClick={() => { setTimePeriod(tp.key); setCustomRange(null); }}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  timePeriod === tp.key && !customRange ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tp.label}
              </button>
            ))}
          </div>

          {/* Custom date range picker */}
          <DateRangePicker
            value={customRange}
            onChange={(range) => {
              setCustomRange(range);
            }}
          />

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

        {/* ═══ KPI CARDS ═══ */}
        <KpiCards
          isLoading={isLoading || isPeriodLoading}
          isVisible={isVisible}
          enabledCards={enabledCards}
          accounts={accounts}
          links={filteredLinksForKpi}
          dailyMetrics={dailyMetrics}
          totalSpend={totalSpend}
          totalRevenue={totalRevenue}
          totalLtv={totalLtv}
          totalProfit={totalProfit}
          paidSubscribers={paidSubscribers}
          avgProfitPerSub={avgProfitPerSub}
          unattributedStats={unattributedStats}
          timePeriod={timePeriod}
          customRange={customRange}
          TIME_PERIODS={TIME_PERIODS}
          modelParam={modelParam}
          groupFilter={groupFilter}
          getAccountCategory={(a: any) => {
            const username = (a.username || "").replace("@", "");
            return CATEGORY_MAP[username] || "Female";
          }}
          fmtC={fmtC}
        />


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


// ═══ KPI Cards component ═══
function KpiCards({
  isLoading, isVisible, enabledCards,
  accounts, links, dailyMetrics,
  totalSpend, totalRevenue, totalLtv, totalProfit, paidSubscribers, avgProfitPerSub,
  unattributedStats, timePeriod, customRange, TIME_PERIODS,
  modelParam, groupFilter, getAccountCategory, fmtC,
}: {
  isLoading: boolean;
  isVisible: (id: string) => boolean;
  enabledCards: string[];
  accounts: any[];
  links: any[];
  dailyMetrics: any[];
  totalSpend: number;
  totalRevenue: number;
  totalLtv: number;
  totalProfit: number | null;
  paidSubscribers: number;
  avgProfitPerSub: number | null;
  unattributedStats: any;
  timePeriod: string;
  customRange: { from: Date; to: Date } | null;
  TIME_PERIODS: { key: string; label: string }[];
  modelParam: string | null;
  groupFilter: string;
  getAccountCategory: (a: any) => string;
  fmtC: (v: number) => string;
}) {
  const periodLabel = customRange
    ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`
    : TIME_PERIODS.find(t => t.key === timePeriod)?.label || "All Time";

  // Subs/Day from daily_metrics
  const subsPerDayCalc = (() => {
    const syncedAcctIds = new Set(accounts.map((a: any) => a.id));
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

  const avgCpl = paidSubscribers > 0 ? totalSpend / paidSubscribers : null;

  // Extra card computations
  const withSpend = links.filter((l: any) => Number(l.cost_total || 0) > 0);
  const expenses = withSpend.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
  const withSpendCount = withSpend.length;
  const avgExpenses = withSpendCount > 0 ? expenses / withSpendCount : null;

  const expEffective = withSpend.reduce((s: number, l: any) => {
    const ltv = Number(l.ltv || 0);
    return s + (ltv > 0 ? ltv : Number(l.revenue || 0));
  }, 0);
  const cardTotalProfit = expenses > 0 ? expEffective - expenses : null;
  const blendedRoi = expenses > 0 && cardTotalProfit !== null ? (cardTotalProfit / expenses) * 100 : null;

  const activeCampaigns = links.filter((l: any) => {
    if (l.clicks <= 0) return false;
    const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
    return calcDate ? differenceInDays(new Date(), calcDate) <= 30 : false;
  }).length;

  // Best source by ROI
  const bySource: Record<string, { rev: number; spend: number; profit: number }> = {};
  withSpend.forEach((l: any) => {
    const tag = l.source_tag || "Untagged";
    if (tag === "Untagged") return;
    if (!bySource[tag]) bySource[tag] = { rev: 0, spend: 0, profit: 0 };
    const effectiveRev = Number(l.ltv || 0) > 0 ? Number(l.ltv) : Number(l.revenue || 0);
    bySource[tag].rev += effectiveRev;
    bySource[tag].spend += Number(l.cost_total || 0);
    bySource[tag].profit += effectiveRev - Number(l.cost_total || 0);
  });
  let bestSource: { name: string; roi: number } | null = null;
  Object.entries(bySource).forEach(([name, d]) => {
    const roi = d.spend > 0 ? (d.profit / d.spend) * 100 : 0;
    if (!bestSource || roi > bestSource.roi) bestSource = { name, roi };
  });

  // Total LTV from accounts
  const getLtvField = () => {
    if (timePeriod === "day") return "ltv_last_day";
    if (timePeriod === "week") return "ltv_last_7d";
    if (timePeriod === "month" || timePeriod === "since_sync") return "ltv_last_30d";
    return "ltv_total";
  };
  const filteredAccts = (() => {
    let accts = [...accounts];
    if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);
    return accts;
  })();
  const totalAccLtv = filteredAccts.reduce((s: number, a: any) => s + Number(a[getLtvField()] || 0), 0);
  const totalAccSubs = filteredAccts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
  const ltvPerSub = totalAccSubs > 0 ? totalAccLtv / totalAccSubs : null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-2xl p-5">
            <div className="skeleton-shimmer h-3 w-20 rounded mb-3" />
            <div className="skeleton-shimmer h-8 w-28 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // Build ordered card list: always-on first, then extras in order they appear in enabledCards
  const orderedCards = enabledCards.filter(id => isVisible(id));

  const cardStyle = { boxShadow: "0 2px 8px rgba(0,0,0,0.04)" };

  const renderCard = (id: DashboardKpiCardId) => {
    switch (id) {
      case "profit_sub":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
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
        );

      case "ltv_sub":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5 group relative" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">LTV/Sub</span>
            </div>
            {ltvPerSub !== null ? (
              <p className="text-[22px] font-bold font-mono text-foreground">{fmtC(ltvPerSub)}</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">All subscribers · {periodLabel}</p>
          </div>
        );

      case "avg_cpl":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
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
        );

      case "subs_day":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
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
        );

      case "unattributed":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5 group relative" style={cardStyle}>
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
            <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl p-3 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 min-w-[220px]">
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Total account subs</span><span className="font-mono text-foreground">{unattributedStats.accountTotalSubs.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Attributed to links</span><span className="font-mono text-foreground">{unattributedStats.attributedSubs.toLocaleString()}</span></div>
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="font-bold text-foreground">Unattributed</span><span className="font-mono font-bold">{unattributedStats.unattributed.toLocaleString()} ({unattributedStats.pct.toFixed(1)}%)</span></div>
                <p className="text-muted-foreground mt-2 leading-relaxed">~20% is normal due to OnlyFans tracking limitations</p>
              </div>
            </div>
          </div>
        );

      case "expenses":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Expenses</span>
            </div>
            <p className={`text-[22px] font-bold font-mono ${expenses === 0 ? "text-destructive" : "text-foreground"}`}>
              {fmtC(expenses)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Total spend set</p>
          </div>
        );

      case "avg_expenses":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Avg Expenses</span>
            </div>
            {avgExpenses !== null ? (
              <p className="text-[22px] font-bold font-mono text-foreground">{fmtC(avgExpenses)}</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">Per campaign with spend</p>
          </div>
        );

      case "total_profit":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Profit</span>
            </div>
            {cardTotalProfit !== null ? (
              <div className="flex items-center gap-2">
                <p className={`text-[22px] font-bold font-mono ${cardTotalProfit >= 0 ? "text-primary" : "text-destructive"}`}>{fmtC(cardTotalProfit)}</p>
                <span className={`w-2 h-2 rounded-full shrink-0 ${totalLtv > 0 ? "bg-[#0891b2]" : "bg-muted-foreground"}`} title={totalLtv > 0 ? "From LTV (accurate)" : "From Revenue (estimate)"} />
              </div>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{totalLtv > 0 ? "LTV minus spend" : "Revenue minus spend (estimate)"}</p>
          </div>
        );

      case "blended_roi":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Percent className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Blended ROI</span>
            </div>
            {blendedRoi !== null ? (
              <p className={`text-[22px] font-bold font-mono ${blendedRoi >= 0 ? "text-primary" : "text-destructive"}`}>{blendedRoi.toFixed(1)}%</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">Profit / Expenses × 100</p>
          </div>
        );

      case "active_campaigns":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Active Campaigns</span>
            </div>
            <p className="text-[22px] font-bold font-mono text-foreground">{activeCampaigns}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Clicks in last 30 days</p>
          </div>
        );

      case "best_source":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Award className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Best Source</span>
            </div>
            {bestSource ? (
              <p className="text-[22px] font-bold font-mono text-primary">{bestSource.name}</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              {bestSource ? `${bestSource.roi.toFixed(0)}% ROI` : "No data"}
            </p>
          </div>
        );

      case "total_ltv":
        return (
          <div key={id} className="space-y-3">
            {/* Total Revenue card */}
            <div className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-foreground" />
                </div>
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Revenue</span>
              </div>
              <p className="text-[22px] font-bold font-mono text-foreground">{fmtC(totalRevenue)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Gross revenue from all subscribers</p>
            </div>
            {/* Total LTV card */}
            <div className="bg-card border border-[#0891b2]/30 rounded-2xl p-5" style={{ ...cardStyle, boxShadow: "0 2px 12px rgba(8,145,178,0.1)" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#0891b2]/10 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-[#0891b2]" />
                </div>
                <span className="text-[11px] text-[#0891b2] font-medium uppercase tracking-wider">Total LTV</span>
              </div>
              {totalLtv > 0 ? (
                <p className="text-[22px] font-bold font-mono text-[#0891b2]">{fmtC(totalLtv)}</p>
              ) : (
                <p className="text-[16px] font-bold text-muted-foreground">Fan sync needed</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">From new subscribers only</p>
            </div>
          </div>
        );

      case "ltv_30d_per_model": {
        const sortedModels = [...accounts]
          .sort((a, b) => (b.ltv_last_30d ?? 0) - (a.ltv_last_30d ?? 0));
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5 col-span-2" style={cardStyle}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">30D LTV per Model</span>
            </div>
            <p className="text-[11px] text-muted-foreground italic mb-3 ml-10">Revenue from new subscribers in last 30 days</p>
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
              {sortedModels.map((acc: any) => (
                <div key={acc.id} className="flex items-center gap-2 text-[12px]">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                    {acc.avatar_thumb_url ? (
                      <img src={acc.avatar_thumb_url} alt="" className="w-full h-full object-cover rounded-full" />
                    ) : (
                      <span className="text-[10px] font-bold text-muted-foreground">{(acc.display_name || "?")[0].toUpperCase()}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground truncate">@{acc.username || acc.display_name}</span>
                  <span className="ml-auto font-mono font-semibold shrink-0 text-muted-foreground">
                    {acc.ltv_last_30d != null && acc.ltv_last_30d > 0
                      ? <span className="text-[#0891b2]">{fmtC(acc.ltv_last_30d)}</span>
                      : "—"}
                  </span>
                </div>
              ))}
              {sortedModels.length === 0 && <p className="text-[11px] text-muted-foreground">No models</p>}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(orderedCards.length, 8)}, 1fr)` }}>
      {orderedCards.map(id => renderCard(id as DashboardKpiCardId))}
    </div>
  );
}

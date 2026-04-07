import { useState, useMemo, useEffect, useCallback } from "react";
import { getEffectiveSource } from "@/lib/source-helpers";
import { subDays, format, differenceInDays } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchSyncSettings, triggerSync, fetchTrackingLinkLtv, fetchActiveLinkCount } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import {
  RefreshCw, TrendingUp, Users, Tag, BarChart3, PieChart, X,
  DollarSign, Activity, Award, Percent
} from "lucide-react";
import { InsightsSection } from "@/components/dashboard/InsightsSection";
import { RefreshButton } from "@/components/RefreshButton";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { OverviewCustomizer, useOverviewCustomizer, type OverviewKpiCardId } from "@/components/dashboard/OverviewCustomizer";
import { DailyDecisionView } from "@/components/dashboard/DailyDecisionView";
import { applySnapshotToLinks, buildSnapshotLookup } from "@/hooks/useSnapshotMetrics";
import type { TimePeriod } from "@/hooks/usePageFilters";

interface OverviewSnapshotRange {
  from: string;
  to: string;
  dayCount: number;
}

function getOverviewSnapshotRange(
  timePeriod: TimePeriod,
  customRange: { from: Date; to: Date } | null
): OverviewSnapshotRange | null {
  if (customRange) {
    return {
      from: format(customRange.from, "yyyy-MM-dd"),
      to: format(customRange.to, "yyyy-MM-dd"),
      dayCount: Math.max(1, differenceInDays(customRange.to, customRange.from) + 1),
    };
  }

  switch (timePeriod) {
    case "day":
      // Resolved to MAX(snapshot_date) at query time
      return { from: "__latest__", to: "__latest__", dayCount: 1 };
    case "since_sync":
      // Same as Last Day — MAX(snapshot_date)
      return { from: "__latest__", to: "__latest__", dayCount: 1 };
    case "week":
      // Resolved server-side: CURRENT_DATE - 7
      return { from: "__server_week__", to: "__server_latest__", dayCount: 7 };
    case "month":
      // Resolved server-side: CURRENT_DATE - 30
      return { from: "__server_month__", to: "__server_latest__", dayCount: 30 };
    case "prev_month":
      // Resolved server-side: CURRENT_DATE - 60 to CURRENT_DATE - 31
      return { from: "__server_prev_from__", to: "__server_prev_to__", dayCount: 30 };
    case "all":
    default:
      return null;
  }
}


export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [selectedModel, setSelectedModel] = useState<string>("all");
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | null>(null);

  const {
    kpiCards: enabledCards, toggleKpi: toggleCard, isKpiVisible: isVisible,
    insightPanels, toggleInsight, isInsightVisible,
    modelCompCols, toggleModelCol, isModelColVisible,
  } = useOverviewCustomizer();

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: allLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: async () => {
      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("tracking_links")
          .select("*, accounts(display_name, username, avatar_thumb_url)")
          .is("deleted_at", null)
          .order("revenue", { ascending: false })
          .range(rangeFrom, rangeFrom + batchSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        rangeFrom += batchSize;
      }
      return allRows;
    },
  });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: syncSettings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });
  const { data: trackingLinkLtv = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });

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

  const modelParam = selectedModel !== "all" ? selectedModel : null;
  const agencyAccountIds = useMemo(() => {
    if (modelParam) return [modelParam];
    if (groupFilter !== "all") return groupFilteredAccounts.map((a: any) => a.id);
    return null;
  }, [modelParam, groupFilter, groupFilteredAccounts]);

  const overviewSnapshotRange = useMemo(
    () => getOverviewSnapshotRange(timePeriod, customRange),
    [timePeriod, customRange]
  );

  const {
    data: overviewSnapshotRows = [],
    isLoading: overviewSnapshotsLoading,
    isFetching: overviewSnapshotsFetching,
  } = useQuery({
    queryKey: [
      "daily_snapshots",
      "overview",
      overviewSnapshotRange?.from ?? "all",
      overviewSnapshotRange?.to ?? "all",
      agencyAccountIds?.join(",") ?? "all",
    ],
    enabled: !!overviewSnapshotRange,
    queryFn: async () => {
      if (!overviewSnapshotRange) return [];
      if (agencyAccountIds && agencyAccountIds.length === 0) return [];

      let fromDate = overviewSnapshotRange.from;
      let toDate = overviewSnapshotRange.to;

      // Resolve server date for all sentinel values
      const needsServerDate = fromDate.startsWith("__");
      let serverMaxDate: string | null = null;

      if (needsServerDate) {
        let latestQuery = supabase
          .from("daily_snapshots")
          .select("snapshot_date")
          .order("snapshot_date", { ascending: false })
          .limit(1);

        if (agencyAccountIds?.length) {
          latestQuery = latestQuery.in("account_id", agencyAccountIds);
        }

        const { data: latest, error: latestError } = await latestQuery;
        if (latestError) throw latestError;

        serverMaxDate = latest?.[0]?.snapshot_date;
        if (!serverMaxDate) return [];

        // Resolve sentinels using server date
        if (fromDate === "__latest__") {
          fromDate = serverMaxDate;
          toDate = serverMaxDate;
        } else if (fromDate === "__server_week__") {
          const d = new Date(serverMaxDate + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() - 7);
          fromDate = d.toISOString().slice(0, 10);
          toDate = serverMaxDate;
        } else if (fromDate === "__server_month__") {
          const d = new Date(serverMaxDate + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() - 30);
          fromDate = d.toISOString().slice(0, 10);
          toDate = serverMaxDate;
        } else if (fromDate === "__server_prev_from__") {
          const dFrom = new Date(serverMaxDate + "T00:00:00Z");
          dFrom.setUTCDate(dFrom.getUTCDate() - 60);
          const dTo = new Date(serverMaxDate + "T00:00:00Z");
          dTo.setUTCDate(dTo.getUTCDate() - 31);
          fromDate = dFrom.toISOString().slice(0, 10);
          toDate = dTo.toISOString().slice(0, 10);
        }
      }

      console.log("[OverviewSnapshots] date range:", { fromDate, toDate, serverMaxDate, originalFrom: overviewSnapshotRange.from });

      const rows: Array<{
        tracking_link_id: string | null;
        clicks: number | null;
        subscribers: number | null;
        revenue: number | null;
      }> = [];
      let rangeFrom = 0;
      const batchSize = 1000;

      while (true) {
        let query = supabase
          .from("daily_snapshots")
          .select("tracking_link_id, clicks, subscribers, revenue, account_id, snapshot_date")
          .gte("snapshot_date", fromDate)
          .lte("snapshot_date", toDate)
          .range(rangeFrom, rangeFrom + batchSize - 1);

        if (agencyAccountIds?.length) {
          query = query.in("account_id", agencyAccountIds);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;

        rows.push(...data);

        if (data.length < batchSize) break;
        rangeFrom += batchSize;
      }

      const totalRev = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
      const totalSubs = rows.reduce((s, r) => s + Number(r.subscribers || 0), 0);
      console.log("[OverviewSnapshots] result:", { rowCount: rows.length, totalRevenue: totalRev.toFixed(2), totalSubscribers: totalSubs });

      return rows;
    },
  });

  const overviewSnapshotLookup = useMemo(() => {
    if (!overviewSnapshotRange) return null;

    return buildSnapshotLookup(overviewSnapshotRows);
  }, [overviewSnapshotRange, overviewSnapshotRows]);

  const links = useMemo(() => applySnapshotToLinks(allLinks, overviewSnapshotLookup), [allLinks, overviewSnapshotLookup]);

  // Fetch today's snapshots for Daily Decision View
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const lastWeekStr = format(subDays(new Date(), 7), "yyyy-MM-dd");

  const { data: todaySnapshots = [] } = useQuery({
    queryKey: ["daily_snapshots", "today", todayStr, agencyAccountIds?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("daily_snapshots")
        .select("tracking_link_id, clicks, subscribers, revenue")
        .eq("snapshot_date", todayStr);
      if (agencyAccountIds?.length) q = q.in("account_id", agencyAccountIds);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: lastWeekSnapshots = [] } = useQuery({
    queryKey: ["daily_snapshots", "lastweek", lastWeekStr, agencyAccountIds?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("daily_snapshots")
        .select("tracking_link_id, clicks, subscribers, revenue")
        .eq("snapshot_date", lastWeekStr);
      if (agencyAccountIds?.length) q = q.in("account_id", agencyAccountIds);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = linksLoading || overviewSnapshotsLoading || overviewSnapshotsFetching;

  const syncFrequency = useMemo(() => {
    const s = syncSettings.find((s: any) => s.key === "sync_frequency_days");
    return s ? parseInt(s.value) : 3;
  }, [syncSettings]);

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(undefined, true, (msg) => toast.info(msg, { id: 'sync-progress' })),
    onSuccess: (data) => {
      toast.success(`Sync complete — ${data?.accounts_synced ?? 0} accounts synced`, { id: 'sync-progress' });
      ["tracking_links", "accounts", "daily_metrics", "daily_snapshots", "sync_logs", "transaction_totals"].forEach(k =>
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

  const filteredLinksForKpi = useMemo(() => {
    if (!agencyAccountIds) return links;
    const idSet = new Set(agencyAccountIds);
    return links.filter((l: any) => idSet.has(l.account_id));
  }, [links, agencyAccountIds]);

  // Build LTV lookup for overview calculations
  const overviewLtvLookup = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trackingLinkLtv) {
      const key = String(r.tracking_link_id ?? "").trim().toLowerCase();
      if (key) map[key] = r;
    }
    return map;
  }, [trackingLinkLtv]);

  const overviewPeriodTotals = useMemo(() => {
    return filteredLinksForKpi.reduce(
      (totals: { clicks: number; subscribers: number; revenue: number; activeLinks: number }, l: any) => {
        const clicks = Number(l.clicks || 0);
        const subscribers = Number(l.subscribers || 0);
        const revenue = Number(l.revenue || 0);

        return {
          clicks: totals.clicks + clicks,
          subscribers: totals.subscribers + subscribers,
          revenue: totals.revenue + revenue,
          activeLinks: totals.activeLinks + (clicks > 0 || subscribers > 0 ? 1 : 0),
        };
      },
      { clicks: 0, subscribers: 0, revenue: 0, activeLinks: 0 }
    );
  }, [filteredLinksForKpi]);

  const periodSubscribers = overviewPeriodTotals.subscribers;
  const periodDayCount = overviewSnapshotRange?.dayCount ?? null;

  // Active link count from DB to avoid 1000-row limit
  const { data: dbActiveLinkCount } = useQuery({
    queryKey: ["active_link_count", agencyAccountIds?.join(",") ?? "all"],
    queryFn: () => fetchActiveLinkCount(agencyAccountIds ?? undefined),
  });
  const activeLinkCount = dbActiveLinkCount ?? 0;

  const isAllTime = timePeriod === "all" && !customRange;

  // ═══ All Time totals from tracking_link_ltv + tracking_links ═══
  const allTimeTotals = useMemo(() => {
    if (!isAllTime) return null;
    const accountIdSet = agencyAccountIds ? new Set(agencyAccountIds) : null;

    // LTV + Cross-Poll from tracking_link_ltv
    let ltv = 0;
    let crossPoll = 0;
    for (const r of trackingLinkLtv) {
      if (accountIdSet && !accountIdSet.has(r.account_id)) continue;
      ltv += Number(r.total_ltv || 0);
      crossPoll += Number(r.cross_poll_revenue || 0);
    }
    const totalLtv = ltv + crossPoll;

    // Expenses, subs, clicks from tracking_links
    let expenses = 0;
    let subs = 0;
    let clicks = 0;
    for (const l of filteredLinksForKpi) {
      expenses += Number(l.cost_total || 0) > 0 ? Number(l.cost_total) : 0;
      subs += Number(l.subscribers || 0);
      clicks += Number(l.clicks || 0);
    }

    const totalProfit = totalLtv - expenses;
    const ltvPerSub = subs > 0 ? totalLtv / subs : null;
    const avgCpl = subs > 0 ? expenses / subs : null;
    const roi = expenses > 0 ? (totalProfit / expenses) * 100 : null;

    return { ltv, crossPoll, totalLtv, expenses, subs, clicks, totalProfit, ltvPerSub, avgCpl, roi };
  }, [isAllTime, trackingLinkLtv, filteredLinksForKpi, agencyAccountIds]);

  // Get distinct active link IDs from snapshot rows for period expense query
  const periodActiveLinkIds = useMemo(() => {
    if (isAllTime || !overviewSnapshotLookup) return null;
    return Object.keys(overviewSnapshotLookup).filter(id => {
      const snap = overviewSnapshotLookup[id];
      return snap && (snap.clicks > 0 || snap.subscribers > 0 || snap.revenue > 0);
    });
  }, [overviewSnapshotLookup, isAllTime]);

  // Determine period days for estimated spend calculation
  const periodDays = useMemo(() => {
    if (isAllTime) return null;
    if (customRange) return Math.max(1, differenceInDays(customRange.to, customRange.from) + 1);
    switch (timePeriod) {
      case "day": case "since_sync": return 1;
      case "week": return 7;
      case "month": return 30;
      case "prev_month": return 30;
      default: return null;
    }
  }, [isAllTime, timePeriod, customRange]);

  // Query estimated period spend: daily_spend = cost_total / days_since_created, then × periodDays
  const { data: periodExpensesFromDb } = useQuery({
    queryKey: ["period_expenses", periodActiveLinkIds?.join(",") ?? "none", periodDays],
    enabled: !!periodActiveLinkIds && periodActiveLinkIds.length > 0 && !!periodDays,
    queryFn: async () => {
      if (!periodActiveLinkIds || periodActiveLinkIds.length === 0 || !periodDays) return 0;
      const today = new Date();
      let total = 0;
      const idBatchSize = 500;
      const rowBatchSize = 1000;
      for (let i = 0; i < periodActiveLinkIds.length; i += idBatchSize) {
        const idBatch = periodActiveLinkIds.slice(i, i + idBatchSize);
        let rangeFrom = 0;
        while (true) {
          const { data, error } = await supabase
            .from("tracking_links")
            .select("cost_total, created_at")
            .in("id", idBatch)
            .gt("cost_total", 0)
            .range(rangeFrom, rangeFrom + rowBatchSize - 1);
          if (error) throw error;
          if (!data?.length) break;
          for (const row of data) {
            const costTotal = Number(row.cost_total || 0);
            const createdAt = new Date(row.created_at);
            const daysSinceCreated = Math.max(1, differenceInDays(today, createdAt));
            const dailySpend = costTotal / daysSinceCreated;
            total += dailySpend * periodDays;
          }
          if (data.length < rowBatchSize) break;
          rangeFrom += rowBatchSize;
        }
      }
      return total;
    },
  });

  // Total Expenses: All Time uses allTimeTotals, periods use DB query
  const totalSpend = useMemo(() => {
    if (isAllTime && allTimeTotals) return allTimeTotals.expenses;
    if (periodActiveLinkIds && periodActiveLinkIds.length > 0) return periodExpensesFromDb ?? 0;
    return 0;
  }, [isAllTime, allTimeTotals, periodActiveLinkIds, periodExpensesFromDb]);
  const totalRevenue = overviewPeriodTotals.revenue;

  // Total LTV — for periods, sum directly from snapshot rows (avoids 1000-row link cap)
  const snapshotRevenue = useMemo(() => {
    if (isAllTime) return 0;
    let sum = 0;
    const accountIdSet = agencyAccountIds ? new Set(agencyAccountIds) : null;
    for (const row of overviewSnapshotRows) {
      // If filtering by account, the query already filters, but double-check
      sum += Number(row.revenue || 0);
    }
    return sum;
  }, [isAllTime, overviewSnapshotRows, agencyAccountIds]);
  const totalLtv = isAllTime && allTimeTotals ? allTimeTotals.totalLtv : snapshotRevenue;
  const totalProfit = isAllTime && allTimeTotals ? allTimeTotals.totalProfit : totalLtv - totalSpend;
  // hasSnapshotData: true if any snapshot rows were returned for this period
  const hasSnapshotData = isAllTime || overviewSnapshotRows.length > 0;
  const avgProfitPerSub = isAllTime && allTimeTotals
    ? allTimeTotals.totalProfit / (allTimeTotals.subs || 1)
    : periodSubscribers > 0 ? totalProfit / periodSubscribers : null;

  const unattributedStats = useMemo(() => {
    let accts = [...accounts];
    if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);
    const accountTotalSubs = accts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    const attributedSubs = Math.min(periodSubscribers, accountTotalSubs);
    const unattributed = Math.max(0, accountTotalSubs - attributedSubs);
    const pct = accountTotalSubs > 0 ? Math.max(0, (unattributed / accountTotalSubs) * 100) : 0;
    return { accountTotalSubs, attributedSubs, unattributed, pct, isOverflow: false };
  }, [accounts, modelParam, groupFilter, periodSubscribers]);

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
            <h1 className="text-[22px] font-bold text-foreground">Overview</h1>
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
            <OverviewCustomizer
              kpiCards={enabledCards} insightPanels={insightPanels} modelCompCols={modelCompCols}
              toggleKpi={toggleCard} toggleInsight={toggleInsight} toggleModelCol={toggleModelCol}
            />
            <RefreshButton queryKeys={["tracking_links", "accounts", "daily_metrics", "daily_snapshots", "sync_settings"]} />
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
          <AccountFilterDropdown
            value={selectedModel}
            onChange={(v) => setSelectedModel(v)}
            accounts={groupFilteredAccounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
          />

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
          isLoading={isLoading}
          isVisible={isVisible}
          enabledCards={enabledCards}
          accounts={accounts}
          links={filteredLinksForKpi}
          totalSpend={totalSpend}
          totalRevenue={totalRevenue}
          totalLtv={totalLtv}
          totalProfit={totalProfit}
          periodSubscribers={periodSubscribers}
          periodDayCount={periodDayCount}
          activeLinkCount={activeLinkCount}
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
          hasSnapshotData={hasSnapshotData}
          organicRevenue={(() => {
            // Filter accounts by agency/model selection
            let accts = [...accounts];
            if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
            else if (groupFilter !== "all") accts = accts.filter((a: any) => {
              const username = (a.username || "").replace("@", "");
              return (CATEGORY_MAP[username] || "Female") === groupFilter;
            });

            if (isAllTime) {
              // All Time: accounts.ltv_total - (tracking_link_ltv.total_ltv + cross_poll_revenue)
              const accountRev = accts.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
              const accountIdSet = new Set(accts.map((a: any) => a.id));
              let campaignLtv = 0;
              for (const r of trackingLinkLtv) {
                if (!accountIdSet.has(r.account_id)) continue;
                campaignLtv += Number(r.total_ltv || 0) + Number(r.cross_poll_revenue || 0);
              }
              return accountRev - campaignLtv;
            }

            // Period filters: use accounts.ltv_last_* - SUM(snapshot revenue)
            let accountRev = 0;
            const tp = timePeriod as string;
            if (tp === "day") {
              accountRev = accts.reduce((s: number, a: any) => s + Number(a.ltv_last_day || 0), 0);
            } else if (tp === "week") {
              accountRev = accts.reduce((s: number, a: any) => s + Number(a.ltv_last_7d || 0), 0);
            } else if (tp === "month") {
              accountRev = accts.reduce((s: number, a: any) => s + Number(a.ltv_last_30d || 0), 0);
            } else {
              // prev_month or custom: fall back to snapshot revenue diff
              accountRev = totalRevenue;
            }

            // Campaign revenue from snapshots
            const campaignRev = snapshotRevenue;
            return accountRev - campaignRev;
          })()}
          trackingLinkLtv={trackingLinkLtv}
        />

        {/* ═══ DAILY DECISION VIEW ═══ */}
        <DailyDecisionView
          links={filteredLinksForKpi}
          ltvLookup={overviewLtvLookup}
          accounts={accounts}
          snapshotLookup={overviewSnapshotLookup}
          isAllTime={isAllTime}
          todaySnapshots={todaySnapshots}
          lastWeekSnapshots={lastWeekSnapshots}
          activeLinkCount={activeLinkCount}
          snapshotRows={overviewSnapshotRows}
        />


        {/* ═══ INSIGHTS SECTION ═══ */}
        <InsightsSection
          links={links}
          accounts={accounts}
          dailyMetrics={dailyMetrics}
          trackingLinkLtv={trackingLinkLtv}
          groupFilter={groupFilter}
          selectedModel={selectedModel}
          getAccountCategory={getAccountCategory}
          isInsightVisible={isInsightVisible}
          isModelColVisible={isModelColVisible}
          snapshotRows={overviewSnapshotRows}
          isAllTime={isAllTime}
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
  accounts, links,
  totalSpend, totalRevenue, totalLtv, totalProfit, periodSubscribers, periodDayCount, activeLinkCount, avgProfitPerSub,
  unattributedStats, timePeriod, customRange, TIME_PERIODS,
  modelParam, groupFilter, getAccountCategory, fmtC, hasSnapshotData, organicRevenue,
  trackingLinkLtv,
}: {
  isLoading: boolean;
  isVisible: (id: string) => boolean;
  enabledCards: string[];
  accounts: any[];
  links: any[];
  totalSpend: number;
  totalRevenue: number;
  totalLtv: number;
  totalProfit: number;
  periodSubscribers: number;
  periodDayCount: number | null;
  activeLinkCount: number;
  avgProfitPerSub: number | null;
  unattributedStats: any;
  timePeriod: string;
  customRange: { from: Date; to: Date } | null;
  TIME_PERIODS: { key: string; label: string }[];
  modelParam: string | null;
  groupFilter: string;
  getAccountCategory: (a: any) => string;
  fmtC: (v: number) => string;
  hasSnapshotData: boolean;
  organicRevenue: number;
  trackingLinkLtv: any[];
}) {
  const periodLabel = customRange
    ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`
    : TIME_PERIODS.find(t => t.key === timePeriod)?.label || "All Time";

  const subsPerDayCalc = periodDayCount ? periodSubscribers / periodDayCount : null;
  const noDataForPeriod = !hasSnapshotData && timePeriod !== "all";

  // Avg CPL = Expenses / tracked subscribers for the selected period
  const avgCpl = periodSubscribers > 0 ? totalSpend / periodSubscribers : null;

  // Extra card computations
  const linksInPeriod = timePeriod === "all" && !customRange
    ? links
    : links.filter((l: any) => Number(l.clicks || 0) > 0 || Number(l.subscribers || 0) > 0 || Number(l.revenue || 0) > 0);
  const withSpend = linksInPeriod.filter((l: any) => Number(l.cost_total || 0) > 0);
  const expenses = totalSpend;
  const withSpendCount = withSpend.length;
  const avgExpenses = withSpendCount > 0 ? expenses / withSpendCount : null;

  const cardTotalProfit = totalProfit;
  const blendedRoi = expenses > 0 ? (cardTotalProfit / expenses) * 100 : null;
  const activeCampaigns = activeLinkCount;

  // Best source by ROI
  const bySource: Record<string, { rev: number; spend: number; profit: number }> = {};
  withSpend.forEach((l: any) => {
    const tag = getEffectiveSource(l) || "Untagged";
    if (tag === "Untagged") return;
    if (!bySource[tag]) bySource[tag] = { rev: 0, spend: 0, profit: 0 };
    const revenue = Number(l.revenue || 0);
    bySource[tag].rev += revenue;
    bySource[tag].spend += Number(l.cost_total || 0);
    bySource[tag].profit += revenue - Number(l.cost_total || 0);
  });
  let bestSource: { name: string; roi: number } | null = null;
  Object.entries(bySource).forEach(([name, d]) => {
    const roi = d.spend > 0 ? (d.profit / d.spend) * 100 : 0;
    if (!bestSource || roi > bestSource.roi) bestSource = { name, roi };
  });

  const ltvPerSub = periodSubscribers > 0 ? totalLtv / periodSubscribers : null;

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

  const renderCard = (id: OverviewKpiCardId) => {
    switch (id) {
      case "profit_sub": {
        return (
          <div key={id} className="rounded-2xl p-5 flex flex-col" style={{ ...cardStyle, background: "#0F172A", border: "1px solid #1E293B" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-white" />
              </div>
              <span className="text-[11px] text-white/70 font-medium uppercase tracking-wider">Profit/Sub</span>
            </div>
            {avgProfitPerSub !== null ? (
              <p className="text-[22px] font-bold font-mono text-emerald-400">{fmtC(avgProfitPerSub)}</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-white/40">{noDataForPeriod ? "$0.00" : "—"}</p>
            )}
            <p className="text-[11px] text-white/50 mt-1 line-clamp-2">{noDataForPeriod ? "No data for this period" : `Total profit / tracked subs · ${periodLabel}`}</p>
          </div>
        );
      }

      case "ltv_sub":
        return (
          <div key={id} className="rounded-2xl p-5 group relative" style={{ ...cardStyle, background: "#0D9488", border: "1px solid #14B8A6" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Users className="h-4 w-4 text-white" />
              </div>
              <span className="text-[11px] text-white/80 font-medium uppercase tracking-wider">LTV/Sub</span>
            </div>
            {ltvPerSub !== null ? (
              <p className="text-[22px] font-bold font-mono text-white">{fmtC(ltvPerSub)}</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-white/40">{noDataForPeriod ? "$0.00" : "—"}</p>
            )}
            <p className="text-[11px] text-white/60 mt-1">{noDataForPeriod ? "No data for this period" : `LTV / tracked subs · ${periodLabel}`}</p>
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
              <p className="text-[22px] font-bold font-mono text-muted-foreground">{noDataForPeriod ? "$0.00" : "—"}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{noDataForPeriod ? "No data for this period" : `Expenses / tracked subs · ${periodLabel}`}</p>
          </div>
        );

      case "subs_day":
        const isAllTimeSubsCard = timePeriod === "all" && !customRange;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{isAllTimeSubsCard ? "Total Subs" : "Subs/Day"}</span>
            </div>
            {isAllTimeSubsCard ? (
              <p className="text-[22px] font-bold font-mono text-primary">{periodSubscribers.toLocaleString()}</p>
            ) : subsPerDayCalc !== null && subsPerDayCalc > 0 ? (
              <p className="text-[22px] font-bold font-mono text-primary">+{Math.round(subsPerDayCalc)}/day</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">{noDataForPeriod ? "0/day" : "---"}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{isAllTimeSubsCard ? "Total subscribers across all campaigns" : noDataForPeriod ? "No data for this period" : `Tracked subs / day · ${periodLabel}`}</p>
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
            <p className="text-[11px] text-muted-foreground mt-1">Fans with no tracking link · {periodLabel}</p>
            {unattributedStats.accountTotalSubs > 0 && (
              <p className="text-[10px] text-muted-foreground italic mt-0.5">Requires fan sync for accuracy</p>
            )}
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
            <p className="text-[11px] text-muted-foreground mt-1">
              {timePeriod === "all" && !customRange ? "Cumulative spend across tracked links" : "Est. spend · cost ÷ campaign age × period days"}
            </p>
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
            <p className="text-[11px] text-muted-foreground mt-1">Per active link with spend · {periodLabel}</p>
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
            <div className="flex items-center gap-2">
              <p className={`text-[22px] font-bold font-mono ${cardTotalProfit >= 0 ? "text-primary" : "text-destructive"}`}>{fmtC(cardTotalProfit)}</p>
              <span className={`w-2 h-2 rounded-full shrink-0 ${totalLtv > 0 ? "bg-[#0891b2]" : "bg-muted-foreground"}`} title="Calculated from cumulative LTV minus cumulative spend" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Cumulative LTV minus cumulative spend</p>
          </div>
        );

      case "blended_roi":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Percent className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">ROI %</span>
            </div>
            {blendedRoi !== null ? (
              <p className={`text-[22px] font-bold font-mono ${blendedRoi >= 0 ? "text-primary" : "text-destructive"}`}>{blendedRoi.toFixed(1)}%</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">Total profit / expenses × 100</p>
          </div>
        );

      case "active_campaigns":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Active Links</span>
            </div>
            <p className="text-[22px] font-bold font-mono text-foreground">{activeCampaigns}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Links with clicks or subs · {periodLabel}</p>
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
              {bestSource ? `${bestSource.roi.toFixed(0)}% ROI · ${periodLabel}` : "No data"}
            </p>
          </div>
        );

      case "est_revenue":
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5 flex flex-col" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-foreground" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Est. Revenue</span>
            </div>
            <p className="text-[22px] font-bold font-mono text-foreground">{fmtC(totalRevenue)} <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground leading-none align-middle">Est.</span></p>
            <p className="text-[11px] text-muted-foreground mt-1">Snapshot revenue · {periodLabel}</p>
          </div>
        );

      case "total_ltv":
        return (
          <div key={id} className="rounded-2xl p-5 flex flex-col" style={{ ...cardStyle, background: "#10B981", border: "1px solid #34D399", boxShadow: "0 2px 12px rgba(16,185,129,0.15)" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-white" />
              </div>
              <span className="text-[11px] text-white/80 font-medium uppercase tracking-wider">LTV</span>
            </div>
            {totalLtv > 0 ? (
              <p className="text-[22px] font-bold font-mono text-white">{fmtC(totalLtv)}</p>
            ) : (
              <p className="text-[22px] font-bold font-mono text-white/40">—</p>
            )}
            <p className="text-[11px] text-white/60 mt-1">{timePeriod === "all" && !customRange ? "Cumulative LTV" : `Snapshot revenue · ${periodLabel}`}</p>
          </div>
        );

      case "organic_revenue": {
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Organic Revenue</span>
            </div>
            <p className={`text-[22px] font-bold font-mono ${organicRevenue >= 0 ? "text-foreground" : "text-destructive"}`}>{fmtC(organicRevenue)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Revenue outside tracked campaigns</p>
          </div>
        );
      }

      case "organic_fans_pct": {
        // Always use All Time data — LTV sync is not date-based
        // new_subs_total from tracking_link_ltv, subscribers from accounts table
        const modelIdSet = modelParam ? new Set([modelParam]) : null;
        const groupAccIds = groupFilter !== "all"
          ? new Set(accounts.filter((a: any) => getAccountCategory(a) === groupFilter).map((a: any) => a.id))
          : null;
        const filterSet = modelIdSet || groupAccIds;

        let allTimeNewSubs = 0;
        for (const r of trackingLinkLtv) {
          if (filterSet && !filterSet.has(r.account_id)) continue;
          allTimeNewSubs += Number(r.new_subs_total || 0);
        }
        // Use subscribers_count from accounts (not affected by 1000-row limit)
        let allTimeSubs = 0;
        for (const a of accounts) {
          if (filterSet && !filterSet.has(a.id)) continue;
          allTimeSubs += Number(a.subscribers_count || 0);
        }
        const organicPct = allTimeSubs > 0 ? (allTimeNewSubs / allTimeSubs) * 100 : null;
        const pctColor = organicPct === null ? "text-muted-foreground"
          : organicPct > 20 ? "text-primary"
          : organicPct >= 10 ? "text-[hsl(38_92%_50%)]"
          : "text-destructive";
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Percent className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Organic Fans %</span>
            </div>
            <p className={`text-[22px] font-bold font-mono ${pctColor}`}>
              {organicPct !== null ? `${organicPct.toFixed(1)}%` : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">New fans from campaigns (All Time)</p>
          </div>
        );
      }

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
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(orderedCards.length, 6)}, 1fr)`, gridAutoRows: "1fr" }}>
      {orderedCards.map(id => renderCard(id as OverviewKpiCardId))}
    </div>
  );
}

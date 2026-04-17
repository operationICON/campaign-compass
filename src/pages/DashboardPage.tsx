import { useState, useMemo, useEffect, useCallback } from "react";
import { startOfMonth, endOfMonth, subMonths, getDaysInMonth } from "date-fns";
import { getEffectiveSource } from "@/lib/source-helpers";
import { subDays, format, differenceInDays } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchSyncSettings, triggerSync, fetchTrackingLinkLtv, fetchActiveLinkCount, fetchTransactionTypeTotalsByAccount } from "@/lib/supabase-helpers";
import { isActiveAccount } from "@/lib/calc-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import {
  RefreshCw, TrendingUp, Users, Tag, BarChart3, PieChart, X,
  DollarSign, Activity, Award, Percent, ChevronDown
} from "lucide-react";


import { RefreshButton } from "@/components/RefreshButton";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { OverviewCustomizer, useOverviewCustomizer, type OverviewKpiCardId } from "@/components/dashboard/OverviewCustomizer";
import { DailyDecisionView } from "@/components/dashboard/DailyDecisionView";
import { applySnapshotToLinks, buildSnapshotLookup } from "@/hooks/useSnapshotMetrics";
import { usePageFilters, TIME_PERIODS, type TimePeriod } from "@/hooks/usePageFilters";
import { useDateScopedMetrics } from "@/hooks/useDateScopedMetrics";

import { RevenueModeBadge } from "@/components/RevenueModeBadge";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
      return { from: "__latest__", to: "__latest__", dayCount: 1 };
    case "week":
      return { from: "__server_week__", to: "__server_latest__", dayCount: 7 };
    case "month":
      return { from: "__server_month__", to: "__server_latest__", dayCount: 30 };
    case "prev_month": {
      const prevMonth = subMonths(new Date(), 1);
      const daysInPrevMonth = getDaysInMonth(prevMonth);
      return { from: "__server_prev_from__", to: "__server_prev_to__", dayCount: daysInPrevMonth };
    }
    case "all":
    default:
      return null;
  }
}


export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { timePeriod, setTimePeriod, modelFilter: selectedModel, setModelFilter: setSelectedModel, customRange, setCustomRange, revenueMode, setRevenueMode, revMultiplier } = usePageFilters();
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);

  const {
    kpiCards: enabledCards, toggleKpi: toggleCard, isKpiVisible: isVisible,
    insightPanels, toggleInsight, isInsightVisible,
    modelCompCols, toggleModelCol, isModelColVisible,
  } = useOverviewCustomizer();

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: txTypeTotalsByAccount = {} } = useQuery({
    queryKey: ["transaction_type_totals_by_account"],
    queryFn: fetchTransactionTypeTotalsByAccount,
    staleTime: 5 * 60 * 1000,
  });
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
  const { data: trackingLinkLtvRaw = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });
  // RULE: exclude LTV rows tied to deleted tracking links (deleted_at IS NOT NULL).
  const activeLinkIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const l of allLinks) s.add(String(l.id).toLowerCase());
    return s;
  }, [allLinks]);
  const trackingLinkLtv = useMemo(() => {
    if (activeLinkIdSet.size === 0) return trackingLinkLtvRaw;
    return trackingLinkLtvRaw.filter((r: any) =>
      activeLinkIdSet.has(String(r.tracking_link_id ?? "").toLowerCase())
    );
  }, [trackingLinkLtvRaw, activeLinkIdSet]);


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

  // Shared date-scoped metrics (subs/clicks/revenue/spend/profit/roi/cpl/cvr/ltvSub/subsPerDay)
  const dateScoped = useDateScopedMetrics(timePeriod, customRange, agencyAccountIds);

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
          const dEnd = new Date(serverMaxDate + "T00:00:00Z");
          dEnd.setUTCDate(dEnd.getUTCDate() - 1);
          toDate = dEnd.toISOString().slice(0, 10);
        } else if (fromDate === "__server_prev_from__") {
          const refDate = new Date(serverMaxDate + "T00:00:00Z");
          const prevMonthDate = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() - 1, 1));
          const prevMonthEnd = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), 0));
          fromDate = prevMonthDate.toISOString().slice(0, 10);
          toDate = prevMonthEnd.toISOString().slice(0, 10);
        }
      }

      console.log("[OverviewSnapshots] date range:", { fromDate, toDate, serverMaxDate, originalFrom: overviewSnapshotRange.from });

      const rows: Array<{
        tracking_link_id: string | null;
        snapshot_date: string | null;
        clicks: number | null;
        subscribers: number | null;
        revenue: number | null;
      }> = [];
      let rangeFrom = 0;
      const batchSize = 1000;

      while (true) {
        let query = supabase
          .from("daily_snapshots")
          .select("tracking_link_id, clicks, subscribers, revenue, cost_total, account_id, snapshot_date")
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

    // LTV + Cross-Poll + new_subs_total from tracking_link_ltv
    let ltv = 0;
    let crossPoll = 0;
    let ltvSubs = 0; // fans who actually generated LTV
    for (const r of trackingLinkLtv) {
      if (accountIdSet && !accountIdSet.has(r.account_id)) continue;
      ltv += Number(r.total_ltv || 0);
      crossPoll += Number(r.cross_poll_revenue || 0);
      ltvSubs += Number(r.new_subs_total || 0);
    }
    const totalLtv = ltv + crossPoll;

    // Expenses, subs, clicks, revenue from tracking_links
    let expenses = 0;
    let subs = 0;
    let clicks = 0;
    let trackingRevenue = 0;
    for (const l of filteredLinksForKpi) {
      expenses += Number(l.cost_total || 0) > 0 ? Number(l.cost_total) : 0;
      subs += Number(l.subscribers || 0);
      clicks += Number(l.clicks || 0);
      trackingRevenue += Number(l.revenue || 0);
    }

    const totalProfit = totalLtv - expenses;
    // LTV/Sub: tracking_links.revenue / subscribers (consistent across all pages)
    const ltvPerSub = subs > 0 ? trackingRevenue / subs : null;
    const avgCpl = subs > 0 ? expenses / subs : null;
    const roi = expenses > 0 ? (totalProfit / expenses) * 100 : null;

    return { ltv, crossPoll, totalLtv, expenses, subs, ltvSubs, clicks, totalProfit, ltvPerSub, avgCpl, roi };
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
      case "day": return 1;
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

  // Total Expenses: All Time uses allTimeTotals, periods use DB query — tracking_links.cost_total only
  const totalSpend = useMemo(() => {
    return isAllTime && allTimeTotals ? allTimeTotals.expenses
      : (periodActiveLinkIds && periodActiveLinkIds.length > 0 ? (periodExpensesFromDb ?? 0) : 0);
  }, [isAllTime, allTimeTotals, periodActiveLinkIds, periodExpensesFromDb]);
  const totalRevenue = overviewPeriodTotals.revenue;

  // Total LTV + Spend — for periods, sum directly from snapshot rows (avoids 1000-row link cap)
  const snapshotRevenue = useMemo(() => {
    if (isAllTime) return 0;
    return overviewSnapshotRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  }, [isAllTime, overviewSnapshotRows]);

  const snapshotSpend = useMemo(() => {
    if (isAllTime) return 0;
    return overviewSnapshotRows.reduce((s, r) => s + Number((r as any).cost_total || 0), 0);
  }, [isAllTime, overviewSnapshotRows]);

  const snapshotSubs = useMemo(() => {
    if (isAllTime) return 0;
    return overviewSnapshotRows.reduce((s, r) => s + Number(r.subscribers || 0), 0);
  }, [isAllTime, overviewSnapshotRows]);

  const totalLtv = isAllTime && allTimeTotals ? allTimeTotals.totalLtv : snapshotRevenue;
  const totalProfit = totalLtv - totalSpend;
  // hasSnapshotData: true if any snapshot rows were returned for this period
  const hasSnapshotData = isAllTime || overviewSnapshotRows.length > 0;
  const avgProfitPerSub = isAllTime && allTimeTotals
    ? (allTimeTotals.ltvSubs > 0 ? totalProfit / allTimeTotals.ltvSubs : null)
    : periodSubscribers > 0 ? totalProfit / periodSubscribers : null;

  const unattributedStats = useMemo(() => {
    // Rule definition: Unattributed = max(0, accounts.ltv_total - SUM(tracking_links.revenue))
    // Unattributed % = unattributed / ltv_total × 100  (NULL when ltv_total <= 0)
    let accts = accounts.filter(isActiveAccount);
    if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);

    const accountTotalLtv = accts.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
    const accountTotalSubs = accts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
    const acctIds = new Set(accts.map((a: any) => a.id));

    // Tracked revenue from non-deleted tracking_links scoped to filtered accounts
    const trackedRevenue = (allLinks || [])
      .filter((l: any) => acctIds.has(l.account_id))
      .reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

    const unattributed = Math.max(0, accountTotalLtv - trackedRevenue);
    const pct = accountTotalLtv > 0 ? (unattributed / accountTotalLtv) * 100 : 0;
    return { accountTotalLtv, accountTotalSubs, trackedRevenue, unattributed, pct, isOverflow: false };
  }, [accounts, modelParam, groupFilter, allLinks]);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;



  return (
    <DashboardLayout>
      <div className="space-y-8">

        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground">Overview</h1>
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

          {/* Gross / Net toggle */}
          <UITooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setRevenueMode("gross")}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    revenueMode === "gross" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Gross
                </button>
                <button
                  onClick={() => setRevenueMode("net")}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    revenueMode === "net" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Net
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-center">
              OnlyFans takes 20% of all revenue. Net shows your actual earnings after their fee.
            </TooltipContent>
          </UITooltip>

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
          allLinks={allLinks}
          snapshotLookup={overviewSnapshotLookup}
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
            let accts = accounts.filter(isActiveAccount);
            if (modelParam) accts = accts.filter((a: any) => a.id === modelParam);
            else if (groupFilter !== "all") accts = accts.filter((a: any) => {
              const username = (a.username || "").replace("@", "");
              return (CATEGORY_MAP[username] || "Female") === groupFilter;
            });

            if (isAllTime) {
              // All Time: accounts.ltv_total - tracking_links.revenue
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
          revMultiplier={revMultiplier}
          revenueMode={revenueMode}
          snapshotSpend={snapshotSpend}
          snapshotSubs={snapshotSubs}
          txTypeTotalsByAccount={txTypeTotalsByAccount}
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
  accounts, links, allLinks, snapshotLookup,
  totalSpend, totalRevenue, totalLtv, totalProfit, periodSubscribers, periodDayCount, activeLinkCount, avgProfitPerSub,
  unattributedStats, timePeriod, customRange, TIME_PERIODS,
  modelParam, groupFilter, getAccountCategory, fmtC, hasSnapshotData, organicRevenue,
  trackingLinkLtv, revMultiplier, revenueMode,
  snapshotSpend, snapshotSubs,
  txTypeTotalsByAccount,
}: {
  isLoading: boolean;
  isVisible: (id: string) => boolean;
  enabledCards: string[];
  accounts: any[];
  links: any[];
  allLinks: any[];
  snapshotLookup: Record<string, any> | null;
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
  revMultiplier: number;
  revenueMode: "gross" | "net";
  snapshotSpend: number;
  snapshotSubs: number;
}) {
  const periodLabel = customRange
    ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`
    : TIME_PERIODS.find(t => t.key === timePeriod)?.label || "All Time";

  const isAllTime = timePeriod === "all" && !customRange;
  const noDataForPeriod = !hasSnapshotData && !isAllTime;

  // ── Filter accounts by model/group selection ──
  // Rule 4: globally exclude inactive/test accounts (ltv_total=0 OR subscribers_count=0)
  const activeAccounts = useMemo(() => accounts.filter(isActiveAccount), [accounts]);
  const filtAccounts = modelParam ? activeAccounts.filter((a: any) => a.id === modelParam)
    : groupFilter !== "all" ? activeAccounts.filter((a: any) => getAccountCategory(a) === groupFilter)
    : activeAccounts;

  // ── All Time base values from tracking_links ──
  const allTimeRevenue = allLinks
    .filter((l: any) => {
      if (modelParam) return l.account_id === modelParam;
      if (groupFilter !== "all") {
        const acctIds = new Set(filtAccounts.map((a: any) => a.id));
        return acctIds.has(l.account_id);
      }
      return true;
    })
    .reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

  const allTimeSpend = allLinks
    .filter((l: any) => {
      const cost = Number(l.cost_total || 0);
      if (cost <= 0) return false;
      if (modelParam) return l.account_id === modelParam;
      if (groupFilter !== "all") {
        const acctIds = new Set(filtAccounts.map((a: any) => a.id));
        return acctIds.has(l.account_id);
      }
      return true;
    })
    .reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);

  const allTimePaidSubs = allLinks
    .filter((l: any) => {
      const cost = Number(l.cost_total || 0);
      if (cost <= 0) return false;
      if (modelParam) return l.account_id === modelParam;
      if (groupFilter !== "all") {
        const acctIds = new Set(filtAccounts.map((a: any) => a.id));
        return acctIds.has(l.account_id);
      }
      return true;
    })
    .reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);

  const allTimeTotalSubs = filtAccounts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
  const allTimeTrackingSubs = allLinks
    .filter((l: any) => {
      if (modelParam) return l.account_id === modelParam;
      if (groupFilter !== "all") {
        const acctIds = new Set(filtAccounts.map((a: any) => a.id));
        return acctIds.has(l.account_id);
      }
      return true;
    })
    .reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);

  // ── Snapshot period values (snapshotSpend, snapshotSubs passed as props from actual snapshot rows) ──
  const snapshotRevenue = links.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

  // ── Earliest tracking link date for All Time subs/day ──
  const earliestCreated = allLinks.reduce((earliest: Date | null, l: any) => {
    if (!l.created_at) return earliest;
    const d = new Date(l.created_at);
    return !earliest || d < earliest ? d : earliest;
  }, null as Date | null);

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

  const orderedCards = enabledCards.filter(id => isVisible(id));
  const cardStyle = { boxShadow: "0 2px 8px rgba(0,0,0,0.04)" };

  // ── Helper: sum of breakdown types (the balanced Total Revenue) ──
  const calcTotalRevFromTypes = (accts: any[]) => {
    return accts.reduce((s: number, a: any) =>
      s + Number(a.ltv_messages || 0) + Number(a.ltv_tips || 0) + Number(a.ltv_subscriptions || 0) + Number(a.ltv_posts || 0), 0);
  };

  const renderCard = (id: OverviewKpiCardId) => {
    switch (id) {
      // ═══ CARD 1 — PROFIT/SUB (hero teal gradient) ═══
      case "profit_per_sub": {
        let profitPerSub: number | null = null;
        let subtitle = "";
        if (isAllTime) {
          const accountsLtvTotal = filtAccounts.filter(isActiveAccount).reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
          const totalSubsCount = filtAccounts.filter(isActiveAccount).reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
          const profit = accountsLtvTotal * revMultiplier - allTimeSpend;
          profitPerSub = totalSubsCount > 0 ? profit / totalSubsCount : null;
          subtitle = "All time · accounts revenue minus spend";
        } else if (noDataForPeriod) {
          subtitle = "No data for this period";
        } else {
          const periodProfit = snapshotRevenue * revMultiplier - snapshotSpend;
          profitPerSub = snapshotSubs > 0 ? periodProfit / snapshotSubs : null;
          subtitle = periodLabel;
        }
        const showDash = profitPerSub === null;
        const isPositive = profitPerSub !== null && profitPerSub >= 0;
        return (
          <div key={id} className="rounded-2xl p-5 flex flex-col" style={{ ...cardStyle, background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-white" />
              </div>
              <span className="text-[11px] text-white/80 font-medium uppercase tracking-wider">Profit/Sub</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${revenueMode === "net" ? "bg-white/20 text-white" : "bg-white/10 text-white/60"}`}>{revenueMode === "net" ? "NET" : "GROSS"}</span>
            </div>
            {showDash ? (
              <p className="text-[20px] font-medium font-mono text-white/40">—</p>
            ) : (
              <p className={`text-[20px] font-medium font-mono ${isPositive ? "text-white" : "text-red-300"}`}>{fmtC(profitPerSub!)}</p>
            )}
            <p className="text-[11px] text-white/60 mt-1">{subtitle}</p>
          </div>
        );
      }

      // ═══ CARD 2 — LTV/SUB ═══
      case "ltv_per_sub": {
        let ltvPerSub: number | null = null;
        let subtitle = "";
        if (isAllTime) {
          const totalRev2 = allLinks.filter((l: any) => { if (modelParam) return l.account_id === modelParam; if (groupFilter !== "all") { const acctIds = new Set(filtAccounts.map((a: any) => a.id)); return acctIds.has(l.account_id); } return true; }).reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
          const totalSubs2 = allLinks.filter((l: any) => { if (modelParam) return l.account_id === modelParam; if (groupFilter !== "all") { const acctIds = new Set(filtAccounts.map((a: any) => a.id)); return acctIds.has(l.account_id); } return true; }).reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
          ltvPerSub = totalSubs2 > 0 ? (totalRev2 * revMultiplier) / totalSubs2 : null;
          subtitle = "All time · revenue per subscriber";
        } else if (noDataForPeriod) {
          subtitle = "No data for this period";
        } else {
          ltvPerSub = snapshotSubs > 0 ? (snapshotRevenue * revMultiplier) / snapshotSubs : null;
          subtitle = periodLabel;
        }
        const showDash = ltvPerSub === null;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">LTV/Sub</span>
              <RevenueModeBadge mode={revenueMode} />
            </div>
            {showDash ? (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            ) : (
              <p className="text-[20px] font-medium font-mono text-primary">{fmtC(ltvPerSub!)}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>
          </div>
        );
      }

      // ═══ CARD 3 — CPL (Always All Time) ═══
      case "cpl": {
        const cplVal = allTimePaidSubs > 0 ? allTimeSpend / allTimePaidSubs : null;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Tag className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">CPL</span>
            </div>
            {cplVal !== null ? (
              <p className="text-[20px] font-medium font-mono text-foreground">{fmtC(cplVal)}</p>
            ) : (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">Cost per lead · All time</p>
          </div>
        );
      }

      // ═══ CARD 4 — SUBS/DAY ═══
      case "subs_per_day": {
        let subsPerDay: number | null = null;
        let label = "";
        if (isAllTime) {
          if (earliestCreated) {
            const daysSince = Math.max(1, differenceInDays(new Date(), earliestCreated));
            subsPerDay = allTimeTotalSubs > 0 ? allTimeTotalSubs / daysSince : null;
          }
          label = "All time average";
        } else if (noDataForPeriod) {
          label = "No data for this period";
        } else if (periodDayCount && periodDayCount > 0) {
          subsPerDay = snapshotSubs / periodDayCount;
          label = periodLabel;
        } else {
          label = "No data for this period";
        }
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Subs/Day</span>
            </div>
            {subsPerDay !== null && subsPerDay > 0 ? (
              <p className="text-[20px] font-medium font-mono text-primary">{Math.round(subsPerDay)}/day</p>
            ) : (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
          </div>
        );
      }

      // ═══ CARD 5 — UNATTRIBUTED % (Always All Time) ═══
      case "unattributed_pct": {
        const accountsLtv5 = filtAccounts.filter(isActiveAccount).reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
        const campaignRevenue5 = allTimeRevenue;
        const unattribVal = Math.max(0, accountsLtv5 - campaignRevenue5);
        const pct = accountsLtv5 > 0
          ? (unattribVal / accountsLtv5) * 100
          : null;
        const colorClass = pct === null ? "text-muted-foreground"
          : pct > 50 ? "text-destructive"
          : pct >= 30 ? "text-[hsl(38_92%_50%)]"
          : "text-primary";

        // Breakdown: unattributed by type
        const uaMessages = filtAccounts.reduce((s: number, a: any) => s + Number(a.ltv_messages || 0), 0);
        const uaTips = filtAccounts.reduce((s: number, a: any) => s + Number(a.ltv_tips || 0), 0);
        const uaSubs = filtAccounts.reduce((s: number, a: any) => s + Number(a.ltv_subscriptions || 0), 0);
        const uaPosts = filtAccounts.reduce((s: number, a: any) => s + Number(a.ltv_posts || 0), 0);
        // Messages untracked = ltv_messages - campaign revenue (campaigns are mostly messages)
        const uaMessagesUntracked = Math.max(0, uaMessages - campaignRevenue5);

        return (
          <UnattributedCard
            key={id}
            pct={pct}
            colorClass={colorClass}
            cardStyle={cardStyle}
            unattribVal={unattribVal}
            uaMessagesUntracked={uaMessagesUntracked}
            uaTips={uaTips}
            uaSubs={uaSubs}
            uaPosts={uaPosts}
            fmtC={fmtC}
            revMultiplier={revMultiplier}
          />
        );
      }

      // ═══ TOTAL REVENUE ═══
      case "total_revenue": {
        let revVal: number | null = null;
        let subtitle = "";
        const activeAccts = filtAccounts.filter(isActiveAccount);
        const accountsLtvTotal = activeAccts.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
        if (isAllTime) {
          revVal = accountsLtvTotal * revMultiplier;
          subtitle = "All time · accounts revenue";
        } else if (noDataForPeriod) {
          subtitle = "No data for this period";
        } else {
          revVal = snapshotRevenue * revMultiplier;
          subtitle = periodLabel;
        }

        const bkTotalRev = accountsLtvTotal * revMultiplier;
        const bkTracked = allTimeRevenue * revMultiplier;
        const bkUnattr = Math.max(0, bkTotalRev - bkTracked);

        return (
          <TotalRevenueCard
            key={id}
            revVal={revVal}
            subtitle={subtitle}
            revenueMode={revenueMode}
            fmtC={fmtC}
            cardStyle={cardStyle}
            bkTotalRev={bkTotalRev}
            bkTracked={bkTracked}
            bkUnattr={bkUnattr}
            isAllTime={isAllTime}
          />
        );
      }

      // ═══ TOTAL SUBS (always accounts.subscribers_count) ═══
      case "total_subs": {
        const totalSubsVal = filtAccounts
          .filter(isActiveAccount)
          .reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
        const subsSubtitle = "Active subscribers across all models · All time";
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Subs</span>
            </div>
            <p className="text-[20px] font-medium font-mono text-foreground">{totalSubsVal.toLocaleString("en-US")}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{subsSubtitle}</p>
          </div>
        );
      }

      // ═══ EXPENSES ═══
      case "expenses": {
        const expVal = isAllTime ? allTimeSpend : snapshotSpend;
        const expSubtitle = isAllTime ? "All time · total ad spend" : noDataForPeriod ? "No data for this period" : periodLabel;
        const expShowDash = !isAllTime && noDataForPeriod;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Expenses</span>
            </div>
            {expShowDash ? (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            ) : (
              <p className="text-[20px] font-medium font-mono text-foreground">{fmtC(expVal)}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{expSubtitle}</p>
          </div>
        );
      }

      // ═══ AVG EXPENSES ═══
      case "avg_expenses": {
        const activePaidLinks = allLinks.filter((l: any) => {
          const cost = Number(l.cost_total || 0);
          if (cost <= 0) return false;
          if (modelParam) return l.account_id === modelParam;
          if (groupFilter !== "all") {
            const acctIds = new Set(filtAccounts.map((a: any) => a.id));
            return acctIds.has(l.account_id);
          }
          return true;
        });
        const avgExp = activePaidLinks.length > 0 ? allTimeSpend / activePaidLinks.length : null;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Avg Expenses</span>
            </div>
            {avgExp !== null ? (
              <p className="text-[20px] font-medium font-mono text-foreground">{fmtC(avgExp)}</p>
            ) : (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">Average spend per paid campaign · All time</p>
          </div>
        );
      }

      // ═══ TOTAL PROFIT ═══
      case "total_profit": {
        const activeAcctsTP = filtAccounts.filter(isActiveAccount);
        const tpRev = isAllTime ? activeAcctsTP.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0) * revMultiplier : snapshotRevenue * revMultiplier;
        const tpSpend = isAllTime ? allTimeSpend : snapshotSpend;
        const tpVal = tpRev - tpSpend;
        const showDash = !isAllTime && noDataForPeriod;
        const isPositive = tpVal >= 0;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Profit</span>
              <RevenueModeBadge mode={revenueMode} />
            </div>
            {showDash ? (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            ) : (
              <p className={`text-[20px] font-medium font-mono ${isPositive ? "text-primary" : "text-destructive"}`}>{fmtC(tpVal)}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{isAllTime ? "All time · revenue minus spend" : periodLabel}</p>
          </div>
        );
      }

      // ═══ ROI ═══
      case "blended_roi": {
        const activeAcctsROI = filtAccounts.filter(isActiveAccount);
        const roiRev = isAllTime ? activeAcctsROI.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0) * revMultiplier : snapshotRevenue * revMultiplier;
        const roiSpend = isAllTime ? allTimeSpend : snapshotSpend;
        const roiProfit = roiRev - roiSpend;
        const roiVal = roiSpend > 0 ? (roiProfit / roiSpend) * 100 : null;
        const isPositive = roiVal !== null && roiVal >= 0;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Percent className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">ROI</span>
              <RevenueModeBadge mode={revenueMode} />
            </div>
            {roiVal !== null ? (
              <p className={`text-[20px] font-medium font-mono ${isPositive ? "text-primary" : "text-destructive"}`}>{roiVal.toFixed(1)}%</p>
            ) : (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{isAllTime ? "All time · blended ROI" : periodLabel}</p>
          </div>
        );
      }

      // ═══ ACTIVE TRACKING LINKS ═══
      case "active_campaigns": {
        const activeCount = allLinks.filter((l: any) => {
          if (modelParam) return l.account_id === modelParam;
          if (groupFilter !== "all") {
            const acctIds = new Set(filtAccounts.map((a: any) => a.id));
            return acctIds.has(l.account_id);
          }
          return true;
        }).length;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Active Tracking Links</span>
            </div>
            <p className="text-[20px] font-medium font-mono text-foreground">{activeCount}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Tracking links with data</p>
          </div>
        );
      }

      // ═══ BEST SOURCE ═══
      case "best_source": {
        const sourceMap: Record<string, number> = {};
        const relevantLinks = allLinks.filter((l: any) => {
          if (modelParam) return l.account_id === modelParam;
          if (groupFilter !== "all") {
            const acctIds = new Set(filtAccounts.map((a: any) => a.id));
            return acctIds.has(l.account_id);
          }
          return true;
        });
        for (const l of relevantLinks) {
          const src = l.source || l.traffic_source || "Unknown";
          const rev = Number(l.revenue || 0);
          const cost = Number(l.cost_total || 0);
          const profit = rev * revMultiplier - cost;
          sourceMap[src] = (sourceMap[src] || 0) + profit;
        }
        const sorted = Object.entries(sourceMap).sort((a, b) => b[1] - a[1]);
        const bestSrc = sorted.length > 0 ? sorted[0] : null;
        return (
          <div key={id} className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Tag className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Best Source</span>
            </div>
            {bestSrc ? (
              <>
                <p className="text-[20px] font-medium font-mono text-foreground truncate">{bestSrc[0]}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Profit: {fmtC(bestSrc[1])} · All time</p>
              </>
            ) : (
              <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {orderedCards.map(id => renderCard(id as OverviewKpiCardId))}
    </div>
  );
}

/* ── Total Revenue Card with expandable breakdown ── */
function TotalRevenueCard({ revVal, subtitle, revenueMode, fmtC, cardStyle, bkTotalRev, bkTracked, bkUnattr, isAllTime }: {
  revVal: number | null; subtitle: string; revenueMode: "gross" | "net"; fmtC: (v: number) => string; cardStyle: any;
  bkTotalRev: number; bkTracked: number; bkUnattr: number; isAllTime: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const fmtBk = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const pct = (v: number) => bkTotalRev > 0 ? `${((v / bkTotalRev) * 100).toFixed(1)}%` : "0%";

  return (
    <div className="rounded-2xl p-5 flex flex-col" style={{ ...cardStyle, background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <DollarSign className="h-4 w-4 text-white" />
        </div>
        <span className="text-[11px] text-white/80 font-medium uppercase tracking-wider">Total Revenue</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${revenueMode === "net" ? "bg-white/20 text-white" : "bg-white/10 text-white/60"}`}>{revenueMode === "net" ? "NET" : "GROSS"}</span>
      </div>
      {revVal !== null ? (
        <p className="text-[20px] font-medium font-mono text-white">{fmtC(revVal)}</p>
      ) : (
        <p className="text-[20px] font-medium font-mono text-white/40">—</p>
      )}
      <p className="text-[11px] text-white/60 mt-1">{subtitle}</p>

      {isAllTime && bkTotalRev > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-2 text-[11px] text-white/60 hover:text-white/90 transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Hide breakdown" : "Show breakdown"}
          </button>

          {expanded && (
            <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "hsl(var(--primary))" }} />
                  <span className="text-white/60">Via Campaigns</span>
                </div>
                <span className="font-mono text-white/80">{fmtBk(bkTracked)} · {pct(bkTracked)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-white/30" />
                  <span className="text-white/60">Unattributed</span>
                </div>
                <span className="font-mono text-white/80">{fmtBk(bkUnattr)} · {pct(bkUnattr)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Unattributed % Card with expandable breakdown ── */
function UnattributedCard({ pct, colorClass, cardStyle, unattribVal, uaMessagesUntracked, uaTips, uaSubs, uaPosts, fmtC, revMultiplier }: {
  pct: number | null; colorClass: string; cardStyle: any;
  unattribVal: number; uaMessagesUntracked: number; uaTips: number; uaSubs: number; uaPosts: number;
  fmtC: (v: number) => string; revMultiplier: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const fmtBk = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Apply rev multiplier
  const mUnattr = unattribVal * revMultiplier;
  const mMsg = uaMessagesUntracked * revMultiplier;
  const mTips = uaTips * revMultiplier;
  const mSubs = uaSubs * revMultiplier;
  const mPosts = uaPosts * revMultiplier;

  const uaPct = (v: number) => mUnattr > 0 ? `${((v / mUnattr) * 100).toFixed(1)}%` : "0%";

  const rows = [
    { label: "Messages / PPV", value: mMsg, color: "hsl(var(--primary))" },
    { label: "Tips", value: mTips, color: "hsl(38 92% 50%)" },
    { label: "Subscriptions", value: mSubs, color: "hsl(280 60% 55%)" },
    { label: "Posts", value: mPosts, color: "hsl(210 80% 55%)" },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-5" style={cardStyle}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Percent className="h-4 w-4 text-primary" />
        </div>
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Unattributed %</span>
      </div>
      {pct !== null ? (
        <p className={`text-[20px] font-medium font-mono ${colorClass}`}>{pct.toFixed(1)}%</p>
      ) : (
        <p className="text-[20px] font-medium font-mono text-muted-foreground">—</p>
      )}
      <p className="text-[11px] text-muted-foreground mt-1">Revenue not attributed to tracking links · All time</p>

      {mUnattr > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Hide breakdown" : "Show breakdown"}
          </button>

          {expanded && (
            <div className="mt-2 pt-2 border-t border-border space-y-1.5">
              <p className="text-[11px] font-medium text-foreground">Unattributed: {fmtBk(mUnattr)}</p>
              <p className="text-[10px] text-muted-foreground">Revenue not from tracking links · by type</p>
              {rows.map(row => (
                <div key={row.label} className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} />
                    <span className="text-muted-foreground">{row.label}</span>
                  </div>
                  <span className="font-mono text-foreground/80">{fmtBk(row.value)} · {uaPct(row.value)}</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground/60 mt-1">Messages shown minus tracked campaign revenue</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

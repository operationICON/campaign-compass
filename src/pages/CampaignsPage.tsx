import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { RevenueModeBadge } from "@/components/RevenueModeBadge";
import { usePageFilters } from "@/hooks/usePageFilters";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { useDateScopedMetrics } from "@/hooks/useDateScopedMetrics";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CsvCostImportModal } from "@/components/dashboard/CsvCostImportModal";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { TagBadge, useTagColors } from "@/components/TagBadge";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { TrafficSourceDropdown } from "@/components/TrafficSourceDropdown";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchTrackingLinks, fetchAdSpend, deleteAdSpend, triggerSync,
  clearTrackingLinkSpend, fetchAccounts, fetchDailyMetrics,
  setTrackingLinkSourceTag, fetchTrackingLinkLtv,
} from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { TIME_PERIODS, type TimePeriod } from "@/hooks/usePageFilters";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RefreshCw, DollarSign, TrendingUp, Star, Trash2, Download, X, Tag,
  Users, Activity, Info, BarChart3, Target, ChevronRight as ChevronR,
  Upload, Plus, Award, AlertTriangle
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { KpiCardCustomizer, useKpiCardVisibility } from "@/components/dashboard/KpiCardCustomizer";
import { ModelAvatar } from "@/components/ModelAvatar";
import { useColumnOrder } from "@/hooks/useColumnOrder";
import { DraggableColumnSelector } from "@/components/DraggableColumnSelector";
import { Pencil } from "lucide-react";
import { SourceSelector } from "@/components/SourceSelector";
import { LinkActivityFilter, type LinkActivityFilterValue } from "@/components/LinkActivityFilter";
import { useActiveLinkStatus, getActiveInfo } from "@/hooks/useActiveLinkStatus";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useSnapshotDeltaMetrics, getDelta } from "@/hooks/useSnapshotDeltaMetrics";

// ─── Types ───
type SortKey = "campaign_name" | "cost_total" | "revenue" | "ltv" | "profit" | "roi" | "profit_per_sub" | "created_at" | "subs_day" | "source_tag" | "clicks" | "subscribers" | "cvr" | "media_buyer" | "ltv_sub_all" | "model" | "cross_poll" | "spender_rate" | "cpl" | "cpc" | "marketer" | "status" | "last_synced" | "avg_expenses";
type CampaignFilter = "all" | "active" | "zero" | "no_spend" | "SCALE" | "WATCH" | "KILL" | "TESTING" | "INACTIVE";

const KPI_COLLAPSED_KEY = "campaigns_kpi_collapsed";

// Standard column order: Tracking Link is rendered as a fixed column.
// Order below: Source | Marketer | Clicks | Subs | Subs/Day | CVR | Spend |
//              Revenue | Cross-Poll | Profit | Profit/Sub | LTV/Sub | CPL |
//              CPC | ROI | Status | Created
const ALL_COLUMNS = [
  { id: "source", label: "Source", defaultOn: true },
  { id: "marketer", label: "Marketer", defaultOn: true },
  { id: "clicks", label: "Clicks", defaultOn: true },
  { id: "subscribers", label: "Subs", defaultOn: true },
  { id: "subs_day", label: "Subs/Day", defaultOn: true },
  { id: "cvr", label: "CVR", defaultOn: true },
  { id: "expenses", label: "Spend", defaultOn: true },
  { id: "revenue", label: "Revenue", defaultOn: true },
  { id: "cross_poll", label: "Cross-Poll", defaultOn: true },
  { id: "profit", label: "Profit", defaultOn: true },
  { id: "profit_sub", label: "Profit/Sub", defaultOn: true, alwaysOn: true },
  { id: "ltv_sub_all", label: "LTV/Sub", defaultOn: true },
  { id: "cpl", label: "CPL", defaultOn: true },
  { id: "cpc", label: "CPC", defaultOn: true },
  { id: "roi", label: "ROI", defaultOn: true },
  { id: "status", label: "Status", defaultOn: true },
  { id: "created", label: "Created", defaultOn: true },
  // Optional / hidden by default
  { id: "model", label: "Model", defaultOn: false },
  { id: "spender_rate", label: "Spender %", defaultOn: false },
  { id: "last_synced", label: "Last Synced", defaultOn: false },
  { id: "media_buyer", label: "Media Buyer", defaultOn: false },
  { id: "avg_expenses", label: "Avg Expenses", defaultOn: false },
];

// ─── Constants ───
const MODEL_COLORS: Record<string, string> = {
  "jessie_ca_xo": "#0891b2", "zoey.skyy": "#7c3aed", "miakitty.ts": "#ec4899",
  "ella_cherryy": "#f59e0b", "aylin_bigts": "#ef4444",
};
function getModelColor(username: string | null): string {
  if (!username) return "#94a3b8";
  return MODEL_COLORS[username.replace("@", "").toLowerCase()] || "#94a3b8";
}

import { STATUS_STYLES, STATUS_LABELS, calcStatus, calcProfit, calcRoi, calcCvr, calcAgencyTotals, calcStatusFromRoi, getEffectiveRevenue, getCostTypeFromOrderId, deriveCostLabel, calcCostMetric, type CostTypeFromOrder } from "@/lib/calc-helpers";
import { EstBadge } from "@/components/EstBadge";

function getAgePill(days: number) {
  if (days <= 30) return { label: "New", bg: "#dcfce7", text: "#16a34a" };
  if (days <= 90) return { label: "Active", bg: "#dbeafe", text: "#2563eb" };
  if (days <= 180) return { label: "Mature", bg: "#fef9c3", text: "#854d0e" };
  return { label: "Old", bg: "#f3f4f6", text: "#6b7280" };
}

const GROUP_MAP: Record<string, string[]> = {
  Female: ["jessie_ca_xo", "zoey.skyy", "ella_cherryy"],
  Trans: ["miakitty.ts", "aylin_bigts"],
};

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (v: number) => `${v.toFixed(1)}%`;
const fmtK = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : fmtC(v);
const normalizeTrackingLinkId = (value: unknown) => String(value ?? "").trim().toLowerCase();
import { getEffectiveSource, getTrafficCategoryLabel } from "@/lib/source-helpers";

// ─── Info Tooltip ───
function InfoDot({ title, desc }: { title: string; desc: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-muted-foreground text-[9px] font-bold cursor-help shrink-0">i</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[230px] bg-[hsl(216_33%_10%)] text-white border-none p-3 rounded-lg">
        <p className="text-[11px] font-bold mb-1">{title}</p>
        <p className="text-[10px] leading-relaxed opacity-90">{desc}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const campaignKpi = useKpiCardVisibility("campaigns_kpi_cards");
  const { timePeriod, setTimePeriod, modelFilter: pageModelFilter, setModelFilter: setPageModelFilter, customRange, setCustomRange, dateFilter, revenueMode, setRevenueMode, revMultiplier } = usePageFilters();

  // ─── Column order + visibility (v2 = standard order rolled out) ───
  const columnOrder = useColumnOrder("campaigns_columns_v2", ALL_COLUMNS);
  const [colDropdownOpen, setColDropdownOpen] = useState(false);
  const col = (id: string) => columnOrder.isVisible(id);

  // ─── KPI collapse state ───
  const [kpiCollapsed, setKpiCollapsed] = useState(() => {
    try { return localStorage.getItem(KPI_COLLAPSED_KEY) !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(KPI_COLLAPSED_KEY, String(kpiCollapsed)); } catch {} }, [kpiCollapsed]);

  // ─── Filter/sort state (persisted to localStorage) ───
  const PREFS = "ct_table_prefs_tracking_links_main";
  const [searchQuery, setSearchQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = usePersistedState<CampaignFilter>(`${PREFS}_campaignFilter`, "all");
  const [activityFilter, setActivityFilter] = usePersistedState<LinkActivityFilterValue>(`${PREFS}_activityFilter`, "all");
  const [sourceFilter, setSourceFilter] = usePersistedState<string>(`${PREFS}_sourceFilter`, "all");

  const [groupFilter, setGroupFilter] = usePersistedState<string>(`${PREFS}_groupFilter`, "all");
  const [accountFilter, setAccountFilter] = usePersistedState<string>(`${PREFS}_accountFilter`, "all");

  const [sortKey, setSortKey] = usePersistedState<SortKey>(`${PREFS}_sortKey`, "created_at");
  const [sortAsc, setSortAsc] = usePersistedState<boolean>(`${PREFS}_sortAsc`, false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = usePersistedState<number>(`${PREFS}_perPage`, 25);

  // ─── Selection/interaction state ───
  const [csvOpen, setCsvOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [spendType, setSpendType] = useState<"CPL" | "CPC" | "FIXED">("CPL");
  const [spendValue, setSpendValue] = useState("");
  
  const [sourceInputValue, setSourceInputValue] = useState("");
  
  const [noteText, setNoteText] = useState("");
  const [syncLabel, setSyncLabel] = useState("Sync Now");
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);

  // ─── Snapshot-based time filtering (shared hook) ───
  const { snapshotLookup, isLoading: snapshotsLoading } = useSnapshotMetrics(timePeriod, customRange);
  // Shared date-scoped aggregator — available for KPI cards on this page.
  // Tables/sorting continue to use applySnapshotToLinks for per-link metrics.
  const dateScoped = useDateScopedMetrics(timePeriod, customRange, pageModelFilter !== "all" ? [pageModelFilter] : null);
  void dateScoped;

  // ─── Data fetching (always fetch all links) ───
  const { data: allLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: async () => {
      const allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("tracking_links")
          .select("*, accounts(display_name, username, avatar_thumb_url)")
          .is("deleted_at", null)
          .order("revenue", { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return allData;
    },
  });

  // Rows always show — only column values change with period
  const isLoading = linksLoading;
  // Apply snapshot metrics to links
  const links = useMemo(() => applySnapshotToLinks(allLinks, snapshotLookup), [allLinks, snapshotLookup]);

  const { data: adSpendData = [] } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: trackingLinkLtv = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });
  const { data: trafficSources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("traffic_sources").select("*").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Snapshot-derived activity (>= 1 sub/day over last 5 days)
  const { activeLookup } = useActiveLinkStatus();

  // Per-link delta-from-cumulative metrics for the selected window. Used for
  // Subs/Day on the table when the activity filter is "all".
  const { deltaLookup, isAllTime: isDeltaAllTime } = useSnapshotDeltaMetrics(timePeriod, customRange);

  const { data: otOrders = [] } = useQuery({
    queryKey: ["ot_orders_for_cost_type"],
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const batch = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("onlytraffic_orders")
          .select("tracking_link_id, order_id")
          .not("tracking_link_id", "is", null)
          .range(from, from + batch - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < batch) break;
        from += batch;
      }
      return all;
    },
  });

  // tracking_link_id → Set of CPL|CPC types derived from order_id prefix
  const costTypeMap = useMemo(() => {
    const m: Record<string, Set<CostTypeFromOrder>> = {};
    for (const o of otOrders) {
      const tlId = o.tracking_link_id;
      if (!tlId) continue;
      const t = getCostTypeFromOrderId(o.order_id);
      if (!t) continue;
      if (!m[tlId]) m[tlId] = new Set();
      m[tlId].add(t);
    }
    return m;
  }, [otOrders]);

  
  const tagColorMap = useTagColors();

  // ─── Realtime ───
  useEffect(() => {
    const channel = supabase
      .channel('campaigns-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracking_links' }, () => {
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
        queryClient.invalidateQueries({ queryKey: ["tracking_link_ltv"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // ─── Deep-link from /campaigns?id=<tracking_link_id> (e.g. AlertsPage View button) ───
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id || !allLinks.length) return;
    const link = allLinks.find((l: any) => String(l.id) === String(id));
    if (link) {
      setDrawerCampaign(link);
      // Clear the param so re-opens of the page don't re-trigger.
      const next = new URLSearchParams(searchParams);
      next.delete("id");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, allLinks, setSearchParams]);


  const deleteSpendMutation = useMutation({
    mutationFn: deleteAdSpend,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend deleted"); },
  });

  const syncMutation = useMutation({
    mutationFn: (testLinkId?: string) => triggerSync(undefined, true, (msg) => toast.info(msg, { id: 'sync-progress' }), testLinkId),
    onSuccess: (data) => {
      toast.success(`Sync complete — ${data?.accounts_synced ?? 0} accounts synced`, { id: 'sync-progress' });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_link_ltv"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["daily_metrics"] });
      setSyncLabel("Synced ✓");
      setTimeout(() => setSyncLabel("Sync Now"), 2000);
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
  });

  const exportCampaignsCsv = useCallback(() => {
    const header = "campaign_name,account_username,source_tag,media_buyer,clicks,subscribers,ltv,spend,profit,profit_per_sub,roi,status";
    const rows = links.map((l: any) => {
      const cn = (l.campaign_name || "").replace(/,/g, " ");
      const un = (l.accounts?.username || "").replace(/,/g, " ");
      const st = (l.source_tag || "").replace(/,/g, " ");
      const mb = (l.media_buyer || "").replace(/,/g, " ");
      const subs = l.subscribers || 0;
      const profit = Number(l.profit || 0);
      const profitPerSub = subs > 0 && Number(l.cost_total || 0) > 0 ? (profit / subs).toFixed(2) : "";
      return `${cn},${un},${st},${mb},${l.clicks || 0},${subs},${Number(l.revenue || 0).toFixed(2)},${Number(l.cost_total || 0).toFixed(2)},${profit.toFixed(2)},${profitPerSub},${Number(l.roi || 0).toFixed(1)},${l.status || "NO_DATA"}`;
    });
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `campaigns_${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${links.length} campaigns`);
  }, [links]);

  // ─── LTV lookup map from tracking_link_ltv table ───
  const ltvLookup = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trackingLinkLtv) {
      const trackingLinkId = normalizeTrackingLinkId(r.tracking_link_id);
      if (!trackingLinkId) continue;
      map[trackingLinkId] = r;
    }
    return map;
  }, [trackingLinkLtv]);

  // ─── Enriched links ───
  const enrichedLinks = useMemo(() => {
    return links.map((l: any) => {
      const daysSinceCreated = differenceInDays(new Date(), new Date(l.created_at));
      const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
      const daysSinceActivity = calcDate ? differenceInDays(new Date(), calcDate) : 999;
      const isNaturallyActive = (l.clicks > 0 || Number(l.revenue) > 0) && daysSinceActivity <= 30;
      const hasOverride = manualOverrides[l.id] !== undefined;
      const isActive = hasOverride ? manualOverrides[l.id] : isNaturallyActive;
      // Delta-based subs/day from daily_metrics snapshots
      const linkMetrics = dailyMetrics
        .filter((m: any) => m.tracking_link_id === l.id)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let subsDay: number | null = null;
      let subsDayLabel: string | null = null;
      if (linkMetrics.length >= 2) {
        const latest = linkMetrics[0];
        const prev = linkMetrics[1];
        const days = Math.max(1, differenceInDays(new Date(latest.date), new Date(prev.date)));
        const delta = (latest.subscribers || 0) - (prev.subscribers || 0);
        subsDay = delta > 0 ? delta / days : 0;
      } else if (linkMetrics.length === 1) {
        subsDayLabel = "Needs 2nd sync";
      } else {
        subsDayLabel = "Sync needed";
      }
      const subs = l.subscribers || 0;
      // LTV from tracking_link_ltv table
      const linkId = normalizeTrackingLinkId(l.id);
      const ltvRecord = ltvLookup[linkId] || null;
      const hasLtvRecord = ltvRecord !== null;
      const ltvFromTable = hasLtvRecord ? Number(ltvRecord.total_ltv || 0) : null;
      const crossPollRevenue = hasLtvRecord ? Number(ltvRecord.cross_poll_revenue || 0) : null;
      const ltvBased = ltvFromTable !== null && ltvFromTable > 0;
      // FIX 4/5: Profit = tracking_links.revenue - cost_total; ROI = profit / cost_total * 100
      const costTotalVal = Number(l.cost_total || 0);
      const hasLtvData = ltvFromTable !== null;
      let computedProfit: number | null = null;
      let computedRoi: number | null = null;
      let profitIsEstimate = false;
      let roiIsEstimate = false;
      if (costTotalVal > 0) {
        const revForProfit = Number(l.revenue || 0);
        computedProfit = revForProfit - costTotalVal;
        computedRoi = costTotalVal > 0 ? (computedProfit / costTotalVal) * 100 : null;
      }
      // Profit/Sub uses new_subs_total from tracking_link_ltv
      const newSubsTotal = ltvRecord ? Number(ltvRecord.new_subs_total || 0) : 0;
      const profitPerSub = newSubsTotal > 0 && computedProfit !== null ? computedProfit / newSubsTotal : null;
      // LTV/Sub from tracking_link_ltv
      const ltvPerSubFromRecord = ltvRecord ? Number(ltvRecord.ltv_per_sub || 0) : null;
      // STEP 4: Fixed status logic
      let computedStatus: string;
      const linkClicks = l.clicks || 0;
      if (costTotalVal > 0 && computedRoi !== null) {
        if (computedRoi > 150) computedStatus = "SCALE";
        else if (computedRoi >= 50) computedStatus = "WATCH";
        else if (computedRoi >= 0) computedStatus = "LOW";
        else computedStatus = "KILL";
      } else if (linkClicks === 0 && daysSinceCreated > 3) {
        computedStatus = "DEAD";
      } else if (costTotalVal <= 0) {
        if (ltvFromTable !== null && ltvFromTable > 0) computedStatus = "NO_SPEND";
        else if (!hasLtvData) computedStatus = "NO_DATA";
        else computedStatus = "NO_SPEND";
      } else {
        computedStatus = calcStatus(l);
      }
      return { ...l, isActive, daysSinceActivity, subsDay, subsDayLabel, daysSinceCreated, profitPerSub, ltvBased, computedProfit, computedRoi, profitIsEstimate, roiIsEstimate, computedStatus, ltvFromTable, crossPollRevenue, ltvRecord, hasLtvRecord, newSubsTotal, ltvPerSubFromRecord };
    });
  }, [links, manualOverrides, dailyMetrics, ltvLookup]);

  // ─── Source filter options ───
  const sourceOptions = useMemo(() => {
    const tags = new Set<string>();
    links.forEach((l: any) => { const es = getEffectiveSource(l); if (es) tags.add(es); });
    return [...tags].sort();
  }, [links]);

  // ─── Account/filter options — only accounts with at least 1 tracking link ───
  const accountOptions = useMemo(() => {
    const accountIdsWithLinks = new Set(allLinks.map((l: any) => l.account_id));
    return accounts
      .filter((a: any) => accountIdsWithLinks.has(a.id) && a.username && a.username !== "unknown")
      .map((a: any) => ({ id: a.id, username: a.username || "", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))
      .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));
  }, [accounts, allLinks]);

  const filteredAccountOptions = useMemo(() => {
    if (groupFilter === "all") return accountOptions;
    const groupUsernames = GROUP_MAP[groupFilter] || [];
    return accountOptions.filter((a: any) => groupUsernames.includes(a.username));
  }, [accountOptions, groupFilter]);

  // ─── All links (no artificial filtering) ───
  const baseLinks = enrichedLinks;

  // ─── Filtering (without activity filter — used for activity counts) ───
  const filteredPreActivity = useMemo(() => {
    let result = baseLinks;
    // Account filter (from top bar)
    if (groupFilter !== "all") {
      const groupUsernames = GROUP_MAP[groupFilter] || [];
      const groupAccountIds = accounts.filter((a: any) => groupUsernames.includes(a.username)).map((a: any) => a.id);
      result = result.filter((l: any) => groupAccountIds.includes(l.account_id));
    }
    if (accountFilter !== "all") result = result.filter((l: any) => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter((l: any) => !getEffectiveSource(l));
    else if (sourceFilter !== "all") result = result.filter((l: any) => getEffectiveSource(l) === sourceFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) || (l.url || "").toLowerCase().includes(q) ||
        (l.accounts?.username || "").toLowerCase().includes(q) || (l.accounts?.display_name || "").toLowerCase().includes(q)
      );
    }
    if (campaignFilter === "active") result = result.filter((l: any) => l.isActive);
    else if (campaignFilter === "zero") result = result.filter((l: any) => l.clicks === 0);
    else if (campaignFilter === "no_spend") result = result.filter((l: any) => !l.cost_total || Number(l.cost_total) === 0);
    else if (["SCALE", "WATCH", "KILL", "TESTING", "INACTIVE"].includes(campaignFilter)) result = result.filter((l: any) => l.computedStatus === campaignFilter);

    return result;
  }, [baseLinks, searchQuery, campaignFilter, sourceFilter, groupFilter, accountFilter, accounts]);

  // Activity counts (snapshot-derived) scoped to current filters
  const activityCounts = useMemo(() => {
    let active = 0;
    for (const l of filteredPreActivity) {
      if (getActiveInfo(l.id, activeLookup).isActive) active++;
    }
    return { total: filteredPreActivity.length, active };
  }, [filteredPreActivity, activeLookup]);

  const filtered = useMemo(() => {
    if (activityFilter === "all") return filteredPreActivity;
    if (activityFilter === "active")
      return filteredPreActivity.filter((l: any) => getActiveInfo(l.id, activeLookup).isActive);
    return filteredPreActivity.filter((l: any) => !getActiveInfo(l.id, activeLookup).isActive);
  }, [filteredPreActivity, activityFilter, activeLookup]);


  // ─── Sorting ───
  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "source_tag": aVal = (getEffectiveSource(a) || "zzz").toLowerCase(); bVal = (getEffectiveSource(b) || "zzz").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "cost_total": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        case "revenue": aVal = Number(a.revenue || 0); bVal = Number(b.revenue || 0); break;
        case "ltv": aVal = a.ltvFromTable ?? -1; bVal = b.ltvFromTable ?? -1; break;
        case "profit": aVal = Number(a.computedProfit ?? -Infinity); bVal = Number(b.computedProfit ?? -Infinity); break;
        case "roi": aVal = Number(a.computedRoi ?? -Infinity); bVal = Number(b.computedRoi ?? -Infinity); break;
        case "profit_per_sub": aVal = a.profitPerSub ?? -Infinity; bVal = b.profitPerSub ?? -Infinity; break;
        case "created_at": aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
        case "subs_day": aVal = a.subsDay ?? -Infinity; bVal = b.subsDay ?? -Infinity; break;
        case "clicks": aVal = Number(a.clicks || 0); bVal = Number(b.clicks || 0); break;
        case "subscribers": aVal = Number(a.subscribers || 0); bVal = Number(b.subscribers || 0); break;
        case "cvr": aVal = Number(a.clicks) > 0 ? (a.subscribers / a.clicks) : -Infinity; bVal = Number(b.clicks) > 0 ? (b.subscribers / b.clicks) : -Infinity; break;
        case "media_buyer": aVal = (a.media_buyer || "zzz").toLowerCase(); bVal = (b.media_buyer || "zzz").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "ltv_sub_all": {
          const aR = Number(a.revenue || 0), aS = Number(a.subscribers || 0);
          const bR = Number(b.revenue || 0), bS = Number(b.subscribers || 0);
          aVal = aS > 0 ? aR / aS : -Infinity; bVal = bS > 0 ? bR / bS : -Infinity; break;
        }
        case "model": {
          aVal = (a.accounts?.username || a.accounts?.display_name || "zzz").toLowerCase();
          bVal = (b.accounts?.username || b.accounts?.display_name || "zzz").toLowerCase();
          return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        case "cross_poll": aVal = a.crossPollRevenue ?? -Infinity; bVal = b.crossPollRevenue ?? -Infinity; break;
        case "spender_rate": aVal = Number(a.spender_rate ?? -Infinity); bVal = Number(b.spender_rate ?? -Infinity); break;
        case "cpl": aVal = Number(a.cpl_real ?? a.cost_per_lead ?? -Infinity); bVal = Number(b.cpl_real ?? b.cost_per_lead ?? -Infinity); break;
        case "cpc": {
          const aSpend = Number(a.cost_total || 0); const aClk = Number(a.clicks || 0);
          const bSpend = Number(b.cost_total || 0); const bClk = Number(b.clicks || 0);
          aVal = aSpend > 0 && aClk > 0 ? aSpend / aClk : -Infinity;
          bVal = bSpend > 0 && bClk > 0 ? bSpend / bClk : -Infinity;
          break;
        }
        case "marketer": aVal = (a.onlytraffic_marketer || "zzz").toLowerCase(); bVal = (b.onlytraffic_marketer || "zzz").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "status": {
          aVal = (a.computedStatus || "zzz").toLowerCase();
          bVal = (b.computedStatus || "zzz").toLowerCase();
          return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        case "last_synced": {
          const at = a.fans_last_synced_at || a.accounts?.last_synced_at;
          const bt = b.fans_last_synced_at || b.accounts?.last_synced_at;
          aVal = at ? new Date(at).getTime() : -Infinity;
          bVal = bt ? new Date(bt).getTime() : -Infinity;
          break;
        }
        case "avg_expenses": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        default: aVal = 0; bVal = 0;
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
  }, [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * perPage, safePage * perPage);
  const showStart = sorted.length > 0 ? (safePage - 1) * perPage + 1 : 0;
  const showEnd = Math.min(safePage * perPage, sorted.length);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };
  const toggleActiveOverride = (id: string, currentActive: boolean) => setManualOverrides(prev => ({ ...prev, [id]: !currentActive }));
  const toggleSelectRow = (id: string) => setSelectedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleSelectAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((l: any) => l.id)));
  };
  const clearAllFilters = () => { setGroupFilter("all"); setAccountFilter("all"); setSourceFilter("all"); setSearchQuery(""); setCampaignFilter("all"); setPage(1); };
  const activeFilterCount = [groupFilter !== "all" ? 1 : 0, accountFilter !== "all" ? 1 : 0, campaignFilter !== "all" ? 1 : 0, sourceFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0);

  // ─── Determine period days for Est Expenses ───
  const isAllTime = timePeriod === "all" && !customRange;

  // ─── KPI Calculations ───
  const kpis = useMemo(() => {
    const scopedLinks = filtered;

    // ── Base all-time links (before snapshot overlay) filtered by account ──
    let atLinks = allLinks;
    if (groupFilter !== "all") {
      const groupUsernames = GROUP_MAP[groupFilter] || [];
      const groupAccountIds = accounts.filter((a: any) => groupUsernames.includes(a.username)).map((a: any) => a.id);
      atLinks = atLinks.filter((l: any) => groupAccountIds.includes(l.account_id));
    }
    if (accountFilter !== "all") atLinks = atLinks.filter((l: any) => l.account_id === accountFilter);

    // Check if snapshot data exists for period
    const hasSnapshotData = !isAllTime && !!snapshotLookup && Object.keys(snapshotLookup).length > 0;

    // ── CARD 1: Total Revenue ──
    let totalRevenue: number;
    if (isAllTime) {
      totalRevenue = atLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    } else if (hasSnapshotData) {
      // scopedLinks have snapshot-applied revenue
      totalRevenue = scopedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    } else {
      totalRevenue = 0;
    }

    // ── CARD 2: Total Spend — ALWAYS all-time tracking_links.cost_total only ──
    const totalSpend = atLinks
      .filter((l: any) => Number(l.cost_total || 0) > 0)
      .reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);

    // ── CARD 3: Total Profit ──
    const totalProfitCalc = (isAllTime || hasSnapshotData) ? (totalRevenue - totalSpend) : 0;

    // ── CARD 4: Avg CPL — ALWAYS all-time, CPL payment_type only ──
    const cplLinks = atLinks.filter((l: any) => {
      const pt = (l.payment_type || l.cost_type || "").toUpperCase();
      return pt === "CPL" && Number(l.cost_total || 0) > 0;
    });
    const cplSpend = cplLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const cplSubs = cplLinks.reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
    const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;

    // ── CARD 5: Untagged — ALWAYS all-time, only links with activity ──
    const untagged = atLinks.filter((l: any) => {
      if (getEffectiveSource(l)) return false;
      if (l.deleted_at) return false;
      return Number(l.clicks || 0) > 0 || Number(l.subscribers || 0) > 0 || Number(l.revenue || 0) > 0;
    }).length;

    const noSpend = scopedLinks.filter((l: any) => !l.cost_total || Number(l.cost_total) === 0).length;
    const totalCount = scopedLinks.length;
    const trackedCount = scopedLinks.filter((l: any) => Number(l.cost_total || 0) > 0).length;
    const paidNewSubsAllTime = atLinks.filter((l: any) => Number(l.cost_total || 0) > 0).reduce((s: number, l: any) => {
      const linkId = normalizeTrackingLinkId(l.id);
      const ltvRec = ltvLookup[linkId];
      return s + (ltvRec ? Number(ltvRec.new_subs_total || 0) : 0);
    }, 0);
    const profitPerSubCalc = paidNewSubsAllTime > 0 ? totalProfitCalc / paidNewSubsAllTime : null;

    return {
      totalRevenue, totalLtv: totalRevenue, noSpend, untagged, totalCount,
      profitPerSub: profitPerSubCalc, trackedCount,
      avgCpl, isEstimate: false,
      totalSpend, totalProfit: totalProfitCalc,
      hasSnapshotData,
    };
  }, [filtered, allLinks, isAllTime, snapshotLookup, groupFilter, accountFilter, accounts, ltvLookup]);

  // ─── Last synced ───
  const lastSynced = useMemo(() => {
    const synced = accounts.filter((a: any) => a.last_synced_at).map((a: any) => new Date(a.last_synced_at).getTime());
    if (synced.length === 0) return null;
    return new Date(Math.max(...synced));
  }, [accounts]);

  // ─── Sort Header Component ───
  const SortHeader = ({ label, sortKeyName, width, sub, primary }: { label: string; sortKeyName: SortKey; width?: string; sub?: string; primary?: boolean }) => (
    <th
      className={`h-[44px] text-left uppercase cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap bg-card text-muted-foreground`}
      style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", padding: "8px 12px", ...(width ? { width, minWidth: width, maxWidth: width } : {}) }}
      onClick={() => handleSort(sortKeyName)}
    >
      <span className="flex flex-col">
        <span className="flex items-center gap-0.5">
          {primary && <Star className="h-2.5 w-2.5 text-primary mr-0.5" />}
          {label}
          {sortKey === sortKeyName ? (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
        </span>
        {sub && <span className="text-[9px] font-normal text-muted-foreground normal-case tracking-normal">{sub}</span>}
      </span>
    </th>
  );

  const handleRowClick = (link: any) => {
    // Open bottom drawer with enriched link data
    const linkId = normalizeTrackingLinkId(link.id);
    const ltvRec = ltvLookup[linkId];
    const account = accounts.find((a: any) => a.id === link.account_id);
    setDrawerCampaign({
      ...link,
      totalLtv: ltvRec ? Number(ltvRec.total_ltv || 0) : 0,
      crossPoll: ltvRec ? Number(ltvRec.cross_poll_revenue || 0) : 0,
      newSubs: ltvRec ? Number(ltvRec.new_subs_total || 0) : 0,
      ltvPerSub: ltvRec && Number(ltvRec.new_subs_total || 0) > 0 ? Number(ltvRec.total_ltv || 0) / Number(ltvRec.new_subs_total) : 0,
      cost: Number(link.cost_total || 0),
      modelName: account?.display_name || link.accounts?.display_name || "",
      avatarUrl: account?.avatar_thumb_url || link.accounts?.avatar_thumb_url || null,
      allTimeSubs: Number(link.subscribers || 0),
      allTimeSpenders: Number(link.spenders || 0),
      periodSubs: Number(link.subscribers || 0),
      periodRev: Number(link.revenue || 0),
      periodClicks: Number(link.clicks || 0),
    });
  };

  const onSpendSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    toast.success("Spend saved — ROI and Profit updated");
  };

  // KPI summary text for collapsed state
  const totalExpenses = kpis.totalSpend;
  const totalProfitAll = kpis.totalProfit;
  const hasAnyExpenses = totalExpenses > 0;
  const kpiSummary = (
    <>
      {fmtK(totalExpenses)} Expenses · {hasAnyExpenses ? (
        <span className={totalProfitAll >= 0 ? "text-primary" : "text-destructive"}>{fmtK(totalProfitAll)} Profit</span>
      ) : "—"} · {kpis.profitPerSub !== null ? fmtC(kpis.profitPerSub) : "—"} Profit/Sub · {kpis.untagged} untagged · {kpis.trackedCount} with spend
    </>
  );

  const modelCount = new Set(accounts.map((a: any) => a.id)).size;

  return (
    <DashboardLayout>
      <div className="space-y-3">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground">Tracking Links</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {allLinks.length.toLocaleString()} tracking links · {modelCount} models
              {(() => {
                const lastSync = allLinks.length > 0
                  ? new Date(Math.max(...allLinks.map((l: any) => new Date(l.updated_at).getTime())))
                  : null;
                if (!lastSync) return null;
                const diffHours = Math.floor((Date.now() - lastSync.getTime()) / 3600000);
                const diffDays = Math.floor(diffHours / 24);
                const rel = diffHours < 1 ? "just now"
                  : diffHours < 24 ? `${diffHours}h ago`
                  : `${diffDays}d ago`;
                return ` · Last sync: ${rel}`;
              })()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCampaignsCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <RefreshButton queryKeys={["tracking_links", "campaigns_tracking_link_ltv", "ad_spend", "accounts"]} />
            <button
              onClick={() => syncMutation.mutate(undefined)}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : syncLabel}
            </button>
          </div>
        </div>

        {/* ═══ TIME + MODEL FILTER BAR ═══ */}
        <div className="flex flex-wrap items-center gap-3">
          <AccountFilterDropdown
            value={accountFilter}
            onChange={(v) => { setAccountFilter(v); setPage(1); }}
            accounts={filteredAccountOptions}
          />
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
            {TIME_PERIODS.map((tp) => (
              <button
                key={tp.key}
                onClick={() => {
                  setTimePeriod(tp.key);
                  setCustomRange(null);
                }}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  timePeriod === tp.key && !customRange
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tp.label}
              </button>
            ))}
          </div>
          <DateRangePicker
            value={customRange}
            onChange={(range) => setCustomRange(range)}
          />
          <Tooltip>
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
          </Tooltip>
        </div>

        <div
          className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
          onClick={() => setKpiCollapsed(!kpiCollapsed)}
        >
          <div className="flex items-center justify-between" style={{ padding: "8px 14px" }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[12px] font-bold text-foreground shrink-0">Overview</span>
              {kpiCollapsed && (
                <span className="text-[11px] text-muted-foreground truncate">{kpiSummary}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="text-[11px] font-medium flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); setKpiCollapsed(!kpiCollapsed); }}>
                {kpiCollapsed ? (
                  <span className="text-primary">Show metrics <ChevronDown className="inline h-3 w-3" /></span>
                ) : (
                  <span className="text-muted-foreground">Hide metrics <ChevronUp className="inline h-3 w-3" /></span>
                )}
              </button>
            </div>
          </div>

          {!kpiCollapsed && (() => {
            const periodLabel = customRange ? "Custom range" : timePeriod === "day" ? "Last 24 hours" : timePeriod === "week" ? "Last 7 days" : timePeriod === "month" ? "Last 30 days" : timePeriod === "prev_month" ? "Previous month" : "All time across all links";
            const spendLabel = isAllTime ? "All paid campaigns" : `${periodLabel} est.`;
            const showDash = !isAllTime && !kpis.hasSnapshotData;
            return (
            <div className="px-3.5 pb-3" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr", gap: "10px", alignItems: "stretch" }}>
                {/* Card 1 — Total Revenue (hero) */}
                <div className="rounded-xl p-4 flex flex-col justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))" }}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-medium text-white/70 uppercase tracking-wider">Total Revenue</p>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${revenueMode === "net" ? "bg-white/20 text-white" : "bg-white/10 text-white/60"}`}>{revenueMode === "net" ? "NET" : "GROSS"}</span>
                  </div>
                  <p className="text-[22px] font-bold text-white font-mono mt-1">{showDash ? "—" : fmtC(kpis.totalRevenue * revMultiplier)}</p>
                  <p className="text-[10px] text-white/60 mt-0.5">{periodLabel}</p>
                </div>
                {/* Card 2 — Total Spend (always all-time) */}
                <KPICard borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-primary" />}
                  label="Total Spend" value={<span className="text-foreground">{kpis.totalSpend > 0 ? fmtC(kpis.totalSpend) : "—"}</span>} sub="All paid campaigns · All time"
                  tooltip={{ title: "Total Spend", desc: "Sum of cost_total across all campaigns with spend set. Always shows all-time value." }} />
                {/* Card 3 — Total Profit */}
                <KPICard borderColor="hsl(var(--primary))" icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  label="Total Profit" value={showDash ? <span className="text-muted-foreground">—</span> : kpis.totalSpend > 0
                    ? <span className={(kpis.totalRevenue * revMultiplier - kpis.totalSpend) >= 0 ? "text-primary" : "text-destructive"}>{fmtC(kpis.totalRevenue * revMultiplier - kpis.totalSpend)}</span>
                    : <span className="text-muted-foreground">—</span>} sub={isAllTime ? "Revenue minus spend" : `${periodLabel} revenue - all-time spend`}
                  tooltip={{ title: "Total Profit", desc: "Total Revenue (after fee if Net) minus Total Spend." }} />
                {/* Card 4 — Avg CPL (always all-time, CPL only) */}
                <KPICard borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-primary" />}
                  label="AVG CPL" value={kpis.avgCpl !== null ? <span className="text-primary">{fmtC(kpis.avgCpl)}</span> : <span className="text-muted-foreground">—</span>} sub="Cost per lead · CPL only"
                  tooltip={{ title: "Avg CPL", desc: "Average cost per lead across CPL-type campaigns only. Always shows all-time value." }} />
                {/* Card 5 — Untagged (always all-time) */}
                <div className="cursor-pointer" onClick={() => { setSourceFilter(sourceFilter === "untagged" ? "all" : "untagged"); setPage(1); }}>
                  <KPICard borderColor={kpis.untagged > 0 ? "hsl(var(--warning))" : "hsl(var(--primary))"} icon={<Tag className={`h-4 w-4 ${kpis.untagged > 0 ? "text-[hsl(var(--warning))]" : "text-primary"}`} />}
                    label="Untagged" value={<span className={kpis.untagged > 0 ? "text-[hsl(var(--warning))]" : "text-primary"}>{kpis.untagged.toLocaleString()}</span>} sub="No source tag · All time"
                    tooltip={{ title: "Untagged", desc: "Links without a source tag that have activity (clicks, subs, or revenue). Click to filter." }} />
                </div>
              </div>
            </div>
            );
          })()}
        </div>

        {/* ═══ FILTER BAR ═══ */}
        <div className="flex flex-wrap items-center" style={{ gap: "8px" }}>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-colors" />
          </div>
          
          <select value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value as CampaignFilter); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">All Campaigns</option>
            <option value="active">Active Only</option>
            <option value="zero">Zero Clicks</option>
            <option value="no_spend">No Spend Set</option>
            <option value="SCALE">SCALE</option>
            <option value="WATCH">WATCH</option>
            <option value="KILL">KILL</option>
            <option value="TESTING">TESTING</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
          <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">All Sources</option>
            {sourceOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
            <option value="untagged">Untagged</option>
          </select>
          {activeFilterCount > 0 && (
            <button onClick={clearAllFilters} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              <span className="px-1.5 py-0.5 rounded-full bg-muted text-[10px] font-bold">{activeFilterCount}</span> filters · <X className="h-3 w-3" /> clear
            </button>
          )}
        </div>


        {/* Activity filter — All / Active / Inactive (snapshot-derived) */}
        <LinkActivityFilter
          value={activityFilter}
          onChange={(v) => { setActivityFilter(v); setPage(1); }}
          totalCount={activityCounts.total}
          activeCount={activityCounts.active}
        />

        {/* ═══ CAMPAIGN TABLE ═══ */}
        <div className="flex gap-0">
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="bg-card border border-border rounded-2xl p-8"><div className="space-y-3">{[...Array(8)].map((_, i) => (<div key={i} className="skeleton-shimmer h-10 rounded" />))}</div></div>
            ) : sorted.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-16 text-center">
                <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium mb-1">No tracking links found</p>
                <p className="text-sm text-muted-foreground">{searchQuery || campaignFilter !== "all" || accountFilter !== "all" || sourceFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <BulkActionToolbar
                  selectedIds={selectedRows}
                  onClear={() => setSelectedRows(new Set())}
                  totalFiltered={sorted.length}
                  onSelectAll={() => setSelectedRows(new Set(sorted.map((l: any) => l.id)))}
                  actions={["assign_source", "delete"]}
                  onComplete={() => {
                    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                  }}
                />
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">Showing {showStart}–{showEnd} of {sorted.length} tracking links</span>
                  <div className="relative">
                    <button onClick={() => setColDropdownOpen(!colDropdownOpen)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-secondary text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3h7a2 2 0 012 2v14a2 2 0 01-2 2h-7m0-18H5a2 2 0 00-2 2v14a2 2 0 002 2h7m0-18v18" /></svg>
                      Columns
                    </button>
                    {colDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setColDropdownOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-card border border-border rounded-lg shadow-lg max-h-[400px] overflow-y-auto">
                          <DraggableColumnSelector
                            columns={columnOrder.orderedColumns}
                            isVisible={columnOrder.isVisible}
                            onToggle={columnOrder.toggleColumn}
                            onReorder={columnOrder.reorder}
                            onReset={columnOrder.reset}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b border-border">
                        <th className="w-8 bg-card text-muted-foreground" style={{ height: "44px", padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}><input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-border cursor-pointer" /></th>
                        <SortHeader label="Tracking Link" sortKeyName="campaign_name" width="200px" />
                        {columnOrder.visibleOrderedColumns.map(c => {
                          const thStyle = { height: "44px", padding: "8px 12px", fontSize: "11px", fontWeight: 600 as const, textTransform: "uppercase" as const, letterSpacing: "0.04em" };
                          switch (c.id) {
                            case "model": return <SortHeader key={c.id} label="Model" sortKeyName="model" width="100px" />;
                            case "source": return <SortHeader key={c.id} label="Source" sortKeyName="source_tag" width="100px" />;
                            case "clicks": return <SortHeader key={c.id} label="Clicks" sortKeyName="clicks" width="70px" />;
                            case "subscribers": return <SortHeader key={c.id} label="Subs" sortKeyName="subscribers" width="70px" />;
                            case "cvr": return <SortHeader key={c.id} label="CVR" sortKeyName="cvr" width="65px" />;
                            case "revenue": return <SortHeader key={c.id} label="Revenue" sortKeyName="revenue" width="90px" />;
                            case "cross_poll": return (
                              <SortHeader key={c.id} label="Cross-Poll" sortKeyName="cross_poll" width="85px" />
                            );
                            case "ltv_sub_all": return (
                              <SortHeader key={c.id} label="LTV/Sub" sortKeyName="ltv_sub_all" width="75px" />
                            );
                            case "spender_rate": return <SortHeader key={c.id} label="Spender %" sortKeyName="spender_rate" width="75px" />;
                            case "marketer": return <SortHeader key={c.id} label="Marketer" sortKeyName="marketer" width="100px" />;
                            case "expenses": return <SortHeader key={c.id} label="Spend" sortKeyName="cost_total" width="90px" />;
                            case "cpl": return <SortHeader key={c.id} label="CPL" sortKeyName="cpl" width="90px" />;
                            case "cpc": return <SortHeader key={c.id} label="CPC" sortKeyName="cpc" width="80px" />;
                            case "profit": return <SortHeader key={c.id} label="Profit" sortKeyName="profit" width="80px" />;
                            case "profit_sub": return <SortHeader key={c.id} label="Profit/Sub" sortKeyName="profit_per_sub" width="85px" primary />;
                            case "roi": return <SortHeader key={c.id} label="ROI" sortKeyName="roi" width="70px" />;
                            case "status": return <SortHeader key={c.id} label="Status" sortKeyName="status" width="80px" />;
                            case "subs_day": return <SortHeader key={c.id} label="Subs/Day" sortKeyName="subs_day" width="80px" />;
                            case "created": return <SortHeader key={c.id} label="Created" sortKeyName="created_at" width="100px" />;
                            case "last_synced": return <SortHeader key={c.id} label="Last Synced" sortKeyName="last_synced" width="90px" />;
                            case "media_buyer": return <SortHeader key={c.id} label="Buyer" sortKeyName="media_buyer" width="90px" />;
                            case "avg_expenses": return <SortHeader key={c.id} label="Avg Expenses" sortKeyName="avg_expenses" width="90px" />;
                            default: return null;
                          }
                        })}
                        <th className="text-center whitespace-nowrap bg-card text-muted-foreground" style={{ height: "44px", padding: "8px 12px", width: "28px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }} title="Fan sync status">👥</th>
                        <th className="text-center whitespace-nowrap bg-card" style={{ height: "44px", padding: "8px 4px", width: "28px" }}></th>
                        <th className="text-center whitespace-nowrap bg-card text-muted-foreground" style={{ height: "44px", padding: "8px 12px", width: "28px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((link: any) => {
                        const username = link.accounts?.username || link.accounts?.display_name || "—";
                        const modelColor = getModelColor(link.accounts?.username);
                        const initials = username !== "—" ? username.replace("@", "").slice(0, 1).toUpperCase() : "?";
                        const costTotal = Number(link.cost_total || 0);
                        const hasCost = costTotal > 0;
                        const profit = link.computedProfit ?? 0;
                        const ltvBased = link.ltvBased;
                        const roi = link.computedRoi ?? 0;
                        const status = link.computedStatus;
                        const displayStatus = STATUS_LABELS[status] || status;
                        const statusStyle = STATUS_STYLES[status] || STATUS_STYLES["NO_DATA"];
                        const isInactive = status === "INACTIVE";
                        const isExpanded = expandedRow === link.id;

                        return (
                          <React.Fragment key={link.id}>
                          <tr
                            onClick={() => handleRowClick(link)}
                            className={`border-b border-border/50 cursor-pointer transition-colors group ${isExpanded ? "" : "hover:bg-secondary/30"} ${
                              activityFilter === "active"
                                ? "border-l-2 border-l-primary/70"
                                : activityFilter === "inactive"
                                ? "border-l-2 border-l-muted-foreground/40"
                                : ""
                            }`}
                            style={{ height: "46px", opacity: isInactive ? 0.6 : 1 }}
                          >
                            <td style={{ padding: "8px 12px", maxWidth: "40px" }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                            </td>
                            <td style={{ padding: "8px 12px", maxWidth: "200px" }}>
                              <p className="font-bold text-foreground truncate" style={{ fontSize: "13px" }} title={link.campaign_name}>{link.campaign_name || "—"}</p>
                              <p className="truncate text-muted-foreground" style={{ fontSize: "11px" }} title={link.url}>{link.url}</p>
                            </td>
                            {columnOrder.visibleOrderedColumns.map(c => {
                              switch (c.id) {
                                case "model": return (
                                  <td key={c.id} style={{ padding: "8px 12px" }}>
                                    <div className="flex items-center gap-1.5">
                                      <ModelAvatar avatarUrl={link.accounts?.avatar_thumb_url} name={username} size={24} />
                                      <span className="truncate text-muted-foreground" style={{ fontSize: "12px" }}>@{username}</span>
                                    </div>
                                  </td>
                                );
                                case "source": return (
                                  <td key={c.id} style={{ padding: "8px 12px" }}>
                                    <div className="flex items-center gap-1.5">
                                      <TagBadge tagName={getEffectiveSource(link)} size="sm" />
                                      {getTrafficCategoryLabel(link.traffic_category) && (
                                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none whitespace-nowrap ${
                                          getTrafficCategoryLabel(link.traffic_category) === "OnlyTraffic"
                                            ? "bg-primary/10 text-primary"
                                            : "bg-muted text-muted-foreground"
                                        }`}>
                                          {getTrafficCategoryLabel(link.traffic_category)}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                                case "clicks": return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {(link.clicks || 0).toLocaleString()}
                                  </td>
                                );
                                case "subscribers": return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {(link.subscribers || 0).toLocaleString()}
                                  </td>
                                );
                                case "cvr": return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {link.clicks > 100 ? <span className="text-primary">{((link.subscribers / link.clicks) * 100).toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                );
                                case "revenue": {
                                  const revVal = Number(link.revenue || 0) * revMultiplier;
                                  return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    <span className="text-foreground">{fmtC(revVal)}</span>
                                  </td>
                                  );
                                }
                                case "cross_poll": {
                                  const cp = link.crossPollRevenue;
                                  const hasRecord = link.hasLtvRecord;
                                  return (
                                    <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                      {hasRecord ? (
                                        cp && cp > 0 ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="text-[#7c3aed] font-semibold">{fmtC(cp)}</span>
                                            </TooltipTrigger>
                                            <TooltipContent>Revenue from fans who crossed to other models</TooltipContent>
                                          </Tooltip>
                                        ) : <span className="text-muted-foreground">$0.00</span>
                                      ) : <span className="text-muted-foreground">—</span>}
                                    </td>
                                  );
                                }
                                case "ltv_sub": {
                                  // Removed — LTV/New Sub no longer shown
                                  return null;
                                }
                                case "ltv_sub_all": {
                                  // LTV/Sub: revenue / subscribers for selected period
                                  let ltvSubAllVal: number | null = null;
                                  if (isAllTime) {
                                    const totalRev = Number(link.revenue || 0) * revMultiplier;
                                    const totalSubs = Number(link.subscribers || 0);
                                    ltvSubAllVal = totalSubs > 0 ? totalRev / totalSubs : null;
                                  } else {
                                    const pRev = Number(link.revenue || 0) * revMultiplier;
                                    const pSubs = Number(link.subscribers || 0);
                                    ltvSubAllVal = pSubs > 0 ? pRev / pSubs : null;
                                  }
                                  const showAllDash = ltvSubAllVal === null || ltvSubAllVal === 0;
                                  return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-foreground">
                                          {showAllDash ? "—" : fmtC(ltvSubAllVal!)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>Total revenue divided by all subscribers for the selected period</TooltipContent>
                                    </Tooltip>
                                  </td>
                                  );
                                }
                                case "spender_rate": {
                                  const spenderPctVal = link.ltvRecord ? Number(link.ltvRecord.spender_pct || 0) : null;
                                  return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {spenderPctVal !== null && spenderPctVal > 0 ? (
                                      <span className={spenderPctVal > 10 ? "text-primary" : spenderPctVal >= 5 ? "text-[hsl(38_92%_50%)]" : "text-destructive"}>
                                        {spenderPctVal.toFixed(1)}%
                                      </span>
                                    ) : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  );
                                }
                                case "expenses": {
                                  const pt = link.payment_type || link.cost_type || null;
                                  const ptLabel = pt ? pt.toUpperCase() : null;
                                  return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    <div className="flex items-center justify-end gap-1.5">
                                      {ptLabel && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold leading-none bg-muted text-muted-foreground">
                                          {ptLabel}
                                        </span>
                                      )}
                                      {hasCost ? (
                                        <span className="text-foreground">{fmtC(costTotal)}</span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[hsl(38_92%_50%/0.15)] text-[hsl(38_92%_50%)]">
                                          No Spend
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  );
                                }
                                case "cpl": {
                                  const types = costTypeMap[link.id];
                                  const label = deriveCostLabel(types || new Set());
                                  const subs = link.subscribers || 0;
                                  const clicks = link.clicks || 0;
                                  const metric = calcCostMetric(label, costTotal, subs, clicks);
                                  return (
                                    <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                      {label && metric.value !== null ? (
                                        <div className="flex items-center justify-end gap-1.5">
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold leading-none bg-muted text-muted-foreground">
                                            {metric.label}
                                          </span>
                                          <span className="text-foreground">{metric.display}</span>
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                  );
                                }
                                case "profit": return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {hasCost ? (
                                      <span className="inline-flex items-center gap-1">
                                        <span className={profit >= 0 ? "text-primary" : "text-destructive"}>{profit >= 0 ? "+" : ""}{fmtC(profit)}</span>
                                        {link.profitIsEstimate && <EstBadge />}
                                      </span>
                                    ) : <span className="text-muted-foreground">—</span>}
                                  </td>
                                );
                                case "profit_sub": return (
                                  <td key={c.id} className="text-right" style={{ padding: "8px 12px" }}>
                                    {link.profitPerSub !== null ? (
                                      <span className={`font-mono font-bold ${link.profitPerSub >= 0 ? "text-primary" : "text-destructive"}`} style={{ fontSize: "12px" }}>
                                        {link.profitPerSub >= 0 ? "" : "-"}${Math.abs(link.profitPerSub).toFixed(2)}
                                      </span>
                                    ) : <span className="text-muted-foreground font-bold" style={{ fontSize: "12px" }}>—</span>}
                                  </td>
                                );
                                case "roi": return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {hasCost ? (
                                      <span className="inline-flex items-center gap-1">
                                        <span className={roi >= 0 ? "text-primary" : "text-destructive"}>{roi.toFixed(1)}%</span>
                                        {link.roiIsEstimate && <EstBadge />}
                                      </span>
                                    ) : <span className="text-muted-foreground">—</span>}
                                  </td>
                                );
                                case "status": return (
                                  <td key={c.id} style={{ padding: "8px 12px" }}>
                                    <div className="flex items-center gap-1.5">
                                      {!hasCost && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                                          </TooltipTrigger>
                                          <TooltipContent>No spend set</TooltipContent>
                                        </Tooltip>
                                      )}
                                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap min-w-[70px] text-center"
                                        style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>{displayStatus}</span>
                                    </div>
                                  </td>
                                );
                                case "subs_day": {
                                  let subsPerDay: number | null = null;
                                  let subsDayLbl: string | null = null;
                                  if (activityFilter !== "all") {
                                    // Activity filter engaged → always show 5-day snapshot-derived value
                                    const ai = getActiveInfo(link.id, activeLookup);
                                    subsPerDay = ai.subsPerDay > 0 ? ai.subsPerDay : null;
                                    if (subsPerDay === null) subsDayLbl = "—";
                                  } else if (!isDeltaAllTime) {
                                    // Date filter active → delta from cumulative snapshots in window
                                    const d = getDelta(link.id, deltaLookup);
                                    subsPerDay = d?.subsPerDay ?? null;
                                    if (subsPerDay === null) subsDayLbl = "—";
                                  } else {
                                    // All Time: subscribers / days since created
                                    const totalSubs = Number(link.subscribers || 0);
                                    const daysSince = Math.max(1, link.daysSinceCreated || 1);
                                    if (totalSubs > 0 && daysSince > 0) {
                                      subsPerDay = totalSubs / daysSince;
                                    } else if (totalSubs === 0) {
                                      subsDayLbl = "—";
                                    }
                                  }
                                  return (
                                  <td key={c.id} className="font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {subsPerDay !== null && subsPerDay > 0
                                      ? <span className="text-primary font-bold">{subsPerDay.toFixed(1)}/day</span>
                                      : subsDayLbl
                                        ? <span className="text-muted-foreground text-[10px]">{subsDayLbl}</span>
                                        : <span className="text-muted-foreground">0/day</span>}
                                  </td>
                                  );
                                }
                                case "created": {
                                  const days = link.daysSinceCreated;
                                  const createdDate = format(new Date(link.created_at), "MMM d, yyyy");
                                  const pill = days <= 30 ? { label: `${days}d New`, cls: "bg-success/15 text-success" }
                                    : days <= 90 ? { label: `${days}d Active`, cls: "bg-primary/15 text-primary" }
                                    : days <= 180 ? { label: `${days}d Mature`, cls: "bg-warning/15 text-warning" }
                                    : { label: `${days}d Old`, cls: "bg-muted text-muted-foreground" };
                                  return (
                                    <td key={c.id} style={{ padding: "8px 12px" }}>
                                      <p className="text-foreground" style={{ fontSize: "12px" }}>{createdDate}</p>
                                      <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold mt-0.5 ${pill.cls}`}>{pill.label}</span>
                                    </td>
                                  );
                                }
                                case "last_synced": return (
                                  <td key={c.id} style={{ padding: "8px 12px" }}>
                                    {(() => {
                                      const updated = new Date(link.updated_at);
                                      const now = new Date();
                                      const diffHours = Math.floor((now.getTime() - updated.getTime()) / 3600000);
                                      const diffDays = Math.floor(diffHours / 24);
                                      const label = diffHours < 1 ? "Just now"
                                        : diffHours < 24 ? `${diffHours}h ago`
                                        : `${diffDays}d ago`;
                                      const color = diffHours < 24 ? "#10b981"
                                        : diffHours < 72 ? "#f59e0b"
                                        : "#ef4444";
                                      const exact = updated.toLocaleString("en-US", {
                                        month: "short", day: "numeric",
                                        year: "numeric", hour: "2-digit", minute: "2-digit"
                                      });
                                      return (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span style={{ color, fontSize: "11px", fontWeight: 600 }}>
                                              {label}
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>{exact}</TooltipContent>
                                        </Tooltip>
                                      );
                                    })()}
                                  </td>
                                );
                                case "marketer": return (
                                  <td key={c.id} style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {link.onlytraffic_marketer ? <span className="text-foreground/80">{link.onlytraffic_marketer}</span> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                );
                                case "cpc": {
                                  const clk = Number(link.clicks || 0);
                                  const cpcVal = hasCost && clk > 0 ? costTotal / clk : null;
                                  return (
                                    <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                      {cpcVal !== null ? <span className="text-foreground">${cpcVal.toFixed(4)}</span> : <span className="text-muted-foreground">—</span>}
                                    </td>
                                  );
                                }
                                case "media_buyer": return (
                                  <td key={c.id} style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {link.media_buyer ? <span className="text-foreground">{link.media_buyer}</span> : <span className="text-muted-foreground italic">—</span>}
                                  </td>
                                );
                                case "avg_expenses": return (
                                  <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                    {hasCost ? <span className="text-muted-foreground">{fmtC(costTotal)}</span> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                );
                                case "org_pct": {
                                  const newSubsT = link.ltvRecord ? Number(link.ltvRecord.new_subs_total || 0) : 0;
                                  const subsT = Number(link.subscribers || 0);
                                  const hasData = link.hasLtvRecord && subsT > 0;
                                  const orgPct = hasData ? (newSubsT / subsT) * 100 : null;
                                  const color = orgPct === null ? "text-muted-foreground"
                                    : orgPct > 20 ? "text-primary"
                                    : orgPct >= 10 ? "text-[hsl(38_92%_50%)]"
                                    : "text-destructive";
                                  return (
                                    <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                      <span className={color}>{orgPct !== null ? `${orgPct.toFixed(1)}%` : "—"}</span>
                                    </td>
                                  );
                                }
                                default: return null;
                              }
                            })}
                            <td className="w-7 text-center" style={{ padding: "8px 4px" }} title={link.fans_last_synced_at ? `Fan data synced: ${format(new Date(link.fans_last_synced_at), "MMM d, yyyy")}` : "Fan data not yet synced"}>
                              {(() => {
                                const synced = link.fans_last_synced_at;
                                if (!synced) return <Users className="h-3.5 w-3.5 text-muted-foreground mx-auto" />;
                                const daysSince = Math.floor((Date.now() - new Date(synced).getTime()) / 86400000);
                                if (daysSince <= 7) return <Users className="h-3.5 w-3.5 text-primary mx-auto" />;
                                if (daysSince <= 30) return <Users className="h-3.5 w-3.5 text-[hsl(var(--warning))] mx-auto" />;
                                return <Users className="h-3.5 w-3.5 text-muted-foreground mx-auto" />;
                              })()}
                            </td>
                            <td className="w-7 text-center" style={{ padding: "8px 4px" }} onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => setDrawerCampaign(link)}
                                className="p-1 rounded hover:bg-secondary transition-colors opacity-0 group-hover:opacity-100">
                                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </td>
                            <td className="w-7 text-center" style={{ padding: "8px 12px" }}>
                              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            </td>
                          </tr>
                          {/* Inline detail row */}
                          {isExpanded && (() => {
                            const el = link;
                            const subsEl = el.subscribers || 0;
                            const clicksEl = el.clicks || 0;
                            const revEl = el.ltvFromTable != null && el.ltvFromTable > 0 ? el.ltvFromTable : Number(el.revenue || 0);
                            const hasCostEl = Number(el.cost_total || 0) > 0;
                            const numVal = parseFloat(spendValue);
                            const validVal = !isNaN(numVal) && numVal > 0;
                            let previewCost = 0, previewProfit = 0, previewProfitSub = 0, previewRoi = 0;
                            if (validVal) {
                              if (spendType === "CPL") previewCost = subsEl * numVal;
                              else if (spendType === "CPC") previewCost = clicksEl * numVal;
                              else previewCost = numVal;
                              previewProfit = revEl - previewCost;
                              previewProfitSub = subsEl > 0 ? previewProfit / subsEl : 0;
                              previewRoi = previewCost > 0 ? (previewProfit / previewCost) * 100 : 0;
                            }
                            const saveSpendInline = async () => {
                              if (!validVal) return;
                              try {
                                const cvr = clicksEl > 0 ? subsEl / clicksEl : 0;
                                const cpcReal = spendType === "CPC" ? numVal : (cvr > 0 ? (spendType === "CPL" ? numVal * cvr : (clicksEl > 0 ? previewCost / clicksEl : 0)) : 0);
                                const cplReal = spendType === "CPL" ? numVal : (subsEl > 0 ? previewCost / subsEl : 0);
                                const arpu = subsEl > 0 ? revEl / subsEl : 0;
                                const newStatus = calcStatusFromRoi(previewRoi);
                                const { error: linkErr } = await supabase.from("tracking_links").update({
                                  cost_type: spendType, cost_value: numVal, cost_total: previewCost,
                                  cvr, cpc_real: cpcReal, cpl_real: cplReal, arpu,
                                  profit: previewProfit, roi: previewRoi, status: newStatus,
                                } as any).eq("id", el.id);
                                if (linkErr) throw linkErr;
                                const { data: existing } = await supabase.from("ad_spend").select("id").eq("tracking_link_id", el.id).maybeSingle();
                                if (existing) {
                                  await supabase.from("ad_spend").update({
                                    spend_type: spendType, amount: previewCost,
                                    date: new Date().toISOString().split("T")[0],
                                  } as any).eq("id", existing.id);
                                } else {
                                  await supabase.from("ad_spend").insert({
                                    campaign_id: el.campaign_id, tracking_link_id: el.id,
                                    traffic_source: el.source || "direct", spend_type: spendType,
                                    amount: previewCost, date: new Date().toISOString().split("T")[0],
                                    notes: `${spendType} @ $${numVal.toFixed(2)}`, account_id: el.account_id,
                                  });
                                }
                                queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                                queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
                                toast.success("Spend saved");
                              } catch (err: any) { toast.error("Save failed — please try again"); }
                            };
                            const clearSpendInline = async () => {
                              try {
                                await supabase.from("tracking_links").update({
                                  cost_type: null,
                                  cost_value: null,
                                  cost_total: 0,
                                  profit: null,
                                  roi: null,
                                  cpl_real: null,
                                  cpc_real: null,
                                  status: 'NO_SPEND',
                                }).eq("id", el.id);
                                queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                                toast.success("Spend cleared");
                              } catch (err: any) { toast.error("Save failed — please try again"); }
                            };
                            const saveNoteInline = async () => {
                              if (!noteText.trim()) return;
                              try {
                                const { data: existingNote } = await supabase.from("manual_notes")
                                  .select("id").eq("campaign_id", el.campaign_id).eq("account_id", el.account_id).maybeSingle();
                                if (existingNote) {
                                  const { error } = await supabase.from("manual_notes").update({
                                    note: noteText.trim(), content: noteText.trim(), updated_at: new Date().toISOString(),
                                  } as any).eq("id", existingNote.id);
                                  if (error) throw error;
                                } else {
                                  const { error } = await supabase.from("manual_notes").insert({
                                    campaign_id: el.campaign_id, campaign_name: el.campaign_name,
                                    account_id: el.account_id, content: noteText.trim(), note: noteText.trim(),
                                  });
                                  if (error) throw error;
                                }
                                toast.success("Note saved");
                              } catch (err: any) { toast.error("Save failed — please try again"); }
                            };
                            const handleSaveSource = async () => {
                              try {
                                await setTrackingLinkSourceTag(el.id, sourceInputValue.trim(), true);
                                queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                                toast.success("Source saved", { duration: 1000 });
                              } catch (err: any) { toast.error("Save failed"); }
                            };
                            const subsDayDisplay = el.subsDay !== null && el.subsDay > 0
                              ? { v: `${Math.round(el.subsDay)}/day`, c: "text-primary" }
                              : el.subsDayLabel
                                ? { v: el.subsDayLabel, c: "text-muted-foreground" }
                                : el.subsDay === 0
                                  ? { v: "0/day", c: "text-muted-foreground" }
                                  : { v: "—", c: "text-muted-foreground" };
                            const ltvVal = el.ltvFromTable;
                            const ltvSubVal = el.ltvRecord ? Number(el.ltvRecord.ltv_per_sub || 0) : 0;
                            const spenderRateVal = el.ltvRecord ? Number(el.ltvRecord.spender_pct || 0) : 0;
                            const needsFanSync = !el.fans_last_synced_at;
                            const currentSource = trafficSources.find((s: any) => s.id === el.traffic_source_id || s.name === el.source_tag);
                            return (
                              <tr>
                                <td colSpan={99} className="p-0">
                                  <div className="bg-secondary border-l-[3px] border-l-primary" style={{ padding: "14px 20px" }}>
                                    <div className="flex gap-5">
                                      {/* Performance */}
                                      <div style={{ width: "280px", flexShrink: 0 }}>
                                        <p className="text-muted-foreground" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px", fontWeight: 600 }}>Performance</p>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0px" }}>
                                          {[
                                            { l: "Clicks", v: clicksEl.toLocaleString(), c: "text-foreground" },
                                            { l: "Revenue", v: fmtC(Number(el.revenue || 0)), c: "text-foreground" },
                                            { l: "Subs", v: subsEl.toLocaleString(), c: "text-foreground" },
                                            { l: "LTV", v: ltvVal > 0 ? fmtC(ltvVal) : (el.fans_last_synced_at ? "$0.00" : "—"), c: ltvVal > 0 ? "text-primary" : "text-muted-foreground" },
                                            { l: "CVR", v: clicksEl > 100 ? `${((subsEl / clicksEl) * 100).toFixed(1)}%` : "—", c: clicksEl > 100 && (subsEl / clicksEl) > 0.15 ? "text-primary" : "text-muted-foreground" },
                                            { l: "LTV/New Sub", v: ltvSubVal > 0 ? fmtC(ltvSubVal) : "—", c: ltvSubVal > 0 ? "text-foreground" : "text-muted-foreground" },
                                            { l: "Subs/Day", v: subsDayDisplay.v, c: subsDayDisplay.c === "text-primary" ? "text-primary" : "text-muted-foreground" },
                                            { l: "Spender%", v: spenderRateVal > 0 ? `${spenderRateVal.toFixed(1)}%` : "—", c: spenderRateVal > 10 ? "text-success" : spenderRateVal >= 5 ? "text-warning" : spenderRateVal > 0 ? "text-destructive" : "text-muted-foreground" },
                                          ].map(r => (
                                            <div key={r.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "26px", padding: "0 8px" }}>
                                              <span className="text-foreground font-bold" style={{ fontSize: "13px" }}>{r.l}</span>
                                              <span className={`font-mono ${r.c}`} style={{ fontSize: "12px", fontWeight: 500 }}>{r.v}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="flex-1 grid grid-cols-3 gap-5">
                                      {/* Spend */}
                                      <div>
                                        <div className="flex items-center gap-1.5 mb-2">
                                        <p className="text-muted-foreground" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Spend</p>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Info className="h-3 w-3 cursor-help text-muted-foreground" />
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                                              <p><strong>CPL</strong> = I pay per subscriber gained</p>
                                              <p><strong>CPC</strong> = I pay per click ⚠️</p>
                                              <p><strong>FIXED</strong> = Fixed amount (pin, promo, deal)</p>
                                            </TooltipContent>
                                          </Tooltip>
                                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: hasCostEl ? "hsl(var(--primary))" : "hsl(var(--warning))" }} />
                                          <span className="text-muted-foreground" style={{ fontSize: "10px" }}>{hasCostEl ? "Set" : "Not set"}</span>
                                        </div>
                                        <div className="flex gap-1 mb-2">
                                          {(["CPL", "CPC", "FIXED"] as const).map(t => (
                                            <button key={t} onClick={(e) => { e.stopPropagation(); setSpendType(t); }}
                                              className={`px-2 py-1 text-[10px] font-bold transition-colors rounded ${spendType === t ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{t}</button>
                                          ))}
                                        </div>
                                        {spendType === "CPC" && (
                                          <div className="flex items-start gap-1.5 mb-2 px-2 py-1.5 rounded-md border bg-warning/10 border-warning/30">
                                            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-warning" />
                                            <span className="text-warning" style={{ fontSize: "10px", lineHeight: "1.3" }}>Per Click may be unreliable — bot traffic can inflate click counts</span>
                                          </div>
                                        )}
                                        <input type="number" step="0.01" value={spendValue} onChange={(e) => setSpendValue(e.target.value)}
                                          placeholder="Cost value..." onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2.5 py-1.5 bg-background border border-border text-sm font-mono outline-none mb-2 rounded-md text-foreground"
                                          style={{ fontSize: "12px" }} />
                                        {validVal && (
                                          <div className="text-[11px] font-mono mb-2 space-y-0.5 bg-card text-muted-foreground rounded-md" style={{ padding: "6px 8px" }}>
                                            <div className="flex justify-between"><span>Cost/Sub</span><span className="text-foreground">{subsEl > 0 ? fmtC(previewCost / subsEl) : "—"}</span></div>
                                            <div className="flex justify-between"><span>Total Spend</span><span className="text-destructive font-semibold">{fmtC(previewCost)}</span></div>
                                            <div className="flex justify-between"><span>Profit</span><span className={`font-semibold ${previewProfit >= 0 ? "text-success" : "text-destructive"}`}>{fmtC(previewProfit)}</span></div>
                                            <div className="flex justify-between"><span>ROI</span><span className={`font-semibold ${previewRoi >= 0 ? "text-success" : "text-destructive"}`}>{previewRoi.toFixed(1)}%</span></div>
                                            <div className="flex justify-between"><span>Profit/Sub</span><span className={previewProfit >= 0 ? "text-success" : "text-destructive"}>{subsEl > 0 ? fmtC(previewProfit / subsEl) : "—"}</span></div>
                                          </div>
                                        )}
                                        <div className="flex gap-1.5">
                                          <button onClick={(e) => { e.stopPropagation(); saveSpendInline(); }} disabled={!validVal}
                                            className="flex-1 py-1.5 text-[11px] font-semibold disabled:opacity-50 rounded-md bg-primary text-primary-foreground">Save</button>
                                          <button onClick={(e) => { e.stopPropagation(); clearSpendInline(); }}
                                            className="px-2.5 py-1.5 text-[11px] font-medium border border-border text-muted-foreground rounded-md">Clear</button>
                                        </div>
                                      </div>
                                      {/* Source */}
                                      <div onClick={(e) => e.stopPropagation()}>
                                        <p className="text-muted-foreground" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px", fontWeight: 600 }}>Source</p>
                                        <SourceSelector
                                          currentSourceTag={el.source_tag}
                                          currentTrafficSourceId={el.traffic_source_id}
                                          trackingLinkId={el.id}
                                          onSaved={() => {
                                            queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                                          }}
                                        />
                                      </div>
                                      {/* Notes */}
                                      <div>
                                        <p className="text-muted-foreground" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px", fontWeight: 600 }}>Notes</p>
                                        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
                                          placeholder="Add a note..." onClick={(e) => e.stopPropagation()}
                                          className="w-full h-16 px-2.5 py-1.5 bg-background border border-border text-[11px] outline-none resize-none mb-1.5 rounded-md text-foreground" />
                                        <div className="flex gap-1.5">
                                          <button onClick={(e) => { e.stopPropagation(); saveNoteInline(); }}
                                            className="flex-1 py-1.5 text-[11px] font-semibold rounded-md bg-primary text-primary-foreground">Save note</button>
                                          <button onClick={(e) => { e.stopPropagation(); setNoteText(""); }}
                                            className="px-2.5 py-1.5 text-[11px] font-medium border border-border text-muted-foreground rounded-md">Clear</button>
                                        </div>
                                      </div>
                                     </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })()}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">Showing {showStart}–{showEnd} of {sorted.length}</span>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Rows:</span>
                      {[10, 25, 50, 100].map((n) => (
                        <button key={n} onClick={() => { setPerPage(n); setPage(1); }}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${perPage === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>{n}</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30"><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>
                      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 7) pageNum = i + 1;
                        else if (safePage <= 4) pageNum = i + 1;
                        else if (safePage >= totalPages - 3) pageNum = totalPages - 6 + i;
                        else pageNum = safePage - 3 + i;
                        return (
                          <button key={pageNum} onClick={() => setPage(pageNum)}
                            className={`w-8 h-8 rounded text-xs font-medium transition-colors ${pageNum === safePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>{pageNum}</button>
                        );
                      })}
                      <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30"><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <CsvCostImportModal open={csvOpen} onClose={() => setCsvOpen(false)} onComplete={() => { setCsvOpen(false); queryClient.invalidateQueries({ queryKey: ["tracking_links"] }); }} trackingLinks={links} />
        <CampaignDetailDrawer campaign={drawerCampaign} onClose={() => setDrawerCampaign(null)} onCampaignUpdated={setDrawerCampaign} />
      </div>
    </DashboardLayout>
  );
}

// ─── KPI Card Component ───
function KPICard({ borderColor, icon, label, value, sub, tooltip, progressBar, progressColor }: {
  borderColor: string; icon: React.ReactNode; label: string; value: React.ReactNode; sub: React.ReactNode;
  tooltip: { title: string; desc: string }; progressBar?: number; progressColor?: string;
}) {
  return (
    <div className="bg-card border border-border shadow-sm" style={{ borderLeftWidth: "3px", borderLeftColor: borderColor, padding: "16px 18px", borderRadius: "0 12px 12px 0" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">{icon}</div>
        <span className="uppercase tracking-wider leading-tight" style={{ fontSize: "11px", fontWeight: 500, color: "#64748b" }}>{label}</span>
        <InfoDot title={tooltip.title} desc={tooltip.desc} />
      </div>
      <p className="font-bold font-mono leading-tight" style={{ fontSize: "24px" }}>{value}</p>
      <p className="mt-1" style={{ fontSize: "12px", color: "#94a3b8" }}>{sub}</p>
      {progressBar !== undefined && (
        <div className="mt-2 h-1 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{
            width: `${Math.min(100, progressBar)}%`,
            backgroundColor: progressColor === "warning" ? "hsl(var(--warning))" : progressColor === "success" ? "hsl(var(--success))" : "hsl(var(--primary))",
          }} />
        </div>
      )}
    </div>
  );
}

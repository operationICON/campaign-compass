import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CsvCostImportModal } from "@/components/dashboard/CsvCostImportModal";
import { TagBadge, useTagColors } from "@/components/TagBadge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchTrackingLinks, fetchAdSpend, deleteAdSpend, triggerSync,
  clearTrackingLinkSpend, fetchAccounts, fetchDailyMetrics,
  setTrackingLinkSourceTag,
} from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RefreshCw, DollarSign, TrendingUp, Star, Trash2, Download, X, Tag,
  Users, Activity, Info, BarChart3, Target, ChevronRight as ChevronR,
  Upload, Plus, Award, AlertTriangle
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { KpiCardCustomizer, useKpiCardVisibility } from "@/components/dashboard/KpiCardCustomizer";

// ─── Types ───
type SortKey = "campaign_name" | "cost_total" | "revenue" | "ltv" | "profit" | "roi" | "profit_per_sub" | "created_at" | "subs_day" | "source_tag" | "clicks" | "subscribers" | "cvr" | "media_buyer";
type CampaignFilter = "all" | "active" | "zero" | "no_spend" | "SCALE" | "WATCH" | "KILL" | "DEAD";

const KPI_COLLAPSED_KEY = "campaigns_kpi_collapsed";
const COLUMNS_KEY = "campaigns_columns";

type ColumnId = "model" | "source" | "revenue" | "ltv" | "ltv_sub" | "spender_rate" | "expenses" | "profit" | "roi" | "status" | "subs_day" | "clicks" | "subscribers" | "cvr" | "created" | "media_buyer" | "avg_expenses";

const ALL_TOGGLEABLE_COLUMNS: { id: ColumnId; label: string; defaultOn: boolean }[] = [
  { id: "model", label: "Model", defaultOn: true },
  { id: "source", label: "Source", defaultOn: true },
  { id: "revenue", label: "Revenue", defaultOn: true },
  { id: "ltv", label: "LTV", defaultOn: true },
  { id: "ltv_sub", label: "LTV/Sub", defaultOn: true },
  { id: "spender_rate", label: "Spender %", defaultOn: false },
  { id: "expenses", label: "Expenses", defaultOn: true },
  { id: "profit", label: "Profit", defaultOn: true },
  { id: "roi", label: "ROI", defaultOn: true },
  { id: "status", label: "Status", defaultOn: true },
  { id: "subs_day", label: "Subs/Day", defaultOn: true },
  { id: "clicks", label: "Clicks", defaultOn: false },
  { id: "subscribers", label: "Subscribers", defaultOn: false },
  { id: "cvr", label: "CVR", defaultOn: false },
  { id: "created", label: "Created", defaultOn: false },
  { id: "media_buyer", label: "Media Buyer", defaultOn: false },
  { id: "avg_expenses", label: "Avg Expenses", defaultOn: false },
];

function getDefaultColumns(): Record<ColumnId, boolean> {
  const defaults: Record<string, boolean> = {};
  ALL_TOGGLEABLE_COLUMNS.forEach(c => { defaults[c.id] = c.defaultOn; });
  return defaults as Record<ColumnId, boolean>;
}

function loadColumns(): Record<ColumnId, boolean> {
  try {
    const saved = localStorage.getItem(COLUMNS_KEY);
    if (saved) return { ...getDefaultColumns(), ...JSON.parse(saved) };
  } catch {}
  return getDefaultColumns();
}

// ─── Constants ───
const MODEL_COLORS: Record<string, string> = {
  "jessie_ca_xo": "#0891b2", "zoey.skyy": "#7c3aed", "miakitty.ts": "#ec4899",
  "ella_cherryy": "#f59e0b", "aylin_bigts": "#ef4444",
};
function getModelColor(username: string | null): string {
  if (!username) return "#94a3b8";
  return MODEL_COLORS[username.replace("@", "").toLowerCase()] || "#94a3b8";
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  SCALE: { bg: "#dcfce7", text: "#16a34a" }, WATCH: { bg: "#dbeafe", text: "#0891b2" },
  LOW: { bg: "#fef9c3", text: "#854d0e" }, KILL: { bg: "#fee2e2", text: "#dc2626" },
  DEAD: { bg: "#f3f4f6", text: "#6b7280" }, "NO SPEND": { bg: "#f9fafb", text: "#94a3b8" },
  NO_DATA: { bg: "#f9fafb", text: "#94a3b8" },
};
const STATUS_LABELS: Record<string, string> = {
  SCALE: "SCALE", WATCH: "WATCH", LOW: "LOW", KILL: "KILL", DEAD: "DEAD",
  "NO SPEND": "NO SPEND", NO_DATA: "NO SPEND",
};

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
  const campaignKpi = useKpiCardVisibility("campaigns_kpi_cards");

  // ─── Column visibility state ───
  const [visibleCols, setVisibleCols] = useState<Record<ColumnId, boolean>>(loadColumns);
  const [colDropdownOpen, setColDropdownOpen] = useState(false);
  const toggleColumn = (id: ColumnId) => {
    setVisibleCols(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const col = (id: ColumnId) => visibleCols[id];

  // ─── KPI collapse state ───
  const [kpiCollapsed, setKpiCollapsed] = useState(() => {
    try { return localStorage.getItem(KPI_COLLAPSED_KEY) !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(KPI_COLLAPSED_KEY, String(kpiCollapsed)); } catch {} }, [kpiCollapsed]);

  // ─── Filter/sort state ───
  const [searchQuery, setSearchQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

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

  // ─── Data fetching ───
  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: adSpendData = [] } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  
  const tagColorMap = useTagColors();

  // ─── Realtime ───
  useEffect(() => {
    const channel = supabase
      .channel('campaigns-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracking_links' }, () => {
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const deleteSpendMutation = useMutation({
    mutationFn: deleteAdSpend,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend deleted"); },
  });

  const syncMutation = useMutation({
    mutationFn: (testLinkId?: string) => triggerSync(undefined, true, (msg) => toast.info(msg, { id: 'sync-progress' }), testLinkId),
    onSuccess: (data) => {
      toast.success(`Sync complete — ${data?.accounts_synced ?? 0} accounts synced`, { id: 'sync-progress' });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
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
      const hasCost = Number(l.cost_total || 0) > 0;
      const effectiveRev = Number(l.ltv || 0) > 0 ? Number(l.ltv) : Number(l.revenue || 0);
      const ltvBased = Number(l.ltv || 0) > 0;
      const profit = hasCost ? effectiveRev - Number(l.cost_total || 0) : null;
      const profitPerSub = subs > 0 && hasCost && profit !== null ? profit / subs : null;
      return { ...l, isActive, daysSinceActivity, subsDay, subsDayLabel, daysSinceCreated, profitPerSub, ltvBased };
    });
  }, [links, manualOverrides, dailyMetrics]);

  // ─── Source filter options ───
  const sourceOptions = useMemo(() => {
    const tags = new Set<string>();
    links.forEach((l: any) => { if (l.source_tag) tags.add(l.source_tag); });
    return [...tags].sort();
  }, [links]);

  // ─── Account/filter options ───
  const accountOptions = useMemo(() => {
    return accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name }))
      .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));
  }, [accounts]);

  const filteredAccountOptions = useMemo(() => {
    if (groupFilter === "all") return accountOptions;
    const groupUsernames = GROUP_MAP[groupFilter] || [];
    return accountOptions.filter((a: any) => groupUsernames.includes(a.username));
  }, [accountOptions, groupFilter]);

  // ─── Filtering ───
  const filtered = useMemo(() => {
    let result = enrichedLinks;
    if (groupFilter !== "all") {
      const groupUsernames = GROUP_MAP[groupFilter] || [];
      const groupAccountIds = accounts.filter((a: any) => groupUsernames.includes(a.username)).map((a: any) => a.id);
      result = result.filter((l: any) => groupAccountIds.includes(l.account_id));
    }
    if (accountFilter !== "all") result = result.filter((l: any) => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter((l: any) => !l.source_tag);
    else if (sourceFilter !== "all") result = result.filter((l: any) => l.source_tag === sourceFilter);
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
    else if (["SCALE", "WATCH", "KILL", "DEAD"].includes(campaignFilter)) result = result.filter((l: any) => (l.status || "NO_DATA") === campaignFilter);

    if (ageFilter !== "all") {
      result = result.filter((l: any) => {
        const days = differenceInDays(new Date(), new Date(l.created_at));
        if (ageFilter === "new") return days <= 30;
        if (ageFilter === "active") return days > 30 && days <= 90;
        if (ageFilter === "mature") return days > 90 && days <= 180;
        return days > 180;
      });
    }
    return result;
  }, [enrichedLinks, searchQuery, campaignFilter, sourceFilter, ageFilter, groupFilter, accountFilter, accounts]);

  // ─── Sorting ───
  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "source_tag": aVal = (a.source_tag || "zzz").toLowerCase(); bVal = (b.source_tag || "zzz").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "cost_total": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        case "revenue": aVal = Number(a.revenue || 0); bVal = Number(b.revenue || 0); break;
        case "ltv": aVal = Number(a.ltv || 0); bVal = Number(b.ltv || 0); break;
        case "profit": aVal = Number(a.profit ?? -Infinity); bVal = Number(b.profit ?? -Infinity); break;
        case "roi": aVal = Number(a.roi ?? -Infinity); bVal = Number(b.roi ?? -Infinity); break;
        case "profit_per_sub": aVal = a.profitPerSub ?? -Infinity; bVal = b.profitPerSub ?? -Infinity; break;
        case "created_at": aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
        case "subs_day": aVal = a.subsDay ?? -Infinity; bVal = b.subsDay ?? -Infinity; break;
        case "clicks": aVal = Number(a.clicks || 0); bVal = Number(b.clicks || 0); break;
        case "subscribers": aVal = Number(a.subscribers || 0); bVal = Number(b.subscribers || 0); break;
        case "cvr": aVal = Number(a.clicks) > 0 ? (a.subscribers / a.clicks) : -Infinity; bVal = Number(b.clicks) > 0 ? (b.subscribers / b.clicks) : -Infinity; break;
        case "media_buyer": aVal = (a.media_buyer || "zzz").toLowerCase(); bVal = (b.media_buyer || "zzz").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
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
  const clearAllFilters = () => { setGroupFilter("all"); setAccountFilter("all"); setSourceFilter("all"); setSearchQuery(""); setCampaignFilter("all"); setAgeFilter("all"); setPage(1); };
  const activeFilterCount = [groupFilter !== "all" ? 1 : 0, accountFilter !== "all" ? 1 : 0, campaignFilter !== "all" ? 1 : 0, sourceFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0);

  // ─── KPI Calculations ───
  const kpis = useMemo(() => {
    const scopedLinks = filtered;
    const totalRevenue = scopedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const totalLtv = scopedLinks.reduce((s: number, l: any) => s + Number(l.ltv || 0), 0);
    const activeCampaigns = scopedLinks.filter((l: any) => {
      if (l.clicks <= 0) return false;
      const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
      return calcDate ? differenceInDays(new Date(), calcDate) <= 30 : false;
    }).length;
    const qualifiedLinks = scopedLinks.filter((l: any) => l.clicks > 100);
    const totalSubs = qualifiedLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalClicks = qualifiedLinks.reduce((s: number, l: any) => s + l.clicks, 0);
    const avgCvr = totalClicks > 0 ? (totalSubs / totalClicks) * 100 : null;
    const noSpend = scopedLinks.filter((l: any) => !l.cost_total || Number(l.cost_total) === 0).length;
    const untagged = scopedLinks.filter((l: any) => !l.source_tag).length;
    const totalCount = scopedLinks.length;

    const withSpend = scopedLinks.filter((l: any) => Number(l.cost_total || 0) > 0);
    const expLtv = withSpend.reduce((s: number, l: any) => s + Number(l.ltv || 0), 0);
    const expRev = withSpend.reduce((s: number, l: any) => {
      const ltv = Number(l.ltv || 0);
      return s + (ltv > 0 ? ltv : Number(l.revenue || 0));
    }, 0);
    const expSpend = withSpend.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const expSubs = withSpend.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const profitPerSub = expSpend > 0 && expSubs > 0 ? (expRev - expSpend) / expSubs : null;
    const avgCpl = expSpend > 0 && expSubs > 0 ? expSpend / expSubs : null;
    const trackedCount = withSpend.length;
    const trackedPct = totalCount > 0 ? (trackedCount / totalCount) * 100 : 0;

    // Source-based KPIs
    const bySource: Record<string, { rev: number; spend: number; subs: number; profit: number; count: number }> = {};
    withSpend.forEach((l: any) => {
      const tag = l.source_tag || "Untagged";
      if (!bySource[tag]) bySource[tag] = { rev: 0, spend: 0, subs: 0, profit: 0, count: 0 };
      const effectiveRev = Number(l.ltv || 0) > 0 ? Number(l.ltv) : Number(l.revenue || 0);
      bySource[tag].rev += effectiveRev;
      bySource[tag].spend += Number(l.cost_total || 0);
      bySource[tag].subs += (l.subscribers || 0);
      bySource[tag].profit += effectiveRev - Number(l.cost_total || 0);
      bySource[tag].count++;
    });

    let bestSourceRoi: { name: string; roi: number } | null = null;
    let bestSourceProfitSub: { name: string; profitSub: number } | null = null;
    let mostProfitable: { name: string; profit: number } | null = null;
    let worstSource: { name: string; roi: number } | null = null;

    Object.entries(bySource).forEach(([name, d]) => {
      if (name === "Untagged") return;
      const roi = d.spend > 0 ? ((d.profit / d.spend) * 100) : 0;
      const ps = d.subs > 0 ? d.profit / d.subs : 0;
      if (!bestSourceRoi || roi > bestSourceRoi.roi) bestSourceRoi = { name, roi };
      if (!bestSourceProfitSub || ps > bestSourceProfitSub.profitSub) bestSourceProfitSub = { name, profitSub: ps };
      if (!mostProfitable || d.profit > mostProfitable.profit) mostProfitable = { name, profit: d.profit };
      if (!worstSource || roi < worstSource.roi) worstSource = { name, roi };
    });

    const avgExpensesPerCampaign = withSpend.length > 0 ? expSpend / withSpend.length : null;
    const blendedRoi = expSpend > 0 ? ((expRev - expSpend) / expSpend) * 100 : null;

    return {
      totalRevenue, totalLtv, activeCampaigns, avgCvr, noSpend, untagged, totalCount,
      profitPerSub, avgCpl, trackedCount, trackedPct,
      bestSourceRoi, bestSourceProfitSub, mostProfitable, worstSource,
      avgExpensesPerCampaign, blendedRoi,
    };
  }, [filtered]);

  // ─── Last synced ───
  const lastSynced = useMemo(() => {
    const synced = accounts.filter((a: any) => a.last_synced_at).map((a: any) => new Date(a.last_synced_at).getTime());
    if (synced.length === 0) return null;
    return new Date(Math.max(...synced));
  }, [accounts]);

  // ─── Sort Header Component ───
  const SortHeader = ({ label, sortKeyName, width, sub, primary }: { label: string; sortKeyName: SortKey; width?: string; sub?: string; primary?: boolean }) => (
    <th
      className={`h-[44px] text-left uppercase cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap`}
      style={{ fontSize: "11px", fontWeight: 600, color: "#1a2332", letterSpacing: "0.04em", padding: "8px 12px", background: "#f8fafc", ...(width ? { width, minWidth: width, maxWidth: width } : {}) }}
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
    if (expandedRow === link.id) {
      setExpandedRow(null);
    } else {
      setExpandedRow(link.id);
      setSpendType(link.cost_type || "CPL");
      setSpendValue(link.cost_value ? String(link.cost_value) : "");
      
      setSourceInputValue(link.source_tag || "");
      setNoteText("");
    }
  };

  const onSpendSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    toast.success("Spend saved — ROI and Profit updated");
  };

  // KPI summary text for collapsed state
  const totalExpenses = filtered.reduce((s: number, l: any) => s + (Number(l.cost_total || 0) > 0 ? Number(l.cost_total) : 0), 0);
  const totalProfitAll = filtered.reduce((s: number, l: any) => {
    const ct = Number(l.cost_total || 0);
    if (ct <= 0) return s;
    const effectiveRev = Number(l.ltv || 0) > 0 ? Number(l.ltv) : Number(l.revenue || 0);
    return s + (effectiveRev - ct);
  }, 0);
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
            <h1 className="text-[20px] font-bold text-foreground">Campaigns</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {sorted.length.toLocaleString()} tracking links · {modelCount} models
              {lastSynced && ` · Last synced ${format(lastSynced, "MMM d, HH:mm")}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCampaignsCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <RefreshButton queryKeys={["tracking_links", "ad_spend", "accounts"]} />
            <button
              onClick={() => syncMutation.mutate(undefined)}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : syncLabel}
            </button>
            <button
              onClick={() => syncMutation.mutate("2876566")}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/50 text-primary text-sm font-medium hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Test Link 2876566
            </button>
          </div>
        </div>

        {/* ═══ KPI CARDS — COLLAPSIBLE ═══ */}
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
              <div onClick={(e) => e.stopPropagation()}>
                <KpiCardCustomizer enabledCards={campaignKpi.enabledCards} toggleCard={campaignKpi.toggleCard} variant="campaigns" />
              </div>
              <button className="text-[11px] font-medium flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); setKpiCollapsed(!kpiCollapsed); }}>
                {kpiCollapsed ? (
                  <span className="text-primary">Show metrics <ChevronDown className="inline h-3 w-3" /></span>
                ) : (
                  <span className="text-muted-foreground">Hide metrics <ChevronUp className="inline h-3 w-3" /></span>
                )}
              </button>
            </div>
          </div>

          {!kpiCollapsed && (
            <div className="px-3.5 pb-3 space-y-[8px]" onClick={(e) => e.stopPropagation()}>
              {/* Group 1 — Overview (teal border) */}
              {(() => {
                const g1 = [
                  campaignKpi.isVisible("total_expenses") && (
                    <KPICard key="total_expenses" borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-primary" />}
                      label="Total Expenses" value={<span className="text-foreground">{fmtC(totalExpenses)}</span>} sub="All paid campaigns"
                      tooltip={{ title: "Total Expenses", desc: "Sum of all ad spend across campaigns with costs set." }} />
                  ),
                  campaignKpi.isVisible("total_profit") && (
                    <KPICard key="total_profit" borderColor="hsl(var(--primary))" icon={<TrendingUp className="h-4 w-4 text-primary" />}
                      label="Total Profit" value={hasAnyExpenses
                        ? <span className={totalProfitAll >= 0 ? "text-primary" : "text-destructive"}>{fmtC(totalProfitAll)}</span>
                        : <span className="text-muted-foreground">—</span>} sub="Revenue minus spend"
                      tooltip={{ title: "Total Profit", desc: "Total revenue minus total expenses across paid campaigns." }} />
                  ),
                  campaignKpi.isVisible("active_campaigns") && (
                    <KPICard key="active_campaigns" borderColor="hsl(var(--primary))" icon={<Activity className="h-4 w-4 text-primary" />}
                      label="Active Campaigns" value={kpis.activeCampaigns.toLocaleString()} sub="Clicks in last 30 days"
                      tooltip={{ title: "Active Campaigns", desc: "Campaigns with at least 1 click in the last 30 days." }} />
                  ),
                  campaignKpi.isVisible("avg_cvr") && (
                    <KPICard key="avg_cvr" borderColor="hsl(var(--primary))" icon={<TrendingUp className="h-4 w-4 text-primary" />}
                      label="Avg CVR" value={kpis.avgCvr !== null ? `${kpis.avgCvr.toFixed(1)}%` : "—"} sub={<span className="text-primary">Agency benchmark</span>}
                      tooltip={{ title: "Avg CVR", desc: "Conversion rate across links with 100+ clicks." }} />
                  ),
                  campaignKpi.isVisible("untagged") && (
                    <KPICard key="untagged" borderColor="hsl(var(--primary))" icon={<Tag className="h-4 w-4 text-[hsl(var(--warning))]" />}
                      label="Untagged" value={<span className={kpis.untagged > 0 ? "text-[hsl(var(--warning))]" : ""}>{kpis.untagged}</span>} sub="No source tag set"
                      tooltip={{ title: "Untagged", desc: "Campaigns without a source tag assigned." }} />
                  ),
                  campaignKpi.isVisible("blended_roi") && (
                    <KPICard key="blended_roi" borderColor="hsl(var(--primary))" icon={<BarChart3 className="h-4 w-4 text-primary" />}
                      label="Blended ROI" value={kpis.blendedRoi !== null ? `${kpis.blendedRoi.toFixed(0)}%` : "—"} sub="Revenue vs spend"
                      tooltip={{ title: "Blended ROI", desc: "Overall return on investment across all paid campaigns." }} />
                  ),
                  campaignKpi.isVisible("avg_expenses_per_campaign") && (
                    <KPICard key="avg_expenses_per_campaign" borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-primary" />}
                      label="Avg Expenses/Campaign" value={kpis.avgExpensesPerCampaign !== null ? fmtC(kpis.avgExpensesPerCampaign) : "—"} sub="Per tracked campaign"
                      tooltip={{ title: "Avg Expenses per Campaign", desc: "Average spend per campaign that has costs set." }} />
                  ),
                ].filter(Boolean);
                return g1.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px", alignItems: "stretch" }}>{g1}</div>
                ) : null;
              })()}

              {/* Group 2 — Expenses (green border) — always-on + toggleable */}
              {(() => {
                const g2 = [
                  campaignKpi.isVisible("profit_sub") && (
                    <KPICard key="profit_sub" borderColor="hsl(142 71% 45%)" icon={<TrendingUp className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                      label="Profit/Sub" value={kpis.profitPerSub !== null
                        ? <span className={`text-[16px] ${kpis.profitPerSub >= 0 ? "text-[hsl(142_71%_45%)]" : "text-destructive"}`}>{fmtC(kpis.profitPerSub)}</span>
                        : "—"} sub="Per acquired subscriber"
                      tooltip={{ title: "Profit/Sub", desc: "Profit generated per acquired subscriber across paid campaigns." }} />
                  ),
                  campaignKpi.isVisible("avg_cpl") && (
                    <KPICard key="avg_cpl" borderColor="hsl(142 71% 45%)" icon={<Tag className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                      label="Avg CPL" value={kpis.avgCpl !== null ? fmtC(kpis.avgCpl) : "—"} sub="Cost per subscriber"
                      tooltip={{ title: "Avg CPL", desc: "Average cost to acquire one subscriber." }} />
                  ),
                  campaignKpi.isVisible("best_source_roi") && (
                    <KPICard key="best_source_roi" borderColor="hsl(142 71% 45%)" icon={<Award className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                      label="Best Source by ROI" value={kpis.bestSourceRoi ? <span className="text-[hsl(142_71%_45%)]">{kpis.bestSourceRoi.name}</span> : "—"}
                      sub={kpis.bestSourceRoi ? `${kpis.bestSourceRoi.roi.toFixed(0)}% ROI` : "No data"}
                      tooltip={{ title: "Best Source by ROI", desc: "Source tag with the highest ROI across paid campaigns." }} />
                  ),
                ].filter(Boolean);
                return g2.length > 0 ? (
                  <>
                    <div className="h-px bg-border mx-0" style={{ margin: "8px 0" }} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", alignItems: "stretch" }}>{g2}</div>
                  </>
                ) : null;
              })()}

              {/* Group 3 — Source Analysis (purple border) */}
              {(() => {
                const g3 = [
                  campaignKpi.isVisible("best_source_profit_sub") && (
                    <KPICard key="best_source_profit_sub" borderColor="hsl(263 70% 50%)" icon={<Star className="h-4 w-4 text-[hsl(263_70%_50%)]" />}
                      label="Best Source by Profit/Sub" value={kpis.bestSourceProfitSub ? <span className="text-[hsl(263_70%_50%)]">{kpis.bestSourceProfitSub.name}</span> : "—"}
                      sub={kpis.bestSourceProfitSub ? `${fmtC(kpis.bestSourceProfitSub.profitSub)}/sub` : "No data"}
                      tooltip={{ title: "Best Source by Profit/Sub", desc: "Source tag with highest profit per subscriber." }} />
                  ),
                  campaignKpi.isVisible("most_profitable_source") && (
                    <KPICard key="most_profitable_source" borderColor="hsl(263 70% 50%)" icon={<DollarSign className="h-4 w-4 text-[hsl(263_70%_50%)]" />}
                      label="Most Profitable Source" value={kpis.mostProfitable ? <span className="text-[hsl(263_70%_50%)]">{kpis.mostProfitable.name}</span> : "—"}
                      sub={kpis.mostProfitable ? `${fmtC(kpis.mostProfitable.profit)} profit` : "No data"}
                      tooltip={{ title: "Most Profitable Source", desc: "Source tag with the highest total profit." }} />
                  ),
                  campaignKpi.isVisible("worst_source") && (
                    <KPICard key="worst_source" borderColor="hsl(263 70% 50%)" icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
                      label="Lowest Profitable Source" value={kpis.worstSource ? <span className="text-destructive">{kpis.worstSource.name}</span> : "—"}
                      sub={kpis.worstSource ? `${kpis.worstSource.roi.toFixed(0)}% ROI` : "No data"}
                      tooltip={{ title: "Lowest Profitable Source", desc: "Source tag with the lowest ROI. Consider pausing or optimizing." }} />
                  ),
                ].filter(Boolean);
                return g3.length > 0 ? (
                  <>
                    <div className="h-px bg-border mx-0" style={{ margin: "8px 0" }} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", alignItems: "stretch" }}>{g3}</div>
                  </>
                ) : null;
              })()}

              {/* 30d LTV per model */}
              {campaignKpi.isVisible("ltv_30d_per_model") && (() => {
                const sortedModels = [...accounts].sort((a: any, b: any) => (b.ltv_last_30d ?? 0) - (a.ltv_last_30d ?? 0));
                return (
                  <>
                    <div className="h-px bg-border mx-0" style={{ margin: "8px 0" }} />
                    <div className="bg-card border border-border shadow-sm" style={{ borderLeftWidth: "3px", borderLeftColor: "hsl(var(--primary))", padding: "12px 14px", borderRadius: "0 12px 12px 0" }}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <Users className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">30d LTV per model</span>
                      </div>
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
                            <span className="ml-auto font-mono font-semibold text-foreground shrink-0">
                              {acc.ltv_last_30d != null ? fmtC(acc.ltv_last_30d) : "—"}
                            </span>
                          </div>
                        ))}
                        {sortedModels.length === 0 && <p className="text-[11px] text-muted-foreground">No models</p>}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* ═══ FILTER BAR ═══ */}
        <div className="flex flex-wrap items-center" style={{ gap: "8px" }}>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-colors" />
          </div>
          <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">All Accounts</option>
            {filteredAccountOptions.map((acc: any) => (<option key={acc.id} value={acc.id}>{acc.display_name} (@{acc.username})</option>))}
          </select>
          <select value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value as CampaignFilter); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">All Campaigns</option>
            <option value="active">Active Only</option>
            <option value="zero">Zero Clicks</option>
            <option value="no_spend">No Spend Set</option>
            <option value="SCALE">SCALE</option>
            <option value="WATCH">WATCH</option>
            <option value="KILL">KILL</option>
            <option value="DEAD">DEAD</option>
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

        {/* Age pills */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg overflow-hidden w-fit">
          {(["all", "new", "active", "mature", "old"] as const).map((f) => {
            const count = f === "all" ? enrichedLinks.length : enrichedLinks.filter((l: any) => {
              const days = differenceInDays(new Date(), new Date(l.created_at));
              if (f === "new") return days <= 30;
              if (f === "active") return days > 30 && days <= 90;
              if (f === "mature") return days > 90 && days <= 180;
              return days > 180;
            }).length;
            return (
              <button key={f} onClick={() => { setAgeFilter(f); setPage(1); }}
                className={`text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${ageFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                style={{ padding: "4px 10px" }}>
                {f === "all" ? "All Ages" : f === "new" ? "🟢 New" : f === "active" ? "🔵 Active" : f === "mature" ? "🟡 Mature" : "⚪ Old"}
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ageFilter === f ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* ═══ CAMPAIGN TABLE ═══ */}
        <div className="flex gap-0">
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="bg-card border border-border rounded-2xl p-8"><div className="space-y-3">{[...Array(8)].map((_, i) => (<div key={i} className="skeleton-shimmer h-10 rounded" />))}</div></div>
            ) : sorted.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-16 text-center">
                <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium mb-1">No tracking links found</p>
                <p className="text-sm text-muted-foreground">{searchQuery || campaignFilter !== "all" || ageFilter !== "all" || accountFilter !== "all" || sourceFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                {selectedRows.size > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border-b border-border">
                    <span className="text-xs font-medium text-foreground">{selectedRows.size} selected</span>
                    <button onClick={() => setSelectedRows(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
                  </div>
                )}
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
                        <div className="absolute right-0 top-full mt-1 z-30 w-48 bg-card border border-border rounded-lg shadow-lg py-1.5 max-h-72 overflow-y-auto">
                          {ALL_TOGGLEABLE_COLUMNS.map(c => (
                            <label key={c.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary/50 cursor-pointer transition-colors">
                              <input type="checkbox" checked={visibleCols[c.id]} onChange={() => toggleColumn(c.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-[hsl(var(--primary))]" />
                              <span className="text-[11px] text-foreground">{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 z-10" style={{ background: "#f8fafc" }}>
                      <tr className="border-b border-border">
                        <th className="w-8" style={{ height: "44px", padding: "8px 12px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}><input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-border cursor-pointer" /></th>
                        <SortHeader label="Campaign" sortKeyName="campaign_name" width="200px" />
                        {col("model") && <th className="text-left whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "100px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}>Model</th>}
                        {col("source") && <SortHeader label="Source" sortKeyName="source_tag" width="100px" />}
                        {col("clicks") && <SortHeader label="Clicks" sortKeyName="clicks" width="70px" />}
                        {col("subscribers") && <SortHeader label="Subs" sortKeyName="subscribers" width="70px" />}
                        {col("cvr") && <SortHeader label="CVR" sortKeyName="cvr" width="65px" />}
                        {col("revenue") && <SortHeader label="Revenue" sortKeyName="revenue" width="90px" />}
                        {col("ltv") && <SortHeader label="LTV" sortKeyName="ltv" width="80px" />}
                        {col("ltv_sub") && <th className="text-right whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "75px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}>LTV/Sub</th>}
                        {col("spender_rate") && <th className="text-right whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "75px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}>Spender %</th>}
                        {col("expenses") && <SortHeader label="Expenses" sortKeyName="cost_total" width="90px" />}
                        {col("profit") && <SortHeader label="Profit" sortKeyName="profit" width="80px" />}
                        <SortHeader label="Profit/Sub" sortKeyName="profit_per_sub" width="85px" primary />
                        {col("roi") && <SortHeader label="ROI" sortKeyName="roi" width="70px" />}
                        {col("status") && <th className="text-left whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "80px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}>Status</th>}
                        {col("subs_day") && <SortHeader label="Subs/Day" sortKeyName="subs_day" width="80px" />}
                        {col("created") && <SortHeader label="Created" sortKeyName="created_at" width="100px" />}
                        {col("media_buyer") && <SortHeader label="Buyer" sortKeyName="media_buyer" width="90px" />}
                        {col("avg_expenses") && <th className="text-left whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "90px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}>Avg Expenses</th>}
                        <th className="text-center whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "28px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }} title="Fan sync status">👥</th>
                        <th className="text-center whitespace-nowrap" style={{ height: "44px", padding: "8px 12px", width: "28px", fontSize: "11px", fontWeight: 600, color: "#1a2332", textTransform: "uppercase", letterSpacing: "0.04em", background: "#f8fafc" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((link: any) => {
                        const username = link.accounts?.username || link.accounts?.display_name || "—";
                        const modelColor = getModelColor(link.accounts?.username);
                        const initials = username !== "—" ? username.replace("@", "").slice(0, 1).toUpperCase() : "?";
                        const costTotal = Number(link.cost_total || 0);
                        const hasCost = link.cost_type && costTotal > 0;
                        const effectiveRev = Number(link.ltv || 0) > 0 ? Number(link.ltv) : Number(link.revenue || 0);
                        const profit = hasCost ? effectiveRev - costTotal : 0;
                        const ltvBased = Number(link.ltv || 0) > 0;
                        const roi = Number(link.roi || 0);
                        const status = link.status || "NO_DATA";
                        const displayStatus = STATUS_LABELS[status] || "NO SPEND";
                        const statusStyle = STATUS_STYLES[displayStatus] || STATUS_STYLES["NO SPEND"];
                        const isExpanded = expandedRow === link.id;

                        return (
                          <React.Fragment key={link.id}>
                          <tr
                            onClick={() => handleRowClick(link)}
                            className={`border-b border-border/50 cursor-pointer transition-colors group ${isExpanded ? "bg-[hsl(var(--primary)/0.04)]" : "hover:bg-secondary/30"}`}
                            style={{ height: "46px" }}
                          >
                            <td style={{ padding: "8px 12px", maxWidth: "40px" }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                            </td>
                            <td style={{ padding: "8px 12px", maxWidth: "200px" }}>
                              <p className="font-bold text-foreground truncate" style={{ fontSize: "13px" }} title={link.campaign_name}>{link.campaign_name || "—"}</p>
                              <p className="truncate" style={{ fontSize: "11px", color: "#94a3b8" }} title={link.url}>{link.url}</p>
                            </td>
                            {col("model") && (
                              <td style={{ padding: "8px 12px" }}>
                                <div className="flex items-center gap-1.5">
                                  <span className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: modelColor }}>{initials}</span>
                                  <span className="truncate" style={{ fontSize: "12px", color: "#94a3b8" }}>@{username}</span>
                                </div>
                              </td>
                            )}
                            {col("source") && (
                              <td style={{ padding: "8px 12px" }}>
                                <TagBadge tagName={link.source_tag} size="sm" />
                              </td>
                            )}
                            {col("clicks") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {(link.clicks || 0).toLocaleString()}
                              </td>
                            )}
                            {col("subscribers") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {(link.subscribers || 0).toLocaleString()}
                              </td>
                            )}
                            {col("cvr") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {link.clicks > 100 ? <span className="text-primary">{((link.subscribers / link.clicks) * 100).toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
                            {col("revenue") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-foreground">{fmtC(Number(link.revenue || 0))}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>Total gross revenue from all subscribers</TooltipContent>
                                </Tooltip>
                              </td>
                            )}
                            {col("ltv") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={Number(link.ltv || 0) > 0 ? "text-[#0891b2] font-semibold" : "text-muted-foreground"}>
                                      {Number(link.ltv || 0) > 0 ? fmtC(Number(link.ltv)) : link.fans_last_synced_at ? "$0.00" : "—"}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{Number(link.ltv || 0) > 0 ? "Revenue from new subscribers only" : "Run fan sync to calculate LTV"}</TooltipContent>
                                </Tooltip>
                              </td>
                            )}
                            {col("ltv_sub") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-foreground">
                                      {Number(link.ltv_per_sub || 0) > 0 ? fmtC(Number(link.ltv_per_sub)) : "—"}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Average revenue per new subscriber</TooltipContent>
                                </Tooltip>
                              </td>
                            )}
                            {col("spender_rate") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {Number(link.spender_rate || 0) > 0 ? (
                                  <span className={Number(link.spender_rate) > 10 ? "text-primary" : Number(link.spender_rate) >= 5 ? "text-[hsl(38_92%_50%)]" : "text-destructive"}>
                                    {Number(link.spender_rate).toFixed(1)}%
                                  </span>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
                            {col("expenses") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {hasCost ? (
                                  <span className="text-muted-foreground">{fmtC(costTotal)}</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <Tooltip>
                                      <TooltipTrigger asChild><span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0 cursor-help" /></TooltipTrigger>
                                      <TooltipContent>No expenses set</TooltipContent>
                                    </Tooltip>
                                    —
                                  </span>
                                )}
                              </td>
                            )}
                            {col("profit") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {hasCost ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 cursor-help ${ltvBased ? "bg-[#0891b2]" : "bg-muted-foreground"}`} />
                                      </TooltipTrigger>
                                      <TooltipContent>{ltvBased ? "Calculated from LTV (accurate)" : "Calculated from Revenue (estimate)"}</TooltipContent>
                                    </Tooltip>
                                    <span className={profit >= 0 ? "text-primary" : "text-destructive"}>{profit >= 0 ? "+" : ""}{fmtC(profit)}</span>
                                  </span>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
                            <td className="text-right" style={{ padding: "8px 12px" }}>
                              {link.profitPerSub !== null ? (
                                <span className={`font-mono font-bold ${link.profitPerSub >= 0 ? "text-primary" : "text-destructive"}`} style={{ fontSize: "12px" }}>
                                  {link.profitPerSub >= 0 ? "" : "-"}${Math.abs(link.profitPerSub).toFixed(2)}
                                </span>
                              ) : <span className="text-muted-foreground font-bold" style={{ fontSize: "12px" }}>—</span>}
                            </td>
                            {col("roi") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {hasCost ? <span className={roi >= 0 ? "text-primary" : "text-destructive"}>{roi.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
                            {col("status") && (
                              <td style={{ padding: "8px 12px" }}>
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
                            )}
                            {col("subs_day") && (
                              <td className="font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {link.subsDay !== null && link.subsDay > 0
                                  ? <span className="text-primary font-bold">{Math.round(link.subsDay)}/day</span>
                                  : link.subsDayLabel
                                    ? <span className="text-muted-foreground text-[10px]">{link.subsDayLabel}</span>
                                    : <span className="text-muted-foreground">0/day</span>}
                              </td>
                            )}
                            {col("created") && (() => {
                              const days = link.daysSinceCreated;
                              const createdDate = format(new Date(link.created_at), "MMM d, yyyy");
                              const pill = days <= 30 ? { label: `${days}d New`, bg: "#dcfce7", text: "#16a34a" }
                                : days <= 90 ? { label: `${days}d Active`, bg: "#dbeafe", text: "#2563eb" }
                                : days <= 180 ? { label: `${days}d Mature`, bg: "#fef9c3", text: "#854d0e" }
                                : { label: `${days}d Old`, bg: "#f3f4f6", text: "#6b7280" };
                              return (
                                <td style={{ padding: "8px 12px" }}>
                                  <p className="text-foreground" style={{ fontSize: "12px" }}>{createdDate}</p>
                                  <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold mt-0.5" style={{ backgroundColor: pill.bg, color: pill.text }}>{pill.label}</span>
                                </td>
                              );
                            })()}
                            {col("media_buyer") && (
                              <td style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {link.media_buyer ? <span className="text-foreground">{link.media_buyer}</span> : <span className="text-muted-foreground italic">—</span>}
                              </td>
                            )}
                            {col("avg_expenses") && (
                              <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                                {hasCost ? <span className="text-muted-foreground">{fmtC(costTotal)}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
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
                            <td className="w-7 text-center" style={{ padding: "8px 12px" }}>
                              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            </td>
                          </tr>
                          {/* Inline detail row */}
                          {isExpanded && (() => {
                            const el = link;
                            const subsEl = el.subscribers || 0;
                            const clicksEl = el.clicks || 0;
                            const revEl = Number(el.ltv || el.revenue || 0);
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
                                const newStatus = previewRoi > 150 ? "SCALE" : previewRoi >= 50 ? "WATCH" : previewRoi >= 0 ? "LOW" : "KILL";
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
                                await clearTrackingLinkSpend(el.id, el.campaign_id);
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
                            return (
                              <tr>
                                <td colSpan={99} className="p-0">
                                  <div className="bg-[hsl(var(--primary)/0.03)] border-l-[3px] border-l-primary px-4 py-3.5">
                                    <div className="grid grid-cols-4 gap-4">
                                      {/* Col 1: Performance */}
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Performance</p>
                                        <div className="space-y-1.5 text-[12px]">
                                          {[
                                            { l: "Clicks", v: clicksEl.toLocaleString() },
                                            { l: "Subscribers", v: subsEl.toLocaleString() },
                                            { l: "CVR", v: clicksEl > 100 ? `${((subsEl / clicksEl) * 100).toFixed(1)}%` : "—", c: clicksEl > 100 ? "text-primary" : "" },
                                            { l: "Subs/Day", v: el.subsDay !== null && el.subsDay > 0 ? `${Math.round(el.subsDay)}/day` : el.subsDayLabel || "0/day", c: el.subsDay ? "text-primary" : "" },
                                            { l: "LTV", v: fmtC(revEl), c: "text-primary font-bold" },
                                            { l: "Spender Rate", v: el.spender_rate ? `${Number(el.spender_rate).toFixed(1)}%` : "—", c: Number(el.spender_rate || 0) > 10 ? "text-primary" : Number(el.spender_rate || 0) >= 5 ? "text-[hsl(38_92%_50%)]" : "text-destructive" },
                                          ].map(r => (
                                            <div key={r.l} className="flex justify-between">
                                              <span className="text-muted-foreground">{r.l}</span>
                                              <span className={r.c || "text-foreground"}>{r.v}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      {/* Col 2: Spend */}
                                      <div>
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Spend</p>
                                          <span className={`w-1.5 h-1.5 rounded-full ${hasCostEl ? "bg-primary" : "bg-[hsl(38_92%_50%)]"}`} />
                                          <span className="text-[10px] text-muted-foreground">{hasCostEl ? "Set" : "Not set"}</span>
                                        </div>
                                        <div className="flex gap-1 mb-2">
                                          {(["CPL", "CPC", "FIXED"] as const).map(t => (
                                            <button key={t} onClick={(e) => { e.stopPropagation(); setSpendType(t); }}
                                              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${spendType === t ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>{t}</button>
                                          ))}
                                        </div>
                                        <input type="number" step="0.01" value={spendValue} onChange={(e) => setSpendValue(e.target.value)}
                                          placeholder="Cost value..." onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary mb-2" />
                                        {validVal && (
                                          <div className="space-y-1 text-[11px] font-mono mb-2">
                                            <div className="flex justify-between"><span className="text-muted-foreground">Spend</span><span>{fmtC(previewCost)}</span></div>
                                            <div className="flex justify-between"><span className="text-muted-foreground">Profit</span><span className={previewProfit >= 0 ? "text-primary" : "text-destructive"}>{fmtC(previewProfit)}</span></div>
                                            <div className="flex justify-between"><span className="text-muted-foreground">Profit/Sub</span><span className={`font-bold text-[13px] ${previewProfitSub >= 0 ? "text-primary" : "text-destructive"}`}>${Math.abs(previewProfitSub).toFixed(2)}</span></div>
                                            <div className="flex justify-between"><span className="text-muted-foreground">ROI</span><span className={previewRoi >= 0 ? "text-primary" : "text-destructive"}>{previewRoi.toFixed(1)}%</span></div>
                                          </div>
                                        )}
                                        <div className="flex gap-1.5">
                                          <button onClick={(e) => { e.stopPropagation(); saveSpendInline(); }} disabled={!validVal}
                                            className="flex-1 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50">Save</button>
                                          {hasCostEl && (
                                            <button onClick={(e) => { e.stopPropagation(); clearSpendInline(); }}
                                              className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-destructive hover:bg-destructive/10 border border-destructive/30">Clear</button>
                                          )}
                                        </div>
                                      </div>
                                      {/* Col 3: Source */}
                                      <div>
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Source</p>
                                          <span className={`w-1.5 h-1.5 rounded-full ${el.source_tag ? "bg-[hsl(142_71%_45%)]" : "bg-[hsl(38_92%_50%)]"}`} />
                                          <span className="text-[10px] text-muted-foreground">{el.source_tag || "Untagged"}</span>
                                        </div>
                                        <input type="text" value={sourceInputValue} onChange={(e) => setSourceInputValue(e.target.value)}
                                          placeholder="Type source name e.g. Reddit, James - OnlyFinder..." onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary mb-2" />
                                        <button onClick={(e) => { e.stopPropagation(); handleSaveSource(); }}
                                          className="w-full py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90">Save</button>
                                      </div>
                                      {/* Col 4: Notes */}
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Notes</p>
                                        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
                                          placeholder="Add a note about this campaign..." onClick={(e) => e.stopPropagation()}
                                          className="w-full h-20 px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary resize-none mb-2" />
                                        <button onClick={(e) => { e.stopPropagation(); saveNoteInline(); }}
                                          className="w-full py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90">Save note</button>
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

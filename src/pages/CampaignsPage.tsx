import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { CsvCostImportModal } from "@/components/dashboard/CsvCostImportModal";
import { TagBadge } from "@/components/TagBadge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchTrackingLinks, fetchAdSpend, deleteAdSpend, triggerSync,
  clearTrackingLinkSpend, fetchSourceTagRules, setTrackingLinkSourceTag,
  bulkSetSourceTag, fetchAccounts, runAutoTag, fetchDailyMetrics,
} from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RefreshCw, DollarSign, TrendingUp, Star, Trash2, Download, Pencil, X, Tag,
  Users, Activity, Info, Wand2, BarChart3, Target, ChevronRight as ChevronR,
  Upload, Plus, User
} from "lucide-react";

// ─── Types ───
type ActiveView = "tracking" | "expenses" | "media";
type SortKey = "campaign_name" | "cost_total" | "revenue" | "profit" | "roi" | "profit_per_sub" | "created_at" | "subs_day";
type ClickFilter = "all" | "active" | "zero";

const VIEW_KEY = "campaigns_active_view";

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

  // ─── View state ───
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as ActiveView) || "tracking"; } catch { return "tracking"; }
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, activeView); } catch {} }, [activeView]);

  // ─── Filter/sort state ───
  const [searchQuery, setSearchQuery] = useState("");
  const [clickFilter, setClickFilter] = useState<ClickFilter>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // ─── Selection/interaction state ───
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const [clearConfirmId, setClearConfirmId] = useState<string | null>(null);
  const [sourceDropdownId, setSourceDropdownId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showBulkTagDropdown, setShowBulkTagDropdown] = useState(false);
  const [detailPanelLink, setDetailPanelLink] = useState<any>(null);
  const [actionPanel, setActionPanel] = useState<{ link: any; action: "spend" | "source" | "buyer" } | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [spendType, setSpendType] = useState<"CPL" | "CPC" | "FIXED">("CPL");
  const [spendValue, setSpendValue] = useState("");

  // Media buyers
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [mediaSortKey, setMediaSortKey] = useState<"source" | "campaigns" | "totalSpend" | "totalLtv" | "totalProfit" | "roi" | "avgCvr">("totalProfit");
  const [mediaSortAsc, setMediaSortAsc] = useState(false);

  // ─── Data fetching ───
  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: adSpendData = [] } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: tagRules = [] } = useQuery({ queryKey: ["source_tag_rules"], queryFn: fetchSourceTagRules });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

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

  // ─── Mutations ───
  const handleSetSourceTag = async (linkId: string, tag: string) => {
    try {
      await setTrackingLinkSourceTag(linkId, tag);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success(tag ? `Tagged as "${tag}"` : "Tag cleared");
      setSourceDropdownId(null);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleBulkTag = async (tag: string) => {
    try {
      await bulkSetSourceTag(Array.from(selectedRows), tag);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success(`Tagged ${selectedRows.size} campaigns as "${tag}"`);
      setSelectedRows(new Set());
      setShowBulkTagDropdown(false);
    } catch (err: any) { toast.error(err.message); }
  };

  const deleteSpendMutation = useMutation({
    mutationFn: deleteAdSpend,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend deleted"); },
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(undefined, true, (msg) => toast.info(msg, { id: 'sync-progress' })),
    onSuccess: (data) => {
      toast.success(`Sync complete — ${data?.accounts_synced ?? 0} accounts synced`, { id: 'sync-progress' });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
  });

  const autoTagMutation = useMutation({
    mutationFn: runAutoTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success("Auto-tagging complete");
    },
    onError: (err: any) => toast.error(`Auto-tag failed: ${err.message}`),
  });

  const exportCampaignsCsv = useCallback(() => {
    const header = "campaign_name,account_username,clicks,subscribers,ltv,spend,profit,profit_per_sub,roi,status,source_tag";
    const rows = links.map((l: any) => {
      const cn = (l.campaign_name || "").replace(/,/g, " ");
      const un = (l.accounts?.username || "").replace(/,/g, " ");
      const subs = l.subscribers || 0;
      const profit = Number(l.profit || 0);
      const profitPerSub = subs > 0 && Number(l.cost_total || 0) > 0 ? (profit / subs).toFixed(2) : "";
      return `${cn},${un},${l.clicks || 0},${subs},${Number(l.revenue || 0).toFixed(2)},${Number(l.cost_total || 0).toFixed(2)},${profit.toFixed(2)},${profitPerSub},${Number(l.roi || 0).toFixed(1)},${l.status || "NO_DATA"},${l.source_tag || ""}`;
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
      const subsDay = daysSinceCreated >= 1 && l.subscribers > 0 ? l.subscribers / daysSinceCreated : null;
      const subs = l.subscribers || 0;
      const hasCost = Number(l.cost_total || 0) > 0;
      const profitPerSub = subs > 0 && hasCost ? Number(l.profit || 0) / subs : null;
      return { ...l, isActive, daysSinceActivity, subsDay, daysSinceCreated, profitPerSub };
    });
  }, [links, manualOverrides]);

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

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedLinks.forEach((l: any) => { if (l.source_tag) set.add(l.source_tag); });
    return Array.from(set).sort();
  }, [enrichedLinks]);

  // ─── Filtering ───
  const filtered = useMemo(() => {
    let result = enrichedLinks;
    if (groupFilter !== "all") {
      const groupUsernames = GROUP_MAP[groupFilter] || [];
      const groupAccountIds = accounts.filter((a: any) => groupUsernames.includes(a.username)).map((a: any) => a.id);
      result = result.filter((l: any) => groupAccountIds.includes(l.account_id));
    }
    if (accountFilter !== "all") result = result.filter((l: any) => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter((l: any) => !l.source_tag || l.source_tag === "Untagged");
    else if (sourceFilter === "has_spend") result = result.filter((l: any) => Number(l.cost_total || 0) > 0);
    else if (sourceFilter === "no_spend") result = result.filter((l: any) => !l.cost_total || Number(l.cost_total) === 0);
    else if (sourceFilter !== "all") result = result.filter((l: any) => l.source_tag === sourceFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) || (l.url || "").toLowerCase().includes(q) ||
        (l.accounts?.username || "").toLowerCase().includes(q) || (l.accounts?.display_name || "").toLowerCase().includes(q)
      );
    }
    if (clickFilter === "active") result = result.filter((l: any) => l.clicks > 0);
    if (clickFilter === "zero") result = result.filter((l: any) => l.clicks === 0);
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
  }, [enrichedLinks, searchQuery, clickFilter, ageFilter, groupFilter, accountFilter, sourceFilter, accounts]);

  // ─── Sorting ───
  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "cost_total": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        case "revenue": aVal = Number(a.revenue); bVal = Number(b.revenue); break;
        case "profit": aVal = Number(a.profit ?? -Infinity); bVal = Number(b.profit ?? -Infinity); break;
        case "roi": aVal = Number(a.roi ?? -Infinity); bVal = Number(b.roi ?? -Infinity); break;
        case "profit_per_sub": aVal = a.profitPerSub ?? -Infinity; bVal = b.profitPerSub ?? -Infinity; break;
        case "created_at": aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
        case "subs_day": aVal = a.subsDay ?? -Infinity; bVal = b.subsDay ?? -Infinity; break;
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
  const clearAllFilters = () => { setGroupFilter("all"); setAccountFilter("all"); setSourceFilter("all"); setSearchQuery(""); setClickFilter("all"); setAgeFilter("all"); setPage(1); };
  const activeFilterCount = [groupFilter !== "all" ? 1 : 0, accountFilter !== "all" ? 1 : 0, sourceFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0);

  // ─── KPI Calculations ───
  const kpis = useMemo(() => {
    let scopedLinks = filtered;
    // Group 1 — Tracking Links
    const totalLtv = scopedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const activeCampaigns = scopedLinks.filter((l: any) => {
      if (l.clicks <= 0) return false;
      const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
      return calcDate ? differenceInDays(new Date(), calcDate) <= 30 : false;
    }).length;
    const qualifiedLinks = scopedLinks.filter((l: any) => l.clicks > 100);
    const totalSubs = qualifiedLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalClicks = qualifiedLinks.reduce((s: number, l: any) => s + l.clicks, 0);
    const avgCvr = totalClicks > 0 ? (totalSubs / totalClicks) * 100 : null;
    const untagged = scopedLinks.filter((l: any) => !l.source_tag || l.source_tag === "Untagged").length;
    const noSpend = scopedLinks.filter((l: any) => !l.cost_total || Number(l.cost_total) === 0).length;
    const totalCount = scopedLinks.length;

    // Group 2 — Expenses
    const withSpend = scopedLinks.filter((l: any) => Number(l.cost_total || 0) > 0);
    const expRev = withSpend.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const expSpend = withSpend.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const expSubs = withSpend.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const profitPerSub = expSpend > 0 && expSubs > 0 ? (expRev - expSpend) / expSubs : null;
    const avgCpl = expSpend > 0 && expSubs > 0 ? expSpend / expSubs : null;
    const trackedCount = withSpend.length;
    const trackedPct = totalCount > 0 ? (trackedCount / totalCount) * 100 : 0;

    // Best source by ROI
    const sourceMap: Record<string, { rev: number; spend: number }> = {};
    withSpend.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!sourceMap[src]) sourceMap[src] = { rev: 0, spend: 0 };
      sourceMap[src].rev += Number(l.revenue || 0);
      sourceMap[src].spend += Number(l.cost_total || 0);
    });
    let bestSource: { name: string; roi: number } | null = null;
    Object.entries(sourceMap).forEach(([name, { rev, spend }]) => {
      if (spend > 0) { const roi = ((rev - spend) / spend) * 100; if (!bestSource || roi > bestSource.roi) bestSource = { name, roi }; }
    });

    // Group 3 — Media Buyers
    const sourceProfit: Record<string, { profit: number; subs: number; spend: number; rev: number }> = {};
    withSpend.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!sourceProfit[src]) sourceProfit[src] = { profit: 0, subs: 0, spend: 0, rev: 0 };
      sourceProfit[src].profit += Number(l.revenue || 0) - Number(l.cost_total || 0);
      sourceProfit[src].subs += l.subscribers || 0;
      sourceProfit[src].spend += Number(l.cost_total || 0);
      sourceProfit[src].rev += Number(l.revenue || 0);
    });
    let bestProfitPerSub: { name: string; value: number } | null = null;
    let mostProfitable: { name: string; value: number } | null = null;
    let worstSource: { name: string; roi: number } | null = null;
    Object.entries(sourceProfit).forEach(([name, d]) => {
      if (d.subs > 0) { const pps = d.profit / d.subs; if (!bestProfitPerSub || pps > bestProfitPerSub.value) bestProfitPerSub = { name, value: pps }; }
      if (!mostProfitable || d.profit > mostProfitable.value) mostProfitable = { name, value: d.profit };
      if (d.spend > 0) { const roi = ((d.rev - d.spend) / d.spend) * 100; if (!worstSource || roi < worstSource.roi) worstSource = { name, roi }; }
    });

    return {
      totalLtv, activeCampaigns, avgCvr, untagged, noSpend, totalCount,
      profitPerSub, avgCpl, bestSource, trackedCount, trackedPct,
      bestProfitPerSub, mostProfitable, worstSource,
    };
  }, [filtered]);

  // ─── Revenue map for spend history ───
  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue || 0); });
    return map;
  }, [links]);

  // ─── Media Buyers: source rows ───
  const agencyAvgCvr = useMemo(() => {
    const qualified = filtered.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const ts = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const tc = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return tc > 0 ? (ts / tc) * 100 : null;
  }, [filtered]);

  const sourceRows = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; active: number; totalSpend: number; totalLtv: number; totalProfit: number; totalClicks: number; totalSubs: number }> = {};
    filtered.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!map[src]) map[src] = { source: src, campaigns: 0, active: 0, totalSpend: 0, totalLtv: 0, totalProfit: 0, totalClicks: 0, totalSubs: 0 };
      map[src].campaigns++;
      if (l.clicks > 0) map[src].active++;
      map[src].totalSpend += Number(l.cost_total || 0);
      map[src].totalLtv += Number(l.revenue || 0);
      map[src].totalProfit += Number(l.revenue || 0) - Number(l.cost_total || 0);
      map[src].totalClicks += l.clicks || 0;
      map[src].totalSubs += l.subscribers || 0;
    });
    return Object.values(map).map(r => ({
      ...r,
      roi: r.totalSpend > 0 ? (r.totalProfit / r.totalSpend) * 100 : null,
      avgCvr: r.totalClicks > 100 ? (r.totalSubs / r.totalClicks) * 100 : null,
    }));
  }, [filtered]);

  const sortedSourceRows = useMemo(() => {
    return [...sourceRows].sort((a: any, b: any) => {
      if (a.source === "Untagged") return 1;
      if (b.source === "Untagged") return -1;
      const av = a[mediaSortKey] ?? (mediaSortKey === "source" ? "" : -Infinity);
      const bv = b[mediaSortKey] ?? (mediaSortKey === "source" ? "" : -Infinity);
      if (typeof av === "string") return mediaSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return mediaSortAsc ? av - bv : bv - av;
    });
  }, [sourceRows, mediaSortKey, mediaSortAsc]);

  const expandedCampaigns = useMemo(() => {
    if (!expandedSource) return [];
    return filtered.filter((l: any) => (l.source_tag || "Untagged") === expandedSource)
      .sort((a: any, b: any) => Number(b.revenue || 0) - Number(a.revenue || 0));
  }, [filtered, expandedSource]);

  const bestModelPerSource = useMemo(() => {
    const withSpend = filtered.filter((l: any) => Number(l.cost_total || 0) > 0 && l.source_tag && l.source_tag !== "Untagged");
    const map: Record<string, Record<string, { profit: number; subs: number; clicks: number; name: string }>> = {};
    withSpend.forEach((l: any) => {
      const src = l.source_tag;
      const aid = l.account_id;
      if (!map[src]) map[src] = {};
      if (!map[src][aid]) {
        const acc = accounts.find((a: any) => a.id === aid);
        map[src][aid] = { profit: 0, subs: 0, clicks: 0, name: acc?.display_name || l.accounts?.display_name || "?" };
      }
      map[src][aid].profit += Number(l.profit || 0);
      map[src][aid].subs += l.subscribers || 0;
      map[src][aid].clicks += l.clicks || 0;
    });
    const result: Record<string, { bestProfit: { name: string; value: number }; bestCvr: { name: string; value: number } }> = {};
    Object.entries(map).forEach(([src, models]) => {
      let bestP = { name: "", value: -Infinity };
      let bestC = { name: "", value: -Infinity };
      Object.values(models).forEach(m => {
        if (m.profit > bestP.value) bestP = { name: m.name, value: m.profit };
        const cvr = m.clicks > 0 ? (m.subs / m.clicks) * 100 : 0;
        if (cvr > bestC.value) bestC = { name: m.name, value: cvr };
      });
      result[src] = { bestProfit: bestP, bestCvr: bestC };
    });
    return result;
  }, [filtered, accounts]);

  // Expenses: breakdown data
  const linksWithSpend = useMemo(() => filtered.filter((l: any) => Number(l.cost_total || 0) > 0), [filtered]);
  const bySource = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; spend: number; ltv: number; profit: number }> = {};
    linksWithSpend.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!map[src]) map[src] = { source: src, campaigns: 0, spend: 0, ltv: 0, profit: 0 };
      map[src].campaigns++; map[src].spend += Number(l.cost_total || 0); map[src].ltv += Number(l.revenue || 0); map[src].profit += Number(l.revenue || 0) - Number(l.cost_total || 0);
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }, [linksWithSpend]);

  const byModel = useMemo(() => {
    const map: Record<string, { name: string; username: string; avatar: string | null; campaigns: number; spend: number; ltv: number; profit: number }> = {};
    linksWithSpend.forEach((l: any) => {
      const aid = l.account_id;
      if (!map[aid]) {
        const acc = accounts.find((a: any) => a.id === aid);
        map[aid] = { name: acc?.display_name || l.accounts?.display_name || "Unknown", username: acc?.username || l.accounts?.username || "", avatar: acc?.avatar_thumb_url || null, campaigns: 0, spend: 0, ltv: 0, profit: 0 };
      }
      map[aid].campaigns++; map[aid].spend += Number(l.cost_total || 0); map[aid].ltv += Number(l.revenue || 0); map[aid].profit += Number(l.revenue || 0) - Number(l.cost_total || 0);
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }, [linksWithSpend, accounts]);

  // ─── Sort Header Component ───
  const SortHeader = ({ label, sortKeyName, width, sub, primary }: { label: string; sortKeyName: SortKey; width?: string; sub?: string; primary?: boolean }) => (
    <th
      className={`h-9 px-2 text-left text-[11px] font-medium uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap ${primary ? "text-foreground font-bold" : "text-muted-foreground"}`}
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
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
    setDetailPanelLink(detailPanelLink?.id === link.id ? null : link);
  };

  const onSpendSaved = () => {
    setCostSlideIn(null);
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    toast.success("Spend saved — ROI and Profit updated");
  };

  const unattributedPct = useMemo(() => {
    const syncedAccounts = accounts.filter((a: any) => a.sync_enabled !== false);
    const accountTotalSubs = syncedAccounts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    const syncedIds = new Set(syncedAccounts.map((a: any) => a.id));
    const attributedSubs = links.filter((l: any) => syncedIds.has(l.account_id)).reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    if (accountTotalSubs === 0) return 0;
    return Math.max(0, ((accountTotalSubs - attributedSubs) / accountTotalSubs) * 100);
  }, [accounts, links]);

  // View config
  const VIEW_CONFIG: Record<ActiveView, { border: string; activeBg: string; title: string; sub: string }> = {
    tracking: { border: "border-primary", activeBg: "bg-[hsl(var(--primary)/0.06)]", title: "Tracking Links", sub: "Stats, timeline, notes" },
    expenses: { border: "border-[hsl(142_71%_45%)]", activeBg: "bg-[hsl(142_71%_45%/0.04)]", title: "Expenses", sub: "Spend, profit, ROI" },
    media: { border: "border-[hsl(263_70%_50%)]", activeBg: "bg-[hsl(263_70%_50%/0.04)]", title: "Media Buyers", sub: "Source tags, buyers" },
  };

  const SUBTITLES: Record<ActiveView, string> = {
    tracking: "All tracking links and performance data",
    expenses: "Spend, profit and cost per campaign",
    media: "Performance by traffic source",
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Campaigns</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{sorted.length.toLocaleString()} tracking links across all models</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => autoTagMutation.mutate()} disabled={autoTagMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50">
              <Wand2 className={`h-4 w-4 ${autoTagMutation.isPending ? "animate-spin" : ""}`} />
              Auto-Tag
            </button>
            <button onClick={exportCampaignsCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
        </div>

        {/* ═══ VIEW SELECTOR CARDS ═══ */}
        <div className="grid grid-cols-3 gap-3">
          {(["tracking", "expenses", "media"] as ActiveView[]).map(v => {
            const cfg = VIEW_CONFIG[v];
            const isActive = activeView === v;
            return (
              <button key={v} onClick={() => setActiveView(v)}
                className={`text-left p-3 rounded-2xl border-2 transition-all ${isActive ? `${cfg.border} ${cfg.activeBg}` : "border-border/50 bg-card hover:border-border"}`}>
                <p className="text-[12px] font-bold text-foreground">{cfg.title}</p>
                <p className="text-[10px] text-muted-foreground">{cfg.sub}</p>
              </button>
            );
          })}
        </div>

        {/* ═══ ALL 12 KPI CARDS ═══ */}
        <div className="space-y-3">
          {/* Group 1 — Tracking Links (teal border) */}
          <div className="grid grid-cols-5 gap-3">
            <KPICard borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-primary" />}
              label="Attributed LTV" value={<span className="text-primary">{fmtC(kpis.totalLtv)}</span>} sub="All tracking links"
              tooltip={{ title: "Attributed LTV", desc: "Revenue from tracking links only. Excludes organic and untracked traffic. For full agency LTV see the Dashboard." }} />
            <KPICard borderColor="hsl(var(--primary))" icon={<Activity className="h-4 w-4 text-primary" />}
              label="Active Campaigns" value={kpis.activeCampaigns.toLocaleString()} sub="Clicks in last 30 days"
              tooltip={{ title: "Active Campaigns", desc: "Campaigns with at least 1 click in the last 30 days. Dead and zero-click campaigns are excluded." }} />
            <KPICard borderColor="hsl(var(--primary))" icon={<TrendingUp className="h-4 w-4 text-primary" />}
              label="Avg CVR" value={kpis.avgCvr !== null ? `${kpis.avgCvr.toFixed(1)}%` : "—"} sub={<span className="text-primary">Agency benchmark</span>}
              tooltip={{ title: "Avg CVR", desc: "Conversion rate across links with 100+ clicks. Low CVR means the model profile or creative needs work — not a spend issue." }} />
            <KPICard borderColor="hsl(var(--primary))" icon={<Tag className="h-4 w-4 text-[hsl(var(--warning))]" />}
              label="Untagged" value={<span className={kpis.untagged > 0 ? "text-[hsl(var(--warning))]" : ""}>{kpis.untagged}</span>} sub="Need source tag"
              tooltip={{ title: "Untagged", desc: "Campaigns with no source tag. Invisible in Media Buyers view. Run Auto-Tag or assign manually." }}
              progressBar={kpis.totalCount > 0 ? ((kpis.totalCount - kpis.untagged) / kpis.totalCount) * 100 : 0} progressColor="primary" />
            <KPICard borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-[hsl(var(--warning))]" />}
              label="No Spend Set" value={<span className={kpis.noSpend > 0 ? "text-[hsl(var(--warning))]" : ""}>{kpis.noSpend}</span>} sub="ROI unknown"
              tooltip={{ title: "No Spend Set", desc: "Campaigns where ROI and Profit are unknown. Set CPL, CPC, or Fixed spend to unlock profitability data." }}
              progressBar={kpis.totalCount > 0 ? ((kpis.totalCount - kpis.noSpend) / kpis.totalCount) * 100 : 0} progressColor="warning" />
          </div>

          {/* Divider */}
          <div className="h-px bg-border" />

          {/* Group 2 — Expenses (green border) */}
          <div className="grid grid-cols-4 gap-3">
            <KPICard borderColor="hsl(142 71% 45%)" icon={<TrendingUp className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
              label="Profit/Sub" value={kpis.profitPerSub !== null
                ? <span className={`text-[16px] ${kpis.profitPerSub >= 0 ? "text-[hsl(142_71%_45%)]" : "text-destructive"}`}>{fmtC(kpis.profitPerSub)}</span>
                : "—"} sub="Per acquired subscriber"
              tooltip={{ title: "Profit/Sub", desc: "Profit generated per acquired subscriber across paid campaigns. The primary scaling metric — higher means each sub earns more than it costs." }} />
            <KPICard borderColor="hsl(142 71% 45%)" icon={<Tag className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
              label="Avg CPL" value={kpis.avgCpl !== null ? fmtC(kpis.avgCpl) : "—"} sub="Cost per subscriber"
              tooltip={{ title: "Avg CPL", desc: "Average cost to acquire one subscriber. Compare against LTV/Sub to confirm acquisition is profitable." }} />
            <KPICard borderColor="hsl(142 71% 45%)" icon={<Star className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
              label="Best Source" value={kpis.bestSource ? <span className="text-[hsl(142_71%_45%)] text-[15px]">{kpis.bestSource.name}</span> : "—"}
              sub={kpis.bestSource ? `${kpis.bestSource.roi.toLocaleString("en-US", { maximumFractionDigits: 0 })}% ROI` : "No spend data"}
              tooltip={{ title: "Best Source", desc: "Traffic source with the highest return on spend. Scale budget here first before expanding to other sources." }} />
            <KPICard borderColor="hsl(142 71% 45%)" icon={<BarChart3 className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
              label="Campaigns Tracked" value={<>{kpis.trackedCount} <span className="text-[14px] font-normal text-muted-foreground">of {kpis.totalCount.toLocaleString()}</span></>}
              sub="Have spend set" progressBar={kpis.trackedPct} progressColor="success"
              tooltip={{ title: "Campaigns Tracked", desc: "How many campaigns have spend entered. Until spend is set ROI and Profit show blank. Use CSV bulk import to fill quickly." }} />
          </div>

          {/* Divider */}
          <div className="h-px bg-border" />

          {/* Group 3 — Media Buyers (purple border) */}
          <div className="grid grid-cols-3 gap-3">
            <KPICard borderColor="hsl(263 70% 50%)" icon={<Star className="h-4 w-4 text-[hsl(263_70%_50%)]" />}
              label="Best Source by Profit/Sub"
              value={kpis.bestProfitPerSub ? <span className="text-[hsl(263_70%_50%)] text-[15px]">{kpis.bestProfitPerSub.name}</span> : "—"}
              sub={kpis.bestProfitPerSub ? `${fmtC(kpis.bestProfitPerSub.value)} profit per sub` : "No spend data"}
              tooltip={{ title: "Best Source by Profit/Sub", desc: "Traffic source delivering the highest profit per subscriber acquired. Best value per dollar spent." }} />
            <KPICard borderColor="hsl(263 70% 50%)" icon={<TrendingUp className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
              label="Most Profitable Source"
              value={kpis.mostProfitable ? <span className="text-[hsl(142_71%_45%)] text-[15px]">{kpis.mostProfitable.name}</span> : "—"}
              sub={kpis.mostProfitable ? `${fmtC(kpis.mostProfitable.value)} total profit` : "No spend data"}
              tooltip={{ title: "Most Profitable Source", desc: "Source generating the highest absolute profit. High total profit means volume AND good margins — scale it." }} />
            <KPICard borderColor="hsl(263 70% 50%)" icon={<Target className="h-4 w-4 text-[hsl(var(--warning))]" />}
              label="Worst Source"
              value={kpis.worstSource
                ? <span className={kpis.worstSource.roi < 0 ? "text-destructive text-[15px]" : "text-[hsl(var(--warning))] text-[15px]"}>{kpis.worstSource.name}</span>
                : "—"}
              sub={kpis.worstSource
                ? (kpis.worstSource.roi < 0 ? `Negative ROI — stop spend` : `${fmtP(kpis.worstSource.roi)} ROI — monitor closely`)
                : "No spend data"}
              tooltip={{ title: "Worst Source", desc: "Source with the lowest or negative ROI. If negative you are losing money on this traffic. Review or stop spend immediately." }} />
          </div>
        </div>

        {/* ═══ FILTER BAR ═══ */}
        <div className="flex flex-wrap items-center gap-2">
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
          <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">All Sources</option>
            {activeView === "expenses" && (<><option value="has_spend">Has Spend</option><option value="no_spend">No Spend</option></>)}
            {activeView === "media" && (<option value="untagged">Untagged Only</option>)}
            {sourceOptions.map((src) => (<option key={src} value={src}>{src}</option>))}
          </select>
          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
            {(["all", "active", "zero"] as ClickFilter[]).map((f) => (
              <button key={f} onClick={() => { setClickFilter(f); setPage(1); }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${clickFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "all" ? "Show All" : f === "active" ? "Active Only" : "Zero Clicks"}
              </button>
            ))}
          </div>
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
                className={`px-3 py-2 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${ageFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "all" ? "All Ages" : f === "new" ? "🟢 New" : f === "active" ? "🔵 Active" : f === "mature" ? "🟡 Mature" : "⚪ Old"}
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ageFilter === f ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* ═══ CAMPAIGN TABLE ═══ */}
        <div className="flex gap-0">
          <div className={`flex-1 min-w-0 ${detailPanelLink ? "mr-[340px]" : ""}`}>
            {isLoading ? (
              <div className="bg-card border border-border rounded-2xl p-8"><div className="space-y-3">{[...Array(8)].map((_, i) => (<div key={i} className="skeleton-shimmer h-10 rounded" />))}</div></div>
            ) : sorted.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-16 text-center">
                <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium mb-1">No tracking links found</p>
                <p className="text-sm text-muted-foreground">{searchQuery || clickFilter !== "all" || ageFilter !== "all" || accountFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                {selectedRows.size > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border-b border-border">
                    <span className="text-xs font-medium text-foreground">{selectedRows.size} selected</span>
                    <div className="relative">
                      <button onClick={() => setShowBulkTagDropdown(!showBulkTagDropdown)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/30 text-primary text-xs font-medium hover:bg-primary/10">
                        <Tag className="h-3 w-3" /> Assign tag
                      </button>
                      {showBulkTagDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-[160px] py-1">
                          {tagRules.map((rule: any) => (
                            <button key={rule.id} onClick={() => handleBulkTag(rule.tag_name)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: rule.color }} />
                              {rule.tag_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setSelectedRows(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">Showing {showStart}–{showEnd} of {sorted.length} tracking links</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 z-10" style={{ background: "#f8fafc" }}>
                      <tr className="border-b border-border">
                        <th className="h-9 px-2 w-8"><input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-border cursor-pointer" /></th>
                        <SortHeader label="Campaign" sortKeyName="campaign_name" width="200px" />
                        <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "100px" }}>Model</th>
                        <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "90px" }}>Source</th>
                        <SortHeader label="LTV" sortKeyName="revenue" width="90px" sub="Attributed" />
                        <SortHeader label="Profit" sortKeyName="profit" width="80px" />
                        <SortHeader label="Profit/Sub" sortKeyName="profit_per_sub" width="85px" primary />
                        <SortHeader label="ROI" sortKeyName="roi" width="70px" />
                        <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "80px" }}>Status</th>
                        {/* View-specific columns */}
                        {activeView === "tracking" && (
                          <>
                            <SortHeader label="Subs/Day" sortKeyName="subs_day" width="80px" />
                            <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "60px" }}>CVR</th>
                          </>
                        )}
                        {activeView === "expenses" && (
                          <>
                            <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "60px" }}>Type</th>
                            <SortHeader label="Spend" sortKeyName="cost_total" width="80px" />
                          </>
                        )}
                        {activeView === "media" && (
                          <SortHeader label="Subs/Day" sortKeyName="subs_day" width="80px" />
                        )}
                        <th className="h-9 px-2 text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "100px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((link: any) => {
                        const username = link.accounts?.username || link.accounts?.display_name || "—";
                        const modelColor = getModelColor(link.accounts?.username);
                        const initials = username !== "—" ? username.replace("@", "").slice(0, 1).toUpperCase() : "?";
                        const costTotal = Number(link.cost_total || 0);
                        const hasCost = link.cost_type && costTotal > 0;
                        const profit = Number(link.profit || 0);
                        const roi = Number(link.roi || 0);
                        const status = link.status || "NO_DATA";
                        const displayStatus = STATUS_LABELS[status] || "NO SPEND";
                        const statusStyle = STATUS_STYLES[displayStatus] || STATUS_STYLES["NO SPEND"];
                        const sourceTag = link.source_tag || null;
                        const sourceRule = tagRules.find((r: any) => r.tag_name === sourceTag);
                        const borderColor = status === "SCALE" ? "#16a34a" : (status === "KILL" || status === "DEAD") ? "#dc2626" : "transparent";
                        const isSelected = detailPanelLink?.id === link.id;

                        return (
                          <tr key={link.id}
                            className={`border-b transition-colors cursor-pointer ${isSelected ? "bg-[hsl(var(--primary)/0.06)]" : "hover:bg-[hsl(var(--primary)/0.03)]"} ${!hasCost ? "opacity-[0.85]" : ""}`}
                            style={{ borderBottomColor: "#f1f5f9", borderLeftWidth: "3px", borderLeftColor: borderColor }}
                            onClick={() => handleRowClick(link)}>
                            <td className="px-2 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                            </td>
                            <td className="px-2 py-2" style={{ maxWidth: "200px" }}>
                              <p className="font-semibold text-foreground text-[13px] truncate">{link.campaign_name || "Unnamed"}</p>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] text-muted-foreground hover:text-primary truncate block">{link.url}</a>
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white" style={{ backgroundColor: modelColor }}>{initials}</div>
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">@{username}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 relative" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => setSourceDropdownId(sourceDropdownId === link.id ? null : link.id)} className="w-full text-left">
                                {sourceTag && sourceRule ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-foreground font-medium">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sourceRule.color }} />
                                    {sourceTag}
                                  </span>
                                ) : (<span className="text-[11px] text-muted-foreground italic">Untagged</span>)}
                              </button>
                              {sourceDropdownId === link.id && (
                                <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-[160px] py-1">
                                  {tagRules.map((rule: any) => (
                                    <button key={rule.id} onClick={() => handleSetSourceTag(link.id, rule.tag_name)}
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 flex items-center gap-2">
                                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: rule.color }} />
                                      {rule.tag_name}
                                    </button>
                                  ))}
                                  <div className="border-t border-border mt-1 pt-1">
                                    <button onClick={() => handleSetSourceTag(link.id, "")} className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/50">Untagged</button>
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right"><span className="font-mono text-[12px] text-primary font-semibold">{fmtC(Number(link.revenue))}</span></td>
                            <td className="px-2 py-2 text-right font-mono text-[12px]">
                              {hasCost ? <span className={profit >= 0 ? "text-primary" : "text-destructive"}>{profit >= 0 ? "+" : ""}{fmtC(profit)}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-2 text-right">
                              {link.profitPerSub !== null ? (
                                <span className={`font-mono text-[13px] font-bold ${link.profitPerSub >= 0 ? "text-primary" : "text-destructive"}`}>
                                  {link.profitPerSub >= 0 ? "" : "-"}${Math.abs(link.profitPerSub).toFixed(2)}
                                </span>
                              ) : <span className="text-muted-foreground text-[13px] font-bold">—</span>}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-[12px]">
                              {hasCost ? <span className={roi >= 0 ? "text-primary" : "text-destructive"}>{roi.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-2">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap min-w-[70px] text-center"
                                style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>{displayStatus}</span>
                            </td>
                            {/* View-specific cells */}
                            {activeView === "tracking" && (
                              <>
                                <td className="px-2 py-2 font-mono text-[12px]">
                                  {link.subsDay !== null && link.subsDay > 0 ? <span className="text-primary font-bold">{Math.round(link.subsDay)}/day</span> : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="px-2 py-2 font-mono text-[12px]">
                                  {link.clicks > 100 && link.subscribers > 0 ? `${((link.subscribers / link.clicks) * 100).toFixed(1)}%` : <span className="text-muted-foreground">—</span>}
                                </td>
                              </>
                            )}
                            {activeView === "expenses" && (
                              <>
                                <td className="px-2 py-2">
                                  {link.cost_type ? <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${link.cost_type === "CPL" ? "bg-primary/15 text-primary" : link.cost_type === "CPC" ? "bg-[hsl(217_91%_60%/0.15)] text-[hsl(217_91%_60%)]" : "bg-[hsl(38_92%_50%/0.15)] text-[hsl(38_92%_50%)]"}`}>{link.cost_type}</span> : <span className="text-muted-foreground text-[10px]">—</span>}
                                </td>
                                <td className="px-2 py-2 text-right font-mono text-[12px]">
                                  {hasCost ? fmtC(costTotal) : <span className="text-muted-foreground">—</span>}
                                </td>
                              </>
                            )}
                            {activeView === "media" && (
                              <td className="px-2 py-2 font-mono text-[12px]">
                                {link.subsDay !== null && link.subsDay > 0 ? <span className="text-primary font-bold">{Math.round(link.subsDay)}/day</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
                            {/* Actions column */}
                            <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  title="Set Spend"
                                  onClick={() => {
                                    if (actionPanel?.link?.id === link.id && actionPanel.action === "spend") setActionPanel(null);
                                    else { setActionPanel({ link, action: "spend" }); setSpendType(link.cost_type || "CPL"); setSpendValue(link.cost_value ? String(link.cost_value) : ""); }
                                  }}
                                  className={`p-1.5 rounded-md transition-colors ${hasCost ? "text-[hsl(142_71%_45%)] hover:bg-[hsl(142_71%_45%/0.1)]" : "text-[hsl(38_92%_50%)] hover:bg-[hsl(38_92%_50%/0.1)]"}`}
                                >
                                  <DollarSign className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  title="Set Source"
                                  onClick={() => {
                                    if (actionPanel?.link?.id === link.id && actionPanel.action === "source") setActionPanel(null);
                                    else setActionPanel({ link, action: "source" });
                                  }}
                                  className={`p-1.5 rounded-md transition-colors ${sourceTag ? "hover:bg-secondary" : "text-[hsl(38_92%_50%)] hover:bg-[hsl(38_92%_50%/0.1)]"}`}
                                  style={sourceTag && sourceRule ? { color: sourceRule.color } : undefined}
                                >
                                  <Tag className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  title="Set Buyer"
                                  onClick={() => {
                                    if (actionPanel?.link?.id === link.id && actionPanel.action === "buyer") setActionPanel(null);
                                    else { setActionPanel({ link, action: "buyer" }); setBuyerName(link.media_buyer || ""); }
                                  }}
                                  className={`p-1.5 rounded-md transition-colors ${link.media_buyer ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-secondary"}`}
                                >
                                  <User className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
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

          {/* ═══ DETAIL PANEL ═══ */}
          {detailPanelLink && (
            <div className="fixed top-0 right-0 w-[340px] h-full bg-card border-l border-border shadow-[-4px_0_12px_rgba(0,0,0,0.06)] z-40 overflow-y-auto animate-slide-in-right">
              <div className="p-5 border-b border-border flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-bold text-foreground truncate max-w-[260px]">{detailPanelLink.campaign_name || "Unnamed"}</p>
                  <p className="text-[11px] text-muted-foreground">@{detailPanelLink.accounts?.username || "?"}</p>
                </div>
                <button onClick={() => setDetailPanelLink(null)} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>

              {activeView === "tracking" && (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "LTV", value: fmtC(Number(detailPanelLink.revenue || 0)), color: "text-primary" },
                      { label: "Subscribers", value: (detailPanelLink.subscribers || 0).toLocaleString(), color: "text-foreground" },
                      { label: "CVR", value: detailPanelLink.clicks > 100 ? `${((detailPanelLink.subscribers / detailPanelLink.clicks) * 100).toFixed(1)}%` : "—", color: "text-foreground" },
                      { label: "Subs/Day", value: detailPanelLink.subsDay ? `${Math.round(detailPanelLink.subsDay)}/day` : "—", color: "text-primary" },
                    ].map(s => (
                      <div key={s.label} className="bg-secondary/50 rounded-lg p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                        <p className={`text-[14px] font-bold font-mono ${s.color}`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p>Clicks: {detailPanelLink.clicks?.toLocaleString()}</p>
                    <p>Created: {detailPanelLink.created_at ? format(new Date(detailPanelLink.created_at), "MMM d, yyyy") : "—"}</p>
                    <p>Spenders: {detailPanelLink.spenders?.toLocaleString()}</p>
                  </div>
                </div>
              )}

              {activeView === "expenses" && (
                <div className="p-5 space-y-4">
                  <div className="space-y-3">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Set Spend</p>
                    <button onClick={() => { setCostSlideIn(detailPanelLink); }} className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                      {Number(detailPanelLink.cost_total || 0) > 0 ? "Edit Spend" : "Set Spend"}
                    </button>
                  </div>
                  {Number(detailPanelLink.cost_total || 0) > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Total Spend", value: fmtC(Number(detailPanelLink.cost_total)), color: "text-foreground" },
                        { label: "LTV", value: fmtC(Number(detailPanelLink.revenue || 0)), color: "text-primary" },
                        { label: "Profit", value: fmtC(Number(detailPanelLink.profit || 0)), color: Number(detailPanelLink.profit || 0) >= 0 ? "text-primary" : "text-destructive" },
                        { label: "ROI", value: `${Number(detailPanelLink.roi || 0).toFixed(1)}%`, color: Number(detailPanelLink.roi || 0) >= 0 ? "text-primary" : "text-destructive" },
                      ].map(s => (
                        <div key={s.label} className="bg-secondary/50 rounded-lg p-3">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                          <p className={`text-[14px] font-bold font-mono ${s.color}`}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeView === "media" && (
                <div className="p-5 space-y-4">
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Source Tag</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tagRules.map((rule: any) => (
                        <button key={rule.id} onClick={() => handleSetSourceTag(detailPanelLink.id, rule.tag_name)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${detailPanelLink.source_tag === rule.tag_name ? "text-white" : "hover:opacity-80"}`}
                          style={{
                            borderColor: rule.color,
                            backgroundColor: detailPanelLink.source_tag === rule.tag_name ? rule.color : "transparent",
                            color: detailPanelLink.source_tag === rule.tag_name ? "white" : rule.color,
                          }}>
                          {rule.tag_name}
                        </button>
                      ))}
                    </div>
                  </div>
                  {detailPanelLink.source_tag && (
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Other campaigns under {detailPanelLink.source_tag}</p>
                      <div className="space-y-1">
                        {filtered.filter((l: any) => l.source_tag === detailPanelLink.source_tag && l.id !== detailPanelLink.id).slice(0, 5).map((l: any) => (
                          <button key={l.id} onClick={() => setDetailPanelLink(l)} className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary/50 transition-colors">
                            <p className="text-[11px] font-medium text-foreground truncate">{l.campaign_name}</p>
                            <p className="text-[10px] text-muted-foreground">@{l.accounts?.username} · {fmtC(Number(l.revenue || 0))}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ VIEW-SPECIFIC PANELS BELOW TABLE ═══ */}
        {activeView === "expenses" && linksWithSpend.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2 mb-3"><span className="w-2 h-2 rounded-full bg-[hsl(142_71%_45%)]" /> Spend by Source</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left py-2 text-[10px] font-medium text-muted-foreground uppercase">Source</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">Spend</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">LTV</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">Profit</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">ROI</th>
                </tr></thead>
                <tbody>
                  {bySource.map((row, i) => {
                    const roi = row.spend > 0 ? (row.profit / row.spend) * 100 : 0;
                    return (
                      <tr key={i} className="border-b border-border/30 cursor-pointer hover:bg-secondary/30" onClick={() => setSourceFilter(row.source)}>
                        <td className="py-2"><TagBadge tagName={row.source} /></td>
                        <td className="py-2 text-right font-mono">{fmtC(row.spend)}</td>
                        <td className="py-2 text-right font-mono text-primary">{fmtC(row.ltv)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${row.profit >= 0 ? "text-primary" : "text-destructive"}`}>{row.profit >= 0 ? "+" : ""}{fmtC(row.profit)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${roi >= 0 ? "text-primary" : "text-destructive"}`}>{fmtP(roi)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2 mb-3"><span className="w-2 h-2 rounded-full bg-[hsl(142_71%_45%)]" /> Spend by Model</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left py-2 text-[10px] font-medium text-muted-foreground uppercase">Model</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">Spend</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">LTV</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">Profit</th>
                  <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase">ROI</th>
                </tr></thead>
                <tbody>
                  {byModel.map((row, i) => {
                    const roi = row.spend > 0 ? (row.profit / row.spend) * 100 : 0;
                    return (
                      <tr key={i} className="border-b border-border/30 cursor-pointer hover:bg-secondary/30" onClick={() => { const acc = accounts.find((a: any) => (a.username || "") === row.username); if (acc) setAccountFilter(acc.id); }}>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ backgroundColor: getModelColor(row.username) }}>{row.name[0]}</div>
                            <div><p className="text-[12px] font-medium text-foreground">{row.name}</p><p className="text-[10px] text-muted-foreground">@{row.username}</p></div>
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono">{fmtC(row.spend)}</td>
                        <td className="py-2 text-right font-mono text-primary">{fmtC(row.ltv)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${row.profit >= 0 ? "text-primary" : "text-destructive"}`}>{row.profit >= 0 ? "+" : ""}{fmtC(row.profit)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${roi >= 0 ? "text-primary" : "text-destructive"}`}>{fmtP(roi)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeView === "media" && (
          <div className="space-y-4">
            {/* Unattributed note */}
            <div className="flex items-start gap-2.5 bg-muted/50 border border-border rounded-xl px-4 py-3">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Approximately <span className="font-semibold text-foreground">{unattributedPct.toFixed(0)}%</span> of total subscribers arrive without tracking link attribution. Source performance below reflects attributed traffic only.
              </p>
            </div>

            {/* Source aggregation table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="text-sm font-bold text-foreground">Source Performance</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {([
                      { label: "Source", field: "source" as const },
                      { label: "Campaigns", field: "campaigns" as const },
                      { label: "Spend", field: "totalSpend" as const },
                      { label: "Attributed LTV", field: "totalLtv" as const },
                      { label: "Profit", field: "totalProfit" as const },
                      { label: "ROI", field: "roi" as const },
                      { label: "Avg CVR", field: "avgCvr" as const },
                    ]).map(col => (
                      <th key={col.field} onClick={() => { if (mediaSortKey === col.field) setMediaSortAsc(!mediaSortAsc); else { setMediaSortKey(col.field); setMediaSortAsc(false); } }}
                        className={`px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none ${col.field !== "source" ? "text-right" : "text-left"}`}>
                        <span className="inline-flex items-center gap-1">{col.label}
                          {mediaSortKey === col.field && (mediaSortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSourceRows.map((row) => {
                    const isExpanded = expandedSource === row.source;
                    return (
                      <React.Fragment key={row.source}>
                        <tr className={`border-b border-border hover:bg-muted/20 transition-colors cursor-pointer ${row.source === "Untagged" ? "opacity-60 italic" : ""}`}
                          onClick={() => setExpandedSource(isExpanded ? null : row.source)}>
                          <td className="px-4 py-3"><TagBadge tagName={row.source} size="md" /></td>
                          <td className="px-4 py-3 text-right font-mono">{row.campaigns}</td>
                          <td className="px-4 py-3 text-right font-mono">{row.totalSpend > 0 ? fmtC(row.totalSpend) : "—"}</td>
                          <td className="px-4 py-3 text-right font-mono text-primary font-semibold">{fmtC(row.totalLtv)}</td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold ${row.totalSpend > 0 ? (row.totalProfit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                            {row.totalSpend > 0 ? (row.totalProfit >= 0 ? "+" : "") + fmtC(row.totalProfit) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold ${row.roi !== null ? (row.roi >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                            {row.roi !== null ? fmtP(row.roi) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold ${
                            row.avgCvr !== null && agencyAvgCvr !== null
                              ? (row.avgCvr > agencyAvgCvr * 1.2 ? "text-primary" : row.avgCvr < agencyAvgCvr * 0.8 ? "text-destructive" : "text-foreground")
                              : "text-muted-foreground"
                          }`}>
                            {row.avgCvr !== null ? fmtP(row.avgCvr) : "—"}
                          </td>
                          <td className="px-4 py-3"><ChevronR className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} /></td>
                        </tr>
                        {isExpanded && expandedCampaigns.length > 0 && (
                          <tr>
                            <td colSpan={8} className="px-0 py-0">
                              <div className="bg-secondary/30 border-t border-border">
                                <table className="w-full text-xs">
                                  <thead><tr className="border-b border-border/50">
                                    <th className="px-6 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Campaign</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Model</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">LTV</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Spend</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Profit</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">ROI</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Status</th>
                                  </tr></thead>
                                  <tbody>
                                    {expandedCampaigns.slice(0, 20).map((l: any) => {
                                      const cost = Number(l.cost_total || 0);
                                      const lProfit = Number(l.profit || 0);
                                      const lRoi = Number(l.roi || 0);
                                      const hasCost = cost > 0;
                                      return (
                                        <tr key={l.id} className="border-b border-border/30">
                                          <td className="px-6 py-2 text-[12px] font-medium text-foreground truncate max-w-[200px]">{l.campaign_name || "—"}</td>
                                          <td className="px-4 py-2 text-[11px] text-muted-foreground">@{l.accounts?.username || "?"}</td>
                                          <td className="px-4 py-2 text-right font-mono text-primary">{fmtC(Number(l.revenue || 0))}</td>
                                          <td className="px-4 py-2 text-right font-mono">{hasCost ? fmtC(cost) : "—"}</td>
                                          <td className={`px-4 py-2 text-right font-mono font-semibold ${hasCost ? (lProfit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                                            {hasCost ? (lProfit >= 0 ? "+" : "") + fmtC(lProfit) : "—"}
                                          </td>
                                          <td className={`px-4 py-2 text-right font-mono font-semibold ${hasCost ? (lRoi >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                                            {hasCost ? fmtP(lRoi) : "—"}
                                          </td>
                                          <td className="px-4 py-2">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                              l.status === "SCALE" ? "bg-[hsl(142_71%_45%/0.1)] text-[hsl(142_71%_45%)]" :
                                              l.status === "WATCH" ? "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]" :
                                              l.status === "KILL" ? "bg-[hsl(0_84%_60%/0.12)] text-[hsl(0_84%_60%)]" :
                                              "bg-secondary text-muted-foreground"
                                            }`}>{l.status || "NO SPEND"}</span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                                {/* Best model for this source */}
                                {bestModelPerSource[expandedSource!] && (
                                  <div className="px-6 py-2 border-t border-border/50 flex items-center gap-6 text-[11px]">
                                    <span className="text-muted-foreground">Best Profit/Sub: <span className="text-foreground font-medium">{bestModelPerSource[expandedSource!].bestProfit.name}</span> · <span className="text-primary font-mono">{fmtC(bestModelPerSource[expandedSource!].bestProfit.value)}</span></span>
                                    <span className="text-muted-foreground">Best CVR: <span className="text-foreground font-medium">{bestModelPerSource[expandedSource!].bestCvr.name}</span> · <span className="text-primary font-mono">{fmtP(bestModelPerSource[expandedSource!].bestCvr.value)}</span></span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {sortedSourceRows.length === 0 && (
                <div className="p-12 text-center">
                  <p className="text-sm text-muted-foreground">No source tags assigned yet.</p>
                  <button onClick={() => setActiveView("tracking")} className="text-sm text-primary hover:underline mt-1">Go to Tracking Links view and tag campaigns</button>
                </div>
              )}
            </div>

            {/* Best Model per Source */}
            {Object.keys(bestModelPerSource).length > 0 && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <h3 className="text-sm font-bold text-foreground">Best Model per Source</h3>
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Source</th>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Highest Profit</th>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Highest CVR</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(bestModelPerSource).map(([src, data]) => (
                      <tr key={src} className="border-b border-border/50">
                        <td className="px-4 py-3"><TagBadge tagName={src} size="md" /></td>
                        <td className="px-4 py-3"><span className="text-foreground font-medium text-[13px]">{data.bestProfit.name}</span><span className="ml-2 text-primary text-xs font-mono">{fmtC(data.bestProfit.value)}</span></td>
                        <td className="px-4 py-3"><span className="text-foreground font-medium text-[13px]">{data.bestCvr.name}</span><span className="ml-2 text-primary text-xs font-mono">{fmtP(data.bestCvr.value)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Slide-ins */}
        {costSlideIn && <CostSettingSlideIn link={costSlideIn} onClose={() => setCostSlideIn(null)} onSaved={onSpendSaved} />}
        {selectedLink && <CampaignDetailSlideIn link={selectedLink} cost={Number(selectedLink.cost_total || 0)} onClose={() => setSelectedLink(null)} onSetCost={() => { setCostSlideIn(selectedLink); setSelectedLink(null); }} />}
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
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm" style={{ borderLeftWidth: "3px", borderLeftColor: borderColor }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">{icon}</div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <InfoDot title={tooltip.title} desc={tooltip.desc} />
      </div>
      <p className="text-[22px] font-bold font-mono text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
      {progressBar !== undefined && (
        <div className="mt-2 h-1 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{
            width: `${Math.min(100, progressBar)}%`,
            backgroundColor: progressColor === "warning" ? "hsl(var(--warning))" : progressColor === "success" ? "hsl(142 71% 45%)" : "hsl(var(--primary))"
          }} />
        </div>
      )}
    </div>
  );
}

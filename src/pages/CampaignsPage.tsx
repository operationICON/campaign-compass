import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CsvCostImportModal } from "@/components/dashboard/CsvCostImportModal";
import { TagBadge } from "@/components/TagBadge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchTrackingLinks, fetchAdSpend, deleteAdSpend, triggerSync,
  clearTrackingLinkSpend, fetchSourceTagRules, setTrackingLinkSourceTag,
  bulkSetSourceTag, fetchAccounts, fetchDailyMetrics,
} from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RefreshCw, DollarSign, TrendingUp, Star, Trash2, Download, X, Tag,
  Users, Activity, Info, BarChart3, Target, ChevronRight as ChevronR,
  Upload, Plus
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";

// ─── Types ───
type SortKey = "campaign_name" | "cost_total" | "revenue" | "profit" | "roi" | "profit_per_sub" | "created_at" | "subs_day";
type CampaignFilter = "all" | "active" | "zero" | "no_spend" | "untagged" | "SCALE" | "WATCH" | "KILL" | "DEAD";

const KPI_COLLAPSED_KEY = "campaigns_kpi_collapsed";

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

  // ─── KPI collapse state ───
  const [kpiCollapsed, setKpiCollapsed] = useState(() => {
    try { return localStorage.getItem(KPI_COLLAPSED_KEY) !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(KPI_COLLAPSED_KEY, String(kpiCollapsed)); } catch {} }, [kpiCollapsed]);

  // ─── Filter/sort state ───
  const [searchQuery, setSearchQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // ─── Selection/interaction state ───
  const [csvOpen, setCsvOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const [sourceDropdownId, setSourceDropdownId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showBulkTagDropdown, setShowBulkTagDropdown] = useState(false);
  const [spendType, setSpendType] = useState<"CPL" | "CPC" | "FIXED">("CPL");
  const [spendValue, setSpendValue] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [noteText, setNoteText] = useState("");
  const [syncLabel, setSyncLabel] = useState("Sync Now");

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
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setSyncLabel("Synced ✓");
      setTimeout(() => setSyncLabel("Sync Now"), 2000);
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
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
    if (sourceFilter !== "all") result = result.filter((l: any) => l.source_tag === sourceFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) || (l.url || "").toLowerCase().includes(q) ||
        (l.accounts?.username || "").toLowerCase().includes(q) || (l.accounts?.display_name || "").toLowerCase().includes(q)
      );
    }
    // Campaign filter
    if (campaignFilter === "active") result = result.filter((l: any) => l.isActive);
    else if (campaignFilter === "zero") result = result.filter((l: any) => l.clicks === 0);
    else if (campaignFilter === "no_spend") result = result.filter((l: any) => !l.cost_total || Number(l.cost_total) === 0);
    else if (campaignFilter === "untagged") result = result.filter((l: any) => !l.source_tag || l.source_tag === "Untagged");
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
  }, [enrichedLinks, searchQuery, campaignFilter, ageFilter, groupFilter, accountFilter, sourceFilter, accounts]);

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
  const clearAllFilters = () => { setGroupFilter("all"); setAccountFilter("all"); setSourceFilter("all"); setSearchQuery(""); setCampaignFilter("all"); setAgeFilter("all"); setPage(1); };
  const activeFilterCount = [groupFilter !== "all" ? 1 : 0, accountFilter !== "all" ? 1 : 0, sourceFilter !== "all" ? 1 : 0, campaignFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0);

  // ─── KPI Calculations ───
  const kpis = useMemo(() => {
    let scopedLinks = filtered;
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

    const withSpend = scopedLinks.filter((l: any) => Number(l.cost_total || 0) > 0);
    const expRev = withSpend.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const expSpend = withSpend.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const expSubs = withSpend.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const profitPerSub = expSpend > 0 && expSubs > 0 ? (expRev - expSpend) / expSubs : null;
    const avgCpl = expSpend > 0 && expSubs > 0 ? expSpend / expSubs : null;
    const trackedCount = withSpend.length;
    const trackedPct = totalCount > 0 ? (trackedCount / totalCount) * 100 : 0;

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

  // ─── Last synced ───
  const lastSynced = useMemo(() => {
    const synced = accounts.filter((a: any) => a.last_synced_at).map((a: any) => new Date(a.last_synced_at).getTime());
    if (synced.length === 0) return null;
    return new Date(Math.max(...synced));
  }, [accounts]);

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
    if (expandedRow === link.id) {
      setExpandedRow(null);
    } else {
      setExpandedRow(link.id);
      setSpendType(link.cost_type || "CPL");
      setSpendValue(link.cost_value ? String(link.cost_value) : "");
      setBuyerName("");
      setNoteText("");
    }
  };

  const onSpendSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    toast.success("Spend saved — ROI and Profit updated");
  };

  // KPI summary text for collapsed state
  const kpiSummary = `${fmtK(kpis.totalLtv)} LTV · ${kpis.profitPerSub !== null ? fmtC(kpis.profitPerSub) : "—"} Profit/Sub · ${kpis.untagged} untagged · ${kpis.trackedCount} with spend`;

  const modelCount = new Set(accounts.map((a: any) => a.id)).size;

  return (
    <DashboardLayout>
      <div className="space-y-5">
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
            <RefreshButton queryKeys={["tracking_links", "ad_spend", "source_tag_rules", "accounts"]} />
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : syncLabel}
            </button>
          </div>
        </div>

        {/* ═══ KPI CARDS — COLLAPSIBLE ═══ */}
        <div
          className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
          onClick={() => setKpiCollapsed(!kpiCollapsed)}
        >
          {/* Summary bar — always visible */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[12px] font-bold text-foreground shrink-0">Overview</span>
              {kpiCollapsed && (
                <span className="text-[11px] text-muted-foreground truncate">{kpiSummary}</span>
              )}
            </div>
            <button className="text-[11px] font-medium shrink-0 flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); setKpiCollapsed(!kpiCollapsed); }}>
              {kpiCollapsed ? (
                <span className="text-primary">Show metrics <ChevronDown className="inline h-3 w-3" /></span>
              ) : (
                <span className="text-muted-foreground">Hide metrics <ChevronUp className="inline h-3 w-3" /></span>
              )}
            </button>
          </div>

          {/* Expanded KPI cards */}
          {!kpiCollapsed && (
            <div className="px-4 pb-4 space-y-[10px]" onClick={(e) => e.stopPropagation()}>
              {/* Group 1 — Tracking Links (teal border) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px", alignItems: "stretch" }}>
                <KPICard borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-primary" />}
                  label="Attributed LTV" value={<span className="text-primary">{fmtC(kpis.totalLtv)}</span>} sub="All tracking links"
                  tooltip={{ title: "Attributed LTV", desc: "Revenue from tracking links only. Excludes organic and untracked traffic." }} />
                <KPICard borderColor="hsl(var(--primary))" icon={<Activity className="h-4 w-4 text-primary" />}
                  label="Active Campaigns" value={kpis.activeCampaigns.toLocaleString()} sub="Clicks in last 30 days"
                  tooltip={{ title: "Active Campaigns", desc: "Campaigns with at least 1 click in the last 30 days." }} />
                <KPICard borderColor="hsl(var(--primary))" icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  label="Avg CVR" value={kpis.avgCvr !== null ? `${kpis.avgCvr.toFixed(1)}%` : "—"} sub={<span className="text-primary">Agency benchmark</span>}
                  tooltip={{ title: "Avg CVR", desc: "Conversion rate across links with 100+ clicks." }} />
                <KPICard borderColor="hsl(var(--primary))" icon={<Tag className="h-4 w-4 text-[hsl(var(--warning))]" />}
                  label="Untagged" value={<span className={kpis.untagged > 0 ? "text-[hsl(var(--warning))]" : ""}>{kpis.untagged}</span>} sub="Need source tag"
                  tooltip={{ title: "Untagged", desc: "Campaigns with no source tag." }}
                  progressBar={kpis.totalCount > 0 ? ((kpis.totalCount - kpis.untagged) / kpis.totalCount) * 100 : 0} progressColor="primary" />
                <KPICard borderColor="hsl(var(--primary))" icon={<DollarSign className="h-4 w-4 text-[hsl(var(--warning))]" />}
                  label="No Spend Set" value={<span className={kpis.noSpend > 0 ? "text-[hsl(var(--warning))]" : ""}>{kpis.noSpend}</span>} sub="ROI unknown"
                  tooltip={{ title: "No Spend Set", desc: "Campaigns where ROI and Profit are unknown." }}
                  progressBar={kpis.totalCount > 0 ? ((kpis.totalCount - kpis.noSpend) / kpis.totalCount) * 100 : 0} progressColor="warning" />
              </div>

              <div className="h-px bg-border mx-0" style={{ margin: "10px 0" }} />

              {/* Group 2 — Expenses (green border) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", alignItems: "stretch" }}>
                <KPICard borderColor="hsl(142 71% 45%)" icon={<TrendingUp className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                  label="Profit/Sub" value={kpis.profitPerSub !== null
                    ? <span className={`text-[16px] ${kpis.profitPerSub >= 0 ? "text-[hsl(142_71%_45%)]" : "text-destructive"}`}>{fmtC(kpis.profitPerSub)}</span>
                    : "—"} sub="Per acquired subscriber"
                  tooltip={{ title: "Profit/Sub", desc: "Profit generated per acquired subscriber across paid campaigns." }} />
                <KPICard borderColor="hsl(142 71% 45%)" icon={<Tag className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                  label="Avg CPL" value={kpis.avgCpl !== null ? fmtC(kpis.avgCpl) : "—"} sub="Cost per subscriber"
                  tooltip={{ title: "Avg CPL", desc: "Average cost to acquire one subscriber." }} />
                <KPICard borderColor="hsl(142 71% 45%)" icon={<Star className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                  label="Best Source" value={kpis.bestSource ? <span className="text-[hsl(142_71%_45%)] text-[15px]">{kpis.bestSource.name}</span> : "—"}
                  sub={kpis.bestSource ? `${kpis.bestSource.roi.toLocaleString("en-US", { maximumFractionDigits: 0 })}% ROI` : "No spend data"}
                  tooltip={{ title: "Best Source", desc: "Traffic source with the highest return on spend." }} />
                <KPICard borderColor="hsl(142 71% 45%)" icon={<BarChart3 className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                  label="Campaigns Tracked" value={<>{kpis.trackedCount} <span className="text-[14px] font-normal text-muted-foreground">of {kpis.totalCount.toLocaleString()}</span></>}
                  sub="Have spend set" progressBar={kpis.trackedPct} progressColor="success"
                  tooltip={{ title: "Campaigns Tracked", desc: "How many campaigns have spend entered." }} />
              </div>

              <div className="h-px bg-border mx-0" style={{ margin: "10px 0" }} />

              {/* Group 3 — Media Buyers (purple border) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", alignItems: "stretch" }}>
                <KPICard borderColor="hsl(263 70% 50%)" icon={<Star className="h-4 w-4 text-[hsl(263_70%_50%)]" />}
                  label="Best Source by Profit/Sub"
                  value={kpis.bestProfitPerSub ? <span className="text-[hsl(263_70%_50%)] text-[15px]">{kpis.bestProfitPerSub.name}</span> : "—"}
                  sub={kpis.bestProfitPerSub ? `${fmtC(kpis.bestProfitPerSub.value)} profit per sub` : "No spend data"}
                  tooltip={{ title: "Best Source by Profit/Sub", desc: "Traffic source delivering the highest profit per subscriber acquired." }} />
                <KPICard borderColor="hsl(263 70% 50%)" icon={<TrendingUp className="h-4 w-4 text-[hsl(142_71%_45%)]" />}
                  label="Most Profitable Source"
                  value={kpis.mostProfitable ? <span className="text-[hsl(142_71%_45%)] text-[15px]">{kpis.mostProfitable.name}</span> : "—"}
                  sub={kpis.mostProfitable ? `${fmtC(kpis.mostProfitable.value)} total profit` : "No spend data"}
                  tooltip={{ title: "Most Profitable Source", desc: "Source generating the highest absolute profit." }} />
                <KPICard borderColor="hsl(263 70% 50%)" icon={<Target className="h-4 w-4 text-[hsl(var(--warning))]" />}
                  label="Worst Source"
                  value={kpis.worstSource
                    ? <span className={kpis.worstSource.roi < 0 ? "text-destructive text-[15px]" : "text-[hsl(var(--warning))] text-[15px]"}>{kpis.worstSource.name}</span>
                    : "—"}
                  sub={kpis.worstSource
                    ? (kpis.worstSource.roi < 0 ? `Negative ROI — stop spend` : `${fmtP(kpis.worstSource.roi)} ROI — monitor closely`)
                    : "No spend data"}
                  tooltip={{ title: "Worst Source", desc: "Source with the lowest or negative ROI." }} />
              </div>
            </div>
          )}
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
            {sourceOptions.map((src) => (<option key={src} value={src}>{src}</option>))}
            <option value="__untagged__">Untagged</option>
          <select value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value as CampaignFilter); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">All Campaigns</option>
            <option value="active">Active Only</option>
            <option value="zero">Zero Clicks</option>
            <option value="no_spend">No Spend Set</option>
            <option value="untagged">Untagged</option>
            <option value="SCALE">SCALE</option>
            <option value="WATCH">WATCH</option>
            <option value="KILL">KILL</option>
            <option value="DEAD">DEAD</option>
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
                className={`px-3 py-2 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${ageFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
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
                <p className="text-sm text-muted-foreground">{searchQuery || campaignFilter !== "all" || ageFilter !== "all" || accountFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}</p>
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
                        <SortHeader label="LTV" sortKeyName="revenue" width="90px" />
                        <SortHeader label="Profit" sortKeyName="profit" width="80px" />
                        <SortHeader label="Profit/Sub" sortKeyName="profit_per_sub" width="85px" primary />
                        <SortHeader label="ROI" sortKeyName="roi" width="70px" />
                        <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "80px" }}>Status</th>
                        <SortHeader label="Subs/Day" sortKeyName="subs_day" width="80px" />
                        
                        <th className="h-9 px-2 text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "28px" }}></th>
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
                        const isExpanded = expandedRow === link.id;
                        const agePill = getAgePill(link.daysSinceCreated);

                        return (
                          <React.Fragment key={link.id}>
                          <tr
                            onClick={() => handleRowClick(link)}
                            className={`border-b border-border/50 cursor-pointer transition-colors group ${isExpanded ? "bg-[hsl(var(--primary)/0.04)]" : "hover:bg-secondary/30"}`}
                          >
                            <td className="px-2 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                            </td>
                            <td className="px-2 py-2" style={{ maxWidth: "200px" }}>
                              <p className="text-[12px] font-semibold text-foreground truncate" title={link.campaign_name}>{link.campaign_name || "—"}</p>
                              <p className="text-[10px] text-muted-foreground truncate" title={link.url}>{link.url}</p>
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: modelColor }}>{initials}</span>
                                <span className="text-[11px] text-muted-foreground truncate">@{username}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 relative" onClick={(e) => { e.stopPropagation(); setSourceDropdownId(sourceDropdownId === link.id ? null : link.id); }}>
                              <button className="text-left">
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
                            <td className="px-2 py-2 font-mono text-[12px]">
                              {link.subsDay !== null && link.subsDay > 0 ? <span className="text-primary font-bold">{Math.round(link.subsDay)}/day</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-2 w-7 text-center">
                              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            </td>
                          </tr>
                          {/* Inline detail row */}
                          {isExpanded && (() => {
                            const el = link;
                            const subsEl = el.subscribers || 0;
                            const clicksEl = el.clicks || 0;
                            const revEl = Number(el.revenue || 0);
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
                                await supabase.from("tracking_links").update({
                                  cost_type: spendType, cost_value: numVal, cost_total: previewCost,
                                  cvr, cpc_real: cpcReal, cpl_real: cplReal, arpu,
                                  profit: previewProfit, roi: previewRoi, status: newStatus,
                                }).eq("id", el.id);
                                await supabase.from("ad_spend").insert({
                                  campaign_id: el.campaign_id, traffic_source: el.source || "direct",
                                  amount: previewCost, date: new Date().toISOString().split("T")[0],
                                  notes: `${spendType} @ $${numVal.toFixed(2)}`, account_id: el.account_id,
                                });
                                queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                                queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
                                toast.success("Spend saved");
                              } catch (err: any) { toast.error(err.message); }
                            };
                            const clearSpendInline = async () => {
                              try {
                                await clearTrackingLinkSpend(el.id, el.campaign_id);
                                queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                                toast.success("Spend cleared");
                              } catch (err: any) { toast.error(err.message); }
                            };
                            const saveNoteInline = async () => {
                              if (!noteText.trim()) return;
                              try {
                                await supabase.from("manual_notes").insert({
                                  campaign_id: el.campaign_id, campaign_name: el.campaign_name,
                                  account_id: el.account_id, content: noteText.trim(),
                                });
                                toast.success("Note saved");
                                setNoteText("");
                              } catch (err: any) { toast.error(err.message); }
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
                                            { l: "Subs/Day", v: el.subsDay ? `${Math.round(el.subsDay)}/day` : "—", c: el.subsDay ? "text-primary" : "" },
                                            { l: "LTV", v: fmtC(revEl), c: "text-primary font-bold" },
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
                                      {/* Col 3: Source + Buyer */}
                                      <div>
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Source</p>
                                          <span className={`w-1.5 h-1.5 rounded-full ${el.source_tag ? "bg-primary" : "bg-[hsl(38_92%_50%)]"}`} />
                                          <span className="text-[10px] text-muted-foreground">{el.source_tag || "Untagged"}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1 mb-3">
                                          {tagRules.map((rule: any) => (
                                            <button key={rule.id} onClick={(e) => { e.stopPropagation(); handleSetSourceTag(el.id, rule.tag_name); }}
                                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${el.source_tag === rule.tag_name ? "text-white" : "hover:opacity-80"}`}
                                              style={{ borderColor: rule.color, backgroundColor: el.source_tag === rule.tag_name ? rule.color : "transparent", color: el.source_tag === rule.tag_name ? "white" : rule.color }}>
                                              {rule.tag_name}
                                            </button>
                                          ))}
                                        </div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Media buyer</p>
                                        <div className="flex gap-1.5">
                                          <input type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)}
                                            placeholder="e.g. James, Saba..." onClick={(e) => e.stopPropagation()}
                                            className="flex-1 px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" />
                                          <button onClick={async (e) => {
                                            e.stopPropagation();
                                            if (!buyerName.trim()) return;
                                            try {
                                              await supabase.from("manual_notes").insert({ campaign_id: el.campaign_id, campaign_name: el.campaign_name, account_id: el.account_id, content: `Media buyer: ${buyerName}` });
                                              toast.success("Buyer saved"); setBuyerName("");
                                            } catch (err: any) { toast.error(err.message); }
                                          }} className="px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90">Save</button>
                                        </div>
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
    <div className="bg-card border border-border rounded-2xl shadow-sm" style={{ borderLeftWidth: "3px", borderLeftColor: borderColor, padding: "14px 16px" }}>
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

import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import {
  fetchTrackingLinks, fetchAdSpend, deleteAdSpend, triggerSync, clearTrackingLinkSpend,
  fetchSourceTagRules, setTrackingLinkSourceTag, bulkSetSourceTag, fetchAccounts
} from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RefreshCw, DollarSign, TrendingUp, Star, Trash2, Download, Pencil, X, Tag,
  Users, Wand2, Activity
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortKey = "campaign_name" | "cost_total" | "revenue" | "profit" | "roi" | "profit_per_sub" | "created_at" | "subs_day";
type ClickFilter = "all" | "active" | "zero";

const MODEL_COLORS: Record<string, string> = {
  "jessie_ca_xo": "#0891b2",
  "zoey.skyy": "#7c3aed",
  "miakitty.ts": "#ec4899",
  "ella_cherryy": "#f59e0b",
  "aylin_bigts": "#ef4444",
};

function getModelColor(username: string | null): string {
  if (!username) return "#94a3b8";
  const key = username.replace("@", "").toLowerCase();
  return MODEL_COLORS[key] || "#94a3b8";
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  SCALE: { bg: "#dcfce7", text: "#16a34a" },
  WATCH: { bg: "#dbeafe", text: "#0891b2" },
  LOW: { bg: "#fef9c3", text: "#854d0e" },
  KILL: { bg: "#fee2e2", text: "#dc2626" },
  DEAD: { bg: "#f3f4f6", text: "#6b7280" },
  "NO SPEND": { bg: "#f9fafb", text: "#94a3b8" },
  NO_DATA: { bg: "#f9fafb", text: "#94a3b8" },
};

const STATUS_LABELS: Record<string, string> = {
  SCALE: "SCALE", WATCH: "WATCH", LOW: "LOW", KILL: "KILL", DEAD: "DEAD",
  "NO SPEND": "NO SPEND", NO_DATA: "NO SPEND",
};

function getAgePill(days: number): { label: string; bg: string; text: string } {
  if (days <= 30) return { label: "New", bg: "#dcfce7", text: "#16a34a" };
  if (days <= 90) return { label: "Active", bg: "#dbeafe", text: "#2563eb" };
  if (days <= 180) return { label: "Mature", bg: "#fef9c3", text: "#854d0e" };
  return { label: "Old", bg: "#f3f4f6", text: "#6b7280" };
}

const GROUP_MAP: Record<string, string[]> = {
  Female: ["jessie_ca_xo", "zoey.skyy", "ella_cherryy"],
  Trans: ["miakitty.ts", "aylin_bigts"],
};

export default function TrackingLinksTab() {
  const queryClient = useQueryClient();
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
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const [clearConfirmId, setClearConfirmId] = useState<string | null>(null);
  const [sourceDropdownId, setSourceDropdownId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showBulkTagDropdown, setShowBulkTagDropdown] = useState(false);

  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: adSpendData = [] } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: tagRules = [] } = useQuery({ queryKey: ["source_tag_rules"], queryFn: fetchSourceTagRules });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

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

  const toggleSelectRow = (id: string) => {
    setSelectedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const exportCampaignsCsv = useCallback(() => {
    const header = "campaign_name,account_username,clicks,subscribers,ltv,spend,profit,profit_per_sub,roi,status";
    const rows = links.map((l: any) => {
      const cn = (l.campaign_name || "").replace(/,/g, " ");
      const un = (l.accounts?.username || "").replace(/,/g, " ");
      const subs = l.subscribers || 0;
      const profit = Number(l.profit || 0);
      const profitPerSub = subs > 0 && Number(l.cost_total || 0) > 0 ? (profit / subs).toFixed(2) : "";
      return `${cn},${un},${l.clicks || 0},${subs},${Number(l.revenue || 0).toFixed(2)},${Number(l.cost_total || 0).toFixed(2)},${profit.toFixed(2)},${profitPerSub},${Number(l.roi || 0).toFixed(1)},${l.status || "NO_DATA"}`;
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `campaigns_export_${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${links.length} campaigns`);
  }, [links]);

  const deleteSpendMutation = useMutation({
    mutationFn: deleteAdSpend,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend deleted"); },
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(undefined, true, (msg) => { toast.info(msg, { id: 'sync-progress' }); }),
    onSuccess: (data) => {
      const count = data?.accounts_synced ?? 0;
      toast.success(`Sync complete — ${count} accounts synced`, { id: 'sync-progress' });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
  });

  // KPI calculations
  const kpis = useMemo(() => {
    let scopedLinks = links;
    if (groupFilter !== "all") {
      const groupUsernames = GROUP_MAP[groupFilter] || [];
      const groupAccountIds = accounts.filter((a: any) => groupUsernames.includes(a.username)).map((a: any) => a.id);
      scopedLinks = scopedLinks.filter((l: any) => groupAccountIds.includes(l.account_id));
    }
    if (accountFilter !== "all") scopedLinks = scopedLinks.filter((l: any) => l.account_id === accountFilter);

    const totalLtv = scopedLinks.reduce((sum: number, l: any) => sum + Number(l.revenue || 0), 0);
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

    return { totalLtv, activeCampaigns, avgCvr, untagged };
  }, [links, groupFilter, accountFilter, accounts]);

  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue || 0); });
    return map;
  }, [links]);

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
      return { ...l, isZeroClicksStale: l.clicks === 0 && daysSinceCreated >= 3, isActive, daysSinceActivity, subsDay, daysSinceCreated, profitPerSub };
    });
  }, [links, manualOverrides]);

  const accountOptions = useMemo(() => {
    return accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name })).sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));
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

  const filtered = useMemo(() => {
    let result = enrichedLinks;
    if (groupFilter !== "all") {
      const groupUsernames = GROUP_MAP[groupFilter] || [];
      const groupAccountIds = accounts.filter((a: any) => groupUsernames.includes(a.username)).map((a: any) => a.id);
      result = result.filter((l: any) => groupAccountIds.includes(l.account_id));
    }
    if (accountFilter !== "all") result = result.filter((l: any) => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter((l: any) => !l.source_tag || l.source_tag === "Untagged");
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
        if (!l.created_at) return false;
        const days = differenceInDays(new Date(), new Date(l.created_at));
        if (ageFilter === "new") return days <= 30;
        if (ageFilter === "active") return days > 30 && days <= 90;
        if (ageFilter === "mature") return days > 90 && days <= 180;
        if (ageFilter === "old") return days > 180;
        return true;
      });
    }
    return result;
  }, [enrichedLinks, searchQuery, clickFilter, ageFilter, groupFilter, accountFilter, sourceFilter, accounts]);

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

  const toggleSelectAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((l: any) => l.id)));
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const toggleActiveOverride = (id: string, currentActive: boolean) => {
    setManualOverrides((prev) => ({ ...prev, [id]: !currentActive }));
  };

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
          {sortKey === sortKeyName ? (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />) : (<ChevronDown className="h-3 w-3 opacity-30" />)}
        </span>
        {sub && <span className="text-[9px] font-normal text-muted-foreground normal-case tracking-normal">{sub}</span>}
      </span>
    </th>
  );

  const handleRowClick = (link: any) => { setExpandedRow(expandedRow === link.id ? null : link.id); };

  const activeFilterCount = [groupFilter !== "all" ? 1 : 0, accountFilter !== "all" ? 1 : 0, sourceFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0);
  const clearAllFilters = () => { setGroupFilter("all"); setAccountFilter("all"); setSourceFilter("all"); setSearchQuery(""); setClickFilter("all"); setAgeFilter("all"); setPage(1); };

  return (
    <div className="space-y-5">
      {/* Action bar */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={exportCampaignsCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-all">
          <Download className="h-4 w-4" /> Export
        </button>
        <button onClick={() => syncMutation.mutate(undefined)} disabled={syncMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 hero-glow gradient-bg hover:opacity-90">
          <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Attributed LTV */}
        <div className="bg-card border border-border rounded-2xl p-5 card-hover hero-glow" style={{ background: "linear-gradient(135deg, hsl(var(--card)), hsl(var(--primary) / 0.06))" }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-4 w-4 text-primary" /></div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Attributed LTV</span>
          </div>
          <p className="text-[28px] font-bold font-mono text-primary">{fmtC(kpis.totalLtv)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Attributed</p>
        </div>
        {/* Active Campaigns */}
        <div className="bg-card border border-border rounded-2xl p-5 card-hover">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Activity className="h-4 w-4 text-primary" /></div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Campaigns</span>
          </div>
          <p className="text-[28px] font-bold font-mono text-foreground">{kpis.activeCampaigns.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Clicks in last 30 days</p>
        </div>
        {/* Avg CVR */}
        <div className="bg-card border border-border rounded-2xl p-5 card-hover">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-primary" /></div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg CVR</span>
          </div>
          <p className="text-[28px] font-bold font-mono text-foreground">{kpis.avgCvr !== null ? `${kpis.avgCvr.toFixed(1)}%` : "—"}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Agency benchmark</p>
        </div>
        {/* Untagged Campaigns */}
        <div className="bg-card border border-border rounded-2xl p-5 card-hover">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center"><Tag className="h-4 w-4 text-muted-foreground" /></div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Untagged Campaigns</span>
          </div>
          <p className={`text-[28px] font-bold font-mono ${kpis.untagged > 0 ? "text-[hsl(38_92%_50%)]" : "text-foreground"}`}>{kpis.untagged.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Need source tag</p>
        </div>
      </div>

      {/* Filter bar — Row 1 */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={groupFilter} onChange={(e) => { setGroupFilter(e.target.value); setAccountFilter("all"); setPage(1); }}
          className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
          <option value="all">All Groups</option>
          <option value="Female">Female</option>
          <option value="Trans">Trans</option>
        </select>
        <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
          <option value="all">All Accounts</option>
          {filteredAccountOptions.map((acc: any) => (<option key={acc.id} value={acc.id}>{acc.display_name} (@{acc.username})</option>))}
        </select>
        <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
          <option value="all">All Sources</option>
          <option value="untagged">Untagged</option>
          {sourceOptions.map((src) => (<option key={src} value={src}>{src}</option>))}
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-colors" />
        </div>
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
            <span className="px-1.5 py-0.5 rounded-full bg-muted text-[10px] font-bold">{activeFilterCount}</span>
            filters · <X className="h-3 w-3" /> clear
          </button>
        )}
      </div>

      {/* Age pills */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-lg overflow-hidden w-fit">
        {(["all", "new", "active", "mature", "old"] as const).map((f) => {
          const count = f === "all" ? enrichedLinks.length : enrichedLinks.filter((l: any) => {
            if (!l.created_at) return false;
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

      {/* Table */}
      {isLoading ? (
        <div className="bg-card border border-border rounded-2xl p-8">
          <div className="space-y-3">{[...Array(8)].map((_, i) => (<div key={i} className="skeleton-shimmer h-10 rounded" />))}</div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-16 text-center">
          <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium mb-1">No tracking links found</p>
          <p className="text-sm text-muted-foreground">
            {searchQuery || clickFilter !== "all" || ageFilter !== "all" || accountFilter !== "all" || groupFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}
          </p>
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
                  <th className="h-9 px-2 w-8">
                    <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                  </th>
                  <SortHeader label="Campaign" sortKeyName="campaign_name" width="220px" />
                  <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "110px" }}>Model</th>
                  <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "100px" }}>Source</th>
                  <th className="h-9 px-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "70px" }}>Subs</th>
                  <SortHeader label="Subs/Day" sortKeyName="subs_day" width="85px" />
                  <SortHeader label="LTV" sortKeyName="revenue" width="90px" sub="Attributed" />
                  <SortHeader label="Spend" sortKeyName="cost_total" width="90px" />
                  <SortHeader label="Profit" sortKeyName="profit" width="85px" />
                  <SortHeader label="Profit/Sub" sortKeyName="profit_per_sub" width="90px" sub="LTV - CPL" primary />
                  <SortHeader label="ROI" sortKeyName="roi" width="75px" />
                  <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "75px" }}>LTV Ratio</th>
                  <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "90px", minWidth: "90px" }}>Status</th>
                  <SortHeader label="Created" sortKeyName="created_at" width="95px" />
                  <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "80px" }}>Active</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((link: any) => {
                  const username = link.accounts?.username || link.accounts?.display_name || "—";
                  const modelColor = getModelColor(link.accounts?.username);
                  const initials = (username !== "—" ? username.replace("@", "").slice(0, 1).toUpperCase() : "?");
                  const costTotal = Number(link.cost_total || 0);
                  const hasCost = link.cost_type && costTotal > 0;
                  const profit = Number(link.profit || 0);
                  const roi = Number(link.roi || 0);
                  const cplReal = Number(link.cpl_real || 0);
                  const status = link.status || "NO_DATA";
                  const displayStatus = STATUS_LABELS[status] || "NO SPEND";
                  const statusStyle = STATUS_STYLES[displayStatus] || STATUS_STYLES["NO SPEND"];
                  const sourceTag = link.source_tag || null;
                  const sourceRule = tagRules.find((r: any) => r.tag_name === sourceTag);
                  const daysOld = link.daysSinceCreated ?? null;
                  const agePill = daysOld !== null ? getAgePill(daysOld) : null;
                  const isExpanded = expandedRow === link.id;
                  const noSpendOpacity = !hasCost ? "opacity-[0.85]" : "";
                  const borderColor = status === "SCALE" ? "#16a34a" : (status === "KILL" || status === "DEAD") ? "#dc2626" : "transparent";

                  return (
                    <React.Fragment key={link.id}>
                      <tr
                        className={`border-b transition-colors cursor-pointer hover:border-l-primary ${noSpendOpacity}`}
                        style={{ borderBottomColor: "#f1f5f9", borderLeftWidth: "3px", borderLeftColor: borderColor }}
                        onClick={() => handleRowClick(link)}
                      >
                        <td className="px-2 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                        </td>
                        <td className="px-2 py-2" style={{ maxWidth: "220px", minWidth: "220px" }}>
                          <div className="min-w-0 overflow-hidden">
                            <p className="font-semibold text-foreground text-[13px] truncate leading-tight">{link.campaign_name || "Unnamed"}</p>
                            <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                              className="text-[10px] text-muted-foreground hover:text-primary truncate block">{link.url}</a>
                          </div>
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
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">Untagged</span>
                            )}
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
                        <td className="px-2 py-2 text-right font-mono text-[12px] text-foreground">{(link.subscribers || 0).toLocaleString()}</td>
                        <td className="px-2 py-2 font-mono text-[12px]">
                          {link.subsDay !== null && link.subsDay > 0 ? (
                            <Tooltip><TooltipTrigger asChild><span className="text-primary font-bold cursor-default">{Math.round(link.subsDay)}/day</span></TooltipTrigger>
                              <TooltipContent><p className="text-xs">{link.subscribers} subs over {link.daysSinceCreated}d = {link.subsDay?.toFixed(1)}/day</p></TooltipContent></Tooltip>
                          ) : link.subsDay === 0 || (link.subsDay !== null && link.subsDay === 0) ? (
                            <span className="text-muted-foreground">0/day</span>
                          ) : (<span className="text-muted-foreground">—</span>)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <span className="font-mono text-[12px] text-primary font-semibold">{fmtC(Number(link.revenue))}</span>
                          <span className="block text-[10px] text-muted-foreground">Attributed</span>
                        </td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          {hasCost ? (
                            clearConfirmId === link.id ? (
                              <span className="inline-flex items-center gap-1 text-[11px]">
                                <span className="text-muted-foreground">Clear?</span>
                                <button onClick={async () => { try { await clearTrackingLinkSpend(link.id, link.campaign_id); queryClient.invalidateQueries({ queryKey: ["tracking_links"] }); queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend cleared"); } catch {} setClearConfirmId(null); }} className="text-destructive font-semibold hover:underline">Yes</button>
                                <button onClick={() => setClearConfirmId(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-foreground">
                                {fmtC(costTotal)}
                                <span className="px-1 py-0 rounded text-[9px] font-semibold bg-muted text-muted-foreground">{link.cost_type}</span>
                                <button onClick={() => setCostSlideIn(link)} className="hover:text-primary transition-colors"><Pencil className="h-2.5 w-2.5 text-muted-foreground" /></button>
                                <button onClick={() => setClearConfirmId(link.id)} className="hover:text-destructive transition-colors"><X className="h-3 w-3 text-muted-foreground" /></button>
                              </span>
                            )
                          ) : (
                            <button onClick={() => setCostSlideIn(link)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/10 transition-colors h-7">
                              <Pencil className="h-3 w-3" /> Set
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[12px]">
                          {hasCost ? (<span className={profit >= 0 ? "text-primary" : "text-destructive"}>{profit >= 0 ? "+" : ""}{fmtC(profit)}</span>) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {link.profitPerSub !== null ? (
                            <span className={`font-mono text-[14px] font-bold ${link.profitPerSub >= 0 ? "text-primary" : "text-destructive"}`}>
                              {link.profitPerSub >= 0 ? "" : "-"}${Math.abs(link.profitPerSub).toFixed(2)}
                            </span>
                          ) : <span className="text-muted-foreground text-[14px] font-bold">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[12px]">
                          {hasCost ? (<span className={roi >= 0 ? "text-primary" : "text-destructive"}>{roi.toFixed(1)}%</span>) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-2 font-mono text-[12px]">
                          {(() => {
                            if (!hasCost || cplReal <= 0) return <span className="text-muted-foreground">—</span>;
                            const ltvPerSub = (link.subscribers || 0) > 0 ? Number(link.revenue || 0) / link.subscribers : 0;
                            const ratio = ltvPerSub / cplReal;
                            const color = ratio >= 2 ? "text-primary" : ratio >= 1 ? "text-[hsl(38_92%_50%)]" : "text-destructive";
                            return <span className={`font-semibold ${color}`}>{ratio.toFixed(1)}x</span>;
                          })()}
                        </td>
                        <td className="px-2 py-2">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap min-w-[80px] text-center"
                            style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>{displayStatus}</span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-col">
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">{link.created_at ? format(new Date(link.created_at), "MMM d, yyyy") : "—"}</span>
                            {agePill && (<span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold w-fit" style={{ backgroundColor: agePill.bg, color: agePill.text }}>{agePill.label}</span>)}
                          </div>
                        </td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <Tooltip><TooltipTrigger asChild>
                            <button onClick={() => toggleActiveOverride(link.id, link.isActive)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${link.isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
                              {link.isActive ? "Active" : "Inactive"}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Last activity: {link.daysSinceActivity < 999 ? `${link.daysSinceActivity} days ago` : "Unknown"}</p></TooltipContent></Tooltip>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderBottomColor: "#f1f5f9" }}>
                          <td colSpan={16} className="px-4 py-3 bg-secondary/30">
                            <div className="flex flex-wrap items-center gap-6 text-[12px]">
                              <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[300px]">{link.url}</a>
                              <span className="text-muted-foreground">Clicks: <span className="text-foreground font-medium">{link.clicks?.toLocaleString()}</span></span>
                              <span className="text-muted-foreground">Total Subs: <span className="text-foreground font-medium">{link.subscribers?.toLocaleString()}</span></span>
                              <span className="text-muted-foreground">LTV/Sub: <span className="text-foreground font-medium">${Number(link.arpu || 0).toFixed(2)}</span></span>
                              <span className="text-muted-foreground">Spenders: <span className="text-foreground font-medium">{link.spenders?.toLocaleString()}</span></span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">Showing {showStart}–{showEnd} of {sorted.length} tracking links</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Rows:</span>
                {[10, 25, 50, 100].map((n) => (
                  <button key={n} onClick={() => { setPerPage(n); setPage(1); }}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${perPage === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>{n}</button>
                ))}
              </div>
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
                      className={`w-8 h-8 rounded text-xs font-medium transition-colors ${pageNum === safePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>{pageNum}</button>
                  );
                })}
                <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Spend History */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Spend History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">All recorded spend entries</p>
        </div>
        {adSpendData.length === 0 ? (
          <div className="p-10 text-center">
            <DollarSign className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No spend recorded</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border" style={{ background: "#f8fafc" }}>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Campaign</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Spend Type</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">LTV</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Profit</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                  <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10">Clear</th>
                </tr>
              </thead>
              <tbody>
                {adSpendData.map((entry: any) => {
                  const rev = revenueMap[entry.campaign_id] || 0;
                  const amt = Number(entry.amount || 0);
                  const entryProfit = rev - amt;
                  const entryRoi = amt > 0 ? ((rev - amt) / amt) * 100 : null;
                  const spendType = entry.notes?.match(/^(CPL|CPC|FIXED)/)?.[1] || entry.spend_type || "—";
                  const spendTypeBg = spendType === "CPL" ? "#dbeafe" : spendType === "CPC" ? "#fef9c3" : spendType === "FIXED" ? "#f3e8ff" : "#f3f4f6";
                  const spendTypeColor = spendType === "CPL" ? "#2563eb" : spendType === "CPC" ? "#854d0e" : spendType === "FIXED" ? "#7c3aed" : "#6b7280";
                  return (
                    <tr key={entry.id} className="border-b hover:bg-secondary/20 transition-colors" style={{ borderBottomColor: "#f1f5f9" }}>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{entry.date ? format(new Date(entry.date), "MMM d, yyyy") : "—"}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground font-medium">{entry.campaigns?.name || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: spendTypeBg, color: spendTypeColor }}>{spendType}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[13px] text-foreground">{fmtC(amt)}</td>
                      <td className="px-4 py-2.5 font-mono text-[13px] text-primary">{fmtC(rev)}</td>
                      <td className="px-4 py-2.5 font-mono text-[13px]">
                        {amt > 0 ? (<span className={entryProfit >= 0 ? "text-primary" : "text-destructive"}>{entryProfit >= 0 ? "+" : ""}{fmtC(entryProfit)}</span>) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[13px]">
                        {entryRoi !== null ? (<span className={entryRoi >= 0 ? "text-primary" : "text-destructive"}>{entryRoi.toFixed(1)}%</span>) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => deleteSpendMutation.mutate(entry.id)} disabled={deleteSpendMutation.isPending} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {costSlideIn && <CostSettingSlideIn link={costSlideIn} onClose={() => setCostSlideIn(null)} onSaved={() => { setCostSlideIn(null); queryClient.invalidateQueries({ queryKey: ["tracking_links"] }); queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend saved — ROI and Profit updated"); }} />}
      {selectedLink && <CampaignDetailSlideIn link={selectedLink} cost={Number(selectedLink.cost_total || 0)} onClose={() => setSelectedLink(null)} onSetCost={() => { setCostSlideIn(selectedLink); setSelectedLink(null); }} />}
    </div>
  );
}

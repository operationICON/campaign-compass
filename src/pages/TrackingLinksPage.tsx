import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import {
  fetchTrackingLinks, fetchAdSpend, deleteAdSpend, triggerSync, clearTrackingLinkSpend,
  fetchSourceTagRules, setTrackingLinkSourceTag, bulkSetSourceTag, runAutoTag
} from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RefreshCw, DollarSign, TrendingUp, BarChart3, Trash2, Download, Pencil, X, Target, Wand2
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortKey = "campaign_name" | "cost_total" | "revenue" | "profit" | "roi" | "cpl_real" | "created_at" | "subs_day";
type ClickFilter = "all" | "active" | "zero";

const ACCOUNT_COLORS: Record<string, { bg: string; text: string }> = {
  "jessie_ca_xo": { bg: "bg-[hsl(24_95%_53%/0.15)]", text: "text-[hsl(24_95%_53%)]" },
  "miakitty.ts": { bg: "bg-[hsl(0_72%_51%/0.15)]", text: "text-[hsl(0_72%_51%)]" },
  "zoey.skyy": { bg: "bg-[hsl(40_96%_53%/0.15)]", text: "text-[hsl(40_96%_53%)]" },
  "ella_cherryy": { bg: "bg-[hsl(15_80%_45%/0.15)]", text: "text-[hsl(15_80%_45%)]" },
  "aylin_bigts": { bg: "bg-[hsl(30_75%_40%/0.15)]", text: "text-[hsl(30_75%_40%)]" },
};

function getAccountColor(username: string | null) {
  if (!username) return { bg: "bg-secondary", text: "text-muted-foreground" };
  const key = username.replace("@", "").toLowerCase();
  return ACCOUNT_COLORS[key] || { bg: "bg-secondary", text: "text-muted-foreground" };
}

function getCampaignInitials(name: string | null) {
  if (!name) return "??";
  const cleaned = name.replace(/^[^a-zA-Z0-9]+/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

const STATUS_STYLES: Record<string, string> = {
  SCALE: "bg-[hsl(142_71%_45%/0.1)] text-[hsl(142_71%_45%)]",
  WATCH: "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]",
  LOW: "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]",
  KILL: "bg-[hsl(0_84%_60%/0.12)] text-[hsl(0_84%_60%)]",
  DEAD: "bg-[hsl(0_72%_51%/0.1)] text-[hsl(0_72%_51%)]",
  "No Spend": "bg-secondary text-muted-foreground",
  NO_DATA: "bg-secondary text-muted-foreground",
};

const STATUS_EMOJI: Record<string, string> = {
  SCALE: "🟢", WATCH: "🟡", LOW: "🟠", KILL: "🔴", DEAD: "💀", "No Spend": "⚪", NO_DATA: "⚪",
};

function getAgePillStyle(days: number) {
  if (days <= 30) return "bg-[hsl(142_71%_45%/0.15)] text-[hsl(142_71%_45%)]";
  if (days <= 90) return "bg-[hsl(217_91%_60%/0.15)] text-[hsl(217_91%_60%)]";
  if (days <= 180) return "bg-[hsl(38_92%_50%/0.15)] text-[hsl(38_92%_50%)]";
  return "bg-secondary text-muted-foreground";
}

export default function TrackingLinksPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [clickFilter, setClickFilter] = useState<ClickFilter>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
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

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: () => fetchTrackingLinks(),
  });
  const { data: adSpendData = [] } = useQuery({
    queryKey: ["ad_spend"],
    queryFn: () => fetchAdSpend(),
  });
  const { data: tagRules = [] } = useQuery({
    queryKey: ["source_tag_rules"],
    queryFn: fetchSourceTagRules,
  });

  const autoTagMutation = useMutation({
    mutationFn: runAutoTag,
    onSuccess: (data: any) => {
      toast.success(`Auto-tagged ${data.tagged} campaigns. ${data.untagged} remain untagged.`);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    },
    onError: (err: any) => toast.error(`Auto-tag failed: ${err.message}`),
  });

  const handleSetSourceTag = async (linkId: string, tag: string) => {
    try {
      await setTrackingLinkSourceTag(linkId, tag);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success(`Tagged as "${tag}"`);
      setSourceDropdownId(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleBulkTag = async (tag: string) => {
    try {
      await bulkSetSourceTag(Array.from(selectedRows), tag);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success(`Tagged ${selectedRows.size} campaigns as "${tag}"`);
      setSelectedRows(new Set());
      setShowBulkTagDropdown(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === paginated.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(paginated.map((l: any) => l.id)));
    }
  };


  const exportCampaignsCsv = useCallback(() => {
    const header = "campaign_name,account_username,clicks,subscribers,ltv,current_spend_type,current_spend_value";
    const rows = links.map((l: any) => {
      const cn = (l.campaign_name || "").replace(/,/g, " ");
      const un = (l.accounts?.username || "").replace(/,/g, " ");
      return `${cn},${un},${l.clicks || 0},${l.subscribers || 0},${Number(l.revenue || 0).toFixed(2)},${l.cost_type || ""},${l.cost_value ?? ""}`;
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaigns_export_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${links.length} campaigns`);
  }, [links]);

  const deleteSpendMutation = useMutation({
    mutationFn: deleteAdSpend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      toast.success("Spend deleted");
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(undefined, true, (msg) => {
      toast.info(msg, { id: 'sync-progress' });
    }),
    onSuccess: (data) => {
      const count = data?.accounts_synced ?? 0;
      toast.success(`Sync complete — ${count} accounts synced`, { id: 'sync-progress' });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
  });

  const totalSpent = useMemo(() => links.reduce((sum: number, l: any) => sum + Number(l.cost_total || 0), 0), [links]);
  const totalLtv = useMemo(() => links.reduce((sum: number, l: any) => sum + Number(l.revenue || 0), 0), [links]);
  const blendedRoi = useMemo(() => {
    if (totalSpent <= 0) return null;
    return ((totalLtv - totalSpent) / totalSpent) * 100;
  }, [totalSpent, totalLtv]);

  // Agency benchmark CVR: avg CVR across links with clicks > 100
  const agencyAvgCvr = useMemo(() => {
    const qualified = links.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const totalSubs = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalClicks = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return totalClicks > 0 ? (totalSubs / totalClicks) * 100 : null;
  }, [links]);

  const getCvrColor = (cvr: number) => {
    if (agencyAvgCvr === null) return "text-foreground";
    if (cvr > agencyAvgCvr * 1.2) return "text-primary";
    if (cvr < agencyAvgCvr * 0.8) return "text-destructive";
    return "text-muted-foreground";
  };

  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => {
      map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue || 0);
    });
    return map;
  }, [links]);

  const enrichedLinks = useMemo(() => {
    return links.map((l: any) => {
      const daysSinceCreated = differenceInDays(new Date(), new Date(l.created_at));
      const isZeroClicksStale = l.clicks === 0 && daysSinceCreated >= 3;
      const isHighRevenue = Number(l.revenue) > 10000;
      const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
      const daysSinceActivity = calcDate ? differenceInDays(new Date(), calcDate) : 999;
      const isNaturallyActive = (l.clicks > 0 || Number(l.revenue) > 0) && daysSinceActivity <= 30;
      const hasOverride = manualOverrides[l.id] !== undefined;
      const isActive = hasOverride ? manualOverrides[l.id] : isNaturallyActive;
      const subsDay = daysSinceCreated >= 1 && l.subscribers > 0 ? l.subscribers / daysSinceCreated : null;
      return { ...l, isZeroClicksStale, isHighRevenue, isActive, daysSinceActivity, subsDay, daysSinceCreated };
    });
  }, [links, manualOverrides]);

  const accountOptions = useMemo(() => {
    const map: Record<string, { id: string; username: string }> = {};
    enrichedLinks.forEach((l: any) => {
      if (!map[l.account_id]) map[l.account_id] = { id: l.account_id, username: l.accounts?.username || "unknown" };
    });
    return Object.values(map).sort((a, b) => a.username.localeCompare(b.username));
  }, [enrichedLinks]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedLinks.forEach((l: any) => { if (l.source) set.add(l.source); });
    return Array.from(set).sort();
  }, [enrichedLinks]);

  const filtered = useMemo(() => {
    let result = enrichedLinks;
    if (accountFilter !== "all") result = result.filter((l: any) => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter((l: any) => !l.source);
    else if (sourceFilter !== "all") result = result.filter((l: any) => l.source === sourceFilter);
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
  }, [enrichedLinks, searchQuery, clickFilter, ageFilter, accountFilter, sourceFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "cost_total": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        case "revenue": aVal = Number(a.revenue); bVal = Number(b.revenue); break;
        case "profit": aVal = Number(a.profit ?? -Infinity); bVal = Number(b.profit ?? -Infinity); break;
        case "roi": aVal = Number(a.roi ?? -Infinity); bVal = Number(b.roi ?? -Infinity); break;
        case "cpl_real": aVal = Number(a.cpl_real || 0); bVal = Number(b.cpl_real || 0); break;
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

  const toggleActiveOverride = (id: string, currentActive: boolean) => {
    setManualOverrides((prev) => ({ ...prev, [id]: !currentActive }));
  };

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const SortHeader = ({ label, sortKeyName, width }: { label: string; sortKeyName: SortKey; width?: string }) => (
    <th
      className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
      onClick={() => handleSort(sortKeyName)}
    >
      <span className="flex items-center gap-0.5">
        {label}
        {sortKey === sortKeyName ? (
          sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />
        ) : (
          <ChevronDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );

  const handleRowClick = (link: any) => {
    if (expandedRow === link.id) {
      setExpandedRow(null);
    } else {
      setExpandedRow(link.id);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
         <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tracking Links</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor your tracking links to track subscribers and LTV
              {agencyAvgCvr !== null && (
                <span className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                  <Target className="h-3 w-3" /> Agency avg CVR: {agencyAvgCvr.toFixed(1)}%
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const untaggedCount = links.filter((l: any) => !l.source_tag || l.source_tag === "Untagged").length;
              if (untaggedCount === 0) { toast.info("All campaigns are already tagged"); return; }
              autoTagMutation.mutate(undefined);
            }} disabled={autoTagMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30 text-primary text-sm font-medium hover:bg-primary/10 transition-colors disabled:opacity-50">
              <Wand2 className={`h-3.5 w-3.5 ${autoTagMutation.isPending ? "animate-spin" : ""}`} />
              {autoTagMutation.isPending ? "Scanning..." : "Auto-Tag"}
            </button>
            <button onClick={exportCampaignsCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-all">
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={() => syncMutation.mutate(undefined)} disabled={syncMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 hero-glow gradient-bg hover:opacity-90">
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-4 w-4 text-primary" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total LTV</span>
            </div>
            <p className="text-[28px] font-bold font-mono text-primary">{fmtC(totalLtv)}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center"><DollarSign className="h-4 w-4 text-destructive" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Spend</span>
            </div>
            <p className={`text-[28px] font-bold font-mono ${totalSpent > 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmtC(totalSpent)}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totalSpent > 0 ? (totalLtv - totalSpent >= 0 ? "bg-primary/10" : "bg-destructive/10") : "bg-secondary"}`}>
                <TrendingUp className={`h-4 w-4 ${totalSpent > 0 ? (totalLtv - totalSpent >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`} />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Profit</span>
            </div>
            {totalSpent > 0 ? (
              <p className={`text-[28px] font-bold font-mono ${totalLtv - totalSpent >= 0 ? "text-primary" : "text-destructive"}`}>{fmtC(totalLtv - totalSpent)}</p>
            ) : (
              <div>
                <p className="text-[28px] font-bold font-mono text-muted-foreground">—</p>
                <p className="text-[11px] text-muted-foreground mt-1">Enter spend to calculate</p>
              </div>
            )}
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${blendedRoi === null ? "bg-secondary" : blendedRoi >= 0 ? "bg-primary/10" : "bg-destructive/10"}`}>
                <BarChart3 className={`h-4 w-4 ${blendedRoi === null ? "text-muted-foreground" : blendedRoi >= 0 ? "text-primary" : "text-destructive"}`} />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Blended ROI</span>
            </div>
            <p className={`text-[28px] font-bold font-mono ${blendedRoi === null ? "text-muted-foreground" : blendedRoi >= 0 ? "text-primary" : "text-destructive"}`}>
              {blendedRoi !== null ? `${blendedRoi.toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>

        {/* Filter bar — Row 1 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-colors" />
          </div>

          {/* Account dropdown — native select */}
          <select
            value={accountFilter}
            onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
          >
            <option value="all">All Accounts</option>
            {accountOptions.map((acc) => (
              <option key={acc.id} value={acc.id}>@{acc.username}</option>
            ))}
          </select>

          {/* Source dropdown — native select */}
          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
          >
            <option value="all">All Sources</option>
            <option value="untagged">Untagged</option>
            {sourceOptions.map((src) => (
              <option key={src} value={src}>{src}</option>
            ))}
          </select>

          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
            {(["all", "active", "zero"] as ClickFilter[]).map((f) => (
              <button key={f} onClick={() => { setClickFilter(f); setPage(1); }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${clickFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "all" ? "Show All" : f === "active" ? "Active Only" : "Zero Clicks"}
              </button>
            ))}
          </div>
        </div>

        {/* Filter bar — Row 2: Age pills */}
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
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="space-y-3">{[...Array(8)].map((_, i) => (<div key={i} className="skeleton-shimmer h-10 rounded" />))}</div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium mb-1">No tracking links found</p>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery || clickFilter !== "all" || ageFilter !== "all" || accountFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {/* Bulk tag bar */}
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
              <span className="text-xs text-muted-foreground">Showing {showStart}–{showEnd} of {sorted.length} campaigns</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="h-9 px-2 w-8">
                      <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                    </th>
                    <SortHeader label="Campaign" sortKeyName="campaign_name" width="200px" />
                    <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "100px" }}>Account</th>
                    <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "100px" }}>Source</th>
                     <SortHeader label="Subs/Day" sortKeyName="subs_day" width="70px" />
                    <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "60px" }}>CVR</th>
                    <SortHeader label="LTV" sortKeyName="revenue" width="90px" />
                    <SortHeader label="Spend" sortKeyName="cost_total" width="85px" />
                    <SortHeader label="Profit" sortKeyName="profit" width="85px" />
                    <SortHeader label="ROI" sortKeyName="roi" width="65px" />
                    <SortHeader label="Cost/Sub" sortKeyName="cpl_real" width="70px" />
                    <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "70px" }}>LTV Ratio</th>
                    <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "80px", minWidth: "80px" }}>Status</th>
                    <SortHeader label="Created" sortKeyName="created_at" width="105px" />
                    <th className="h-9 px-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "65px" }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((link: any) => {
                    const acctColor = getAccountColor(link.accounts?.username);
                    const initials = getCampaignInitials(link.campaign_name);
                    const username = link.accounts?.username || link.accounts?.display_name || "—";
                    const borderClass = link.isZeroClicksStale ? "border-l-2 border-l-destructive" : link.isHighRevenue ? "border-l-2 border-l-primary" : "border-l-2 border-l-transparent";
                    const rowOpacity = link.isActive ? "" : "opacity-50";
                    const costTotal = Number(link.cost_total || 0);
                    const hasCost = link.cost_type && costTotal > 0;
                    const profit = Number(link.profit || 0);
                    const roi = Number(link.roi || 0);
                    const cplReal = Number(link.cpl_real || 0);
                    const status = link.status || "NO_DATA";
                    const displayStatus = status === "NO_DATA" ? "No Spend" : status;
                    const mediaBuyer = link.source || null;
                    const daysOld = link.daysSinceCreated ?? null;
                    const isExpanded = expandedRow === link.id;

                    return (
                      <React.Fragment key={link.id}>
                        <tr className={`border-b border-border hover:bg-secondary/20 transition-colors cursor-pointer ${borderClass} ${rowOpacity}`} onClick={() => handleRowClick(link)}>
                          {/* Campaign */}
                          <td className="px-2 py-2" style={{ maxWidth: "200px" }}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${acctColor.bg} ${acctColor.text}`}>{initials}</div>
                              <div className="min-w-0 overflow-hidden">
                                <p className="font-semibold text-foreground text-[13px] truncate leading-tight">{link.campaign_name || "Unnamed"}</p>
                              </div>
                            </div>
                          </td>
                          {/* Account */}
                          <td className="px-2 py-2"><span className="text-[11px] text-muted-foreground whitespace-nowrap">@{username}</span></td>
                          {/* Source */}
                          <td className="px-2 py-2">
                            {mediaBuyer ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-foreground font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                {mediaBuyer}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">Untagged</span>
                            )}
                          </td>
                          {/* Subs/Day */}
                          <td className="px-2 py-2 font-mono text-[12px] text-foreground">
                            {link.subsDay !== null ? `${Math.round(link.subsDay)}/day` : "—"}
                          </td>
                          {/* CVR */}
                          <td className="px-2 py-2 font-mono text-[12px]">
                            {link.clicks > 0 ? (() => {
                              const cvr = (link.subscribers / link.clicks) * 100;
                              const color = getCvrColor(cvr);
                              const diff = agencyAvgCvr !== null ? cvr - agencyAvgCvr : null;
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`font-semibold cursor-default ${color}`}>{cvr.toFixed(1)}%</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">
                                      {agencyAvgCvr !== null
                                        ? `Agency avg: ${agencyAvgCvr.toFixed(1)}% — this campaign is ${diff !== null && diff >= 0 ? "+" : ""}${diff?.toFixed(1)}% ${diff !== null && diff >= 0 ? "above" : "below"} average`
                                        : "Not enough data for agency benchmark"}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })() : <span className="text-muted-foreground">—</span>}
                          </td>
                          {/* LTV */}
                          <td className="px-2 py-2"><span className="font-mono text-[12px] gradient-text font-semibold">{fmtC(Number(link.revenue))}</span></td>
                          {/* Spend */}
                          <td className="px-2 py-2">
                            {hasCost ? (
                              clearConfirmId === link.id ? (
                                <span className="inline-flex items-center gap-1 text-[11px]">
                                  <span className="text-muted-foreground">Clear?</span>
                                  <button onClick={async (e) => { e.stopPropagation(); try { await clearTrackingLinkSpend(link.id, link.campaign_id); queryClient.invalidateQueries({ queryKey: ["tracking_links"] }); queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend cleared"); } catch {} setClearConfirmId(null); }} className="text-destructive font-semibold hover:underline">Yes</button>
                                  <button onClick={(e) => { e.stopPropagation(); setClearConfirmId(null); }} className="text-muted-foreground hover:text-foreground">Cancel</button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-mono text-[12px] text-foreground">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                  {fmtC(costTotal)}
                                  <button onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }} className="hover:text-primary transition-colors"><Pencil className="h-2.5 w-2.5 text-muted-foreground" /></button>
                                  <button onClick={(e) => { e.stopPropagation(); setClearConfirmId(link.id); }} className="hover:text-destructive transition-colors"><X className="h-3 w-3 text-muted-foreground" /></button>
                                </span>
                              )
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/10 transition-colors h-7">
                                <Pencil className="h-3 w-3" /> Set
                              </button>
                            )}
                          </td>
                          {/* Profit */}
                          <td className="px-2 py-2 font-mono text-[12px]">
                            {hasCost ? (
                              <span className={profit >= 0 ? "text-primary" : "text-destructive"}>{profit >= 0 ? "+" : ""}{fmtC(profit)}</span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          {/* ROI */}
                          <td className="px-2 py-2 font-mono text-[12px]">
                            {hasCost ? (
                              <span className={roi >= 0 ? "text-primary" : "text-destructive"}>{roi.toFixed(1)}%</span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          {/* Cost/Sub */}
                          <td className="px-2 py-2 font-mono text-[12px]">
                            {cplReal > 0 ? <span className="font-semibold text-primary">${cplReal.toFixed(2)}</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          {/* LTV Ratio */}
                          <td className="px-2 py-2 font-mono text-[12px]">
                            {(() => {
                              if (!hasCost || cplReal <= 0) return <span className="text-muted-foreground">—</span>;
                              const ltvPerSub = (link.subscribers || 0) > 0 ? Number(link.revenue || 0) / link.subscribers : 0;
                              const ratio = ltvPerSub / cplReal;
                              const color = ratio >= 2 ? "text-primary" : ratio >= 1 ? "text-[hsl(38_92%_50%)]" : "text-destructive";
                              return <span className={`font-semibold ${color}`}>{ratio.toFixed(1)}x</span>;
                            })()}
                          </td>
                          {/* Status */}
                          <td className="px-2 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap min-w-[80px] text-center ${STATUS_STYLES[displayStatus] || STATUS_STYLES.NO_DATA}`}>
                              {STATUS_EMOJI[displayStatus] || "⚪"} {displayStatus}
                            </span>
                          </td>
                          {/* Created */}
                          <td className="px-2 py-2">
                            <div className="flex flex-col">
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                {link.created_at ? format(new Date(link.created_at), "MMM d, yyyy") : "—"}
                              </span>
                              {daysOld !== null && (
                                <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold w-fit ${getAgePillStyle(daysOld)}`}>
                                  {daysOld}d
                                </span>
                              )}
                            </div>
                          </td>
                          {/* Active */}
                          <td className="px-2 py-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={(e) => { e.stopPropagation(); toggleActiveOverride(link.id, link.isActive); }}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${link.isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
                                  {link.isActive ? "Active" : "Inactive"}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent><p className="text-xs">Last activity: {link.daysSinceActivity < 999 ? `${link.daysSinceActivity} days ago` : "Unknown"}</p></TooltipContent>
                            </Tooltip>
                          </td>
                        </tr>
                        {/* Expanded row */}
                        {isExpanded && (
                          <tr className="bg-secondary/30 border-b border-border">
                            <td colSpan={14} className="px-4 py-3">
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
            {/* Footer: pagination + rows per page */}
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
        <div className="bg-card border border-border rounded-lg overflow-hidden">
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
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Campaign</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Media Buyer</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Platform</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">LTV</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                    <th className="h-9 px-4 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {adSpendData.map((entry: any) => {
                    const rev = revenueMap[entry.campaign_id] || 0;
                    const amt = Number(entry.amount || 0);
                    const entryRoi = amt > 0 ? ((rev - amt) / amt) * 100 : null;
                    return (
                      <tr key={entry.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{entry.date ? format(new Date(entry.date), "MMM d, yyyy") : "—"}</td>
                        <td className="px-4 py-2.5 text-[13px] text-foreground font-medium">{entry.campaigns?.name || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{entry.media_buyer || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{entry.traffic_source || "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-[13px] text-foreground">{fmtC(amt)}</td>
                        <td className="px-4 py-2.5 font-mono text-[13px] text-primary">{fmtC(rev)}</td>
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
      </div>

      {costSlideIn && <CostSettingSlideIn link={costSlideIn} onClose={() => setCostSlideIn(null)} onSaved={() => { setCostSlideIn(null); queryClient.invalidateQueries({ queryKey: ["tracking_links"] }); queryClient.invalidateQueries({ queryKey: ["ad_spend"] }); toast.success("Spend saved — ROI and Profit updated"); }} />}
      {selectedLink && <CampaignDetailSlideIn link={selectedLink} cost={Number(selectedLink.cost_total || 0)} onClose={() => setSelectedLink(null)} onSetCost={() => { setCostSlideIn(selectedLink); setSelectedLink(null); }} />}
    </DashboardLayout>
  );
}

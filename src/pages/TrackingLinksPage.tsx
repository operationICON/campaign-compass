import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendSlideIn } from "@/components/dashboard/AdSpendSlideIn";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { CsvCostImportModal } from "@/components/dashboard/CsvCostImportModal";
import { fetchTrackingLinks, fetchAdSpend, addAdSpend, deleteAdSpend, triggerSync } from "@/lib/supabase-helpers";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { toast } from "sonner";
import { format, differenceInDays, differenceInHours, isToday } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Users, RefreshCw, ExternalLink, DollarSign, TrendingUp, BarChart3, Trash2, Plus, Upload, Download
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortKey = "campaign_name" | "clicks" | "subscribers" | "cvr" | "cost_total" | "revenue" | "spenders" | "profit" | "roi" | "arpu" | "cpl_real" | "created_at";
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

function formatUpdatedAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const hours = differenceInHours(new Date(), d);
  if (hours < 1) return "Updated <1h ago";
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

const STATUS_STYLES: Record<string, string> = {
  SCALE: "bg-[hsl(142_71%_45%/0.1)] text-[hsl(142_71%_45%)]",
  WATCH: "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]",
  LOW: "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]",
  KILL: "bg-[hsl(0_84%_60%/0.12)] text-[hsl(0_84%_60%)]",
  DEAD: "bg-[hsl(0_72%_51%/0.1)] text-[hsl(0_72%_51%)]",
  NO_DATA: "bg-muted text-muted-foreground",
};

const STATUS_EMOJI: Record<string, string> = {
  SCALE: "🟢", WATCH: "🟡", LOW: "🟠", KILL: "🔴", DEAD: "💀", NO_DATA: "⚪",
};

const COST_TYPE_STYLES: Record<string, string> = {
  CPC: "bg-info/15 text-info",
  CPL: "bg-primary/15 text-primary",
  FIXED: "bg-warning/15 text-warning",
};

export default function TrackingLinksPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [clickFilter, setClickFilter] = useState<ClickFilter>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [adSpendSlideIn, setAdSpendSlideIn] = useState<any>(null);
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const [importModalOpen, setImportModalOpen] = useState(false);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: () => fetchTrackingLinks(),
  });
  const { data: adSpendData = [] } = useQuery({
    queryKey: ["ad_spend"],
    queryFn: () => fetchAdSpend(),
  });

  const exportCampaignsCsv = useCallback(() => {
    const header = "campaign_name,account_username,clicks,subscribers,revenue,current_cost_type,current_cost_value";
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

  const addSpendMutation = useMutation({
    mutationFn: addAdSpend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      setAdSpendSlideIn(null);
      toast.success("Ad spend saved");
    },
  });

  const deleteSpendMutation = useMutation({
    mutationFn: deleteAdSpend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      toast.success("Ad spend deleted");
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(undefined, true),
    onSuccess: (data) => {
      const count = data?.dispatched?.length ?? 0;
      toast.success(`Sync dispatched for ${count} account(s) — check logs for progress`);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  const adSpendMap = useMemo(() => {
    const map: Record<string, number> = {};
    adSpendData.forEach((s: any) => {
      map[s.campaign_id] = (map[s.campaign_id] || 0) + Number(s.amount || 0);
    });
    return map;
  }, [adSpendData]);

  const totalSpent = useMemo(() => links.reduce((sum: number, l: any) => sum + Number(l.cost_total || 0), 0), [links]);
  const totalRevenue = useMemo(() => links.reduce((sum: number, l: any) => sum + Number(l.revenue || 0), 0), [links]);
  const blendedRoi = useMemo(() => {
    if (totalSpent <= 0) return null;
    return ((totalRevenue - totalSpent) / totalSpent) * 100;
  }, [totalSpent, totalRevenue]);

  const bestPlatform = useMemo(() => {
    if (adSpendData.length === 0) return null;
    const platformMap: Record<string, { spend: number; revenue: number }> = {};
    adSpendData.forEach((s: any) => {
      const p = s.traffic_source || "unknown";
      if (!platformMap[p]) platformMap[p] = { spend: 0, revenue: 0 };
      platformMap[p].spend += Number(s.amount || 0);
    });
    links.forEach((l: any) => {
      const matchingSpends = adSpendData.filter((s: any) => s.campaign_id === l.campaign_id);
      if (matchingSpends.length > 0) {
        const platform = matchingSpends[0].traffic_source || "unknown";
        if (platformMap[platform]) platformMap[platform].revenue += Number(l.revenue || 0);
      }
    });
    let best: string | null = null;
    let bestRoi = -Infinity;
    Object.entries(platformMap).forEach(([p, data]) => {
      if (data.spend > 0) {
        const roi = ((data.revenue - data.spend) / data.spend) * 100;
        if (roi > bestRoi) { bestRoi = roi; best = p; }
      }
    });
    return best;
  }, [adSpendData, links]);

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
      return { ...l, isZeroClicksStale, isHighRevenue, isActive, daysSinceActivity };
    });
  }, [links, manualOverrides]);

  // Account summary for the summary bar
  const accountSummary = useMemo(() => {
    const map: Record<string, { id: string; username: string; display_name: string; count: number }> = {};
    enrichedLinks.forEach((l: any) => {
      const accId = l.account_id;
      if (!map[accId]) {
        map[accId] = {
          id: accId,
          username: l.accounts?.username || "unknown",
          display_name: l.accounts?.display_name || "Unknown",
          count: 0,
        };
      }
      map[accId].count++;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [enrichedLinks]);

  const filtered = useMemo(() => {
    let result = enrichedLinks;
    if (accountFilter) {
      result = result.filter((l: any) => l.account_id === accountFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) ||
        (l.url || "").toLowerCase().includes(q) ||
        (l.accounts?.username || "").toLowerCase().includes(q) ||
        (l.accounts?.display_name || "").toLowerCase().includes(q)
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
  }, [enrichedLinks, searchQuery, clickFilter, ageFilter, accountFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "clicks": aVal = a.clicks; bVal = b.clicks; break;
        case "subscribers": aVal = a.subscribers; bVal = b.subscribers; break;
        case "cvr": aVal = Number(a.cvr || 0); bVal = Number(b.cvr || 0); break;
        case "cost_total": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        case "revenue": aVal = Number(a.revenue); bVal = Number(b.revenue); break;
        case "spenders": aVal = a.spenders; bVal = b.spenders; break;
        case "profit": aVal = Number(a.profit ?? -Infinity); bVal = Number(b.profit ?? -Infinity); break;
        case "roi": aVal = Number(a.roi ?? -Infinity); bVal = Number(b.roi ?? -Infinity); break;
        case "arpu": aVal = Number(a.arpu || 0); bVal = Number(b.arpu || 0); break;
        case "cpl_real": aVal = Number(a.cpl_real || 0); bVal = Number(b.cpl_real || 0); break;
        case "created_at": aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
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

  const formatCreatedAt = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return format(d, "MMM d, yyyy");
  };

  const toggleActiveOverride = (id: string, currentActive: boolean) => {
    setManualOverrides((prev) => ({ ...prev, [id]: !currentActive }));
  };

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const SortHeader = ({ label, sortKeyName, width }: { label: string; sortKeyName: SortKey; width?: string }) => (
    <th
      className="h-9 px-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tracking Links</h1>
            <p className="text-sm text-muted-foreground mt-1">Monitor your tracking links to track your subscribers and revenue</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCampaignsCsv}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-all"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-all"
            >
              <Upload className="h-4 w-4" />
              Import Costs
            </button>
            <button
              onClick={() => setAdSpendSlideIn({ campaign_id: "", campaign_name: "New Entry" })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] gradient-bg text-white text-sm font-medium hover:opacity-90 transition-all duration-200 hero-glow"
            >
              <Plus className="h-4 w-4" />
              Add Ad Spend
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-destructive" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Cost</span>
            </div>
            <p className={`text-[28px] font-bold font-mono ${totalSpent > 0 ? "text-foreground" : "text-muted-foreground"}`}>
              {fmtC(totalSpent)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Revenue</span>
            </div>
            <p className="text-[28px] font-bold font-mono text-primary">
              {fmtC(totalRevenue)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                blendedRoi === null ? "bg-secondary" : blendedRoi >= 0 ? "bg-primary/10" : "bg-destructive/10"
              }`}>
                <BarChart3 className={`h-4 w-4 ${
                  blendedRoi === null ? "text-muted-foreground" : blendedRoi >= 0 ? "text-primary" : "text-destructive"
                }`} />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Blended ROI</span>
            </div>
            <p className={`text-[28px] font-bold font-mono ${
              blendedRoi === null ? "text-muted-foreground" : blendedRoi >= 0 ? "text-primary" : "text-destructive"
            }`}>
              {blendedRoi !== null ? `${blendedRoi.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-info" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Best Platform</span>
            </div>
            <p className="text-[28px] font-bold font-mono text-foreground capitalize">
              {bestPlatform || "—"}
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by campaign or account..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
            {(["all", "active", "zero"] as ClickFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setClickFilter(f); setPage(1); }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  clickFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "Show All" : f === "active" ? "Active Only" : "Zero Clicks"}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
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
                <button
                  key={f}
                  onClick={() => { setAgeFilter(f); setPage(1); }}
                  className={`px-3 py-2 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                    ageFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "all" ? "All Ages" : f === "new" ? "🟢 New" : f === "active" ? "🔵 Active" : f === "mature" ? "🟡 Mature" : "⚪ Old"}
                  <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    ageFilter === f ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}>{count}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => syncMutation.mutate(undefined)}
            disabled={syncMutation.isPending}
            className={`ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 hero-glow gradient-bg hover:opacity-90`}
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {/* Account Summary Bar */}
        {accountSummary.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {accountSummary.map((acc) => {
                const isActive = accountFilter === acc.id;
                const color = getAccountColor(acc.username);
                return (
                  <button
                    key={acc.id}
                    onClick={() => { setAccountFilter(isActive ? null : acc.id); setPage(1); }}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all shrink-0 ${
                      isActive
                        ? "bg-primary/15 border border-primary/40 text-foreground"
                        : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${color.bg} ${color.text}`}>
                      {acc.display_name.charAt(0)}
                    </div>
                    <span className="text-xs">@{acc.username}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs font-bold text-primary">{acc.count}</span>
                    <span className="text-[10px] text-muted-foreground">campaigns</span>
                  </button>
                );
              })}
            </div>
            <div className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
              Total: <span className="font-bold text-primary">{enrichedLinks.length}</span> campaigns across <span className="font-bold text-foreground">{accountSummary.length}</span> accounts
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="skeleton-shimmer h-10 rounded" />
              ))}
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium mb-1">No tracking links found</p>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery || clickFilter !== "all" || ageFilter !== "all" || accountFilter ? "Try adjusting your filters." : "Run a sync to get started."}
            </p>
            {!searchQuery && clickFilter === "all" && ageFilter === "all" && !accountFilter && (
              <button
                onClick={() => syncMutation.mutate(undefined)}
                disabled={syncMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                Sync Now
              </button>
            )}
            {(searchQuery || clickFilter !== "all" || ageFilter !== "all" || accountFilter) && (
              <button
                onClick={() => { setSearchQuery(""); setClickFilter("all"); setAgeFilter("all"); setAccountFilter(null); }}
                className="px-4 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {/* Showing count + rows per page */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-xs text-muted-foreground">
                Showing {showStart}–{showEnd} of {sorted.length} campaigns
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Rows per page:</span>
                {[10, 25, 50, 100].map((n) => (
                  <button
                    key={n}
                    onClick={() => { setPerPage(n); setPage(1); }}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      perPage === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border bg-secondary/30">
                    <SortHeader label="Campaign" sortKeyName="campaign_name" width="180px" />
                    <th className="h-9 px-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "100px" }}>Account</th>
                    <SortHeader label="Clicks" sortKeyName="clicks" width="60px" />
                    <SortHeader label="Subs" sortKeyName="subscribers" width="55px" />
                    <SortHeader label="CVR" sortKeyName="cvr" width="55px" />
                    <th className="h-9 px-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "55px" }}>Type</th>
                    <SortHeader label="Cost" sortKeyName="cost_total" width="80px" />
                    <SortHeader label="Revenue" sortKeyName="revenue" width="90px" />
                    <th className="h-9 px-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "60px" }}>EPC</th>
                    <SortHeader label="ARPU" sortKeyName="arpu" width="60px" />
                    <SortHeader label="CPL" sortKeyName="cpl_real" width="60px" />
                    <SortHeader label="Profit" sortKeyName="profit" width="80px" />
                    <SortHeader label="ROI" sortKeyName="roi" width="60px" />
                    <th className="h-9 px-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "70px" }}>Status</th>
                    <SortHeader label="Created" sortKeyName="created_at" width="85px" />
                    <th className="h-9 px-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "65px" }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((link: any) => {
                    const acctColor = getAccountColor(link.accounts?.username);
                    const initials = getCampaignInitials(link.campaign_name);
                    const username = link.accounts?.username || link.accounts?.display_name || "—";
                    const borderClass = link.isZeroClicksStale
                      ? "border-l-2 border-l-destructive"
                      : link.isHighRevenue ? "border-l-2 border-l-primary" : "border-l-2 border-l-transparent";
                    const rowOpacity = link.isActive ? "" : "opacity-50";
                    const epc = link.clicks > 0 ? Number(link.revenue) / link.clicks : 0;
                    const costTotal = Number(link.cost_total || 0);
                    const profit = Number(link.profit || 0);
                    const roi = Number(link.roi || 0);
                    const cvr = Number(link.cvr || 0);
                    const arpu = Number(link.arpu || 0);
                    const cplReal = Number(link.cpl_real || 0);
                    const status = link.status || "NO_DATA";
                    const hasCost = link.cost_type && costTotal > 0;

                    return (
                      <tr
                        key={link.id}
                        className={`border-b border-border hover:bg-secondary/20 transition-colors cursor-pointer ${borderClass} ${rowOpacity}`}
                        onClick={() => setSelectedLink(link)}
                      >
                        {/* Campaign */}
                        <td className="px-2 py-2" style={{ maxWidth: "180px" }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${acctColor.bg} ${acctColor.text}`}>
                              {initials}
                            </div>
                            <div className="min-w-0 overflow-hidden">
                              <p className="font-semibold text-foreground text-[13px] truncate leading-tight">{link.campaign_name || "Unnamed"}</p>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] text-muted-foreground hover:text-primary truncate block transition-colors leading-tight">{link.url}</a>
                            </div>
                          </div>
                        </td>
                        {/* Account */}
                        <td className="px-2 py-2" style={{ maxWidth: "100px" }}>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">@{username}</span>
                        </td>
                        {/* Clicks */}
                        <td className="px-2 py-2 font-mono text-[12px] text-foreground">{link.clicks.toLocaleString()}</td>
                        {/* Subs */}
                        <td className="px-2 py-2 font-mono text-[12px] text-foreground">{link.subscribers.toLocaleString()}</td>
                        {/* CVR */}
                        <td className="px-2 py-2 font-mono text-[12px] text-foreground">{(cvr * 100).toFixed(1)}%</td>
                        {/* Cost Type */}
                        <td className="px-2 py-2">
                          {link.cost_type ? (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${COST_TYPE_STYLES[link.cost_type] || "bg-secondary text-muted-foreground"}`}>
                              {link.cost_type}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-secondary text-muted-foreground">—</span>
                          )}
                        </td>
                        {/* Cost */}
                        <td className="px-2 py-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }}
                            className="text-[12px] transition-colors whitespace-nowrap"
                          >
                            {hasCost ? (
                              <span className="font-mono text-foreground">{fmtC(costTotal)}</span>
                            ) : (
                              <span className="text-muted-foreground hover:text-primary">Set cost</span>
                            )}
                          </button>
                        </td>
                        {/* Revenue */}
                        <td className="px-2 py-2">
                          <span className="font-mono text-[12px] gradient-text font-semibold">{fmtC(Number(link.revenue))}</span>
                        </td>
                        {/* EPC */}
                        <td className="px-2 py-2 font-mono text-[12px] text-foreground">${epc.toFixed(2)}</td>
                        {/* ARPU */}
                        <td className="px-2 py-2 font-mono text-[12px] text-foreground">${arpu.toFixed(2)}</td>
                        {/* CPL */}
                        <td className="px-2 py-2 font-mono text-[12px] text-foreground">{cplReal > 0 ? `$${cplReal.toFixed(2)}` : "—"}</td>
                        {/* Profit */}
                        <td className="px-2 py-2 font-mono text-[12px]">
                          {hasCost ? (
                            <span className={profit >= 0 ? "text-primary" : "text-destructive"}>
                              {profit >= 0 ? "+" : ""}{fmtC(profit)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        {/* ROI */}
                        <td className="px-2 py-2 font-mono text-[12px]">
                          {hasCost ? (
                            <span className={roi >= 0 ? "text-primary" : "text-destructive"}>
                              {roi.toFixed(1)}%
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        {/* Status */}
                        <td className="px-2 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.NO_DATA}`}>
                            {STATUS_EMOJI[status]} {status.replace("_", " ")}
                          </span>
                        </td>
                        {/* Created */}
                        <td className="px-2 py-2">
                          <CampaignAgePill
                            createdAt={link.created_at}
                            lastActivityAt={link.calculated_at}
                            clicks={link.clicks}
                            revenue={Number(link.revenue || 0)}
                          />
                        </td>
                        {/* Active */}
                        <td className="px-2 py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleActiveOverride(link.id, link.isActive); }}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                                  link.isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                                }`}
                              >
                                {link.isActive ? "Active" : "Inactive"}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Last activity: {link.daysSinceActivity < 999 ? `${link.daysSinceActivity} days ago` : "Unknown"}</p>
                            </TooltipContent>
                          </Tooltip>
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
                Showing {showStart}–{showEnd} of {sorted.length} tracking links
              </span>
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
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                        pageNum === safePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Spend History */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Spend History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">All recorded ad spend entries</p>
          </div>
          {adSpendData.length === 0 ? (
            <div className="p-10 text-center">
              <DollarSign className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No ad spend recorded</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Campaign</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Media Buyer</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Platform</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Revenue</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                    <th className="h-9 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider w-10"></th>
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
                          {entryRoi !== null ? (
                            <span className={entryRoi >= 0 ? "text-primary" : "text-destructive"}>{entryRoi.toFixed(1)}%</span>
                          ) : <span className="text-muted-foreground">—</span>}
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

      {adSpendSlideIn && (
        <AdSpendSlideIn
          link={adSpendSlideIn}
          onClose={() => setAdSpendSlideIn(null)}
          onSubmit={(data) => addSpendMutation.mutateAsync(data)}
        />
      )}

      {costSlideIn && (
        <CostSettingSlideIn
          link={costSlideIn}
          onClose={() => setCostSlideIn(null)}
          onSaved={() => {
            setCostSlideIn(null);
            queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
            toast.success("Cost saved & metrics recalculated");
          }}
        />
      )}

      {selectedLink && (
        <CampaignDetailSlideIn
          link={selectedLink}
          cost={Number(selectedLink.cost_total || 0)}
          onClose={() => setSelectedLink(null)}
          onSetCost={() => {
            setCostSlideIn(selectedLink);
            setSelectedLink(null);
          }}
        />
      )}

      <CsvCostImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
          setImportModalOpen(false);
        }}
        trackingLinks={links}
      />
    </DashboardLayout>
  );
}

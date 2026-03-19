import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendSlideIn } from "@/components/dashboard/AdSpendSlideIn";
import { fetchTrackingLinks, fetchAdSpend, addAdSpend, deleteAdSpend, triggerSync } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format, formatDistanceToNow, differenceInDays, isToday } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Pencil, Users, RefreshCw, ExternalLink, DollarSign, TrendingUp, BarChart3, Trash2, Plus
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortKey = "campaign_name" | "clicks" | "subscribers" | "revenue" | "spenders" | "profit" | "roi" | "arps" | "created_at";
type ClickFilter = "all" | "active" | "zero";

export default function TrackingLinksPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [clickFilter, setClickFilter] = useState<ClickFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [adSpendSlideIn, setAdSpendSlideIn] = useState<any>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const perPage = 20;

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: () => fetchTrackingLinks(),
  });
  const { data: adSpendData = [] } = useQuery({
    queryKey: ["ad_spend"],
    queryFn: () => fetchAdSpend(),
  });

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
    mutationFn: triggerSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      toast.success("Sync started");
    },
  });

  // Ad spend aggregation by campaign_id
  const adSpendMap = useMemo(() => {
    const map: Record<string, number> = {};
    adSpendData.forEach((s: any) => {
      const key = s.campaign_id;
      map[key] = (map[key] || 0) + Number(s.amount || 0);
    });
    return map;
  }, [adSpendData]);

  // KPI calculations
  const totalSpent = useMemo(() => adSpendData.reduce((sum: number, s: any) => sum + Number(s.amount || 0), 0), [adSpendData]);
  const totalRevenue = useMemo(() => links.reduce((sum: number, l: any) => sum + Number(l.revenue || 0), 0), [links]);
  const blendedRoi = useMemo(() => {
    if (totalSpent <= 0) return null;
    return ((totalRevenue - totalSpent) / totalSpent) * 100;
  }, [totalSpent, totalRevenue]);

  const bestPlatform = useMemo(() => {
    if (adSpendData.length === 0) return null;
    // Group spend and revenue by platform
    const platformMap: Record<string, { spend: number; revenue: number }> = {};
    adSpendData.forEach((s: any) => {
      const p = s.traffic_source || "unknown";
      if (!platformMap[p]) platformMap[p] = { spend: 0, revenue: 0 };
      platformMap[p].spend += Number(s.amount || 0);
    });
    // Attribute revenue from tracking links by campaign_id
    links.forEach((l: any) => {
      const matchingSpends = adSpendData.filter((s: any) => s.campaign_id === l.campaign_id);
      if (matchingSpends.length > 0) {
        const platform = matchingSpends[0].traffic_source || "unknown";
        if (platformMap[platform]) {
          platformMap[platform].revenue += Number(l.revenue || 0);
        }
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

  // Revenue map by campaign_id for spend history
  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => {
      map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue || 0);
    });
    return map;
  }, [links]);

  const enrichedLinks = useMemo(() => {
    return links.map((l: any) => {
      const cost = adSpendMap[l.campaign_id] || 0;
      const revenue = Number(l.revenue || 0);
      const profit = cost > 0 ? revenue - cost : null;
      const roi = cost > 0 ? (profit! / cost) * 100 : null;
      const arps = l.subscribers > 0 ? revenue / l.subscribers : 0;
      const daysSinceCreated = differenceInDays(new Date(), new Date(l.created_at));
      const isZeroClicksStale = l.clicks === 0 && daysSinceCreated >= 3;
      const isHighRevenue = revenue > 10000;
      const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
      const daysSinceActivity = calcDate ? differenceInDays(new Date(), calcDate) : 999;
      const isNaturallyActive = (l.clicks > 0 || revenue > 0) && daysSinceActivity <= 30;
      const hasOverride = manualOverrides[l.id] !== undefined;
      const isActive = hasOverride ? manualOverrides[l.id] : isNaturallyActive;
      return { ...l, cost, profit, roi, arps, isZeroClicksStale, isHighRevenue, isActive, daysSinceActivity };
    });
  }, [links, adSpendMap, manualOverrides]);

  const filtered = useMemo(() => {
    let result = enrichedLinks;
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
    return result;
  }, [enrichedLinks, searchQuery, clickFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "clicks": aVal = a.clicks; bVal = b.clicks; break;
        case "subscribers": aVal = a.subscribers; bVal = b.subscribers; break;
        case "revenue": aVal = Number(a.revenue); bVal = Number(b.revenue); break;
        case "spenders": aVal = a.spenders; bVal = b.spenders; break;
        case "profit": aVal = a.profit ?? -Infinity; bVal = b.profit ?? -Infinity; break;
        case "roi": aVal = a.roi ?? -Infinity; bVal = b.roi ?? -Infinity; break;
        case "arps": aVal = a.arps; bVal = b.arps; break;
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
    if (isToday(d)) return "—";
    return format(d, "MMM d, yyyy");
  };

  const toggleActiveOverride = (id: string, currentActive: boolean) => {
    setManualOverrides((prev) => ({ ...prev, [id]: !currentActive }));
  };

  const SortHeader = ({ label, sortKeyName, className = "" }: { label: string; sortKeyName: SortKey; className?: string }) => (
    <th
      className={`h-10 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => handleSort(sortKeyName)}
    >
      <span className="flex items-center gap-1">
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
          <button
            onClick={() => setAdSpendSlideIn({ campaign_id: "", campaign_name: "New Entry" })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all"
          >
            <Plus className="h-4 w-4" />
            Add Ad Spend
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Spent */}
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-destructive" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Spent</span>
            </div>
            <p className={`text-[28px] font-bold font-mono ${totalSpent > 0 ? "text-foreground" : "text-destructive"}`}>
              ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* Total Revenue */}
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Revenue</span>
            </div>
            <p className="text-[28px] font-bold font-mono text-primary">
              ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* Blended ROI */}
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

          {/* Best Platform */}
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
                  clickFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "Show All" : f === "active" ? "Active Only" : "Zero Clicks"}
              </button>
            ))}
          </div>

          <button
            onClick={() => syncMutation.mutate(undefined)}
            disabled={syncMutation.isPending}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="skeleton-shimmer h-12 rounded" />
              ))}
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium mb-1">No tracking links found</p>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery || clickFilter !== "all" ? "Try adjusting your filters." : "Run a sync to get started."}
            </p>
            {!searchQuery && clickFilter === "all" && (
              <button
                onClick={() => syncMutation.mutate(undefined)}
                disabled={syncMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                Sync Now
              </button>
            )}
            {(searchQuery || clickFilter !== "all") && (
              <button
                onClick={() => { setSearchQuery(""); setClickFilter("all"); }}
                className="px-4 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <SortHeader label="Campaign" sortKeyName="campaign_name" className="min-w-[240px]" />
                    <th className="h-10 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Account</th>
                    <SortHeader label="Clicks" sortKeyName="clicks" />
                    <SortHeader label="Subs" sortKeyName="subscribers" />
                    <th className="h-10 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost</th>
                    <SortHeader label="Revenue" sortKeyName="revenue" />
                    <SortHeader label="Spenders" sortKeyName="spenders" />
                    <SortHeader label="Profit" sortKeyName="profit" />
                    <SortHeader label="ROI" sortKeyName="roi" />
                    <SortHeader label="ARPS" sortKeyName="arps" />
                    <SortHeader label="Created" sortKeyName="created_at" />
                    <th className="h-10 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((link: any) => {
                    const isExpanded = expandedRow === link.id;
                    const updatedAgo = link.calculated_at
                      ? formatDistanceToNow(new Date(link.calculated_at), { addSuffix: true })
                      : null;
                    const borderClass = link.isZeroClicksStale
                      ? "border-l-2 border-l-destructive"
                      : link.isHighRevenue
                      ? "border-l-2 border-l-primary"
                      : "border-l-2 border-l-transparent";
                    const rowOpacity = link.isActive ? "" : "opacity-50";
                    const username = link.accounts?.username || link.accounts?.display_name || "—";
                    const initial = (link.accounts?.display_name || link.accounts?.username || "?")[0]?.toUpperCase();

                    return (
                      <tbody key={link.id}>
                        <tr
                          className={`border-b border-border hover:bg-secondary/20 transition-colors cursor-pointer ${borderClass} ${rowOpacity}`}
                          onClick={() => setExpandedRow(isExpanded ? null : link.id)}
                        >
                          {/* Campaign Name + URL */}
                          <td className="px-3 py-3">
                            <div className="flex items-start gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                                link.clicks > 0 ? "bg-primary/20" : "bg-secondary"
                              }`}>
                                <Link2 className={`h-3.5 w-3.5 ${link.clicks > 0 ? "text-primary" : "text-muted-foreground"}`} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate">{link.campaign_name || "Unnamed"}</p>
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] text-muted-foreground hover:text-primary truncate block transition-colors"
                                >
                                  {link.url}
                                </a>
                              </div>
                            </div>
                          </td>
                          {/* Account */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                {initial}
                              </div>
                              <span className="text-xs text-muted-foreground truncate">@{username}</span>
                            </div>
                          </td>
                          {/* Clicks */}
                          <td className="px-3 py-3 font-mono text-foreground">{link.clicks.toLocaleString()}</td>
                          {/* Subscribers */}
                          <td className="px-3 py-3 font-mono text-foreground">{link.subscribers.toLocaleString()}</td>
                          {/* Cost */}
                          <td className="px-3 py-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); setAdSpendSlideIn(link); }}
                              className="flex items-center gap-1 text-xs transition-colors"
                            >
                              {link.cost > 0 ? (
                                <>
                                  <span className="font-mono text-foreground">${link.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  <Pencil className="h-3 w-3 text-muted-foreground" />
                                </>
                              ) : (
                                <span className="text-muted-foreground hover:text-primary flex items-center gap-1">
                                  <Pencil className="h-3 w-3" /> Set cost
                                </span>
                              )}
                            </button>
                          </td>
                          {/* Revenue (Net) */}
                          <td className="px-3 py-3">
                            <span className="font-mono text-primary font-semibold">
                              ${Number(link.revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {updatedAgo && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">Updated {updatedAgo}</p>
                            )}
                          </td>
                          {/* Spenders */}
                          <td className="px-3 py-3">
                            <span className="flex items-center gap-1 font-mono text-foreground">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              {link.spenders}
                            </span>
                          </td>
                          {/* Profit */}
                          <td className="px-3 py-3 font-mono">
                            {link.profit !== null ? (
                              <span className={link.profit >= 0 ? "text-primary" : "text-destructive"}>
                                {link.profit >= 0 ? "+" : ""}${Math.abs(link.profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">N/A</span>
                            )}
                          </td>
                          {/* ROI */}
                          <td className="px-3 py-3 font-mono">
                            {link.roi !== null ? (
                              <span className={link.roi >= 0 ? "text-primary" : "text-destructive"}>
                                {link.roi.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">N/A</span>
                            )}
                          </td>
                          {/* ARPS */}
                          <td className="px-3 py-3 font-mono text-foreground">
                            ${link.arps.toFixed(2)}
                          </td>
                          {/* Created */}
                          <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatCreatedAt(link.created_at)}
                          </td>
                          {/* Active/Inactive */}
                          <td className="px-3 py-3">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleActiveOverride(link.id, link.isActive); }}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                                    link.isActive
                                      ? "bg-primary/20 text-primary"
                                      : "bg-secondary text-muted-foreground"
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
                        {isExpanded && (
                          <tr className="border-b border-border bg-secondary/10">
                            <td colSpan={12} className="px-6 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-muted-foreground block mb-1">Full URL</span>
                                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 break-all">
                                    {link.url} <ExternalLink className="h-3 w-3 shrink-0" />
                                  </a>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block mb-1">Campaign ID</span>
                                  <span className="font-mono text-foreground text-[11px]">{link.campaign_id}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block mb-1">Account</span>
                                  <span className="text-foreground">{link.accounts?.display_name || "—"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block mb-1">Country</span>
                                  <span className="text-foreground">{link.country || "—"}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
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
                <button
                  onClick={() => setPage(Math.max(1, safePage - 1))}
                  disabled={safePage <= 1}
                  className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors"
                >
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
                        pageNum === safePage
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage >= totalPages}
                  className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors"
                >
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
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Campaign</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Media Buyer</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Platform</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Revenue</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                    <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {adSpendData.map((entry: any) => {
                    const rev = revenueMap[entry.campaign_id] || 0;
                    const amt = Number(entry.amount || 0);
                    const entryRoi = amt > 0 ? ((rev - amt) / amt) * 100 : null;
                    return (
                      <tr key={entry.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {entry.date ? format(new Date(entry.date), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground font-medium">
                          {entry.campaigns?.name || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {entry.media_buyer || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                          {entry.traffic_source || "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-foreground">
                          ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-primary">
                          ${rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {entryRoi !== null ? (
                            <span className={entryRoi >= 0 ? "text-primary" : "text-destructive"}>
                              {entryRoi.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => deleteSpendMutation.mutate(entry.id)}
                            disabled={deleteSpendMutation.isPending}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
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
    </DashboardLayout>
  );
}

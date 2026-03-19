import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendSlideIn } from "@/components/dashboard/AdSpendSlideIn";
import { fetchTrackingLinks, fetchAdSpend, addAdSpend, triggerSync } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import {
  Search, Link2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Pencil, Users, RefreshCw, Plus, ExternalLink, Filter
} from "lucide-react";

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

  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success("Sync started");
    },
  });

  const adSpendMap = useMemo(() => {
    const map: Record<string, number> = {};
    adSpendData.forEach((s: any) => {
      const key = s.campaign_id;
      map[key] = (map[key] || 0) + Number(s.amount || 0);
    });
    return map;
  }, [adSpendData]);

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
      return { ...l, cost, profit, roi, arps, isZeroClicksStale, isHighRevenue };
    });
  }, [links, adSpendMap]);

  const filtered = useMemo(() => {
    let result = enrichedLinks;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) ||
        (l.url || "").toLowerCase().includes(q)
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
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tracking Links</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor your tracking links to track your subscribers and revenue</p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search campaigns..."
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

          <button className="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Tracking Link
          </button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
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
                    <SortHeader label="Campaign" sortKeyName="campaign_name" className="min-w-[260px]" />
                    <SortHeader label="Clicks" sortKeyName="clicks" />
                    <SortHeader label="Subs" sortKeyName="subscribers" />
                    <th className="h-10 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost</th>
                    <SortHeader label="Revenue" sortKeyName="revenue" />
                    <SortHeader label="Spenders" sortKeyName="spenders" />
                    <SortHeader label="Profit" sortKeyName="profit" />
                    <SortHeader label="ROI" sortKeyName="roi" />
                    <SortHeader label="ARPS" sortKeyName="arps" />
                    <SortHeader label="Created" sortKeyName="created_at" />
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

                    return (
                      <>
                        <tr
                          key={link.id}
                          className={`border-b border-border hover:bg-secondary/20 transition-colors cursor-pointer ${borderClass}`}
                          onClick={() => setExpandedRow(isExpanded ? null : link.id)}
                        >
                          {/* Campaign */}
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
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">+ Tag</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          {/* Clicks */}
                          <td className="px-3 py-3 font-mono text-foreground">{link.clicks.toLocaleString()}</td>
                          {/* Subscribers */}
                          <td className="px-3 py-3 font-mono text-foreground">{link.subscribers.toLocaleString()}</td>
                          {/* Cost */}
                          <td className="px-3 py-3">
                            {link.cost > 0 ? (
                              <span className="font-mono text-foreground">${link.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setAdSpendSlideIn(link); }}
                                className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors text-xs"
                              >
                                <Pencil className="h-3 w-3" /> Set cost
                              </button>
                            )}
                          </td>
                          {/* Revenue */}
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
                                {link.profit >= 0 ? "+" : ""}${link.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                            {format(new Date(link.created_at), "MMM d, h:mma").toLowerCase().replace("am", "am").replace("pm", "pm")}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${link.id}-detail`} className="border-b border-border bg-secondary/10">
                            <td colSpan={10} className="px-6 py-4">
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
                                  <span className="text-foreground">{link.accounts?.display_name || link.accounts?.username || "—"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block mb-1">Country</span>
                                  <span className="text-foreground">{link.country || "—"}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
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

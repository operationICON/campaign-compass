import React, { useState, useMemo } from "react";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { ArrowLeft, ChevronUp, ChevronDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { differenceInDays, format } from "date-fns";
import { ModelAvatar } from "@/components/ModelAvatar";
import { getOnlytrafficOrders, updateTrackingLink } from "@/lib/api";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { usePersistedState } from "@/hooks/usePersistedState";
import { LinkActivityFilter, type LinkActivityFilterValue } from "@/components/LinkActivityFilter";
import { useActiveLinkStatus, getActiveInfo } from "@/hooks/useActiveLinkStatus";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function getStatusBadge(link: any): { label: string; bg: string; text: string } {
  const spend = Number(link.cost_total || 0);
  if (spend <= 0) return { label: "NO SPEND", bg: "hsl(220 9% 46% / 0.15)", text: "hsl(220 9% 46%)" };
  const revenue = Number(link.revenue || 0);
  const roi = (revenue - spend) / spend * 100;
  if (roi > 150) return { label: "SCALE", bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 45%)" };
  if (roi >= 50) return { label: "WATCH", bg: "hsl(199 89% 48% / 0.15)", text: "hsl(199 89% 48%)" };
  if (roi >= 0) return { label: "LOW", bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  return { label: "KILL", bg: "hsl(0 84% 60% / 0.15)", text: "hsl(0 84% 60%)" };
}

type SortKey = "campaign" | "model" | "marketer" | "clicks" | "subs" | "revenue" | "spend" | "profit" | "roi" | "profitSub" | "ltvSub" | "created" | "status" | "source" | "orderId";

function getAgePill(days: number): { label: string; bg: string; text: string } {
  if (days <= 30) return { label: `${days}d`, bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 45%)" };
  if (days <= 90) return { label: `${days}d`, bg: "hsl(199 89% 48% / 0.15)", text: "hsl(199 89% 48%)" };
  if (days <= 180) return { label: `${days}d`, bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  return { label: `${days}d`, bg: "hsl(220 9% 46% / 0.15)", text: "hsl(220 9% 46%)" };
}

interface Props {
  sourceName: string;
  sourceColor: string;
  categoryName: string;
  links: any[];
  onBack: () => void;
  sourceTagOptions: string[];
  onTagLink: (linkId: string, sourceTag: string) => void;
}

const PAGE_SIZE = 25;

export function TrafficSourceDetail({ sourceName, sourceColor, categoryName, links, onBack, sourceTagOptions, onTagLink }: Props) {
  // Persisted prefs — Sources Level 3 (per-source detail). Keyed per-source so each source remembers independently.
  const TSD_PREFS = `ct_table_prefs_traffic_sources_l3_${sourceName}`;
  const [sortKey, setSortKey] = usePersistedState<SortKey>(`${TSD_PREFS}_sortKey`, "created");
  const [sortAsc, setSortAsc] = usePersistedState<boolean>(`${TSD_PREFS}_sortAsc`, false);
  const [page, setPage] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMarketer, setSelectedMarketer] = useState<string>("__all__");
  const [activityFilter, setActivityFilter] = usePersistedState<LinkActivityFilterValue>(`${TSD_PREFS}_activityFilter`, "all");

  // Snapshot-derived activity (>= 1 sub/day over last 5 days). No account scope — covers all links shown here.
  const { activeLookup } = useActiveLinkStatus(null);

  const isUntaggedView = sourceName === "Untagged";
  const isOnlyTraffic = categoryName === "OnlyTraffic";

  // Fetch distinct marketer+source combos from onlytraffic_orders
  const { data: orderMarketerCombos = [] } = useQuery({
    queryKey: ["onlytraffic_orders_marketer_combos"],
    queryFn: async () => {
      const raw = await getOnlytrafficOrders();
      const data = (raw as any[]).filter((o: any) => o.marketer != null);
      if (!data) return [];
      const comboMap: Record<string, Set<string>> = {};
      data.forEach((o: any) => {
        const key = o.marketer;
        if (!comboMap[key]) comboMap[key] = new Set();
        if (o.tracking_link_id) comboMap[key].add(o.tracking_link_id);
      });
      return Object.entries(comboMap)
        .map(([label, ids]) => ({ label, trackingLinkIds: Array.from(ids) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
  });

  // Fetch marketer+offer_id per tracking_link_id for table display
  const { data: linkMarketerMap = {} } = useQuery({
    queryKey: ["onlytraffic_orders_link_marketer_map"],
    queryFn: async () => {
      const raw = await getOnlytrafficOrders();
      const data = (raw as any[]).filter((o: any) => o.marketer != null);
      if (!data) return {};
      // Build map: tracking_link_id → { marketer, offer_id }
      // Also track which marketers have multiple offer_ids
      const marketerOffers: Record<string, Set<number>> = {};
      data.forEach((o: any) => {
        if (!o.marketer) return;
        if (!marketerOffers[o.marketer]) marketerOffers[o.marketer] = new Set();
        if (o.offer_id != null) marketerOffers[o.marketer].add(o.offer_id);
      });
      const multiOffer = new Set<string>();
      Object.entries(marketerOffers).forEach(([m, offers]) => {
        if (offers.size > 1) multiOffer.add(m);
      });
      // Build per-link map (first order wins)
      const map: Record<string, { marketer: string; offer_id: number | null; showOfferId: boolean }> = {};
      data.forEach((o: any) => {
        if (!o.tracking_link_id || map[o.tracking_link_id]) return;
        map[o.tracking_link_id] = {
          marketer: o.marketer,
          offer_id: o.offer_id,
          showOfferId: multiOffer.has(o.marketer) && o.offer_id != null,
        };
      });
      return map;
    },
  });

  // Base filtered (search + marketer) — used for activity counts so the
  // All/Active/Inactive numbers always reflect the user's other filters.
  const baseFilteredLinks = useMemo(() => {
    let result = links;
    if (selectedMarketer !== "__all__") {
      const combo = orderMarketerCombos.find(c => c.label === selectedMarketer);
      if (combo) {
        const idSet = new Set(combo.trackingLinkIds);
        result = result.filter(l => idSet.has(l.id));
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(l => {
        const name = (l.campaign_name || "").toLowerCase();
        const url = (l.url || "").toLowerCase();
        const orderId = (l.onlytraffic_order_id || "").toLowerCase();
        return name.includes(q) || url.includes(q) || orderId.includes(q);
      });
    }
    return result;
  }, [links, selectedMarketer, searchQuery, orderMarketerCombos]);

  // Activity counts (snapshot-derived) over the base-filtered set
  const activityCounts = useMemo(() => {
    let active = 0;
    for (const l of baseFilteredLinks) if (getActiveInfo(l.id, activeLookup).isActive) active++;
    return { total: baseFilteredLinks.length, active };
  }, [baseFilteredLinks, activeLookup]);

  // Final filteredLinks — applies activity filter on top of base
  const filteredLinks = useMemo(() => {
    if (activityFilter === "all") return baseFilteredLinks;
    if (activityFilter === "active") {
      return baseFilteredLinks.filter(l => getActiveInfo(l.id, activeLookup).isActive);
    }
    return baseFilteredLinks.filter(l => !getActiveInfo(l.id, activeLookup).isActive);
  }, [baseFilteredLinks, activityFilter, activeLookup]);

  // Sorting
  const sorted = useMemo(() => {
    const getValue = (l: any): number | string => {
      const spend = Number(l.cost_total || 0);
      const rev = Number(l.revenue || 0);
      const profit = spend > 0 ? rev - spend : -Infinity;
      const roi = spend > 0 ? (rev - spend) / spend * 100 : -Infinity;
      const subs = l.subscribers || 0;
      const profitSub = spend > 0 && subs > 0 ? (rev - spend) / subs : -Infinity;
      const ltvSub = subs > 0 ? rev / subs : -Infinity;
      switch (sortKey) {
        case "campaign": return (l.campaign_name || "").toLowerCase();
        case "model": return (l.accounts?.username || "").toLowerCase();
        case "marketer": return (l.onlytraffic_marketer || "").toLowerCase();
        case "clicks": return l.clicks || 0;
        case "subs": return subs;
        case "revenue": return rev;
        case "spend": return spend;
        case "profit": return profit;
        case "roi": return roi;
        case "profitSub": return profitSub;
        case "ltvSub": return ltvSub;
        case "created": return new Date(l.created_at).getTime();
        case "status": return spend <= 0 ? -2 : roi;
        case "source": return (l.source_tag || "").toLowerCase();
        case "orderId": return (l.onlytraffic_order_id || "").toLowerCase();
        default: return 0;
      }
    };
    return [...filteredLinks].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === "string" && typeof vb === "string") return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [filteredLinks, sortKey, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
    setPage(0);
  };

  const handleAssignSource = async (linkId: string, tag: string) => {
    const actualTag = tag === "__add_manual__" ? "Manual" : tag;
    setSavingIds(prev => new Set(prev).add(linkId));
    try {
      await updateTrackingLink(linkId, { source_tag: actualTag, traffic_category: "Manual", manually_tagged: true });
      onTagLink(linkId, actualTag);
      toast.success(`Tagged as "${actualTag}"`);
    } catch (e: any) {
      toast.error("Failed to tag: " + (e.message || "Unknown error"));
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(linkId); return n; });
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  return (
    <div className="space-y-4">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: "13px", fontWeight: 500 }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to {categoryName}
      </button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sourceColor }} />
          <span className="text-foreground" style={{ fontSize: "18px", fontWeight: 600 }}>{sourceName}</span>
        </div>
        <span className="text-muted-foreground" style={{ fontSize: "12px" }}>{filteredLinks.length} campaigns{filteredLinks.length !== links.length ? ` (of ${links.length})` : ""}</span>
      </div>

      {/* Search + Marketer filter + Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder={isOnlyTraffic ? "Search campaign name, URL, or Order ID..." : "Search campaign name or URL..."}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setPage(0); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={selectedMarketer} onValueChange={v => { setSelectedMarketer(v); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm w-[160px]">
            <SelectValue placeholder="All Marketers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Marketers</SelectItem>
            {orderMarketerCombos.map(c => (
              <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={`${sortKey}__${sortAsc ? "asc" : "desc"}`} onValueChange={v => {
          const [k, d] = v.split("__") as [SortKey, string];
          setSortKey(k);
          setSortAsc(d === "asc");
          setPage(0);
        }}>
          <SelectTrigger className="h-9 text-sm w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created__desc">Newest First</SelectItem>
            <SelectItem value="created__asc">Oldest First</SelectItem>
            <SelectItem value="revenue__desc">Highest Revenue</SelectItem>
            <SelectItem value="spend__desc">Highest Spend</SelectItem>
            <SelectItem value="profit__desc">Highest Profit</SelectItem>
            <SelectItem value="roi__desc">Highest ROI</SelectItem>
            <SelectItem value="subs__desc">Most Subs</SelectItem>
            <SelectItem value="clicks__desc">Most Clicks</SelectItem>
            <SelectItem value="ltvSub__desc">Highest LTV/Sub</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Activity filter — All / Active / Inactive (snapshot-derived) */}
      <LinkActivityFilter
        value={activityFilter}
        onChange={(v) => { setActivityFilter(v); setPage(0); }}
        totalCount={activityCounts.total}
        activeCount={activityCounts.active}
      />

      {/* Campaign table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className={thClass} onClick={() => handleSort("campaign")}>Campaign <SortIcon col="campaign" /></TableHead>
              <TableHead className={thClass} onClick={() => handleSort("model")}>Model <SortIcon col="model" /></TableHead>
              <TableHead className={thClass} onClick={() => handleSort("marketer")}>Marketer <SortIcon col="marketer" /></TableHead>
              {isOnlyTraffic && (
                <TableHead className={thClass} onClick={() => handleSort("orderId")}>Order ID <SortIcon col="orderId" /></TableHead>
              )}
              {isUntaggedView && (
                <TableHead className={`${thClass}`} onClick={() => handleSort("source")}>Source <SortIcon col="source" /></TableHead>
              )}
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("clicks")}>Clicks <SortIcon col="clicks" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("subs")}>Subs <SortIcon col="subs" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("spend")}>Spend <SortIcon col="spend" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("revenue")}>Revenue <SortIcon col="revenue" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profit")}>Profit <SortIcon col="profit" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profitSub")}>Profit/Sub <SortIcon col="profitSub" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("ltvSub")}>LTV/Sub <SortIcon col="ltvSub" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("roi")}>ROI <SortIcon col="roi" /></TableHead>
              <TableHead className={thClass} onClick={() => handleSort("created")}>Created <SortIcon col="created" /></TableHead>
              <TableHead className={`${thClass} text-center`} onClick={() => handleSort("status")}>Status <SortIcon col="status" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(link => {
              const spend = Number(link.cost_total || 0);
              const rev = Number(link.revenue || 0);
              const profit = spend > 0 ? rev - spend : null;
              const roi = spend > 0 ? ((rev - spend) / spend) * 100 : null;
              const subs = link.subscribers || 0;
              const profitSub = spend > 0 && subs > 0 ? (rev - spend) / subs : null;
              const ltvSub = subs > 0 ? rev / subs : null;
              const badge = getStatusBadge(link);
              const username = link.accounts?.username || null;
              const displayName = link.accounts?.display_name || username || "Unknown";
              const avatarUrl = link.accounts?.avatar_thumb_url || null;
              const profitColor = profit !== null ? (profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
              const roiColor = roi !== null ? (roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
              const isSaving = savingIds.has(link.id);
              const activeInfo = getActiveInfo(link.id, activeLookup);

              return (
                <TableRow key={link.id} className="border-border cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setDrawerCampaign(link)}>
                  <TableCell className="max-w-[220px]">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: activeInfo.isActive ? "#16a34a" : "#94a3b8" }} title={activeInfo.isActive ? "Active" : "Inactive"} />
                      <p className="text-foreground font-semibold truncate" style={{ fontSize: "12px" }}>{link.campaign_name || "—"}</p>
                    </div>
                    <p className="text-muted-foreground truncate" style={{ fontSize: "10px", paddingLeft: "14px" }}>{link.url}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ModelAvatar avatarUrl={avatarUrl} name={displayName} size={20} />
                      <span className="text-foreground" style={{ fontSize: "12px" }}>@{username || "unknown"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-foreground" style={{ fontSize: "12px" }}>
                      {(() => {
                        const info = (linkMarketerMap as any)[link.id];
                        if (info) {
                          return info.showOfferId
                            ? <>{info.marketer} <span className="text-muted-foreground text-[10px]">#{info.offer_id}</span></>
                            : info.marketer;
                        }
                        return link.onlytraffic_marketer || "—";
                      })()}
                    </span>
                  </TableCell>
                  {isOnlyTraffic && (
                    <TableCell>
                      <span className="text-foreground font-mono" style={{ fontSize: "11px" }}>{link.onlytraffic_order_id || "—"}</span>
                    </TableCell>
                  )}
                  {isUntaggedView && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!link.source_tag ? (
                        <Select
                          disabled={isSaving}
                          onValueChange={(val) => handleAssignSource(link.id, val)}
                        >
                          <SelectTrigger className="h-7 w-[130px] text-[11px] border-border bg-background">
                            <SelectValue placeholder={isSaving ? "Saving…" : "Assign source"} />
                          </SelectTrigger>
                          <SelectContent>
                            {sourceTagOptions.map(tag => (
                              <SelectItem key={tag} value={tag} className="text-[11px]">{tag}</SelectItem>
                            ))}
                            <SelectItem value="__add_manual__" className="text-[11px] text-blue-500 font-semibold">
                              + Add to Manual
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-foreground" style={{ fontSize: "12px" }}>{link.source_tag}</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtN(link.clicks || 0)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtN(subs)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>
                    {fmtC(spend)}
                    {link.payment_type === "CPL" && (
                      <span className="block mt-0.5 rounded-full font-bold text-white" style={{ fontSize: "9px", padding: "2px 6px", backgroundColor: "#0891b2", width: "fit-content", marginLeft: "auto" }}>CPL</span>
                    )}
                    {link.payment_type === "CPC" && (
                      <span className="block mt-0.5 rounded-full font-bold text-white" style={{ fontSize: "9px", padding: "2px 6px", backgroundColor: "#d97706", width: "fit-content", marginLeft: "auto" }}>CPC</span>
                    )}
                    {link.payment_type === "Fixed" && (
                      <span className="block mt-0.5 rounded-full font-bold text-white" style={{ fontSize: "9px", padding: "2px 6px", backgroundColor: "#64748b", width: "fit-content", marginLeft: "auto" }}>Fixed</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: "hsl(173 80% 36%)" }}>{fmtC(rev)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: profitColor }}>{profit !== null ? fmtC(profit) : "—"}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: profitColor }}>{profitSub !== null ? fmtC(profitSub) : "—"}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: "#0891b2" }}>{ltvSub !== null ? fmtC(ltvSub) : "—"}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: roiColor }}>{roi !== null ? fmtPct(roi) : "—"}</TableCell>
                  <TableCell>
                    {(() => {
                      const ageDays = Math.max(0, differenceInDays(new Date(), new Date(link.created_at)));
                      const pill = getAgePill(ageDays);
                      return (
                        <div>
                          <p className="text-foreground" style={{ fontSize: "11px" }}>{format(new Date(link.created_at), "MMM d, yyyy")}</p>
                          <span className="inline-block mt-0.5 rounded-full font-bold" style={{ fontSize: "9px", padding: "1px 6px", backgroundColor: pill.bg, color: pill.text }}>{pill.label}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
                      {badge.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={isUntaggedView ? 15 : isOnlyTraffic ? 14 : 13} className="text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>
                  No campaigns found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-foreground font-mono" style={{ fontSize: "12px" }}>{page + 1} / {totalPages}</span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4 rotate-180" />
              </button>
            </div>
          </div>
        )}
      </div>
      <CampaignDetailDrawer campaign={drawerCampaign} onClose={() => setDrawerCampaign(null)} />
    </div>
  );
}


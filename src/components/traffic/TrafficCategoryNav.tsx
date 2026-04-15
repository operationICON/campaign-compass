import React, { useState, useMemo } from "react";
import { ArrowLeft, ChevronRight, Zap, Globe, DollarSign, TrendingUp, Users, Percent, BarChart3, AlertTriangle, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { getEffectiveSource } from "@/lib/source-helpers";
import { useTagColors } from "@/components/TagBadge";
import { differenceInDays, format } from "date-fns";
import { TrafficSourceDetail } from "./TrafficSourceDetail";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UnmatchedOrdersCard } from "./UnmatchedOrdersCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calcStatus, STATUS_STYLES, STATUS_LABELS } from "@/lib/calc-helpers";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { ModelAvatar } from "@/components/ModelAvatar";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

interface Props {
  links: any[];
  allLinks: any[];
  onTagLink?: (linkId: string, sourceTag: string) => void;
  unmatchedOrders?: { count: number; spend: number };
  onLevelChange?: (level: 1 | 2 | 3) => void;
}

type Category = "OnlyTraffic" | "Manual";
type TableSortPreset = "highest_revenue" | "highest_profit" | "most_spend" | "highest_roi" | "most_campaigns";
type ColSortKey = "campaign" | "model" | "source" | "marketer" | "orderId" | "clicks" | "subs" | "spend" | "revenue" | "profit" | "profitSub" | "ltvSub" | "roi" | "created" | "status";

function isOnlyTraffic(link: any): boolean {
  return link.traffic_category === "OnlyTraffic";
}

function isManual(link: any): boolean {
  return link.traffic_category === "Manual";
}

function calcCategoryMetrics(catLinks: any[]) {
  const spend = catLinks
    .filter(l => Number(l.cost_total || 0) > 0)
    .reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const revenue = catLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
  const profit = revenue - spend;
  const subs = catLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const roi = spend > 0 ? (profit / spend) * 100 : null;

  const cplLinks = catLinks.filter(l => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
  const cplSpend = cplLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const cplSubs = cplLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;

  const profitPerSub = spend > 0 && subs > 0 ? profit / subs : null;
  const ltvPerSub = subs > 0 ? revenue / subs : null;

  const ages = catLinks.map(l => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
  const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 1;
  const subsDay = avgAge > 0 ? subs / avgAge : 0;

  const campaigns = catLinks.length;
  const sourceTags = new Set<string>();
  catLinks.forEach(l => {
    const es = getEffectiveSource(l);
    if (es) sourceTags.add(es);
  });
  const activeSources = sourceTags.size;

  return { spend, revenue, profit, roi, avgCpl, profitPerSub, ltvPerSub, subsDay, campaigns, activeSources, subs };
}

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

function getAgePill(days: number): { label: string; bg: string; text: string } {
  if (days <= 30) return { label: `${days}d`, bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 45%)" };
  if (days <= 90) return { label: `${days}d`, bg: "hsl(199 89% 48% / 0.15)", text: "hsl(199 89% 48%)" };
  if (days <= 180) return { label: `${days}d`, bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  return { label: `${days}d`, bg: "hsl(220 9% 46% / 0.15)", text: "hsl(220 9% 46%)" };
}

const PAGE_SIZE = 25;

export function TrafficCategoryNav({ links, allLinks, onTagLink, unmatchedOrders, onLevelChange }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeUnmatched, setActiveUnmatched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMarketer, setSelectedMarketer] = useState<string>("__all__");
  const [sourceFilterL2, setSourceFilterL2] = useState<string>("__all__");
  const [accountFilterL2, setAccountFilterL2] = useState<string>("__all__");
  const [tableSortPreset, setTableSortPreset] = useState<TableSortPreset>("highest_revenue");
  const [colSortKey, setColSortKey] = useState<ColSortKey>("revenue");
  const [colSortAsc, setColSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);
  const colorMap = useTagColors();

  // Fetch accounts for dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, username, display_name, avatar_thumb_url").order("display_name");
      return data || [];
    },
  });

  // Fetch distinct marketer combos
  const { data: orderMarketerCombos = [] } = useQuery({
    queryKey: ["onlytraffic_orders_marketer_combos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onlytraffic_orders")
        .select("marketer, source, tracking_link_id, offer_id")
        .not("marketer", "is", null);
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

  // Fetch marketer+offer_id per tracking_link_id
  const { data: linkMarketerMap = {} } = useQuery({
    queryKey: ["onlytraffic_orders_link_marketer_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onlytraffic_orders")
        .select("tracking_link_id, marketer, offer_id")
        .not("marketer", "is", null);
      if (!data) return {};
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

  const setCategoryAndNotify = (cat: Category | null) => {
    setActiveCategory(cat);
    setActiveUnmatched(false);
    setSearchQuery("");
    setSelectedMarketer("__all__");
    setSourceFilterL2("__all__");
    setAccountFilterL2("__all__");
    setTableSortPreset("highest_revenue");
    setPage(0);
    if (!cat) onLevelChange?.(1);
    else onLevelChange?.(2);
  };

  const otLinks = useMemo(() => allLinks.filter(l => isOnlyTraffic(l) && l.deleted_at == null), [allLinks]);
  const manualOnlyLinks = useMemo(() => allLinks.filter(l => isManual(l) && l.deleted_at == null), [allLinks]);
  const noSourceLinks = useMemo(() => allLinks.filter(l =>
    l.traffic_category == null &&
    l.deleted_at == null &&
    (l.clicks > 0 || l.subscribers > 0 || Number(l.revenue || 0) > 0)
  ), [allLinks]);
  const noSourceCount = noSourceLinks.length;
  const manualLinks = useMemo(() => [...manualOnlyLinks, ...noSourceLinks], [manualOnlyLinks, noSourceLinks]);

  const otMetrics = useMemo(() => calcCategoryMetrics(otLinks), [otLinks]);
  const manualMetrics = useMemo(() => calcCategoryMetrics(manualLinks), [manualLinks]);

  // Category links (all campaigns in the selected category)
  const categoryLinksRaw = activeCategory === "OnlyTraffic" ? otLinks : manualLinks;

  // Apply all filters
  const filteredLinks = useMemo(() => {
    let result = categoryLinksRaw;

    // Marketer filter
    if (selectedMarketer !== "__all__") {
      const combo = orderMarketerCombos.find(c => c.label === selectedMarketer);
      if (combo) {
        const idSet = new Set(combo.trackingLinkIds);
        result = result.filter(l => idSet.has(l.id));
      }
    }

    // Source filter
    if (sourceFilterL2 !== "__all__") {
      if (sourceFilterL2 === "__untagged__") {
        result = result.filter(l => !getEffectiveSource(l));
      } else {
        result = result.filter(l => getEffectiveSource(l) === sourceFilterL2);
      }
    }

    // Account filter
    if (accountFilterL2 !== "__all__") {
      result = result.filter(l => l.account_id === accountFilterL2);
    }

    // Search
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
  }, [categoryLinksRaw, selectedMarketer, sourceFilterL2, accountFilterL2, searchQuery, orderMarketerCombos]);

  // Column sort handler
  const handleColSort = (key: ColSortKey) => {
    if (colSortKey === key) setColSortAsc(!colSortAsc);
    else { setColSortKey(key); setColSortAsc(false); }
    setPage(0);
  };

  // Apply preset → sets colSortKey/colSortAsc
  const applyPreset = (preset: TableSortPreset) => {
    setTableSortPreset(preset);
    switch (preset) {
      case "highest_revenue": setColSortKey("revenue"); setColSortAsc(false); break;
      case "highest_profit": setColSortKey("profit"); setColSortAsc(false); break;
      case "most_spend": setColSortKey("spend"); setColSortAsc(false); break;
      case "highest_roi": setColSortKey("roi"); setColSortAsc(false); break;
      case "most_campaigns": setColSortKey("source"); setColSortAsc(false); break;
    }
    setPage(0);
  };

  // Sort by column
  const finalSorted = useMemo(() => {
    const getValue = (l: any): number | string => {
      const spend = Number(l.cost_total || 0);
      const rev = Number(l.revenue || 0);
      const subs = l.subscribers || 0;
      switch (colSortKey) {
        case "campaign": return (l.campaign_name || "").toLowerCase();
        case "model": return (l.accounts?.username || "").toLowerCase();
        case "source": return (getEffectiveSource(l) || "zzz").toLowerCase();
        case "marketer": return (l.onlytraffic_marketer || "zzz").toLowerCase();
        case "orderId": return (l.onlytraffic_order_id || "").toLowerCase();
        case "clicks": return l.clicks || 0;
        case "subs": return subs;
        case "spend": return spend;
        case "revenue": return rev;
        case "profit": return spend > 0 ? rev - spend : -Infinity;
        case "profitSub": return spend > 0 && subs > 0 ? (rev - spend) / subs : -Infinity;
        case "ltvSub": return subs > 0 ? rev / subs : -Infinity;
        case "roi": return spend > 0 ? ((rev - spend) / spend) * 100 : -Infinity;
        case "created": return new Date(l.created_at).getTime();
        case "status": return spend <= 0 ? -2 : ((rev - spend) / spend) * 100;
        default: return 0;
      }
    };
    return [...filteredLinks].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === "string" && typeof vb === "string") return colSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return colSortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [filteredLinks, colSortKey, colSortAsc]);

  const totalPages = Math.ceil(finalSorted.length / PAGE_SIZE);
  const pageRows = finalSorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Build source options for the dropdown
  const sourceOptions = useMemo(() => {
    const tags = new Set<string>();
    categoryLinksRaw.forEach(l => {
      const es = getEffectiveSource(l);
      if (es) tags.add(es);
    });
    return [...tags].sort();
  }, [categoryLinksRaw]);

  // KPIs for filtered view
  const kpis = useMemo(() => {
    const spend = filteredLinks.filter(l => Number(l.cost_total || 0) > 0).reduce((s, l) => s + Number(l.cost_total || 0), 0);
    const revenue = filteredLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
    const profit = revenue - spend;
    const subs = filteredLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    const cplLinks = filteredLinks.filter(l => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
    const cplSpend = cplLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
    const cplSubs = cplLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
    const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;
    const profitPerSub = spend > 0 && subs > 0 ? profit / subs : null;
    const ltvPerSub = subs > 0 ? revenue / subs : null;
    const ages = filteredLinks.map(l => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
    const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 1;
    const subsDay = avgAge > 0 ? subs / avgAge : 0;
    return { spend, revenue, profit, avgCpl, profitPerSub, ltvPerSub, subsDay, roi };
  }, [filteredLinks]);

  const isOT = activeCategory === "OnlyTraffic";

  // ═══ UNMATCHED ORDERS VIEW ═══
  if (activeUnmatched) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setActiveUnmatched(false); setCategoryAndNotify("OnlyTraffic"); }}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontSize: "13px", fontWeight: 500 }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to OnlyTraffic
        </button>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4" style={{ color: "#d97706" }} />
            <span className="text-foreground" style={{ fontSize: "18px", fontWeight: 600 }}>Unmatched Orders</span>
          </div>
          <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
            Orders that could not be matched to any tracking link
          </span>
        </div>
        <UnmatchedOrdersCard />
      </div>
    );
  }

  // ═══ LEVEL 1 ═══
  if (!activeCategory) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground" style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Traffic Categories
        </p>
        <div className="grid grid-cols-2 gap-4">
          {/* OnlyTraffic Card */}
          <button
            onClick={() => setCategoryAndNotify("OnlyTraffic")}
            className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary/40 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-emerald-500" />
              <span className="text-foreground font-bold text-base">OnlyTraffic</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-500">API</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <MetricRow label="Spend" value={fmtC(otMetrics.spend)} />
              <MetricRow label="Revenue" value={fmtC(otMetrics.revenue)} />
              <MetricRow label="Profit" value={fmtC(otMetrics.profit)} color={otMetrics.profit >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))"} />
              <MetricRow label="Avg CPL" value={otMetrics.avgCpl !== null ? fmtC(otMetrics.avgCpl) : "—"} />
              <MetricRow label="ROI" value={otMetrics.roi !== null ? fmtPct(otMetrics.roi) : "—"} color={otMetrics.roi !== null ? (otMetrics.roi >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))") : undefined} />
              <MetricRow label="Campaigns" value={fmtN(otMetrics.campaigns)} />
            </div>
            {unmatchedOrders && unmatchedOrders.count > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" style={{ color: "#d97706" }} />
                          <span className="font-semibold" style={{ fontSize: "11px", color: "#d97706" }}>Unmatched</span>
                        </div>
                        <span className="font-mono font-semibold" style={{ fontSize: "11px", color: "#d97706" }}>
                          {fmtN(unmatchedOrders.count)} orders · {fmtC(unmatchedOrders.spend)}
                        </span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                    Orders from OnlyTraffic that could not be matched to any tracking link — null URLs or trial links
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{otMetrics.activeSources} active sources</span>
              <span className="text-emerald-500 font-semibold flex items-center gap-0.5 group-hover:gap-1.5 transition-all" style={{ fontSize: "12px" }}>
                View campaigns <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </button>

          {/* Manual Card */}
          <button
            onClick={() => setCategoryAndNotify("Manual")}
            className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary/40 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-blue-500" />
              <span className="text-foreground font-bold text-base">Manual</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-500">Direct</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <MetricRow label="Spend" value={fmtC(manualMetrics.spend)} />
              <MetricRow label="Revenue" value={fmtC(manualMetrics.revenue)} />
              <MetricRow label="Profit" value={fmtC(manualMetrics.profit)} color={manualMetrics.profit >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))"} />
              <MetricRow label="Avg CPL" value={manualMetrics.avgCpl !== null ? fmtC(manualMetrics.avgCpl) : "—"} />
              <MetricRow label="ROI" value={manualMetrics.spend > 0 && manualMetrics.roi !== null ? fmtPct(manualMetrics.roi) : "—"} color={manualMetrics.spend > 0 && manualMetrics.roi !== null ? (manualMetrics.roi >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))") : undefined} />
              <MetricRow label="Campaigns" value={fmtN(manualMetrics.campaigns)} />
            </div>
            {noSourceCount > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground" style={{ fontSize: "11px", fontWeight: 600 }}>Includes No Source</span>
                  <span className="font-mono font-semibold text-muted-foreground" style={{ fontSize: "11px" }}>
                    {fmtN(noSourceCount)} campaigns
                  </span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{manualMetrics.activeSources} active sources</span>
              <span className="text-blue-500 font-semibold flex items-center gap-0.5 group-hover:gap-1.5 transition-all" style={{ fontSize: "12px" }}>
                View campaigns <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ═══ CAMPAIGN TABLE VIEW (was Level 2 + 3, now merged) ═══
  const catColor = activeCategory === "OnlyTraffic" ? "text-emerald-500" : "text-blue-500";
  const catBadgeBg = activeCategory === "OnlyTraffic" ? "bg-emerald-500/15 text-emerald-500" : "bg-blue-500/15 text-blue-500";
  const catBadgeLabel = activeCategory === "OnlyTraffic" ? "API" : "Direct";
  const CatIcon = activeCategory === "OnlyTraffic" ? Zap : Globe;

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={() => setCategoryAndNotify(null)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: "13px", fontWeight: 500 }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Sources
      </button>

      {/* Header */}
      <div className="flex items-center gap-2">
        <CatIcon className={`h-5 w-5 ${catColor}`} />
        <span className="text-foreground font-bold text-lg">{activeCategory}</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${catBadgeBg}`}>{catBadgeLabel}</span>
        <span className="text-muted-foreground" style={{ fontSize: "12px", marginLeft: "4px" }}>
          {filteredLinks.length} campaign{filteredLinks.length !== 1 ? "s" : ""}
          {filteredLinks.length !== categoryLinksRaw.length ? ` (of ${categoryLinksRaw.length})` : ""}
        </span>
      </div>

      {/* Sub-KPI row */}
      <div className="grid grid-cols-8 gap-2">
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Spend" value={fmtC(kpis.spend)} color="#dc2626" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Revenue" value={fmtC(kpis.revenue)} color="#16a34a" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Profit" value={fmtC(kpis.profit)} color={kpis.profit >= 0 ? "#16a34a" : "#dc2626"} />
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Avg CPL" value={kpis.avgCpl !== null ? fmtC(kpis.avgCpl) : "—"} color="#0891b2" />
        <SubKpi icon={<Users className="h-3.5 w-3.5" />} label="Profit/Sub" value={kpis.profitPerSub !== null ? fmtC(kpis.profitPerSub) : "—"} color={kpis.profitPerSub !== null ? (kpis.profitPerSub >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
        <SubKpi icon={<BarChart3 className="h-3.5 w-3.5" />} label="Subs/Day" value={kpis.subsDay > 0 ? kpis.subsDay.toFixed(1) : "0"} color="#d97706" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="LTV/Sub" value={kpis.ltvPerSub !== null ? fmtC(kpis.ltvPerSub) : "—"} color="#0891b2" />
        <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="ROI" value={kpis.roi !== null ? fmtPct(kpis.roi) : "—"} color={kpis.roi !== null ? (kpis.roi >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
      </div>

      {/* Filter row 1: All Sources, All Accounts, Sort */}
      <div className="grid grid-cols-3 gap-3">
        <Select value={sourceFilterL2} onValueChange={v => { setSourceFilterL2(v); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Sources</SelectItem>
            {sourceOptions.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
            <SelectItem value="__untagged__">Untagged</SelectItem>
          </SelectContent>
        </Select>

        <Select value={accountFilterL2} onValueChange={v => { setAccountFilterL2(v); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="All Accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Accounts</SelectItem>
            {accounts.map((a: any) => (
              <SelectItem key={a.id} value={a.id}>@{(a.username || "").replace("@", "")} — {a.display_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tableSortPreset} onValueChange={v => { setTableSortPreset(v as TableSortPreset); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="highest_revenue">Highest Revenue</SelectItem>
            <SelectItem value="highest_profit">Highest Profit</SelectItem>
            <SelectItem value="most_spend">Most Spend</SelectItem>
            <SelectItem value="highest_roi">Highest ROI</SelectItem>
            <SelectItem value="most_campaigns">Most Campaigns</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filter row 2: Search + Marketer */}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder={isOT ? "Search campaign name, URL or Order ID..." : "Search campaign name or URL..."}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); setPage(0); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={selectedMarketer} onValueChange={v => { setSelectedMarketer(v); setPage(0); }}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="All Marketers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Marketers</SelectItem>
            {orderMarketerCombos.map(c => (
              <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Unmatched Orders link (OnlyTraffic only) */}
      {isOT && unmatchedOrders && unmatchedOrders.count > 0 && (
        <button
          onClick={() => { setActiveUnmatched(true); }}
          className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors w-fit"
        >
          <AlertTriangle className="h-3.5 w-3.5" style={{ color: "#d97706" }} />
          <span className="font-semibold" style={{ fontSize: "12px", color: "#d97706" }}>
            {fmtN(unmatchedOrders.count)} Unmatched Orders · {fmtC(unmatchedOrders.spend)}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      {/* Campaign table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className={thClass}>Campaign</TableHead>
              <TableHead className={thClass}>Model</TableHead>
              <TableHead className={thClass}>Source</TableHead>
              <TableHead className={thClass}>Marketer</TableHead>
              {isOT && <TableHead className={thClass}>Order ID</TableHead>}
              <TableHead className={`${thClass} text-right`}>Clicks</TableHead>
              <TableHead className={`${thClass} text-right`}>Subs</TableHead>
              <TableHead className={`${thClass} text-right`}>Spend</TableHead>
              <TableHead className={`${thClass} text-right`}>Revenue</TableHead>
              <TableHead className={`${thClass} text-right`}>Profit</TableHead>
              <TableHead className={`${thClass} text-right`}>Profit/Sub</TableHead>
              <TableHead className={`${thClass} text-right`}>LTV/Sub</TableHead>
              <TableHead className={`${thClass} text-right`}>ROI</TableHead>
              <TableHead className={thClass}>Created</TableHead>
              <TableHead className={`${thClass} text-center`}>Status</TableHead>
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
              const source = getEffectiveSource(link) || "Untagged";

              return (
                <TableRow key={link.id} className="border-border cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setDrawerCampaign(link)}>
                  <TableCell className="max-w-[220px]">
                    <p className="text-foreground font-semibold truncate" style={{ fontSize: "12px" }}>{link.campaign_name || "—"}</p>
                    <p className="text-muted-foreground truncate" style={{ fontSize: "10px" }}>{link.url}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ModelAvatar avatarUrl={avatarUrl} name={displayName} size={20} />
                      <span className="text-foreground" style={{ fontSize: "12px" }}>@{username || "unknown"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-foreground" style={{ fontSize: "12px" }}>{source}</span>
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
                  {isOT && (
                    <TableCell>
                      <span className="text-foreground font-mono" style={{ fontSize: "11px" }}>{link.onlytraffic_order_id || "—"}</span>
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
                <TableCell colSpan={isOT ? 15 : 14} className="text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>
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
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, finalSorted.length)} of {finalSorted.length}
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

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{label}</span>
      <span className="font-mono font-semibold" style={{ fontSize: "12px", color }}>{value}</span>
    </div>
  );
}

function SubKpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border px-2 py-2 rounded-lg" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-1 mb-0.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-muted-foreground" style={{ fontSize: "9px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <p className="font-mono font-bold text-foreground" style={{ fontSize: "13px" }}>{value}</p>
    </div>
  );
}

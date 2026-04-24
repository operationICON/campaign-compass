import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Zap, Globe, DollarSign, TrendingUp, Users, Percent, BarChart3, AlertTriangle, Search, X, ChevronUp, ChevronDown, LayoutGrid } from "lucide-react";
import { getEffectiveSource } from "@/lib/source-helpers";
import { useTagColors } from "@/components/TagBadge";
import { differenceInDays, format } from "date-fns";
import { TrafficSourceDetail } from "./TrafficSourceDetail";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UnmatchedOrdersCard } from "./UnmatchedOrdersCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calcStatus, STATUS_STYLES, STATUS_LABELS, getCostTypeFromOrderId, deriveCostLabel, calcCostMetric, type CostTypeFromOrder } from "@/lib/calc-helpers";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { ModelAvatar } from "@/components/ModelAvatar";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { getAccounts, getOnlytrafficOrders } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { LinkActivityFilter, type LinkActivityFilterValue } from "@/components/LinkActivityFilter";
import { useActiveLinkStatus, getActiveInfo } from "@/hooks/useActiveLinkStatus";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

interface Props {
  links: any[];
  allLinks: any[];
  onTagLink?: (linkId: string, sourceTag: string) => void;
  unmatchedOrders?: { count: number; spend: number };
  onLevelChange?: (level: 1 | 2 | 3) => void;
  initialCategory?: Category;
}

type Category = "OnlyTraffic" | "Manual";
type TableSortPreset = "newest_first" | "highest_revenue" | "highest_profit" | "most_spend" | "highest_roi" | "most_campaigns";
type ColSortKey = "campaign" | "model" | "source" | "marketer" | "offerId" | "orderId" | "clicks" | "subs" | "spend" | "revenue" | "profit" | "profitSub" | "ltvSub" | "roi" | "created" | "status";

function isOnlyTraffic(link: any): boolean {
  return link.traffic_category === "OnlyTraffic";
}

function isManual(link: any): boolean {
  return link.traffic_category === "Manual";
}

function calcCategoryMetrics(catLinks: any[], linkMarketerMapData?: Record<string, any>) {
  const spend = catLinks
    .filter(l => Number(l.cost_total || 0) > 0)
    .reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const revenue = catLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
  const profit = revenue - spend;
  const subs = catLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const clicks = catLinks.reduce((s, l) => s + (l.clicks || 0), 0);
  const roi = spend > 0 ? (profit / spend) * 100 : null;

  // Derive cost type from order_id prefixes
  const costTypes = new Set<CostTypeFromOrder>();
  if (linkMarketerMapData) {
    catLinks.forEach(l => {
      const info = linkMarketerMapData[l.id];
      if (info?.order_ids) {
        info.order_ids.forEach((oid: string) => {
          const ct = getCostTypeFromOrderId(oid);
          if (ct) costTypes.add(ct);
        });
      }
    });
  }
  const costLabel = deriveCostLabel(costTypes);
  const costMetric = calcCostMetric(costLabel, spend, subs, clicks);

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

  return { spend, revenue, profit, roi, avgCpl: costMetric.value, avgCplLabel: costMetric.label, profitPerSub, ltvPerSub, subsDay, campaigns, activeSources, subs };
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

export function TrafficCategoryNav({ links, allLinks, onTagLink, unmatchedOrders, onLevelChange, initialCategory }: Props) {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<Category | null>(initialCategory || null);
  const [activeUnmatched, setActiveUnmatched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMarketer, setSelectedMarketer] = useState<string>("__all__");
  const [selectedCostType, setSelectedCostType] = useState<string>("__all__");
  const [sourceFilterL2, setSourceFilterL2] = useState<string>("__all__");
  const [accountFilterL2, setAccountFilterL2] = useState<string>("__all__");
  const [offerIdFilter, setOfferIdFilter] = useState<string>("__all__");
  const [tableSortPreset, setTableSortPreset] = useState<TableSortPreset>("newest_first");
  const [colSortKey, setColSortKey] = useState<ColSortKey>("created");
  const [colSortAsc, setColSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);
  const [showMarketerAnalytics, setShowMarketerAnalytics] = useState(false);
  const [expandedMarketer, setExpandedMarketer] = useState<string | null>(null);
  const colorMap = useTagColors();
  const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<string>("__all__");
  const [sourcePage, setSourcePage] = useState(0);
  const [sourceSortKey, setSourceSortKey] = useState<string>("profit");
  const [sourceSortAsc, setSourceSortAsc] = useState(false);
  const [activityFilter, setActivityFilter] = useState<LinkActivityFilterValue>("all");

  // Snapshot-derived active status for ALL links (filter applies to the L2 source-group table)
  const { activeLookup } = useActiveLinkStatus(null);

  // Notify parent if starting with an initial category
  React.useEffect(() => {
    if (initialCategory) onLevelChange?.(2);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch accounts for dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  // Fetch distinct marketer combos
  const { data: orderMarketerCombos = [] } = useQuery({
    queryKey: ["onlytraffic_orders_marketer_combos"],
    queryFn: async () => {
      const data = await getOnlytrafficOrders();
      if (!data) return [];
      const filtered = (data as any[]).filter((o: any) => o.marketer != null);
      const comboMap: Record<string, Set<string>> = {};
      filtered.forEach((o: any) => {
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
      const raw = await getOnlytrafficOrders();
      const data = (raw as any[]).filter((o: any) => o.marketer != null);
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
      const map: Record<string, { marketer: string; offer_id: number | null; showOfferId: boolean; order_ids: string[] }> = {};
      data.forEach((o: any) => {
        if (!o.tracking_link_id) return;
        if (!map[o.tracking_link_id]) {
          map[o.tracking_link_id] = {
            marketer: o.marketer,
            offer_id: o.offer_id,
            showOfferId: multiOffer.has(o.marketer) && o.offer_id != null,
            order_ids: [],
          };
        }
        if (o.order_id) map[o.tracking_link_id].order_ids.push(o.order_id);
      });
      return map;
    },
  });

  const setCategoryAndNotify = (cat: Category | null) => {
    setActiveCategory(cat);
    setActiveUnmatched(false);
    setSearchQuery("");
    setSelectedMarketer("__all__");
    setSelectedCostType("__all__");
    setSourceFilterL2("__all__");
    setAccountFilterL2("__all__");
    setOfferIdFilter("__all__");
    setTableSortPreset("newest_first");
    setPage(0);
    setActiveSourceKey(null);
    setQuickFilter("__all__");
    setSourcePage(0);
    setSourceSortKey("profit");
    setSourceSortAsc(false);
    if (!cat) onLevelChange?.(1);
    else onLevelChange?.(2);
  };

  // A link has OT data if it has a source_tag or onlytraffic fields — treat as OT even if traffic_category is null
  const hasOTData = (l: any) => !!(l.source_tag?.trim() || l.onlytraffic_marketer?.trim() || l.onlytraffic_order_id?.trim());

  const otLinks = useMemo(() => allLinks.filter(l =>
    l.deleted_at == null && !isManual(l) && (isOnlyTraffic(l) || hasOTData(l))
  ), [allLinks]);
  const manualOnlyLinks = useMemo(() => allLinks.filter(l => isManual(l) && l.deleted_at == null), [allLinks]);
  const noSourceLinks = useMemo(() => allLinks.filter(l =>
    l.traffic_category == null &&
    !hasOTData(l) &&
    l.deleted_at == null &&
    (l.clicks > 0 || l.subscribers > 0 || Number(l.revenue || 0) > 0)
  ), [allLinks]);
  const noSourceCount = noSourceLinks.length;
  const manualLinks = useMemo(() => [...manualOnlyLinks, ...noSourceLinks], [manualOnlyLinks, noSourceLinks]);

  const otMetrics = useMemo(() => calcCategoryMetrics(otLinks, linkMarketerMap), [otLinks, linkMarketerMap]);
  const manualMetrics = useMemo(() => calcCategoryMetrics(manualLinks, linkMarketerMap), [manualLinks, linkMarketerMap]);

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

    // Cost Type filter
    if (selectedCostType !== "__all__") {
      result = result.filter(l => (l.payment_type || l.cost_type) === selectedCostType);
    }

    // Offer ID filter
    if (offerIdFilter !== "__all__") {
      result = result.filter(l => {
        const linkInfo = linkMarketerMap[l.id];
        if (!linkInfo) return false;
        return offerIdFilter === "__with_offer__" 
          ? linkInfo.offer_id != null 
          : String(linkInfo.offer_id) === offerIdFilter;
      });
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
  }, [categoryLinksRaw, selectedMarketer, selectedCostType, offerIdFilter, sourceFilterL2, accountFilterL2, searchQuery, orderMarketerCombos, linkMarketerMap]);

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
      case "newest_first": setColSortKey("created"); setColSortAsc(false); break;
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
        case "offerId": {
          const info = (linkMarketerMap as any)[l.id];
          return info?.offer_id != null ? info.offer_id : -Infinity;
        }
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

  // Build offer ID options from linkMarketerMap
  const offerIdOptions = useMemo(() => {
    const offers = new Set<number>();
    Object.values(linkMarketerMap).forEach(info => {
      if (info.offer_id != null) offers.add(info.offer_id);
    });
    return [...offers].sort((a, b) => a - b);
  }, [linkMarketerMap]);

  // KPIs for filtered view
  const kpis = useMemo(() => {
    const spend = filteredLinks.filter(l => Number(l.cost_total || 0) > 0).reduce((s, l) => s + Number(l.cost_total || 0), 0);
    const revenue = filteredLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
    const profit = revenue - spend;
    const subs = filteredLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
    const clicks = filteredLinks.reduce((s, l) => s + (l.clicks || 0), 0);
    const roi = spend > 0 ? (profit / spend) * 100 : null;

    // Derive cost type from order_id prefixes
    const costTypes = new Set<CostTypeFromOrder>();
    filteredLinks.forEach(l => {
      const info = (linkMarketerMap as any)[l.id];
      if (info?.order_ids) {
        info.order_ids.forEach((oid: string) => {
          const ct = getCostTypeFromOrderId(oid);
          if (ct) costTypes.add(ct);
        });
      }
    });
    const costLabel = deriveCostLabel(costTypes);
    const costMetric = calcCostMetric(costLabel, spend, subs, clicks);

    const profitPerSub = spend > 0 && subs > 0 ? profit / subs : null;
    const ltvPerSub = subs > 0 ? revenue / subs : null;
    const ages = filteredLinks.map(l => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
    const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 1;
    const subsDay = avgAge > 0 ? subs / avgAge : 0;
    return { spend, revenue, profit, avgCpl: costMetric.value, avgCplLabel: costMetric.label, profitPerSub, ltvPerSub, subsDay, roi };
  }, [filteredLinks, linkMarketerMap]);

  const isOT = activeCategory === "OnlyTraffic";

  // ═══ LEVEL 2 HOOKS — must be before early returns ═══
  const groupedSources = useMemo(() => {
    const groups: Record<string, { marketer: string; sourceTag: string; offerId: number | null; links: any[]; isUnknown: boolean }> = {};
    const UNKNOWN_KEY = "__unknown__";
    for (const link of categoryLinksRaw) {
      const info = (linkMarketerMap as any)[link.id];
      const rawMarketer = info?.marketer || link.onlytraffic_marketer || "";
      const rawSource = getEffectiveSource(link) || link.source || "";
      const isUnknown = !rawMarketer.trim() || !rawSource.trim();
      if (isUnknown) {
        if (!groups[UNKNOWN_KEY]) groups[UNKNOWN_KEY] = { marketer: "Unknown", sourceTag: "Untagged", offerId: null, links: [], isUnknown: true };
        groups[UNKNOWN_KEY].links.push(link);
      } else {
        const offerId = info?.offer_id ?? null;
        const key = `${rawMarketer}__${rawSource}__${offerId ?? "none"}`;
        if (!groups[key]) groups[key] = { marketer: rawMarketer, sourceTag: rawSource, offerId, links: [], isUnknown: false };
        groups[key].links.push(link);
      }
    }
    return Object.entries(groups).map(([key, g]) => {
      const spend = g.links.filter(l => Number(l.cost_total || 0) > 0).reduce((s, l) => s + Number(l.cost_total || 0), 0);
      const revenue = g.links.reduce((s, l) => s + Number(l.revenue || 0), 0);
      const profit = revenue - spend;
      const subs = g.links.reduce((s, l) => s + (l.subscribers || 0), 0);
      const clicks = g.links.reduce((s, l) => s + (l.clicks || 0), 0);
      const roi = spend > 0 ? (profit / spend) * 100 : null;

      // Derive cost type from order_id prefixes
      const costTypes = new Set<CostTypeFromOrder>();
      g.links.forEach(l => {
        const info = (linkMarketerMap as any)[l.id];
        if (info?.order_ids) {
          info.order_ids.forEach((oid: string) => {
            const ct = getCostTypeFromOrderId(oid);
            if (ct) costTypes.add(ct);
          });
        }
      });
      const costLabel = deriveCostLabel(costTypes);
      const costMetric = calcCostMetric(costLabel, spend, subs, clicks);

      const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
      const ltvSub = subs > 0 ? revenue / subs : null;
      const offerIdStr = g.offerId != null ? `#${g.offerId}` : null;
      return { key, ...g, spend, revenue, profit, subs, clicks, roi, cpl: costMetric.value, cplDisplay: costMetric.display, costLabel: costMetric.label, cvr, ltvSub, campaigns: g.links.length, offerIdStr };
    });
  }, [categoryLinksRaw, linkMarketerMap]);

  // Tag each group with isActive flag (any link in group is active by snapshot logic)
  const groupedWithActivity = useMemo(() => {
    return groupedSources.map(g => {
      const isActive = (g.links || []).some((l: any) => getActiveInfo(l.id, activeLookup).isActive);
      return { ...g, isActive };
    });
  }, [groupedSources, activeLookup]);

  // Base filter (search + quick filter), used for activity-bar counts
  const baseFiltered = useMemo(() => {
    let result = groupedWithActivity;
    if (quickFilter === "profitable") result = result.filter(g => g.profit > 0);
    else if (quickFilter === "manual") result = result.filter(g => g.marketer === "In-house");
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(g => g.marketer.toLowerCase().includes(q) || g.sourceTag.toLowerCase().includes(q));
    }
    return result;
  }, [groupedWithActivity, quickFilter, searchQuery]);

  const activityCounts = useMemo(() => {
    let active = 0;
    for (const g of baseFiltered) if (g.isActive) active++;
    return { total: baseFiltered.length, active };
  }, [baseFiltered]);

  const quickFiltered = useMemo(() => {
    if (activityFilter === "all") return baseFiltered;
    if (activityFilter === "active") return baseFiltered.filter(g => g.isActive);
    return baseFiltered.filter(g => !g.isActive);
  }, [baseFiltered, activityFilter]);

  const sortedSources = useMemo(() => {
    const dir = sourceSortAsc ? 1 : -1;
    return [...quickFiltered].sort((a, b) => {
      // Unknown always sorts to bottom
      if (a.isUnknown && !b.isUnknown) return 1;
      if (!a.isUnknown && b.isUnknown) return -1;
      switch (sourceSortKey) {
        case "marketer": return dir * a.marketer.localeCompare(b.marketer);
        case "camps": return dir * (a.campaigns - b.campaigns);
        case "spend": return dir * (a.spend - b.spend);
        case "revenue": return dir * (a.revenue - b.revenue);
        case "profit": return dir * (a.profit - b.profit);
        case "cpl": return dir * ((a.cpl ?? -Infinity) - (b.cpl ?? -Infinity));
        case "cvr": return dir * ((a.cvr ?? -Infinity) - (b.cvr ?? -Infinity));
        case "ltvSub": return dir * ((a.ltvSub ?? -Infinity) - (b.ltvSub ?? -Infinity));
        case "roi": return dir * ((a.roi ?? -Infinity) - (b.roi ?? -Infinity));
        default: return dir * (a.profit - b.profit);
      }
    });
  }, [quickFiltered, sourceSortKey, sourceSortAsc]);

  const SOURCE_PAGE_SIZE = 25;
  const sourceTotalPages = Math.ceil(sortedSources.length / SOURCE_PAGE_SIZE);
  const sourcePageRows = sortedSources.slice(sourcePage * SOURCE_PAGE_SIZE, (sourcePage + 1) * SOURCE_PAGE_SIZE);

  const catKpis = useMemo(() => {
    const spend = categoryLinksRaw.filter(l => Number(l.cost_total || 0) > 0).reduce((s, l) => s + Number(l.cost_total || 0), 0);
    const revenue = categoryLinksRaw.reduce((s, l) => s + Number(l.revenue || 0), 0);
    const profit = revenue - spend;
    const subs = categoryLinksRaw.reduce((s, l) => s + (l.subscribers || 0), 0);
    const clicks = categoryLinksRaw.reduce((s, l) => s + (l.clicks || 0), 0);

    const costTypes = new Set<CostTypeFromOrder>();
    categoryLinksRaw.forEach(l => {
      const info = (linkMarketerMap as any)[l.id];
      if (info?.order_ids) {
        info.order_ids.forEach((oid: string) => {
          const ct = getCostTypeFromOrderId(oid);
          if (ct) costTypes.add(ct);
        });
      }
    });
    const costLabel = deriveCostLabel(costTypes);
    const costMetric = calcCostMetric(costLabel, spend, subs, clicks);

    const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    return { spend, revenue, profit, cpl: costMetric.value, cplLabel: `Avg ${costMetric.label}`, cvr, roi };
  }, [categoryLinksRaw, linkMarketerMap]);

  const uniqueSources = useMemo(() => {
    const tags = new Set<string>();
    categoryLinksRaw.forEach(l => { const es = getEffectiveSource(l) || l.source; if (es) tags.add(es); });
    return tags.size;
  }, [categoryLinksRaw]);

  const catColor = activeCategory === "OnlyTraffic" ? "text-emerald-500" : "text-blue-500";
  const catBadgeBg = activeCategory === "OnlyTraffic" ? "bg-emerald-500/15 text-emerald-500" : "bg-blue-500/15 text-blue-500";
  const catBadgeLabel = activeCategory === "OnlyTraffic" ? "API" : "Direct";
  const CatIcon = activeCategory === "OnlyTraffic" ? Zap : Globe;

  // ═══ EARLY RETURNS ═══
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

  if (!activeCategory) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
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
              <MetricRow label={`Avg ${otMetrics.avgCplLabel || "CPL"}`} value={otMetrics.avgCpl !== null ? fmtC(otMetrics.avgCpl) : "—"} />
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
              <MetricRow label={`Avg ${manualMetrics.avgCplLabel || "CPL"}`} value={manualMetrics.avgCpl !== null ? fmtC(manualMetrics.avgCpl) : "—"} />
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

  // ═══ LEVEL 2 — GROUPED SOURCE VIEW ═══
  if (activeSourceKey) {
    const group = groupedSources.find(g => g.key === activeSourceKey);
    if (group) {
      return (
        <div className="space-y-4">
          <button
            onClick={() => { setActiveSourceKey(null); onLevelChange?.(2); }}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontSize: "13px", fontWeight: 500 }}
          >
            <ArrowLeft className="h-4 w-4" /> Back to {activeCategory}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-foreground font-bold text-lg">{group.marketer} — {group.sourceTag}</span>
            <span className="text-muted-foreground" style={{ fontSize: "12px" }}>· {group.campaigns} campaigns</span>
          </div>
          <div className="grid grid-cols-6 gap-2">
            <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Spend" value={fmtC(group.spend)} color="#dc2626" />
            <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Revenue" value={fmtC(group.revenue)} color="#16a34a" />
            <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Profit" value={fmtC(group.profit)} color={group.profit >= 0 ? "#16a34a" : "#dc2626"} />
            <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label={group.costLabel || "CPL"} value={group.cplDisplay || "—"} color="#0891b2" />
            <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="CVR" value={group.cvr !== null ? fmtPct(group.cvr) : "—"} color="#d97706" />
            <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="ROI" value={group.roi !== null ? fmtPct(group.roi) : "—"} color={group.roi !== null ? (group.roi >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
          </div>
          <MarketerExpandedTable
            links={group.links}
            linkMarketerMap={linkMarketerMap}
            onCampaignClick={setDrawerCampaign}
          />
          <CampaignDetailDrawer campaign={drawerCampaign} onClose={() => setDrawerCampaign(null)} />
        </div>
      );
    }
  }

  const handleSourceColSort = (key: string) => {
    if (sourceSortKey === key) setSourceSortAsc(!sourceSortAsc);
    else { setSourceSortKey(key); setSourceSortAsc(false); }
    setSourcePage(0);
  };

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={() => setCategoryAndNotify(null)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: "13px", fontWeight: 500 }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-foreground font-bold text-lg">{activeCategory}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${catBadgeBg}`}>{catBadgeLabel}</span>
          </div>
          <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
            {uniqueSources} sources · {categoryLinksRaw.length} campaigns
          </span>
        </div>
        <button className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:border-primary/40 transition-colors" style={{ fontSize: "12px" }}>
          + Add new source
        </button>
      </div>

      {/* KPI row — 6 cards */}
      <div className="grid grid-cols-6 gap-2">
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Total spend" value={fmtC(catKpis.spend)} color="#dc2626" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Total revenue" value={fmtC(catKpis.revenue)} color="#16a34a" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Total profit" value={catKpis.profit >= 0 ? `+${fmtC(catKpis.profit)}` : fmtC(catKpis.profit)} color={catKpis.profit >= 0 ? "#16a34a" : "#dc2626"} />
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label={catKpis.cplLabel} value={catKpis.cpl !== null ? fmtC(catKpis.cpl) : "—"} color="#0891b2" />
        <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="Avg CVR" value={catKpis.cvr !== null ? fmtPct(catKpis.cvr) : "—"} color="#d97706" />
        <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="Avg ROI" value={catKpis.roi !== null ? fmtPct(catKpis.roi) : "—"} color={catKpis.roi !== null ? (catKpis.roi >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
      </div>

      {/* Search + Quick filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSourcePage(0); }}
            placeholder="Search marketer, OnlyTraffic, offer, or type..."
            className="pl-9 pr-8 h-10 text-sm bg-card border-border rounded-lg"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setSourcePage(0); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground whitespace-nowrap" style={{ fontSize: "12px" }}>Quick filter:</span>
          {[
            { key: "__all__", label: "All" },
            { key: "profitable", label: "Profitable only" },
            { key: "manual", label: "Manual" },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => { setQuickFilter(quickFilter === f.key ? "__all__" : f.key); setSourcePage(0); }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${quickFilter === f.key ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-foreground hover:border-primary/30"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity filter — All / Active / Inactive (snapshot-derived). A source group is Active if any link in it is delivering ≥ 1 sub/day over last 5 days. */}
      <LinkActivityFilter
        value={activityFilter}
        onChange={(v) => { setActivityFilter(v); setSourcePage(0); }}
        totalCount={activityCounts.total}
        activeCount={activityCounts.active}
      />

      {isOT && unmatchedOrders && unmatchedOrders.count > 0 && (
        <button
          onClick={() => setActiveUnmatched(true)}
          className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors"
        >
          <AlertTriangle className="h-3.5 w-3.5" style={{ color: "#d97706" }} />
          <span className="font-semibold" style={{ fontSize: "12px", color: "#d97706" }}>
            {fmtN(unmatchedOrders.count)} Unmatched Orders · {fmtC(unmatchedOrders.spend)}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      {/* Grouped source table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "35%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className={thClass} style={{ padding: "8px 12px", textAlign: "left" }} onClick={() => handleSourceColSort("marketer")}>
                Source <SortIcon active={sourceSortKey === "marketer"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("camps")}>
                Campaigns <SortIcon active={sourceSortKey === "camps"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("spend")}>
                Spend <SortIcon active={sourceSortKey === "spend"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("revenue")}>
                Revenue <SortIcon active={sourceSortKey === "revenue"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("profit")}>
                Profit <SortIcon active={sourceSortKey === "profit"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("cpl")}>
                CPL/CPC <SortIcon active={sourceSortKey === "cpl"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("cvr")}>
                CVR <SortIcon active={sourceSortKey === "cvr"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("ltvSub")}>
                LTV/Sub <SortIcon active={sourceSortKey === "ltvSub"} asc={sourceSortAsc} />
              </th>
              <th className={`${thClass} text-right`} style={{ padding: "8px 12px" }} onClick={() => handleSourceColSort("roi")}>
                ROI <SortIcon active={sourceSortKey === "roi"} asc={sourceSortAsc} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sourcePageRows.map(g => {
              const profitColor = g.profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";
              const roiColor = g.roi !== null ? (g.roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
              const mutedRow = g.isUnknown;
              return (
                <tr
                  key={g.key}
                  className="border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
                  style={{ height: "48px" }}
                  onClick={() => {
                    if (g.isUnknown) {
                      navigate(`/sources/onlytraffic/__unknown__/0`);
                      return;
                    }
                    if (g.offerId != null) {
                      navigate(`/sources/onlytraffic/${encodeURIComponent(g.marketer)}/${g.offerId}`);
                    } else {
                      setActiveSourceKey(g.key); onLevelChange?.(3);
                    }
                  }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <ModelAvatar name={g.marketer} size={32} />
                        <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-card" style={{ width: 10, height: 10, background: g.isActive ? "#16a34a" : "#94a3b8" }} title={g.isActive ? "Active" : "Inactive"} />
                      </div>
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${mutedRow ? "text-muted-foreground" : "text-foreground"}`} style={{ fontSize: "13px", fontWeight: 500 }}>
                          {g.marketer}
                          {g.offerIdStr && <span className="text-muted-foreground ml-1.5" style={{ fontSize: "11px", fontWeight: 400 }}>· {g.offerIdStr}</span>}
                        </p>
                        <p className="text-muted-foreground truncate" style={{ fontSize: "11px" }}>{g.sourceTag}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px" }}>{g.campaigns}</td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px" }}>{fmtC(g.spend)}</td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px" }}>{fmtC(g.revenue)}</td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px", color: profitColor }}>
                    {g.profit >= 0 ? `+${fmtC(g.profit)}` : fmtC(g.profit)}
                  </td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px" }}>{g.cplDisplay || "—"}</td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px" }}>{g.cvr !== null ? fmtPct(g.cvr) : "—"}</td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px" }}>{g.ltvSub !== null ? fmtC(g.ltvSub) : "—"}</td>
                  <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "13px", color: roiColor }}>{g.roi !== null ? fmtPct(g.roi) : "—"}</td>
                </tr>
              );
            })}
            {sourcePageRows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>No sources found</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination + hint */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
            Showing {sourcePageRows.length} of {sortedSources.length} · Click any row to see its campaigns
          </span>
          {sourceTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <button disabled={sourcePage === 0} onClick={() => setSourcePage(p => p - 1)} className="px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-foreground font-mono" style={{ fontSize: "12px" }}>{sourcePage + 1} / {sourceTotalPages}</span>
              <button disabled={sourcePage >= sourceTotalPages - 1} onClick={() => setSourcePage(p => p + 1)} className="px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                <ArrowLeft className="h-4 w-4 rotate-180" />
              </button>
            </div>
          )}
        </div>
      </div>

      <CampaignDetailDrawer campaign={drawerCampaign} onClose={() => setDrawerCampaign(null)} />
    </div>
  );
}

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronDown className="h-3 w-3 inline ml-0.5 opacity-20" />;
  return asc ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" /> : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
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

// ═══ MARKETER ANALYTICS VIEW ═══
interface MarketerAnalyticsProps {
  links: any[];
  linkMarketerMap: Record<string, { marketer: string; offer_id: number | null; showOfferId: boolean }>;
  expandedMarketer: string | null;
  setExpandedMarketer: (m: string | null) => void;
  onBack: () => void;
  onCampaignClick: (link: any) => void;
  accounts: any[];
}

function MarketerAnalyticsView({ links, linkMarketerMap, expandedMarketer, setExpandedMarketer, onBack, onCampaignClick, accounts }: MarketerAnalyticsProps) {
  const marketerData = useMemo(() => {
    const map: Record<string, any[]> = {};
    links.forEach(l => {
      const info = linkMarketerMap[l.id];
      const name = info?.marketer || l.onlytraffic_marketer || "Unknown";
      if (!map[name]) map[name] = [];
      map[name].push(l);
    });

    return Object.entries(map).map(([name, mLinks]) => {
      const spend = mLinks.filter(l => Number(l.cost_total || 0) > 0).reduce((s, l) => s + Number(l.cost_total || 0), 0);
      const revenue = mLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
      const profit = revenue - spend;
      const subs = mLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
      const clicks = mLinks.reduce((s, l) => s + (l.clicks || 0), 0);
      const roi = spend > 0 ? (profit / spend) * 100 : null;
      const costTypes = new Set<CostTypeFromOrder>();
      mLinks.forEach(l => {
        const info = (linkMarketerMap as any)[l.id];
        if (info?.order_ids) {
          info.order_ids.forEach((oid: string) => {
            const ct = getCostTypeFromOrderId(oid);
            if (ct) costTypes.add(ct);
          });
        }
      });
      const costLabel = deriveCostLabel(costTypes);
      const costMetric = calcCostMetric(costLabel, spend, subs, clicks);
      const avgCpl = costMetric.value;
      const profitSub = spend > 0 && subs > 0 ? profit / subs : null;
      const ltvSub = subs > 0 ? revenue / subs : null;

      let statusLabel = "NO SPEND";
      let statusBg = "hsl(220 9% 46% / 0.15)";
      let statusText = "hsl(220 9% 46%)";
      if (spend > 0 && roi !== null) {
        if (roi > 150) { statusLabel = "SCALE"; statusBg = "hsl(142 71% 45% / 0.15)"; statusText = "hsl(142 71% 45%)"; }
        else if (roi >= 50) { statusLabel = "WATCH"; statusBg = "hsl(199 89% 48% / 0.15)"; statusText = "hsl(199 89% 48%)"; }
        else if (roi >= 0) { statusLabel = "LOW"; statusBg = "hsl(38 92% 50% / 0.15)"; statusText = "hsl(38 92% 50%)"; }
        else { statusLabel = "KILL"; statusBg = "hsl(0 84% 60% / 0.15)"; statusText = "hsl(0 84% 60%)"; }
      }

      return { name, links: mLinks, spend, revenue, profit, roi, avgCpl, profitSub, ltvSub, subs, campaigns: mLinks.length, statusLabel, statusBg, statusText };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [links, linkMarketerMap]);

  return (
    <div className="space-y-4">
      {!expandedMarketer ? (
        <>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontSize: "13px", fontWeight: 500 }}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Campaigns
          </button>

          <div className="grid grid-cols-3 gap-4">
            {marketerData.map(m => (
              <div key={m.name}>
                <button
                  onClick={() => setExpandedMarketer(m.name)}
                  className="w-full text-left bg-card border rounded-xl p-4 transition-colors border-border hover:border-primary/30"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-foreground font-bold" style={{ fontSize: "14px" }}>{m.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-mono" style={{ fontSize: "11px" }}>{m.campaigns} campaign{m.campaigns !== 1 ? "s" : ""}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: m.statusBg, color: m.statusText }}>
                        {m.statusLabel}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <MetricRow label="Spend" value={fmtC(m.spend)} />
                    <MetricRow label="Revenue" value={fmtC(m.revenue)} />
                    <MetricRow label="Profit" value={fmtC(m.profit)} color={m.profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"} />
                    <MetricRow label="Avg CPL" value={m.avgCpl !== null ? fmtC(m.avgCpl) : "—"} />
                    <MetricRow label="Profit/Sub" value={m.profitSub !== null ? fmtC(m.profitSub) : "—"} color={m.profitSub !== null ? (m.profitSub >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined} />
                    <MetricRow label="LTV/Sub" value={m.ltvSub !== null ? fmtC(m.ltvSub) : "—"} />
                    <MetricRow label="ROI" value={m.roi !== null ? fmtPct(m.roi) : "—"} color={m.roi !== null ? (m.roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined} />
                    <MetricRow label="Subscribers" value={fmtN(m.subs)} />
                  </div>
                </button>
              </div>
            ))}
          </div>
          {marketerData.length === 0 && (
            <div className="text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>No marketer data found</div>
          )}
        </>
      ) : (() => {
        const m = marketerData.find(d => d.name === expandedMarketer);
        if (!m) return null;
        return (
          <>
            <button
              onClick={() => setExpandedMarketer(null)}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              style={{ fontSize: "13px", fontWeight: 500 }}
            >
              <ArrowLeft className="h-4 w-4" /> Back to Marketers
            </button>
            <div className="flex items-center gap-3">
              <span className="text-foreground font-bold" style={{ fontSize: "16px" }}>{m.name}</span>
              <span className="text-muted-foreground font-mono" style={{ fontSize: "12px" }}>{m.campaigns} campaigns</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: m.statusBg, color: m.statusText }}>
                {m.statusLabel}
              </span>
            </div>
            <MarketerExpandedTable
              links={m.links}
              linkMarketerMap={linkMarketerMap}
              onCampaignClick={onCampaignClick}
            />
          </>
        );
      })()}
    </div>
  );
}

// ═══ MARKETER EXPANDED TABLE ═══
type METSortKey = "campaign" | "model" | "source" | "marketer" | "offerId" | "orderId" | "clicks" | "subs" | "spend" | "revenue" | "profit" | "profitSub" | "ltvSub" | "roi" | "created" | "status";

function MarketerExpandedTable({ links, linkMarketerMap, onCampaignClick }: { links: any[]; linkMarketerMap: Record<string, any>; onCampaignClick: (l: any) => void }) {
  const [sortKey, setSortKey] = useState<METSortKey>("created");
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (key: METSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "campaign"); }
  };

  const rows = useMemo(() => {
    const enriched = links.map((link: any) => {
      const sp = Number(link.cost_total || 0);
      const rv = Number(link.revenue || 0);
      const subs = link.subscribers || 0;
      const profit = sp > 0 ? rv - sp : null;
      const roi = sp > 0 ? ((rv - sp) / sp) * 100 : null;
      const profitSub = sp > 0 && subs > 0 ? (rv - sp) / subs : null;
      const ltvSub = subs > 0 ? rv / subs : null;
      const info = linkMarketerMap[link.id];
      const username = link.accounts?.username || "unknown";
      const badge = getStatusBadge(link);
      const statusOrder = { SCALE: 4, WATCH: 3, LOW: 2, KILL: 1, "NO SPEND": 0 };
      return { link, sp, rv, subs, profit, roi, profitSub, ltvSub, info, username, badge, statusOrder: (statusOrder as any)[badge.label] ?? 0 };
    });

    const dir = sortAsc ? 1 : -1;
    return enriched.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case "campaign": av = a.link.campaign_name || ""; bv = b.link.campaign_name || ""; return dir * av.localeCompare(bv);
        case "model": av = a.username; bv = b.username; return dir * av.localeCompare(bv);
        case "source": av = a.link.source_tag || a.link.source || ""; bv = b.link.source_tag || b.link.source || ""; return dir * av.localeCompare(bv);
        case "marketer": av = a.info?.marketer || a.link.onlytraffic_marketer || ""; bv = b.info?.marketer || b.link.onlytraffic_marketer || ""; return dir * av.localeCompare(bv);
        case "offerId": av = a.info?.offer_id ?? -1; bv = b.info?.offer_id ?? -1; return dir * (av - bv);
        case "orderId": av = a.link.onlytraffic_order_id || ""; bv = b.link.onlytraffic_order_id || ""; return dir * av.localeCompare(bv);
        case "clicks": return dir * ((a.link.clicks || 0) - (b.link.clicks || 0));
        case "subs": return dir * (a.subs - b.subs);
        case "spend": return dir * (a.sp - b.sp);
        case "revenue": return dir * (a.rv - b.rv);
        case "profit": return dir * ((a.profit ?? -Infinity) - (b.profit ?? -Infinity));
        case "profitSub": return dir * ((a.profitSub ?? -Infinity) - (b.profitSub ?? -Infinity));
        case "ltvSub": return dir * ((a.ltvSub ?? -Infinity) - (b.ltvSub ?? -Infinity));
        case "roi": return dir * ((a.roi ?? -Infinity) - (b.roi ?? -Infinity));
        case "created": return dir * (new Date(a.link.created_at || 0).getTime() - new Date(b.link.created_at || 0).getTime());
        case "status": return dir * (a.statusOrder - b.statusOrder);
        default: return 0;
      }
    });
  }, [links, linkMarketerMap, sortKey, sortAsc]);

  const SH = ({ k, label, align }: { k: METSortKey; label: string; align?: string }) => (
    <TableHead
      className={`text-[11px] font-semibold uppercase text-muted-foreground cursor-pointer select-none whitespace-nowrap ${align === "right" ? "text-right" : align === "center" ? "text-center" : ""}`}
      onClick={() => toggleSort(k)}
    >
      {label}<SortIcon active={sortKey === k} asc={sortAsc} />
    </TableHead>
  );

  return (
    <div className="mt-2 bg-card border border-border rounded-xl overflow-x-auto">
      <Table className="min-w-[1400px]">
        <TableHeader>
          <TableRow className="border-border">
            <SH k="campaign" label="Campaign" />
            <SH k="model" label="Model" />
            <SH k="source" label="Source" />
            <SH k="marketer" label="Marketer" />
            <SH k="offerId" label="Offer ID" />
            <SH k="orderId" label="Order ID" />
            <SH k="clicks" label="Clicks" align="right" />
            <SH k="subs" label="Subs" align="right" />
            <SH k="spend" label="Spend" align="right" />
            <SH k="revenue" label="Revenue" align="right" />
            <SH k="profit" label="Profit" align="right" />
            <SH k="profitSub" label="Profit/Sub" align="right" />
            <SH k="ltvSub" label="LTV/Sub" align="right" />
            <SH k="roi" label="ROI" align="right" />
            <SH k="created" label="Created" />
            <SH k="status" label="Status" align="center" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ link, sp, rv, subs, profit, roi, profitSub, ltvSub, info, username, badge }) => {
            const avatarUrl = link.accounts?.avatar_thumb_url || null;
            const displayName = link.accounts?.display_name || username;
            const profitColor = profit !== null ? (profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
            const roiColor = roi !== null ? (roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
            const ageDays = link.created_at ? Math.max(0, differenceInDays(new Date(), new Date(link.created_at))) : 0;
            const pill = getAgePill(ageDays);
            const marketerName = info?.marketer || link.onlytraffic_marketer || "—";

            return (
              <TableRow key={link.id} className="border-border cursor-pointer hover:bg-muted/50" onClick={() => onCampaignClick(link)}>
                <TableCell className="min-w-[200px] max-w-[260px]">
                  <p className="text-foreground font-semibold truncate" style={{ fontSize: "12px" }}>{link.campaign_name || "—"}</p>
                  <p className="text-muted-foreground truncate" style={{ fontSize: "10px" }}>{link.url || ""}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <ModelAvatar avatarUrl={avatarUrl} name={displayName} size={18} />
                    <span className="text-foreground" style={{ fontSize: "11px" }}>@{username}</span>
                  </div>
                </TableCell>
                <TableCell><span className="text-foreground" style={{ fontSize: "11px" }}>{link.source_tag || link.source || "—"}</span></TableCell>
                <TableCell><span className="text-foreground" style={{ fontSize: "11px" }}>{marketerName}</span></TableCell>
                <TableCell><span className="text-foreground font-mono" style={{ fontSize: "11px" }}>{info?.offer_id ?? "—"}</span></TableCell>
                <TableCell><span className="text-foreground font-mono" style={{ fontSize: "11px" }}>{link.onlytraffic_order_id || "—"}</span></TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtN(link.clicks || 0)}</TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtN(subs)}</TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>
                  {fmtC(sp)}
                  {sp > 0 && subs > 0 && (
                    <span className="block mt-0.5 rounded-full font-bold text-white" style={{ fontSize: "9px", padding: "2px 6px", backgroundColor: "#0891b2", width: "fit-content", marginLeft: "auto" }}>
                      CPL {fmtC(sp / subs)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: "hsl(173 80% 36%)" }}>{fmtC(rv)}</TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: profitColor }}>{profit !== null ? fmtC(profit) : "—"}</TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: profitColor }}>{profitSub !== null ? fmtC(profitSub) : "—"}</TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: "#0891b2" }}>{ltvSub !== null ? fmtC(ltvSub) : "—"}</TableCell>
                <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: roiColor }}>{roi !== null ? fmtPct(roi) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {link.created_at ? (
                    <div>
                      <p className="text-foreground" style={{ fontSize: "11px" }}>{format(new Date(link.created_at), "MMM d, yyyy")}</p>
                      <span className="inline-block mt-0.5 rounded-full font-bold" style={{ fontSize: "9px", padding: "1px 6px", backgroundColor: pill.bg, color: pill.text }}>{pill.label}</span>
                    </div>
                  ) : <span className="text-muted-foreground" style={{ fontSize: "11px" }}>—</span>}
                </TableCell>
                <TableCell className="text-center">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>{badge.label}</span>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={16} className="text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>No campaigns found</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

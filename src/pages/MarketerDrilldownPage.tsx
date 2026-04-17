import React, { useState, useMemo } from "react";
import { getCostTypeFromOrderId, deriveCostLabel, calcCostMetric, type CostTypeFromOrder } from "@/lib/calc-helpers";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ModelAvatar } from "@/components/ModelAvatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { ArrowLeft, Info, ChevronUp, ChevronDown, ChevronRight } from "lucide-react";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

type SortKey = "model" | "campaigns" | "subs" | "clicks" | "spend" | "revenue" | "profit" | "ltv" | "cpl" | "cpc" | "cvr" | "roi";

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronDown className="h-3 w-3 inline ml-0.5 opacity-20" />;
  return asc ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" /> : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-start py-1" style={{ flex: "1 1 0", minWidth: 0 }}>
      <span className="text-muted-foreground uppercase tracking-wider" style={{ fontSize: "10px" }}>{label}</span>
      <span className="font-mono" style={{ fontSize: "18px", fontWeight: 500, color: color || "hsl(var(--foreground))" }}>{value}</span>
    </div>
  );
}

function StatDivider() {
  return <div className="w-px h-8 bg-border shrink-0" />;
}

export default function MarketerDrilldownPage() {
  const { marketer, offer_id } = useParams<{ marketer: string; offer_id: string }>();
  const navigate = useNavigate();
  const [modelFilter, setModelFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortAsc, setSortAsc] = useState(false);
  const [profitableFilter, setProfitableFilter] = useState(false);
  const [losingFilter, setLosingFilter] = useState(false);
  const [scaleFilter, setScaleFilter] = useState(false);
  const [highVolFilter, setHighVolFilter] = useState(false);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);

  const isUnknown = marketer === "__unknown__";
  const decodedMarketer = isUnknown ? "Unknown" : decodeURIComponent(marketer || "");
  const offerId = (!isUnknown && offer_id) ? Number(offer_id) : null;

  // Fetch orders
  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["marketer_orders", decodedMarketer, offerId, isUnknown],
    queryFn: async () => {
      let q = supabase
        .from("onlytraffic_orders")
        .select("id, tracking_link_id, quantity_delivered, total_spent, marketer, offer_id, source, status, order_id")
        .in("status", ["completed", "accepted", "active", "waiting"]);
      if (isUnknown) {
        q = q.or("marketer.is.null,marketer.eq.");
      } else {
        q = q.eq("marketer", decodedMarketer);
        if (offerId != null) q = q.eq("offer_id", offerId);
      }
      const { data } = await q;
      return data || [];
    },
    enabled: isUnknown || !!decodedMarketer,
  });

  const trackingLinkIds = useMemo(() => {
    const ids = new Set<string>();
    orders.forEach(o => { if (o.tracking_link_id) ids.add(o.tracking_link_id); });
    return [...ids];
  }, [orders]);

  // Fetch tracking links with extra fields for sub-table
  const { data: trackingLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["marketer_tracking_links", trackingLinkIds],
    queryFn: async () => {
      if (trackingLinkIds.length === 0) return [];
      const all: any[] = [];
      for (let i = 0; i < trackingLinkIds.length; i += 50) {
        const chunk = trackingLinkIds.slice(i, i + 50);
        const { data } = await supabase
          .from("tracking_links")
          .select("id, account_id, clicks, subscribers, revenue, cost_total, cost_type, campaign_name, url, created_at, source_tag, status, campaign_id, profit, roi, ltv_per_sub, conversion_rate, cost_per_lead, revenue_per_subscriber, spenders, payment_type, cost_value, manually_tagged, media_buyer, country, deleted_at, external_tracking_link_id, onlytraffic_marketer, onlytraffic_order_id, onlytraffic_order_type, onlytraffic_status, needs_spend, capped_spend, review_flag, traffic_source_id, traffic_category, arpu, calculated_at, cpc_real, cpl_real, cvr, ltv, needs_full_sync, spender_rate, spenders_count, fans_last_synced_at")
          .in("id", chunk);
        if (data) all.push(...data);
      }
      return all;
    },
    enabled: trackingLinkIds.length > 0,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, username, display_name, avatar_thumb_url, avatar_url").order("display_name");
      return data || [];
    },
  });

  const sourceLabel = useMemo(() => {
    const first = orders.find(o => o.source);
    return first?.source || "Direct";
  }, [orders]);

  // Build model breakdown
  const modelRows = useMemo(() => {
    const tlMap: Record<string, any> = {};
    trackingLinks.forEach(tl => { tlMap[tl.id] = tl; });

    const groups: Record<string, { accountId: string; orders: any[]; tlIds: Set<string> }> = {};
    for (const o of orders) {
      const tl = o.tracking_link_id ? tlMap[o.tracking_link_id] : null;
      const accountId = tl?.account_id || "__unknown__";
      if (!groups[accountId]) groups[accountId] = { accountId, orders: [], tlIds: new Set() };
      groups[accountId].orders.push(o);
      if (o.tracking_link_id) groups[accountId].tlIds.add(o.tracking_link_id);
    }

    return Object.values(groups).map(g => {
      const acc = accounts.find(a => a.id === g.accountId);
      const campaignCount = g.tlIds.size;
      const subs = g.orders.reduce((s, o) => s + (o.quantity_delivered || 0), 0);
      const spend = g.orders.reduce((s, o) => s + Number(o.total_spent || 0), 0);

      let clicks = 0, revenue = 0;
      const costTypes = new Set<CostTypeFromOrder>();
      g.orders.forEach(o => {
        const ct = getCostTypeFromOrderId(o.order_id);
        if (ct) costTypes.add(ct);
      });
      g.tlIds.forEach(tlId => {
        const tl = tlMap[tlId];
        if (tl) {
          clicks += tl.clicks || 0;
          revenue += Number(tl.revenue || 0);
        }
      });

      const costLabel = deriveCostLabel(costTypes);
      const costMetric = calcCostMetric(costLabel, spend, subs, clicks);
      const profit = revenue - spend;
      const ltv = subs > 0 ? revenue / subs : null;
      const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
      const roi = spend > 0 ? (profit / spend) * 100 : null;

      return {
        accountId: g.accountId,
        username: acc?.username || null,
        displayName: acc?.display_name || "Unknown",
        avatarUrl: acc?.avatar_thumb_url || acc?.avatar_url || null,
        campaignCount, subs, clicks, spend, revenue, profit, ltv, cplCpc: costMetric.value, cvr, roi, costLabel, costDisplay: costMetric.display,
      };
    });
  }, [orders, trackingLinks, accounts]);

  // Filters
  const filtered = useMemo(() => {
    let rows = modelRows;
    if (modelFilter !== "all") {
      rows = rows.filter(r => r.accountId === modelFilter);
    }
    if (profitableFilter) rows = rows.filter(r => r.profit > 0);
    if (losingFilter) rows = rows.filter(r => r.profit < 0);
    if (scaleFilter) rows = rows.filter(r => r.profit > 0 && r.roi !== null && r.roi > 50);
    if (highVolFilter) rows = rows.filter(r => r.campaignCount > 10);
    return rows;
  }, [modelRows, modelFilter, profitableFilter, losingFilter, scaleFilter, highVolFilter]);

  // Sort
  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const getVal = (r: typeof a): number | string => {
        switch (sortKey) {
          case "model": return (r.username || r.displayName || "").toLowerCase();
          case "campaigns": return r.campaignCount;
          case "subs": return r.subs;
          case "clicks": return r.clicks;
          case "spend": return r.spend;
          case "revenue": return r.revenue;
          case "profit": return r.profit;
          case "ltv": return r.ltv ?? -Infinity;
          case "cpl": return r.cplCpc ?? -Infinity;
          case "cvr": return r.cvr ?? -Infinity;
          case "roi": return r.roi ?? -Infinity;
          default: return 0;
        }
      };
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
  }, [filtered, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // Expanded model data
  const expandedModelData = useMemo(() => {
    if (!expandedModel) return [];
    const tlMap: Record<string, any> = {};
    trackingLinks.forEach(tl => { tlMap[tl.id] = tl; });

    // Get TL ids for this model
    const modelRow = modelRows.find(r => r.accountId === expandedModel);
    if (!modelRow) return [];

    // Group orders by tracking_link_id
    const tlGroups: Record<string, any[]> = {};
    for (const o of orders) {
      const tl = o.tracking_link_id ? tlMap[o.tracking_link_id] : null;
      const accountId = tl?.account_id || "__unknown__";
      if (accountId !== expandedModel) continue;
      if (!o.tracking_link_id) continue;
      if (!tlGroups[o.tracking_link_id]) tlGroups[o.tracking_link_id] = [];
      tlGroups[o.tracking_link_id].push(o);
    }

    return Object.entries(tlGroups).map(([tlId, tlOrders]) => {
      const tl = tlMap[tlId];
      if (!tl) return null;
      const orderCount = tlOrders.length;
      const subs = tlOrders.reduce((s, o) => s + (o.quantity_delivered || 0), 0);
      const clicks = tl.clicks || 0;
      const costTotal = Number(tl.cost_total || 0);
      const revenue = Number(tl.revenue || 0);
      const hasSpend = costTotal > 0;
      const profit = hasSpend ? revenue - costTotal : null;
      const ltv = subs > 0 ? revenue / subs : null;

      const costTypes = new Set<CostTypeFromOrder>();
      tlOrders.forEach(o => {
        const ct = getCostTypeFromOrderId(o.order_id);
        if (ct) costTypes.add(ct);
      });
      const costLabel = deriveCostLabel(costTypes);
      const costMetric = calcCostMetric(costLabel, costTotal, subs, clicks);

      const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
      const roi = hasSpend ? ((revenue - costTotal) / costTotal) * 100 : null;

      return { ...tl, orderCount, subs, clicks: tl.clicks, costTotal, revenue, profit, ltv, cplCpc: costMetric.value, costDisplay: costMetric.display, costLabel, cvr, roi, campaignName: tl.campaign_name, url: tl.url };
    }).filter(Boolean).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [expandedModel, orders, trackingLinks, modelRows]);

  // Stats scoping
  const expandedRow = expandedModel ? modelRows.find(r => r.accountId === expandedModel) : null;
  const statsSource = expandedRow ? expandedRow : null;

  // Derive agency-wide cost type from all orders
  const agencyCostLabel = useMemo(() => {
    const types = new Set<CostTypeFromOrder>();
    orders.forEach(o => {
      const ct = getCostTypeFromOrderId(o.order_id);
      if (ct) types.add(ct);
    });
    return deriveCostLabel(types);
  }, [orders]);

  const agencyTotals = useMemo(() => {
    const t = { spend: 0, revenue: 0, profit: 0, orders: 0, subs: 0, clicks: 0 };
    modelRows.forEach(r => { t.spend += r.spend; t.revenue += r.revenue; t.profit += r.profit; t.orders += r.campaignCount; t.subs += r.subs; t.clicks += r.clicks; });
    return t;
  }, [modelRows]);

  const statsCostLabel = statsSource ? statsSource.costLabel : agencyCostLabel;
  const statsCostMetric = statsSource
    ? { value: statsSource.cplCpc, display: statsSource.costDisplay }
    : calcCostMetric(agencyCostLabel, agencyTotals.spend, agencyTotals.subs, agencyTotals.clicks);

  const stats = statsSource
    ? { spend: statsSource.spend, revenue: statsSource.revenue, profit: statsSource.profit, orders: statsSource.campaignCount, subs: statsSource.subs, clicks: statsSource.clicks, ltv: statsSource.ltv, cpl: statsCostMetric.value, cvr: statsSource.cvr, roi: statsSource.roi }
    : {
      spend: agencyTotals.spend, revenue: agencyTotals.revenue, profit: agencyTotals.profit, orders: agencyTotals.orders, subs: agencyTotals.subs, clicks: agencyTotals.clicks,
      ltv: agencyTotals.subs > 0 ? agencyTotals.revenue / agencyTotals.subs : null,
      cpl: statsCostMetric.value,
      cvr: agencyTotals.clicks > 0 ? (agencyTotals.subs / agencyTotals.clicks) * 100 : null,
      roi: agencyTotals.spend > 0 ? (agencyTotals.profit / agencyTotals.spend) * 100 : null,
    };

  const profitSub = stats.subs > 0 ? stats.profit / stats.subs : null;
  const profitColor = (v: number) => v >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";

  const totalOrders = modelRows.reduce((s, r) => s + r.campaignCount, 0);
  const modelCount = modelRows.length;
  const isLoading = ordersLoading || linksLoading;

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  const handleRowClick = (row: typeof sorted[0]) => {
    if (expandedModel === row.accountId) {
      setExpandedModel(null);
    } else {
      setExpandedModel(row.accountId);
    }
  };

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${active ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-foreground hover:border-primary/30"}`;

  const statsLabel = expandedRow ? `STATS · @${expandedRow.username || expandedRow.displayName}` : "STATS · AGENCY-WIDE";

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate("/traffic-sources", { state: { openCategory: "OnlyTraffic" } })}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontSize: "13px", fontWeight: 500 }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to OnlyTraffic
        </button>

        {/* Title */}
        <div>
          <h1 className="text-foreground font-medium" style={{ fontSize: "22px" }}>
            {isUnknown ? (
              <><span className="text-muted-foreground">[?]</span> Unknown · Untagged</>
            ) : (
              <>{decodedMarketer} — {sourceLabel} {offerId != null ? offerId : ""}</>
            )}
          </h1>
          <p className="text-muted-foreground" style={{ fontSize: "12px", marginTop: "2px" }}>
            · {fmtN(totalOrders)} campaigns · {fmtN(modelCount)} models
          </p>
        </div>

        {/* Stats Bar */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-2 mb-1">
          <span className="text-muted-foreground uppercase tracking-widest" style={{ fontSize: "12px", fontWeight: 500, letterSpacing: "0.08em" }}>{statsLabel}</span>
          {/* Row 1 — 5 items */}
          <div className="flex items-center gap-3">
            <StatItem label="Total Spend" value={fmtC(stats.spend)} />
            <StatDivider />
            <StatItem label="Total Revenue" value={fmtC(stats.revenue)} color="hsl(var(--primary))" />
            <StatDivider />
            <StatItem label="Total Profit" value={stats.profit >= 0 ? `+${fmtC(stats.profit)}` : fmtC(stats.profit)} color={profitColor(stats.profit)} />
            <StatDivider />
            <StatItem label="ROI" value={stats.roi !== null ? fmtPct(stats.roi) : "—"} color={stats.roi !== null ? profitColor(stats.roi) : undefined} />
            <StatDivider />
            <StatItem label="Campaigns" value={fmtN(stats.orders)} />
          </div>
          {/* Row 2 — 6 items: pad last item to keep 5-col alignment */}
          <div className="flex items-center gap-3">
            <StatItem label="Subs" value={fmtN(stats.subs)} />
            <StatDivider />
            <StatItem label="Clicks" value={fmtN(stats.clicks)} />
            <StatDivider />
            <StatItem label={`Avg ${statsCostLabel || "CPL"}`} value={stats.cpl !== null ? fmtC(stats.cpl) : "—"} />
            <StatDivider />
            <StatItem label="Avg LTV/Sub" value={stats.ltv !== null ? fmtC(stats.ltv) : "—"} />
            <StatDivider />
            <div className="flex gap-3" style={{ flex: "1 1 0", minWidth: 0 }}>
              <StatItem label="Profit/Sub" value={profitSub !== null ? fmtC(profitSub) : "—"} color={profitSub !== null ? profitColor(profitSub) : undefined} />
              <StatDivider />
              <StatItem label="Avg CVR" value={stats.cvr !== null ? fmtPct(stats.cvr) : "—"} />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center flex-wrap">
          <AccountFilterDropdown
            value={modelFilter}
            onChange={setModelFilter}
            accounts={accounts.filter(a => modelRows.some(r => r.accountId === a.id))}
            className="min-w-[200px]"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setProfitableFilter(!profitableFilter)} className={chipClass(profitableFilter)}>Profitable</button>
            <button onClick={() => setLosingFilter(!losingFilter)} className={chipClass(losingFilter)}>Losing money</button>
            <button onClick={() => setScaleFilter(!scaleFilter)} className={chipClass(scaleFilter)}>Scale candidates</button>
            <button onClick={() => setHighVolFilter(!highVolFilter)} className={chipClass(highVolFilter)}>High Volume Orders</button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" style={{ fontSize: "13px" }}>
              {modelRows.length === 0 ? "No orders found for this marketer" : "No models match your filters"}
            </div>
          ) : (
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "6.5%" }} />
                <col style={{ width: "6.5%" }} />
              </colgroup>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className={thClass} onClick={() => handleSort("model")}>Model <SortIcon active={sortKey === "model"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("campaigns")}>Campaigns <SortIcon active={sortKey === "campaigns"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("subs")}>Subs <SortIcon active={sortKey === "subs"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("clicks")}>Clicks <SortIcon active={sortKey === "clicks"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("spend")}>Spend <SortIcon active={sortKey === "spend"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("revenue")}>
                    <span className="inline-flex items-center gap-1">
                      Revenue
                      <Tooltip><TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">Revenue reflects lifetime revenue of tracking links attributed to this marketer.</TooltipContent>
                      </Tooltip>
                    </span>
                    <SortIcon active={sortKey === "revenue"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profit")}>Profit <SortIcon active={sortKey === "profit"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("ltv")}>LTV <SortIcon active={sortKey === "ltv"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("cpl")}>CPL/CPC <SortIcon active={sortKey === "cpl"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("cvr")}>CVR <SortIcon active={sortKey === "cvr"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("roi")}>ROI <SortIcon active={sortKey === "roi"} asc={sortAsc} /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row, i) => {
                  const isExpanded = expandedModel === row.accountId;
                  const pColor = profitColor(row.profit);
                  const roiColor = row.roi !== null ? profitColor(row.roi) : undefined;
                  const cvrColor = row.cvr !== null ? (row.cvr > 51.17 ? "hsl(142 71% 45%)" : row.cvr < 16.69 ? "hsl(0 84% 60%)" : undefined) : undefined;
                  const rowBg = i % 2 === 1 ? "bg-muted/30" : "";

                  return (
                    <React.Fragment key={row.accountId}>
                      <TableRow
                        className={`border-border cursor-pointer hover:bg-muted/50 transition-colors ${rowBg} ${isExpanded ? "bg-muted/40" : ""}`}
                        style={{ borderLeft: `3px solid ${isExpanded ? "hsl(var(--primary))" : "transparent"}` }}
                        onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.borderLeftColor = "hsl(var(--primary))"; }}
                        onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
                        onClick={() => handleRowClick(row)}
                      >
                        <TableCell className="min-w-[180px]">
                          <div className="flex items-center gap-2">
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            <ModelAvatar avatarUrl={row.avatarUrl} name={row.username || row.displayName} size={28} />
                            <div>
                              <p className="text-foreground font-semibold" style={{ fontSize: "13px" }}>{row.username ? `@${row.username}` : row.displayName}</p>
                              {row.username && row.displayName !== row.username && (
                                <p className="text-muted-foreground" style={{ fontSize: "11px" }}>{row.displayName}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-foreground" style={{ fontSize: "13px" }}>{fmtN(row.campaignCount)}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.subs)}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.clicks)}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtC(row.spend)}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtC(row.revenue)}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: pColor }}>{row.profit >= 0 ? `+${fmtC(row.profit)}` : fmtC(row.profit)}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.ltv !== null ? fmtC(row.ltv) : "—"}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.costDisplay || "—"}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: cvrColor }}>{row.cvr !== null ? fmtPct(row.cvr) : "—"}</TableCell>
                        <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: roiColor }}>{row.roi !== null ? fmtPct(row.roi) : "—"}</TableCell>
                      </TableRow>

                      {/* Expanded sub-table */}
                      {isExpanded && (
                        <TableRow className="border-border">
                          <TableCell colSpan={11} className="p-0">
                            <div className="bg-background/50 border-t border-border">
                              <table className="w-full table-fixed text-sm">
                                 <colgroup>
                                   <col style={{ width: "18%" }} />
                                   <col style={{ width: "8%" }} />
                                   <col style={{ width: "7%" }} />
                                   <col style={{ width: "7%" }} />
                                   <col style={{ width: "10%" }} />
                                   <col style={{ width: "11%" }} />
                                   <col style={{ width: "10%" }} />
                                   <col style={{ width: "8%" }} />
                                   <col style={{ width: "8%" }} />
                                   <col style={{ width: "6.5%" }} />
                                   <col style={{ width: "6.5%" }} />
                                 </colgroup>
                                 <thead>
                                  <tr className="border-b border-border">
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap text-left py-1.5 pl-12 pr-2">Campaigns ({expandedModelData.length})</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Orders</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Subs</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Clicks</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Spend</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Revenue</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Profit</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">LTV</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">CPL/CPC</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">CVR</th>
                                    <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">ROI</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedModelData.map((c: any) => {
                                    const cProfitColor = c.profit !== null ? profitColor(c.profit) : undefined;
                                    const cRoiColor = c.roi !== null ? profitColor(c.roi) : undefined;
                                    const cCvrColor = c.cvr !== null ? (c.cvr > 51.17 ? "hsl(142 71% 45%)" : c.cvr < 16.69 ? "hsl(0 84% 60%)" : undefined) : undefined;
                                    return (
                                      <tr
                                        key={c.id}
                                        className="border-b border-border cursor-pointer hover:bg-muted/40 transition-colors"
                                        style={{ borderLeft: "3px solid transparent", height: "38px" }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "hsl(var(--primary))"; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
                                        onClick={e => { e.stopPropagation(); setSelectedCampaign(c); }}
                                      >
                                        <td className="pl-12 pr-2 py-1 overflow-hidden">
                                          <p className="text-foreground font-semibold truncate" style={{ fontSize: "12px" }}>{c.campaignName || "Unnamed"}</p>
                                          <p className="text-muted-foreground truncate" style={{ fontSize: "10px" }}>{c.url}</p>
                                        </td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtN(c.orderCount)}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtN(c.subs)}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtN(c.clicks)}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtC(c.costTotal)}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: "hsl(var(--primary))" }}>{fmtC(c.revenue)}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: cProfitColor }}>{c.profit !== null ? (c.profit >= 0 ? `+${fmtC(c.profit)}` : fmtC(c.profit)) : "—"}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{c.ltv !== null ? fmtC(c.ltv) : "—"}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{c.costDisplay || "—"}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: cCvrColor }}>{c.cvr !== null ? fmtPct(c.cvr) : "—"}</td>
                                        <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: cRoiColor }}>{c.roi !== null ? fmtPct(c.roi) : "—"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </table>
          )}

          {/* Footer */}
          {sorted.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
                Showing {sorted.length} of {modelRows.length} models · Click any row to expand campaigns · Click a campaign to open full details
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Campaign Drawer */}
      <CampaignDetailDrawer campaign={selectedCampaign} onClose={() => setSelectedCampaign(null)} />
    </DashboardLayout>
  );
}

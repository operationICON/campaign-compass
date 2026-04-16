import React, { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ModelAvatar } from "@/components/ModelAvatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Search, X, Info, ChevronUp, ChevronDown } from "lucide-react";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

type SortKey = "model" | "orders" | "subs" | "clicks" | "spend" | "revenue" | "profit" | "ltv" | "cpl" | "cvr" | "roi";

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronDown className="h-3 w-3 inline ml-0.5 opacity-20" />;
  return asc ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" /> : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
}

export default function MarketerDrilldownPage() {
  const { marketer, offer_id } = useParams<{ marketer: string; offer_id: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortAsc, setSortAsc] = useState(false);
  const [scaleFilter, setScaleFilter] = useState(false);
  const [highVolFilter, setHighVolFilter] = useState(false);

  const decodedMarketer = decodeURIComponent(marketer || "");
  const offerId = offer_id ? Number(offer_id) : null;

  // Fetch orders for this marketer + offer_id
  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["marketer_orders", decodedMarketer, offerId],
    queryFn: async () => {
      let q = supabase
        .from("onlytraffic_orders")
        .select("id, tracking_link_id, quantity_delivered, total_spent, marketer, offer_id, source, status, order_id")
        .eq("marketer", decodedMarketer)
        .in("status", ["completed", "accepted", "active", "waiting"]);
      if (offerId != null) q = q.eq("offer_id", offerId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!decodedMarketer,
  });

  // Get unique tracking_link_ids
  const trackingLinkIds = useMemo(() => {
    const ids = new Set<string>();
    orders.forEach(o => { if (o.tracking_link_id) ids.add(o.tracking_link_id); });
    return [...ids];
  }, [orders]);

  // Fetch tracking links
  const { data: trackingLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["marketer_tracking_links", trackingLinkIds],
    queryFn: async () => {
      if (trackingLinkIds.length === 0) return [];
      // Batch fetch in chunks of 50
      const all: any[] = [];
      for (let i = 0; i < trackingLinkIds.length; i += 50) {
        const chunk = trackingLinkIds.slice(i, i + 50);
        const { data } = await supabase
          .from("tracking_links")
          .select("id, account_id, clicks, subscribers, revenue, cost_total")
          .in("id", chunk);
        if (data) all.push(...data);
      }
      return all;
    },
    enabled: trackingLinkIds.length > 0,
  });

  // Fetch accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, username, display_name, avatar_thumb_url, avatar_url").order("display_name");
      return data || [];
    },
  });

  // Determine source label from first order
  const sourceLabel = useMemo(() => {
    const first = orders.find(o => o.source);
    return first?.source || "Direct";
  }, [orders]);

  // Build model breakdown
  const modelRows = useMemo(() => {
    const tlMap: Record<string, any> = {};
    trackingLinks.forEach(tl => { tlMap[tl.id] = tl; });

    // Group orders by account_id (via tracking link)
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
      const orderCount = g.orders.length;
      const subs = g.orders.reduce((s, o) => s + (o.quantity_delivered || 0), 0);
      const spend = g.orders.reduce((s, o) => s + Number(o.total_spent || 0), 0);

      // Aggregate tracking link metrics (deduplicated)
      let clicks = 0, revenue = 0;
      g.tlIds.forEach(tlId => {
        const tl = tlMap[tlId];
        if (tl) {
          clicks += tl.clicks || 0;
          revenue += Number(tl.revenue || 0);
        }
      });

      const profit = revenue - spend;
      const ltv = subs > 0 ? revenue / subs : null;
      const cpl = subs > 0 ? spend / subs : null;
      const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
      const roi = spend > 0 ? (profit / spend) * 100 : null;

      return {
        accountId: g.accountId,
        username: acc?.username || null,
        displayName: acc?.display_name || "Unknown",
        avatarUrl: acc?.avatar_thumb_url || acc?.avatar_url || null,
        orderCount, subs, clicks, spend, revenue, profit, ltv, cpl, cvr, roi,
      };
    });
  }, [orders, trackingLinks, accounts]);

  // Apply filters
  const filtered = useMemo(() => {
    let rows = modelRows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.username || "").toLowerCase().includes(q) ||
        (r.displayName || "").toLowerCase().includes(q)
      );
    }
    if (scaleFilter) rows = rows.filter(r => r.profit > 0 && r.roi !== null && r.roi > 50);
    if (highVolFilter) rows = rows.filter(r => r.orderCount > 10);
    return rows;
  }, [modelRows, search, scaleFilter, highVolFilter]);

  // Sort
  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const getVal = (r: typeof a): number | string => {
        switch (sortKey) {
          case "model": return (r.username || r.displayName || "").toLowerCase();
          case "orders": return r.orderCount;
          case "subs": return r.subs;
          case "clicks": return r.clicks;
          case "spend": return r.spend;
          case "revenue": return r.revenue;
          case "profit": return r.profit;
          case "ltv": return r.ltv ?? -Infinity;
          case "cpl": return r.cpl ?? -Infinity;
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

  const totalOrders = modelRows.reduce((s, r) => s + r.orderCount, 0);
  const modelCount = modelRows.length;
  const isLoading = ordersLoading || linksLoading;

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  const handleRowClick = (row: typeof sorted[0]) => {
    const modelParam = row.username || row.displayName;
    navigate(`/sources/onlytraffic/${encodeURIComponent(decodedMarketer)}/${offerId ?? ""}/${encodeURIComponent(modelParam)}`);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate("/traffic-sources")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontSize: "13px", fontWeight: 500 }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to OnlyTraffic
        </button>

        {/* Title */}
        <div>
          <h1 className="text-foreground font-bold" style={{ fontSize: "22px" }}>
            {decodedMarketer} — {sourceLabel} {offerId != null ? offerId : ""}
          </h1>
          <p className="text-muted-foreground" style={{ fontSize: "13px", marginTop: "2px" }}>
            · {fmtN(totalOrders)} orders · {fmtN(modelCount)} models
          </p>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search model..."
              className="pl-9 pr-8 h-10 text-sm bg-card border-border rounded-lg"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground whitespace-nowrap" style={{ fontSize: "12px" }}>Quick filter:</span>
            <button
              onClick={() => setScaleFilter(!scaleFilter)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${scaleFilter ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-foreground hover:border-primary/30"}`}
            >
              Scale candidates
            </button>
            <button
              onClick={() => setHighVolFilter(!highVolFilter)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${highVolFilter ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-foreground hover:border-primary/30"}`}
            >
              High Volume Orders
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" style={{ fontSize: "13px" }}>
              {modelRows.length === 0 ? "No orders found for this marketer" : "No models match your filters"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className={thClass} onClick={() => handleSort("model")}>
                    Model <SortIcon active={sortKey === "model"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("orders")}>
                    Orders <SortIcon active={sortKey === "orders"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("subs")}>
                    Subs <SortIcon active={sortKey === "subs"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("clicks")}>
                    Clicks <SortIcon active={sortKey === "clicks"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("spend")}>
                    Spend <SortIcon active={sortKey === "spend"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("revenue")}>
                    <span className="inline-flex items-center gap-1">
                      Revenue
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Revenue reflects lifetime revenue of tracking links attributed to this marketer. May include cross-attribution if links were used by multiple marketers.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                    <SortIcon active={sortKey === "revenue"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profit")}>
                    Profit <SortIcon active={sortKey === "profit"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("ltv")}>
                    LTV <SortIcon active={sortKey === "ltv"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("cpl")}>
                    CPL <SortIcon active={sortKey === "cpl"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("cvr")}>
                    CVR <SortIcon active={sortKey === "cvr"} asc={sortAsc} />
                  </TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("roi")}>
                    ROI <SortIcon active={sortKey === "roi"} asc={sortAsc} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row, i) => {
                  const profitColor = row.profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";
                  const roiColor = row.roi !== null ? (row.roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
                  const cvrColor = row.cvr !== null
                    ? row.cvr > 51.17 ? "hsl(142 71% 45%)" : row.cvr < 16.69 ? "hsl(0 84% 60%)" : undefined
                    : undefined;
                  const rowBg = i % 2 === 1 ? "bg-muted/30" : "";

                  return (
                    <TableRow
                      key={row.accountId}
                      className={`border-border cursor-pointer hover:bg-muted/50 transition-colors ${rowBg}`}
                      style={{ borderLeft: "3px solid transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "hsl(var(--primary))"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
                      onClick={() => handleRowClick(row)}
                    >
                      <TableCell className="min-w-[180px]">
                        <div className="flex items-center gap-2">
                          <ModelAvatar
                            avatarUrl={row.avatarUrl}
                            name={row.username || row.displayName}
                            size={28}
                          />
                          <div>
                            <p className="text-foreground font-semibold" style={{ fontSize: "13px" }}>
                              {row.username ? `@${row.username}` : row.displayName}
                            </p>
                            {row.username && row.displayName !== row.username && (
                              <p className="text-muted-foreground" style={{ fontSize: "11px" }}>{row.displayName}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.orderCount)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.subs)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.clicks)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtC(row.spend)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtC(row.revenue)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: profitColor }}>
                        {row.profit >= 0 ? `+${fmtC(row.profit)}` : fmtC(row.profit)}
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.ltv !== null ? fmtC(row.ltv) : "—"}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.cpl !== null ? fmtC(row.cpl) : "—"}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: cvrColor }}>{row.cvr !== null ? fmtPct(row.cvr) : "—"}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: roiColor }}>{row.roi !== null ? fmtPct(row.roi) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Footer */}
          {sorted.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
                Showing {sorted.length} of {modelRows.length} models · Click any row to see orders for that model
              </span>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

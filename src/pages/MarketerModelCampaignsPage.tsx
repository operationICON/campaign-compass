import React, { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ModelAvatar } from "@/components/ModelAvatar";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronUp, ChevronDown } from "lucide-react";
import { LinkActivityFilter, type LinkActivityFilterValue } from "@/components/LinkActivityFilter";
import { useActiveLinkStatus, getActiveInfo } from "@/hooks/useActiveLinkStatus";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

type SortKey =
  | "campaign" | "created" | "model" | "source" | "marketer" | "offerId"
  | "orderId" | "clicks" | "subs" | "spend" | "revenue" | "profit"
  | "profitSub" | "ltvSub" | "roi";

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronDown className="h-3 w-3 inline ml-0.5 opacity-20" />;
  return asc ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" /> : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
}

interface CampaignRow {
  id: string;
  campaignName: string | null;
  url: string;
  createdAt: string;
  clicks: number;
  subs: number;
  costTotal: number | null;
  revenue: number;
  sourceTag: string | null;
  marketer: string | null;
  offerId: number | null;
  orderId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  profit: number | null;
  profitSub: number | null;
  ltvSub: number | null;
  roi: number | null;
  // pass full link object for drawer
  rawLink: any;
}

export default function MarketerModelCampaignsPage() {
  const { marketer, offer_id, model_username } = useParams<{
    marketer: string;
    offer_id: string;
    model_username: string;
  }>();
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [activityFilter, setActivityFilter] = useState<LinkActivityFilterValue>("all");

  const decodedMarketer = decodeURIComponent(marketer || "");
  const decodedUsername = decodeURIComponent(model_username || "");
  const offerId = offer_id ? Number(offer_id) : null;

  // 1. Fetch the account for this username
  const { data: account } = useQuery({
    queryKey: ["account_by_username", decodedUsername],
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("id, username, display_name, avatar_thumb_url, avatar_url")
        .eq("username", decodedUsername)
        .limit(1);
      return data?.[0] || null;
    },
    enabled: !!decodedUsername,
  });

  // Snapshot-derived activity (>= 1 sub/day over last 5 days), scoped to this account
  const { activeLookup } = useActiveLinkStatus(account?.id ?? null);
  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["l4_orders", decodedMarketer, offerId, account?.id],
    queryFn: async () => {
      if (!account?.id) return [];
      let q = supabase
        .from("onlytraffic_orders")
        .select("id, tracking_link_id, marketer, offer_id, order_id, source, status, quantity_delivered, total_spent")
        .eq("marketer", decodedMarketer)
        .in("status", ["completed", "accepted", "active", "waiting"]);
      if (offerId != null) q = q.eq("offer_id", offerId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!account?.id,
  });

  // 3. Get tracking link ids that belong to this account
  const trackingLinkIds = useMemo(() => {
    // We need to cross-reference with tracking_links to filter by account
    const ids = new Set<string>();
    orders.forEach(o => { if (o.tracking_link_id) ids.add(o.tracking_link_id); });
    return [...ids];
  }, [orders]);

  // 4. Fetch tracking links for this account
  const { data: trackingLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["l4_tracking_links", trackingLinkIds, account?.id],
    queryFn: async () => {
      if (trackingLinkIds.length === 0 || !account?.id) return [];
      const all: any[] = [];
      for (let i = 0; i < trackingLinkIds.length; i += 50) {
        const chunk = trackingLinkIds.slice(i, i + 50);
        const { data } = await supabase
          .from("tracking_links")
          .select("*")
          .is("deleted_at", null)
          .in("id", chunk)
          .eq("account_id", account.id);
        if (data) all.push(...data);
      }
      return all;
    },
    enabled: trackingLinkIds.length > 0 && !!account?.id,
  });

  // Determine source label
  const sourceLabel = useMemo(() => {
    const first = orders.find(o => o.source);
    return first?.source || "Direct";
  }, [orders]);

  // Build rows: one row per tracking_link that has orders for this marketer+offer+model
  const rows: CampaignRow[] = useMemo(() => {
    const tlMap: Record<string, any> = {};
    trackingLinks.forEach(tl => { tlMap[tl.id] = tl; });

    // Group orders by tracking_link_id
    const ordersByTl: Record<string, any[]> = {};
    for (const o of orders) {
      if (!o.tracking_link_id) continue;
      if (!tlMap[o.tracking_link_id]) continue; // not this account
      if (!ordersByTl[o.tracking_link_id]) ordersByTl[o.tracking_link_id] = [];
      ordersByTl[o.tracking_link_id].push(o);
    }

    return Object.entries(ordersByTl).map(([tlId, tlOrders]) => {
      const tl = tlMap[tlId];
      const revenue = Number(tl.revenue || 0);
      const clicks = tl.clicks || 0;
      const subs = tl.subscribers || 0;
      const costTotal = tl.cost_total != null ? Number(tl.cost_total) : null;
      const hasSpend = costTotal != null && costTotal > 0;
      const profit = hasSpend ? revenue - costTotal : null;
      const profitSub = profit != null && subs > 0 ? profit / subs : null;
      const ltvSub = subs > 0 ? revenue / subs : null;
      const roi = hasSpend ? ((revenue - costTotal!) / costTotal!) * 100 : null;

      // Pick first order for marketer/offer/order metadata
      const firstOrder = tlOrders[0];

      return {
        id: tlId,
        campaignName: tl.campaign_name || null,
        url: tl.url,
        createdAt: tl.created_at,
        clicks,
        subs,
        costTotal,
        revenue,
        sourceTag: tl.source_tag || null,
        marketer: firstOrder.marketer,
        offerId: firstOrder.offer_id,
        orderId: firstOrder.order_id,
        username: account?.username || null,
        displayName: account?.display_name || null,
        avatarUrl: account?.avatar_thumb_url || account?.avatar_url || null,
        profit,
        profitSub,
        ltvSub,
        roi,
        rawLink: tl,
      };
    });
  }, [orders, trackingLinks, account]);

  // Sort
  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const getVal = (r: CampaignRow): number | string => {
        switch (sortKey) {
          case "campaign": return (r.campaignName || "").toLowerCase();
          case "created": return new Date(r.createdAt).getTime();
          case "model": return (r.username || "").toLowerCase();
          case "source": return (r.sourceTag || "").toLowerCase();
          case "marketer": return (r.marketer || "").toLowerCase();
          case "offerId": return r.offerId ?? -Infinity;
          case "orderId": return (r.orderId || "").toLowerCase();
          case "clicks": return r.clicks;
          case "subs": return r.subs;
          case "spend": return r.costTotal ?? -Infinity;
          case "revenue": return r.revenue;
          case "profit": return r.profit ?? -Infinity;
          case "profitSub": return r.profitSub ?? -Infinity;
          case "ltvSub": return r.ltvSub ?? -Infinity;
          case "roi": return r.roi ?? -Infinity;
          default: return 0;
        }
      };
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
  }, [rows, sortKey, sortAsc]);

  // Activity counts (snapshot-derived) for this marketer × model scope
  const activityCounts = useMemo(() => {
    let active = 0;
    for (const r of rows) if (getActiveInfo(r.id, activeLookup).isActive) active++;
    return { total: rows.length, active };
  }, [rows, activeLookup]);

  // Apply activity filter + override sort when filter is engaged
  const displayRows = useMemo(() => {
    if (activityFilter === "all") return sorted;
    if (activityFilter === "active") {
      return [...rows]
        .filter((r) => getActiveInfo(r.id, activeLookup).isActive)
        .sort((a, b) =>
          getActiveInfo(b.id, activeLookup).subsPerDay -
          getActiveInfo(a.id, activeLookup).subsPerDay
        );
    }
    return [...rows]
      .filter((r) => !getActiveInfo(r.id, activeLookup).isActive)
      .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
  }, [activityFilter, sorted, rows, activeLookup]);


  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const isLoading = ordersLoading || linksLoading;

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  const profitColor = (v: number | null) =>
    v == null ? undefined : v >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";
  const roiColor = profitColor;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate(`/sources/onlytraffic/${encodeURIComponent(decodedMarketer)}/${offerId ?? ""}`)}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontSize: "13px", fontWeight: 500 }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to {decodedMarketer} — {sourceLabel} {offerId != null ? offerId : ""}
        </button>

        {/* Title */}
        <div>
          <h1 className="text-foreground font-medium" style={{ fontSize: "22px" }}>
            {decodedMarketer} — {sourceLabel} {offerId != null ? offerId : ""} × @{decodedUsername}
          </h1>
          <p className="text-muted-foreground" style={{ fontSize: "13px", marginTop: "2px" }}>
            · {fmtN(rows.length)} campaigns
          </p>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted-foreground" style={{ fontSize: "13px" }}>
                No campaigns found for this marketer × model combination.
              </p>
              <button
                onClick={() => navigate(`/sources/onlytraffic/${encodeURIComponent(decodedMarketer)}/${offerId ?? ""}`)}
                className="text-primary hover:underline text-sm"
              >
                ← Back to {decodedMarketer}
              </button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className={thClass} onClick={() => handleSort("campaign")}>Campaign <SortIcon active={sortKey === "campaign"} asc={sortAsc} /></TableHead>
                  <TableHead className={thClass} onClick={() => handleSort("created")}>Created <SortIcon active={sortKey === "created"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("clicks")}>Clicks <SortIcon active={sortKey === "clicks"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("subs")}>Subs <SortIcon active={sortKey === "subs"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("spend")}>Spend <SortIcon active={sortKey === "spend"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("revenue")}>Revenue <SortIcon active={sortKey === "revenue"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profit")}>Profit <SortIcon active={sortKey === "profit"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profitSub")}>Profit/Sub <SortIcon active={sortKey === "profitSub"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("ltvSub")}>LTV/Sub <SortIcon active={sortKey === "ltvSub"} asc={sortAsc} /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort("roi")}>ROI <SortIcon active={sortKey === "roi"} asc={sortAsc} /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row, i) => {
                  const rowBg = i % 2 === 1 ? "bg-muted/30" : "";
                  return (
                    <TableRow
                      key={row.id}
                      className={`border-border cursor-pointer hover:bg-muted/50 transition-colors ${rowBg}`}
                      style={{ borderLeft: "3px solid transparent", minHeight: "52px" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "hsl(var(--primary))"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
                      onClick={() => setSelectedLink(row.rawLink)}
                    >
                      <TableCell>
                        <p className="text-foreground font-semibold truncate max-w-[280px]" style={{ fontSize: "13px" }}>
                          {row.campaignName || "Unnamed"}
                        </p>
                        <p className="text-muted-foreground truncate max-w-[280px]" style={{ fontSize: "11px" }}>
                          {row.url}
                        </p>
                      </TableCell>
                      <TableCell>
                        <CampaignAgePill createdAt={row.createdAt} clicks={row.clicks} revenue={row.revenue} />
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.clicks)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.subs)}</TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>
                        {row.costTotal != null ? fmtC(row.costTotal) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: "hsl(var(--primary))" }}>
                        {fmtC(row.revenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: profitColor(row.profit) }}>
                        {row.profit != null ? (row.profit >= 0 ? `+${fmtC(row.profit)}` : fmtC(row.profit)) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: profitColor(row.profitSub) }}>
                        {row.profitSub != null ? fmtC(row.profitSub) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: "hsl(var(--primary))" }}>
                        {row.ltvSub != null ? fmtC(row.ltvSub) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: roiColor(row.roi) }}>
                        {row.roi != null ? fmtPct(row.roi) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {sorted.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
                Showing {sorted.length} of {rows.length} campaigns · Click any row to view campaign details
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Campaign Detail Drawer */}
      {selectedLink && (
        <CampaignDetailDrawer
          campaign={selectedLink}
          onClose={() => setSelectedLink(null)}
        />
      )}
    </DashboardLayout>
  );
}

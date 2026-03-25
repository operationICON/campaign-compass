import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTrackingLinks, fetchAccounts, fetchSourceTagRules } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";
import { ChevronUp, ChevronDown, DollarSign, TrendingUp, BarChart3, Target, Tag, Info, ChevronRight } from "lucide-react";

type SortKey = "source" | "campaigns" | "totalSpend" | "totalLtv" | "totalProfit" | "roi" | "avgCvr";

export default function MediaBuyersTab() {
  const queryClient = useQueryClient();
  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: tagRules = [] } = useQuery({ queryKey: ["source_tag_rules"], queryFn: fetchSourceTagRules });
  const [sortKey, setSortKey] = useState<SortKey>("totalProfit");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('media-buyers-tags')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tracking_links' }, () => {
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const agencyAvgCvr = useMemo(() => {
    const qualified = links.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const totalS = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalC = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return totalC > 0 ? (totalS / totalC) * 100 : null;
  }, [links]);

  // KPIs for Media Buyers tab
  const kpis = useMemo(() => {
    const withSpend = links.filter((l: any) => Number(l.cost_total || 0) > 0);
    const activeSources = new Set(withSpend.filter((l: any) => l.source_tag && l.source_tag !== "Untagged").map((l: any) => l.source_tag)).size;
    const totalLtv = withSpend.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const totalSpend = withSpend.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const totalProfit = totalLtv - totalSpend;
    const blendedROI = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : null;
    return { activeSources, totalLtv, totalSpend, totalProfit, blendedROI };
  }, [links]);

  const sourceRows = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; active: number; totalSpend: number; totalLtv: number; totalProfit: number; totalClicks: number; totalSubs: number }> = {};
    links.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!map[src]) map[src] = { source: src, campaigns: 0, active: 0, totalSpend: 0, totalLtv: 0, totalProfit: 0, totalClicks: 0, totalSubs: 0 };
      map[src].campaigns++;
      if (l.clicks > 0) map[src].active++;
      map[src].totalSpend += Number(l.cost_total || 0);
      map[src].totalLtv += Number(l.revenue || 0);
      map[src].totalProfit += Number(l.revenue || 0) - Number(l.cost_total || 0);
      map[src].totalClicks += l.clicks || 0;
      map[src].totalSubs += l.subscribers || 0;
    });
    return Object.values(map).map(r => ({
      ...r,
      roi: r.totalSpend > 0 ? (r.totalProfit / r.totalSpend) * 100 : null,
      avgCvr: r.totalClicks > 100 ? (r.totalSubs / r.totalClicks) * 100 : null,
    }));
  }, [links]);

  const sortedRows = useMemo(() => {
    // Put Untagged at the bottom
    return [...sourceRows].sort((a: any, b: any) => {
      if (a.source === "Untagged") return 1;
      if (b.source === "Untagged") return -1;
      const av = a[sortKey] ?? (sortKey === "source" ? "" : -Infinity);
      const bv = b[sortKey] ?? (sortKey === "source" ? "" : -Infinity);
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    });
  }, [sourceRows, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // Campaigns for expanded source
  const expandedCampaigns = useMemo(() => {
    if (!expandedSource) return [];
    return links
      .filter((l: any) => (l.source_tag || "Untagged") === expandedSource)
      .sort((a: any, b: any) => Number(b.revenue || 0) - Number(a.revenue || 0));
  }, [links, expandedSource]);

  // Best model per source
  const bestModelPerSource = useMemo(() => {
    const withSpend = links.filter((l: any) => Number(l.cost_total || 0) > 0 && l.source_tag && l.source_tag !== "Untagged");
    const map: Record<string, Record<string, { profit: number; subs: number; clicks: number; name: string }>> = {};
    withSpend.forEach((l: any) => {
      const src = l.source_tag;
      const aid = l.account_id;
      if (!map[src]) map[src] = {};
      if (!map[src][aid]) {
        const acc = accounts.find((a: any) => a.id === aid);
        map[src][aid] = { profit: 0, subs: 0, clicks: 0, name: acc?.display_name || l.accounts?.display_name || "?" };
      }
      map[src][aid].profit += Number(l.profit || 0);
      map[src][aid].subs += l.subscribers || 0;
      map[src][aid].clicks += l.clicks || 0;
    });
    const result: Record<string, { bestProfit: { name: string; value: number }; bestCvr: { name: string; value: number } }> = {};
    Object.entries(map).forEach(([src, models]) => {
      let bestP = { name: "", value: -Infinity };
      let bestC = { name: "", value: -Infinity };
      Object.values(models).forEach(m => {
        if (m.profit > bestP.value) bestP = { name: m.name, value: m.profit };
        const cvr = m.clicks > 0 ? (m.subs / m.clicks) * 100 : 0;
        if (cvr > bestC.value) bestC = { name: m.name, value: cvr };
      });
      result[src] = { bestProfit: bestP, bestCvr: bestC };
    });
    return result;
  }, [links, accounts]);

  const unattributedPct = useMemo(() => {
    const syncedAccounts = accounts.filter((a: any) => a.sync_enabled !== false);
    const accountTotalSubs = syncedAccounts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    const syncedIds = new Set(syncedAccounts.map((a: any) => a.id));
    const attributedSubs = links.filter((l: any) => syncedIds.has(l.account_id)).reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    if (accountTotalSubs === 0) return 0;
    return Math.max(0, ((accountTotalSubs - attributedSubs) / accountTotalSubs) * 100);
  }, [accounts, links]);

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const SortHeader = ({ label, field, align = "left" }: { label: string; field: SortKey; align?: string }) => (
    <th onClick={() => toggleSort(field)}
      className={`px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none ${align === "right" ? "text-right" : "text-left"}`}>
      <span className="inline-flex items-center gap-1">{label}
        {sortKey === field && (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)}
      </span>
    </th>
  );

  return (
    <div className="space-y-5">
      {/* Unattributed note */}
      <div className="flex items-start gap-2.5 bg-muted/50 border border-border rounded-xl px-4 py-3">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Approximately <span className="font-semibold text-foreground">{unattributedPct.toFixed(0)}%</span> of total subscribers arrive without tracking link attribution. Source performance below reflects attributed traffic only.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-4 card-hover">
          <div className="flex items-center gap-2 mb-2"><Tag className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Active Sources</span></div>
          <p className="text-2xl font-bold font-mono text-foreground">{kpis.activeSources}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 card-hover">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Attributed LTV</span></div>
          <p className="text-2xl font-bold font-mono text-primary">{fmtCurrency(kpis.totalLtv)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Attributed</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 card-hover">
          <div className="flex items-center gap-2 mb-2"><DollarSign className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Profit</span></div>
          <p className={`text-2xl font-bold font-mono ${kpis.totalProfit >= 0 ? "text-primary" : "text-destructive"}`}>{fmtCurrency(kpis.totalProfit)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 card-hover">
          <div className="flex items-center gap-2 mb-2"><BarChart3 className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Blended ROI</span></div>
          <p className={`text-2xl font-bold font-mono ${kpis.blendedROI !== null ? (kpis.blendedROI >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
            {kpis.blendedROI !== null ? fmtPct(kpis.blendedROI) : "—"}
          </p>
        </div>
      </div>

      {/* Source Performance Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Source Performance</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <SortHeader label="Source" field="source" />
              <SortHeader label="Campaigns" field="campaigns" align="right" />
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Active</th>
              <SortHeader label="Spend" field="totalSpend" align="right" />
              <SortHeader label="Attributed LTV" field="totalLtv" align="right" />
              <SortHeader label="Profit" field="totalProfit" align="right" />
              <SortHeader label="ROI" field="roi" align="right" />
              <SortHeader label="Avg CVR" field="avgCvr" align="right" />
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const isExpanded = expandedSource === row.source;
              return (
                <React.Fragment key={row.source}>
                  <tr className={`border-b border-border hover:bg-muted/20 transition-colors cursor-pointer ${row.source === "Untagged" ? "opacity-60" : ""}`}
                    onClick={() => setExpandedSource(isExpanded ? null : row.source)}>
                    <td className="px-4 py-3"><TagBadge tagName={row.source} size="md" /></td>
                    <td className="px-4 py-3 text-right font-mono">{row.campaigns}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{row.active}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.totalSpend > 0 ? fmtCurrency(row.totalSpend) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-primary font-semibold">{fmtCurrency(row.totalLtv)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${row.totalSpend > 0 ? (row.totalProfit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                      {row.totalSpend > 0 ? (row.totalProfit >= 0 ? "+" : "") + fmtCurrency(row.totalProfit) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${row.roi !== null ? (row.roi >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                      {row.roi !== null ? fmtPct(row.roi) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${
                      row.avgCvr !== null && agencyAvgCvr !== null
                        ? (row.avgCvr > agencyAvgCvr * 1.2 ? "text-primary" : row.avgCvr < agencyAvgCvr * 0.8 ? "text-destructive" : "text-foreground")
                        : "text-muted-foreground"
                    }`}>
                      {row.avgCvr !== null ? fmtPct(row.avgCvr) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </td>
                  </tr>
                  {isExpanded && expandedCampaigns.length > 0 && (
                    <tr>
                      <td colSpan={9} className="px-0 py-0">
                        <div className="bg-secondary/30 border-t border-border">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/50">
                                <th className="px-6 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Campaign</th>
                                <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Model</th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">LTV</th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Spend</th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Profit</th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">ROI</th>
                                <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedCampaigns.slice(0, 20).map((l: any) => {
                                const cost = Number(l.cost_total || 0);
                                const profit = Number(l.profit || 0);
                                const roi = Number(l.roi || 0);
                                const hasCost = cost > 0;
                                return (
                                  <tr key={l.id} className="border-b border-border/30">
                                    <td className="px-6 py-2 text-[12px] font-medium text-foreground truncate max-w-[200px]">{l.campaign_name || "—"}</td>
                                    <td className="px-4 py-2 text-[11px] text-muted-foreground">@{l.accounts?.username || "?"}</td>
                                    <td className="px-4 py-2 text-right font-mono text-primary">{fmtCurrency(Number(l.revenue || 0))}</td>
                                    <td className="px-4 py-2 text-right font-mono">{hasCost ? fmtCurrency(cost) : "—"}</td>
                                    <td className={`px-4 py-2 text-right font-mono font-semibold ${hasCost ? (profit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                                      {hasCost ? (profit >= 0 ? "+" : "") + fmtCurrency(profit) : "—"}
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono font-semibold ${hasCost ? (roi >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                                      {hasCost ? fmtPct(roi) : "—"}
                                    </td>
                                    <td className="px-4 py-2">
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                        l.status === "SCALE" ? "bg-[hsl(142_71%_45%/0.1)] text-[hsl(142_71%_45%)]" :
                                        l.status === "WATCH" ? "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]" :
                                        l.status === "KILL" ? "bg-[hsl(0_84%_60%/0.12)] text-[hsl(0_84%_60%)]" :
                                        l.status === "DEAD" ? "bg-secondary text-muted-foreground" :
                                        "bg-secondary text-muted-foreground"
                                      }`}>{l.status || "NO SPEND"}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
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

      {/* Best Model per Source */}
      {Object.keys(bestModelPerSource).length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Best Model per Source</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Which model performs best on each traffic source</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Source</th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Highest Profit</th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Highest CVR</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(bestModelPerSource).map(([src, data]) => (
                <tr key={src} className="border-b border-border/50">
                  <td className="px-4 py-3"><TagBadge tagName={src} size="md" /></td>
                  <td className="px-4 py-3">
                    <span className="text-foreground font-medium text-[13px]">{data.bestProfit.name}</span>
                    <span className="ml-2 text-primary text-xs font-mono">{fmtCurrency(data.bestProfit.value)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-foreground font-medium text-[13px]">{data.bestCvr.name}</span>
                    <span className="ml-2 text-primary text-xs font-mono">{fmtPct(data.bestCvr.value)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && sourceRows.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-16 text-center text-muted-foreground">
          No source tags assigned yet.
        </div>
      )}
    </div>
  );
}

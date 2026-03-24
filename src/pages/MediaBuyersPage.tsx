import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchTrackingLinks, fetchAccounts } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";
import { ChevronUp, ChevronDown, DollarSign, TrendingUp, BarChart3, Target, Tag, Info } from "lucide-react";

type SortKey = "source" | "campaigns" | "totalSpend" | "totalLtv" | "totalProfit" | "roi" | "avgCvr";

export default function MediaBuyersPage() {
  const queryClient = useQueryClient();
  const { data: links = [], isLoading } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [sortKey, setSortKey] = useState<SortKey>("totalProfit");
  const [sortAsc, setSortAsc] = useState(false);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('media-buyers-tags')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tracking_links' }, () => {
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Agency benchmark CVR
  const agencyAvgCvr = useMemo(() => {
    const qualified = links.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const totalS = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalC = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return totalC > 0 ? (totalS / totalC) * 100 : null;
  }, [links]);

  // Group by source_tag
  const sourceRows = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; totalSpend: number; totalLtv: number; totalProfit: number; totalClicks: number; totalSubs: number }> = {};
    links.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!map[src]) map[src] = { source: src, campaigns: 0, totalSpend: 0, totalLtv: 0, totalProfit: 0, totalClicks: 0, totalSubs: 0 };
      map[src].campaigns++;
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
    return [...sourceRows].sort((a: any, b: any) => {
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

  const totalSpend = sourceRows.reduce((s, r) => s + r.totalSpend, 0);
  const totalLtv = sourceRows.reduce((s, r) => s + r.totalLtv, 0);
  const totalProfit = totalLtv - totalSpend;
  const blendedROI = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;
  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  // Unattributed subs calculation
  const unattributedPct = useMemo(() => {
    const accountTotalSubs = accounts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    const attributedSubs = links.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    if (accountTotalSubs === 0) return 0;
    return Math.max(0, ((accountTotalSubs - attributedSubs) / accountTotalSubs) * 100);
  }, [accounts, links]);

  const SortHeader = ({ label, field, align = "left" }: { label: string; field: SortKey; align?: string }) => (
    <th onClick={() => toggleSort(field)}
      className={`px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none ${align === "right" ? "text-right" : "text-left"}`}>
      <span className="inline-flex items-center gap-1">{label}
        {sortKey === field && (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)}
      </span>
    </th>
  );

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Traffic Sources</h1>
          <p className="text-sm text-muted-foreground">
            Performance by traffic source (grouped by source tag)
            {agencyAvgCvr !== null && (
              <span className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                <Target className="h-3 w-3" /> Agency avg CVR: {agencyAvgCvr.toFixed(1)}%
              </span>
            )}
          </p>
        </div>

        {/* Unattributed traffic note */}
        <div className="flex items-start gap-2.5 bg-muted/50 border border-border rounded-xl px-4 py-3">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Approximately <span className="font-semibold text-foreground">{unattributedPct.toFixed(0)}%</span> of total subscribers arrive without tracking link attribution. Source performance below reflects attributed traffic only.
          </p>
        </div>

        {/* Hero Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Sources", value: String(sourceRows.length), icon: Tag },
            { label: "Total Spend", value: fmtCurrency(totalSpend), icon: DollarSign },
            { label: "Total LTV", value: fmtCurrency(totalLtv), icon: TrendingUp },
            { label: "Blended ROI", value: totalSpend > 0 ? fmtPct(blendedROI) : "—", icon: BarChart3, colored: true, val: blendedROI },
          ].map(stat => (
            <div key={stat.label} className="bg-card border border-border rounded-lg p-4 card-hover">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className={`text-2xl font-bold font-mono ${stat.colored ? ((stat.val ?? 0) >= 0 ? "text-primary" : "text-destructive") : "text-foreground"}`}>{stat.value}</p>
            </div>
          ))}
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
                <SortHeader label="Total Spend" field="totalSpend" align="right" />
                <SortHeader label="Total LTV" field="totalLtv" align="right" />
                <SortHeader label="Profit" field="totalProfit" align="right" />
                <SortHeader label="ROI" field="roi" align="right" />
                <SortHeader label="Avg CVR" field="avgCvr" align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.source} className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3"><TagBadge tagName={row.source} size="md" /></td>
                  <td className="px-4 py-3 text-right font-mono">{row.campaigns}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && sourceRows.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-16 text-center text-muted-foreground">
            No source tags found. Auto-tag campaigns on the Tracking Links page to see performance by source.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

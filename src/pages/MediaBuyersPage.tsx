import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAdSpend, fetchTrackingLinks, fetchAccounts } from "@/lib/supabase-helpers";
import { ChevronUp, ChevronDown, Users, DollarSign, TrendingUp, BarChart3, Percent } from "lucide-react";

type SortKey = "name" | "totalSpend" | "totalRevenue" | "roi" | "campaignCount" | "subsPerDay";
type ViewMode = "roi" | "revenue" | "subs";

export default function MediaBuyersPage() {
  const { data: adSpendData = [], isLoading } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [sortKey, setSortKey] = useState<SortKey>("roi");
  const [sortAsc, setSortAsc] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("roi");

  const revByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue); });
    return map;
  }, [links]);

  const subsByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + (l.subscribers || 0); });
    return map;
  }, [links]);

  const clicksByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + (l.clicks || 0); });
    return map;
  }, [links]);

  const costByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { if (l.cost_total) map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.cost_total); });
    return map;
  }, [links]);

  const campaignToAccount = useMemo(() => {
    const map: Record<string, string> = {};
    links.forEach((l: any) => { map[l.campaign_id] = l.accounts?.display_name || "Unknown"; });
    return map;
  }, [links]);

  const buyers = useMemo(() => {
    const map: Record<string, any> = {};
    adSpendData.forEach((entry: any) => {
      const buyer = entry.media_buyer || "Unknown";
      if (!map[buyer]) map[buyer] = {
        name: buyer, totalSpend: 0, totalRevenue: 0, totalCost: 0, campaignIds: new Set(), totalSubs: 0, totalClicks: 0,
        bestModel: "", bestModelRev: 0, worstModel: "", worstModelRev: Infinity,
        earliestDate: entry.date, modelSpend: {} as Record<string, number>, modelRev: {} as Record<string, number>,
      };
      map[buyer].totalSpend += Number(entry.amount);
      map[buyer].campaignIds.add(entry.campaign_id);
      map[buyer].totalRevenue += revByCampaign[entry.campaign_id] || 0;
      map[buyer].totalSubs += subsByCampaign[entry.campaign_id] || 0;
      map[buyer].totalClicks += clicksByCampaign[entry.campaign_id] || 0;
      map[buyer].totalCost += costByCampaign[entry.campaign_id] || 0;
      const acctName = campaignToAccount[entry.campaign_id] || "";
      const acctRev = revByCampaign[entry.campaign_id] || 0;
      map[buyer].modelSpend[acctName] = (map[buyer].modelSpend[acctName] || 0) + Number(entry.amount);
      map[buyer].modelRev[acctName] = (map[buyer].modelRev[acctName] || 0) + acctRev;
      if (acctRev > map[buyer].bestModelRev) { map[buyer].bestModel = acctName; map[buyer].bestModelRev = acctRev; }
      if (acctRev < map[buyer].worstModelRev) { map[buyer].worstModel = acctName; map[buyer].worstModelRev = acctRev; }
      if (entry.date < map[buyer].earliestDate) map[buyer].earliestDate = entry.date;
    });
    return Object.values(map).map((b: any) => {
      const daysDiff = Math.max(1, Math.ceil((Date.now() - new Date(b.earliestDate).getTime()) / (1000 * 60 * 60 * 24)));
      const avgCvr = b.totalClicks > 0 ? (b.totalSubs / b.totalClicks) * 100 : 0;
      const avgCpl = b.totalSubs > 0 ? b.totalCost / b.totalSubs : 0;
      return {
        ...b,
        campaignCount: b.campaignIds.size,
        roi: b.totalSpend > 0 ? ((b.totalRevenue - b.totalSpend) / b.totalSpend) * 100 : 0,
        subsPerDay: +(b.totalSubs / daysDiff).toFixed(1),
        avgCvr,
        avgCpl,
      };
    });
  }, [adSpendData, revByCampaign, subsByCampaign, clicksByCampaign, costByCampaign, campaignToAccount]);

  const modelNames = useMemo(() => accounts.map((a: any) => a.display_name), [accounts]);

  const sortedBuyers = useMemo(() => {
    return [...buyers].sort((a: any, b: any) => {
      const av = a[sortKey] ?? 0; const bv = b[sortKey] ?? 0;
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    });
  }, [buyers, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };

  const totalBuyerSpend = buyers.reduce((s, b) => s + b.totalSpend, 0);
  const totalBuyerRevenue = buyers.reduce((s, b) => s + b.totalRevenue, 0);
  const blendedROI = totalBuyerSpend > 0 ? ((totalBuyerRevenue - totalBuyerSpend) / totalBuyerSpend) * 100 : 0;
  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const SortHeader = ({ label, field, align = "left" }: { label: string; field: SortKey; align?: string }) => (
    <th onClick={() => toggleSort(field)}
      className={`px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none ${align === "right" ? "text-right" : "text-left"}`}>
      <span className="inline-flex items-center gap-1">{label}
        {sortKey === field && (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)}
      </span>
    </th>
  );

  const getCellValue = (buyer: any, modelName: string) => {
    const spend = buyer.modelSpend?.[modelName] || 0;
    const rev = buyer.modelRev?.[modelName] || 0;
    if (viewMode === "roi") {
      const roiVal = spend > 0 ? ((rev - spend) / spend) * 100 : null;
      return roiVal !== null ? (
        <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold font-mono ${roiVal >= 0 ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}`}>{roiVal.toFixed(0)}%</span>
      ) : <span className="text-muted-foreground text-xs">—</span>;
    }
    if (viewMode === "revenue") {
      return rev > 0 ? (
        <span className="font-mono text-xs text-primary font-semibold">{fmtCurrency(rev)}</span>
      ) : <span className="text-muted-foreground text-xs">—</span>;
    }
    // subs per day — approximate
    return <span className="font-mono text-xs text-foreground">—</span>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Media Buyers</h1>
          <p className="text-sm text-muted-foreground">ROI comparison by media buyer</p>
        </div>

        {/* Hero Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Buyers", value: String(buyers.length), icon: Users },
            { label: "Total Spend", value: fmtCurrency(totalBuyerSpend), icon: DollarSign },
            { label: "Total Revenue", value: fmtCurrency(totalBuyerRevenue), icon: TrendingUp },
            { label: "Blended ROI", value: `${blendedROI.toFixed(1)}%`, icon: BarChart3, colored: true, val: blendedROI },
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

        {/* Performance Matrix */}
        {modelNames.length > 0 && sortedBuyers.length > 0 && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Performance Matrix — Buyer × Model</h3>
              <div className="flex items-center bg-secondary border border-border rounded-lg overflow-hidden">
                {(["roi", "revenue", "subs"] as ViewMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={`px-3 py-1.5 text-[10px] font-medium uppercase transition-colors ${viewMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {m === "roi" ? "By ROI" : m === "revenue" ? "By Revenue" : "By Subs/day"}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Buyer</th>
                    {modelNames.map(name => (
                      <th key={name} className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">{name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedBuyers.map((buyer: any) => (
                    <tr key={buyer.name} className="border-b border-border">
                      <td className="px-4 py-3 font-medium text-foreground">{buyer.name}</td>
                      {modelNames.map(name => (
                        <td key={name} className="px-4 py-3 text-center">{getCellValue(buyer, name)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detailed Buyer Cards */}
        <div className="grid grid-cols-2 gap-4">
          {sortedBuyers.map((b: any) => (
            <div key={b.name} className="bg-card border border-border rounded-lg p-5 card-hover">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
                  {b.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.campaignCount} campaigns · {b.subsPerDay} subs/day</p>
                </div>
                <span className={`ml-auto text-lg font-bold font-mono ${b.roi >= 0 ? "text-primary" : "text-destructive"}`}>{b.roi.toFixed(1)}%</span>
              </div>
              <div className="grid grid-cols-4 gap-3 text-xs mb-3">
                <div><span className="text-muted-foreground block">Spend</span><span className="font-mono text-foreground font-semibold">{fmtCurrency(b.totalSpend)}</span></div>
                <div><span className="text-muted-foreground block">Revenue</span><span className="font-mono text-primary font-semibold">{fmtCurrency(b.totalRevenue)}</span></div>
                <div><span className="text-muted-foreground block">Blended ROI</span><span className={`font-mono font-semibold ${b.roi >= 0 ? "text-primary" : "text-destructive"}`}>{b.roi.toFixed(1)}%</span></div>
                <div><span className="text-muted-foreground block">Avg CVR</span><span className="font-mono text-foreground font-semibold">{b.avgCvr.toFixed(1)}%</span></div>
              </div>
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div><span className="text-muted-foreground block">Avg CPL</span><span className="font-mono text-foreground font-semibold">{b.avgCpl > 0 ? fmtCurrency(b.avgCpl) : "—"}</span></div>
                <div><span className="text-muted-foreground block">Subs/Day</span><span className="font-mono text-foreground font-semibold">{b.subsPerDay}</span></div>
                <div><span className="text-muted-foreground block">Best Model</span><span className="text-foreground font-semibold">{b.bestModel || "—"}</span></div>
                <div><span className="text-muted-foreground block">Worst Model</span><span className="text-foreground font-semibold">{b.worstModel || "—"}</span></div>
              </div>
            </div>
          ))}
        </div>

        {!isLoading && !sortedBuyers.length && (
          <div className="bg-card border border-border rounded-lg p-16 text-center text-muted-foreground">
            No media buyer data found. Add ad spend with buyer names to see analytics.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

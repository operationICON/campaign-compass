import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAdSpend, fetchTrackingLinks, fetchAccounts } from "@/lib/supabase-helpers";
import { ChevronUp, ChevronDown } from "lucide-react";

type SortKey = "name" | "totalSpend" | "totalRevenue" | "roi" | "campaignCount" | "subsPerDay";

export default function MediaBuyersPage() {
  const { data: adSpendData = [], isLoading } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [sortKey, setSortKey] = useState<SortKey>("roi");
  const [sortAsc, setSortAsc] = useState(false);

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

  // Best model (account) per campaign
  const campaignToAccount = useMemo(() => {
    const map: Record<string, string> = {};
    links.forEach((l: any) => {
      map[l.campaign_id] = l.accounts?.display_name || "Unknown";
    });
    return map;
  }, [links]);

  const buyers = useMemo(() => {
    const map: Record<string, { name: string; totalSpend: number; totalRevenue: number; campaignIds: Set<string>; totalSubs: number; bestModel: string; bestModelRev: number; earliestDate: string }> = {};
    adSpendData.forEach((entry: any) => {
      const buyer = entry.media_buyer || "Unknown";
      if (!map[buyer]) map[buyer] = { name: buyer, totalSpend: 0, totalRevenue: 0, campaignIds: new Set(), totalSubs: 0, bestModel: "", bestModelRev: 0, earliestDate: entry.date };
      map[buyer].totalSpend += Number(entry.amount);
      map[buyer].campaignIds.add(entry.campaign_id);
      map[buyer].totalRevenue += revByCampaign[entry.campaign_id] || 0;
      map[buyer].totalSubs += subsByCampaign[entry.campaign_id] || 0;
      // Track best model
      const acctName = campaignToAccount[entry.campaign_id] || "";
      const acctRev = revByCampaign[entry.campaign_id] || 0;
      if (acctRev > map[buyer].bestModelRev) {
        map[buyer].bestModel = acctName;
        map[buyer].bestModelRev = acctRev;
      }
      if (entry.date < map[buyer].earliestDate) map[buyer].earliestDate = entry.date;
    });

    return Object.values(map).map((b) => {
      const daysDiff = Math.max(1, Math.ceil((Date.now() - new Date(b.earliestDate).getTime()) / (1000 * 60 * 60 * 24)));
      return {
        ...b,
        campaignCount: b.campaignIds.size,
        roi: b.totalSpend > 0 ? ((b.totalRevenue - b.totalSpend) / b.totalSpend) * 100 : 0,
        subsPerDay: +(b.totalSubs / daysDiff).toFixed(1),
      };
    });
  }, [adSpendData, revByCampaign, subsByCampaign, campaignToAccount]);

  const sortedBuyers = useMemo(() => {
    return [...buyers].sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0;
      const bv = (b as any)[sortKey] ?? 0;
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    });
  }, [buyers, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, field, align = "left" }: { label: string; field: SortKey; align?: string }) => (
    <th
      onClick={() => toggleSort(field)}
      className={`px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === field && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Media Buyers</h1>
          <p className="text-sm text-muted-foreground">ROI comparison by media buyer — sorted by best performers</p>
        </div>

        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading...</div>
          ) : !sortedBuyers.length ? (
            <div className="p-12 text-center text-muted-foreground">No ad spend data with media buyers found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <SortHeader label="Media Buyer" field="name" />
                  <SortHeader label="Total Spend" field="totalSpend" align="right" />
                  <SortHeader label="Total Revenue" field="totalRevenue" align="right" />
                  <SortHeader label="ROI" field="roi" align="right" />
                  <SortHeader label="Campaigns" field="campaignCount" align="right" />
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Best Model</th>
                  <SortHeader label="Subs/Day" field="subsPerDay" align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedBuyers.map((b) => (
                  <tr key={b.name} className="border-b border-border hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmtCurrency(b.totalSpend)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{fmtCurrency(b.totalRevenue)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${b.roi >= 0 ? "text-accent" : "text-destructive"}`}>{b.roi.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{b.campaignCount}</td>
                    <td className="px-4 py-3 text-foreground">{b.bestModel || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{b.subsPerDay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

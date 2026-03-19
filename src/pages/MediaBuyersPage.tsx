import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAdSpend, fetchTrackingLinks } from "@/lib/supabase-helpers";

export default function MediaBuyersPage() {
  const { data: adSpendData = [], isLoading } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });

  // Revenue by campaign_id
  const revByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue); });
    return map;
  }, [links]);

  const buyers = useMemo(() => {
    const map: Record<string, { name: string; totalSpend: number; totalRevenue: number; campaignIds: Set<string> }> = {};
    adSpendData.forEach((entry: any) => {
      const buyer = entry.media_buyer || "Unknown";
      if (!map[buyer]) map[buyer] = { name: buyer, totalSpend: 0, totalRevenue: 0, campaignIds: new Set() };
      map[buyer].totalSpend += Number(entry.amount);
      map[buyer].campaignIds.add(entry.campaign_id);
      map[buyer].totalRevenue += revByCampaign[entry.campaign_id] || 0;
    });
    return Object.values(map).map((b) => ({
      ...b,
      campaignCount: b.campaignIds.size,
      roi: b.totalSpend > 0 ? ((b.totalRevenue - b.totalSpend) / b.totalSpend) * 100 : 0,
    })).sort((a, b) => b.totalSpend - a.totalSpend);
  }, [adSpendData, revByCampaign]);

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Media Buyers</h1>
          <p className="text-sm text-muted-foreground">Performance breakdown by media buyer</p>
        </div>

        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading...</div>
          ) : !buyers.length ? (
            <div className="p-12 text-center text-muted-foreground">No ad spend data with media buyers found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Media Buyer</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Total Spend</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Revenue Attributed</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">ROI</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Campaigns</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((b) => (
                  <tr key={b.name} className="border-b border-border hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmtCurrency(b.totalSpend)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{fmtCurrency(b.totalRevenue)}</td>
                    <td className={`px-4 py-3 text-right font-mono ${b.roi >= 0 ? "text-accent" : "text-destructive"}`}>{b.roi.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{b.campaignCount}</td>
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

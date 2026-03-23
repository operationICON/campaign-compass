import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAdSpend, fetchCampaigns, fetchTrackingLinks, clearTrackingLinkSpend } from "@/lib/supabase-helpers";
import { format } from "date-fns";
import { DollarSign, TrendingUp, BarChart3, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function AdSpendPage() {
  const queryClient = useQueryClient();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { data: adSpend = [], isLoading } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });

  // Map campaign_id to tracking_link for clearing spend
  const linkByCampaign = useMemo(() => {
    const map: Record<string, any> = {};
    links.forEach((l: any) => { if (!map[l.campaign_id]) map[l.campaign_id] = l; });
    return map;
  }, [links]);

  const handleDeleteSpend = async (entry: any) => {
    const tl = linkByCampaign[entry.campaign_id];
    if (tl) {
      try {
        await clearTrackingLinkSpend(tl.id, entry.campaign_id);
        queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
        toast.success("Spend cleared");
      } catch (err: any) {
        toast.error("Failed to clear spend");
      }
    }
    setDeleteConfirmId(null);
  };

  const revByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    links.forEach((l: any) => { map[l.campaign_id] = (map[l.campaign_id] || 0) + Number(l.revenue); });
    return map;
  }, [links]);

  const totalSpent = adSpend.reduce((s: number, a: any) => s + Number(a.amount), 0);
  const totalRevenue = Object.values(revByCampaign).reduce((s, v) => s + v, 0);
  const blendedROI = totalSpent > 0 ? ((totalRevenue - totalSpent) / totalSpent) * 100 : 0;

  // Platform breakdown
  const platformData = useMemo(() => {
    const map: Record<string, { spend: number; campaigns: Set<string> }> = {};
    adSpend.forEach((a: any) => {
      const p = a.traffic_source || "direct";
      if (!map[p]) map[p] = { spend: 0, campaigns: new Set() };
      map[p].spend += Number(a.amount);
      map[p].campaigns.add(a.campaign_id);
    });
    return Object.entries(map).map(([platform, data]) => {
      const rev = [...data.campaigns].reduce((s, cid) => s + (revByCampaign[cid] || 0), 0);
      const roi = data.spend > 0 ? ((rev - data.spend) / data.spend) * 100 : 0;
      return { platform, spend: data.spend, revenue: rev, roi, campaignCount: data.campaigns.size };
    }).sort((a, b) => b.roi - a.roi);
  }, [adSpend, revByCampaign]);

  const bestPlatform = platformData[0]?.platform || "—";

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Ad Spend</h1>
            <p className="text-sm text-muted-foreground">Track advertising costs by campaign and source</p>
          </div>
          <AdSpendDialog campaigns={campaigns} onAdded={() => queryClient.invalidateQueries({ queryKey: ["ad_spend"] })} />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Spent", value: fmtCurrency(totalSpent), icon: DollarSign, color: "text-destructive" },
            { label: "Total Revenue", value: fmtCurrency(totalRevenue), icon: TrendingUp, color: "text-primary" },
            { label: "Blended ROI", value: `${blendedROI.toFixed(1)}%`, icon: BarChart3, color: blendedROI >= 0 ? "text-primary" : "text-destructive" },
            { label: "Best Platform", value: bestPlatform, icon: Target, color: "text-foreground", noMono: true },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-lg p-4 card-hover">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{s.label}</span>
              </div>
              <p className={`text-xl font-bold ${s.noMono ? "" : "font-mono"} ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Platform Breakdown */}
        {platformData.length > 0 && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Platform Breakdown</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Platform</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Spend</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Revenue</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">ROI</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Campaigns</th>
                </tr>
              </thead>
              <tbody>
                {platformData.map(p => (
                  <tr key={p.platform} className="border-b border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground capitalize">{p.platform}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmtCurrency(p.spend)}</td>
                    <td className="px-4 py-3 text-right font-mono text-primary">{fmtCurrency(p.revenue)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${p.roi >= 0 ? "text-primary" : "text-destructive"}`}>{p.roi.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{p.campaignCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Spend History */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Spend History</h3>
          </div>
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading...</div>
          ) : !adSpend.length ? (
            <div className="p-12 text-center text-muted-foreground">No ad spend recorded</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Date</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Campaign</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Source</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Media Buyer</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Amount</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {adSpend.map((entry: any) => (
                  <tr key={entry.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm">{format(new Date(entry.date), "MMM d, yyyy")}</td>
                    <td className="px-4 py-3 text-foreground">{entry.campaigns?.name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{entry.traffic_source}</td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.media_buyer || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">${Number(entry.amount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-muted-foreground text-sm max-w-[200px] truncate">{entry.notes || "—"}</td>
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

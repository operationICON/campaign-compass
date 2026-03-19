import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAdSpend, fetchCampaigns } from "@/lib/supabase-helpers";
import { format } from "date-fns";

export default function AdSpendPage() {
  const queryClient = useQueryClient();
  const { data: adSpend = [], isLoading } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Ad Spend</h1>
            <p className="text-sm text-muted-foreground">Track advertising costs by campaign and source</p>
          </div>
          <AdSpendDialog campaigns={campaigns} onAdded={() => queryClient.invalidateQueries({ queryKey: ["ad_spend"] })} />
        </div>

        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading...</div>
          ) : !adSpend.length ? (
            <div className="p-12 text-center text-muted-foreground">No ad spend recorded</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Date</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Campaign</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Source</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Media Buyer</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Amount</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {adSpend.map((entry: any) => (
                  <tr key={entry.id} className="border-b border-border hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-mono text-sm">{format(new Date(entry.date), "MMM d, yyyy")}</td>
                    <td className="px-4 py-3 text-foreground">{entry.campaigns?.name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.traffic_source}</td>
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

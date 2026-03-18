import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAdSpend, fetchCampaigns } from "@/lib/supabase-helpers";
import { format } from "date-fns";

export default function AdSpendPage() {
  const queryClient = useQueryClient();
  const { data: adSpend = [], isLoading } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Ad Spend</h1>
            <p className="text-sm text-muted-foreground">Track advertising costs by campaign and source</p>
          </div>
          <AdSpendDialog campaigns={campaigns} onAdded={() => queryClient.invalidateQueries({ queryKey: ["ad_spend"] })} />
        </div>

        <Card className="border-border bg-card">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Campaign</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Traffic Source</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Amount</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adSpend.map((entry: any) => (
                    <TableRow key={entry.id} className="hover:bg-secondary/30">
                      <TableCell className="font-mono">{format(new Date(entry.date), "MMM d, yyyy")}</TableCell>
                      <TableCell>{entry.campaigns?.name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{entry.traffic_source}</TableCell>
                      <TableCell className="text-right font-mono text-destructive">${Number(entry.amount).toFixed(2)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{entry.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!adSpend.length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No ad spend recorded</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

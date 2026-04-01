import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccounts } from "@/lib/supabase-helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelAvatar } from "@/components/ModelAvatar";
import { CrossPollDetailTable } from "@/components/crosspoll/CrossPollDetailTable";
import { GitBranch, Users, DollarSign, Award } from "lucide-react";

const fmtC = (v: number | null) =>
  v == null ? "—" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtP = (v: number | null) =>
  v == null ? "—" : v.toFixed(1) + "%";

export default function CrossPollPage() {
  const [modelFilter, setModelFilter] = useState("all");

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const { data: ltvData = [], isLoading: ltvLoading } = useQuery({
    queryKey: ["crosspoll_ltv"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_link_ltv")
        .select("*")
        .gt("cross_poll_revenue", 0)
        .order("cross_poll_revenue", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: trackingLinks = [] } = useQuery({
    queryKey: ["crosspoll_tracking_links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_links")
        .select("id, campaign_name, account_id")
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const linkLookup = useMemo(() => {
    const map: Record<string, any> = {};
    trackingLinks.forEach((l: any) => { map[l.id] = l; });
    return map;
  }, [trackingLinks]);

  const accountLookup = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[a.id] = a; });
    return map;
  }, [accounts]);

  const filteredLtv = useMemo(() => {
    if (modelFilter === "all") return ltvData;
    return ltvData.filter((r: any) => r.account_id === modelFilter);
  }, [ltvData, modelFilter]);

  // Summary cards
  const summary = useMemo(() => {
    const totalRevenue = filteredLtv.reduce((s: number, r: any) => s + Number(r.cross_poll_revenue || 0), 0);
    const totalFans = filteredLtv.reduce((s: number, r: any) => s + Number(r.cross_poll_fans || 0), 0);
    const avgPerFan = totalFans > 0 ? totalRevenue / totalFans : 0;

    const byAccount: Record<string, number> = {};
    filteredLtv.forEach((r: any) => {
      byAccount[r.account_id] = (byAccount[r.account_id] || 0) + Number(r.cross_poll_revenue || 0);
    });
    let topModel = "—";
    let topVal = 0;
    let topAccId = "";
    Object.entries(byAccount).forEach(([accId, val]) => {
      if (val > topVal) { topVal = val; topAccId = accId; topModel = accountLookup[accId]?.display_name || accId; }
    });

    return { totalRevenue, totalFans, avgPerFan, topModel, topAccId };
  }, [filteredLtv, accountLookup]);

  // Campaign table with new columns
  const topCampaigns = useMemo(() => {
    return filteredLtv.slice(0, 50).map((r: any) => {
      const link = linkLookup[r.tracking_link_id];
      const acc = accountLookup[r.account_id];
      const directLtv = Number(r.total_ltv || 0);
      const crossPollRev = Number(r.cross_poll_revenue || 0);

      // Determine "received by" — the model(s) that got the cross-poll revenue
      // This is the opposite of the source model
      // We don't have per-row dest info in tracking_link_ltv, so we show "Other Models"
      return {
        ...r,
        campaignName: link?.campaign_name || r.tracking_link_id,
        modelName: acc?.display_name || "—",
        avatarUrl: acc?.avatar_thumb_url,
        directLtv,
        totalLtv: directLtv + crossPollRev,
      };
    });
  }, [filteredLtv, linkLookup, accountLookup]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <GitBranch className="h-6 w-6 text-primary" />
              Cross-Pollination
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Revenue generated on other models from fans acquired by each campaign
            </p>
          </div>
          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className="w-[180px] bg-card border-border">
              <SelectValue placeholder="All Models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Cross-Poll Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{fmtC(summary.totalRevenue)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cross-Poll Fans</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{summary.totalFans.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg Revenue / Fan</CardTitle>
              <DollarSign className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{fmtC(summary.avgPerFan)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top Source Model</CardTitle>
              <Award className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <ModelAvatar avatarUrl={accountLookup[summary.topAccId]?.avatar_thumb_url} name={summary.topModel} size={32} />
                <span className="text-2xl font-bold text-foreground truncate">{summary.topModel}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Campaigns Table — with Direct LTV, Total LTV, Received By */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground">Top Campaigns by Cross-Poll Revenue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Campaign</TableHead>
                  <TableHead className="text-muted-foreground">Source Model</TableHead>
                  <TableHead className="text-muted-foreground text-right">New Fans</TableHead>
                  <TableHead className="text-muted-foreground text-right">Direct LTV</TableHead>
                  <TableHead className="text-muted-foreground text-right">Cross-Poll Revenue</TableHead>
                  <TableHead className="text-muted-foreground text-right">Total LTV</TableHead>
                  <TableHead className="text-muted-foreground text-right">Cross-Poll Fans</TableHead>
                  <TableHead className="text-muted-foreground text-right">Conversion %</TableHead>
                  <TableHead className="text-muted-foreground">Received By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ltvLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : topCampaigns.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No cross-pollination data yet</TableCell></TableRow>
                ) : topCampaigns.map((r: any) => {
                  // "Received By" = all other models (exclude source)
                  const otherModels = accounts.filter((a: any) => a.id !== r.account_id);
                  return (
                    <TableRow key={r.id} className="border-border">
                      <TableCell className="font-medium text-foreground max-w-[200px] truncate">{r.campaignName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <ModelAvatar avatarUrl={r.avatarUrl} name={r.modelName} size={24} />
                          <span className="text-muted-foreground">{r.modelName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-foreground">{Number(r.new_subs_total || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-foreground">{fmtC(r.directLtv)}</TableCell>
                      <TableCell className="text-right font-medium text-primary">{fmtC(Number(r.cross_poll_revenue || 0))}</TableCell>
                      <TableCell className="text-right font-semibold text-foreground">{fmtC(r.totalLtv)}</TableCell>
                      <TableCell className="text-right text-foreground">{Number(r.cross_poll_fans || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-foreground">{fmtP(Number(r.cross_poll_conversion_pct || 0))}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {otherModels.slice(0, 4).map((a: any) => (
                            <ModelAvatar key={a.id} avatarUrl={a.avatar_thumb_url} name={a.display_name} size={20} />
                          ))}
                          {otherModels.length > 4 && (
                            <span className="text-xs text-muted-foreground ml-1">+{otherModels.length - 4}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Cross-Poll Revenue Detail */}
        <CrossPollDetailTable
          accounts={accounts}
          accountLookup={accountLookup}
          linkLookup={linkLookup}
          globalModelFilter={modelFilter}
        />
      </div>
    </DashboardLayout>
  );
}

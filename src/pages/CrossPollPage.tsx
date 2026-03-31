import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccounts } from "@/lib/supabase-helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { ModelAvatar } from "@/components/ModelAvatar";
import { GitBranch, Users, DollarSign, Award } from "lucide-react";

const fmtC = (v: number | null) =>
  v == null ? "—" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtP = (v: number | null) =>
  v == null ? "—" : v.toFixed(1) + "%";

export default function CrossPollPage() {
  const [modelFilter, setModelFilter] = useState("all");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | null>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const { data: ltvData = [], isLoading: ltvLoading } = useQuery({
    queryKey: ["tracking_link_ltv_crosspoll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_link_ltv")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: trackingLinks = [] } = useQuery({
    queryKey: ["tracking_links_crosspoll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_links")
        .select("id, campaign_name, account_id, subscribers, accounts(display_name, username)")
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: fanLtvData = [], isLoading: fanLoading } = useQuery({
    queryKey: ["fan_ltv_crosspoll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fan_ltv")
        .select("*")
        .eq("is_cross_pollinated", true)
        .order("first_seen_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Build lookup maps
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

  // Filter LTV data by model
  const filteredLtv = useMemo(() => {
    let items = ltvData;
    if (modelFilter !== "all") {
      items = items.filter((r: any) => r.account_id === modelFilter);
    }
    return items;
  }, [ltvData, modelFilter]);

  // Summary cards
  const summary = useMemo(() => {
    const totalRevenue = filteredLtv.reduce((s: number, r: any) => s + Number(r.cross_poll_revenue || 0), 0);
    const totalFans = filteredLtv.reduce((s: number, r: any) => s + Number(r.cross_poll_fans || 0), 0);
    const avgPerFan = totalFans > 0 ? totalRevenue / totalFans : 0;

    // Top receiving model: aggregate cross_poll_revenue by account
    const byAccount: Record<string, number> = {};
    filteredLtv.forEach((r: any) => {
      const accId = r.account_id;
      byAccount[accId] = (byAccount[accId] || 0) + Number(r.cross_poll_revenue || 0);
    });
    let topModel = "—";
    let topVal = 0;
    Object.entries(byAccount).forEach(([accId, val]) => {
      if (val > topVal) {
        topVal = val;
        const acc = accountLookup[accId];
        topModel = acc?.display_name || accId;
      }
    });

    return { totalRevenue, totalFans, avgPerFan, topModel };
  }, [filteredLtv, accountLookup]);

  // Top campaigns table
  const topCampaigns = useMemo(() => {
    return [...filteredLtv]
      .filter((r: any) => Number(r.cross_poll_revenue || 0) > 0)
      .sort((a: any, b: any) => Number(b.cross_poll_revenue || 0) - Number(a.cross_poll_revenue || 0))
      .slice(0, 50)
      .map((r: any) => {
        const link = linkLookup[r.tracking_link_id];
        return {
          ...r,
          campaignName: link?.campaign_name || r.tracking_link_id,
          modelName: link?.accounts?.display_name || accountLookup[r.account_id]?.display_name || "—",
        };
      });
  }, [filteredLtv, linkLookup, accountLookup]);

  // Fan migration table
  const filteredFans = useMemo(() => {
    let items = fanLtvData;
    if (modelFilter !== "all") {
      items = items.filter((f: any) => f.first_seen_model === modelFilter);
    }
    if (dateRange) {
      const fromStr = dateRange.from.toISOString().slice(0, 10);
      const toStr = dateRange.to.toISOString().slice(0, 10);
      items = items.filter((f: any) => {
        const d = f.first_seen_date;
        return d && d >= fromStr && d <= toStr;
      });
    }
    return items.slice(0, 100);
  }, [fanLtvData, modelFilter, dateRange]);

  const MODEL_COLORS = ["#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981", "#f97316", "#6366f1"];

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
              Revenue from fans who subscribe to multiple models after being acquired via a tracking link
            </p>
          </div>
          <div className="flex items-center gap-3">
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
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
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
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top Receiving Model</CardTitle>
              <Award className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground truncate">{summary.topModel}</div>
            </CardContent>
          </Card>
        </div>

        {/* Top Campaigns Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground">Top Campaigns by Cross-Poll Revenue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Campaign</TableHead>
                  <TableHead className="text-muted-foreground">Model</TableHead>
                  <TableHead className="text-muted-foreground text-right">New Fans</TableHead>
                  <TableHead className="text-muted-foreground text-right">Cross-Poll Fans</TableHead>
                  <TableHead className="text-muted-foreground text-right">Cross-Poll Revenue</TableHead>
                  <TableHead className="text-muted-foreground text-right">Conversion %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ltvLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : topCampaigns.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No cross-pollination data yet</TableCell></TableRow>
                ) : topCampaigns.map((r: any) => (
                  <TableRow key={r.id} className="border-border">
                    <TableCell className="font-medium text-foreground max-w-[200px] truncate">{r.campaignName}</TableCell>
                    <TableCell className="text-muted-foreground">{r.modelName}</TableCell>
                    <TableCell className="text-right text-foreground">{Number(r.new_subs_total || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-foreground">{Number(r.cross_poll_fans || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium text-primary">{fmtC(Number(r.cross_poll_revenue || 0))}</TableCell>
                    <TableCell className="text-right text-foreground">{fmtP(Number(r.cross_poll_conversion_pct || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Fan Migration Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground">Fan Migration</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Fan ID</TableHead>
                  <TableHead className="text-muted-foreground">Acquired Via</TableHead>
                  <TableHead className="text-muted-foreground">Source Model</TableHead>
                  <TableHead className="text-muted-foreground">Entry Date</TableHead>
                  <TableHead className="text-muted-foreground">Models Spent On</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fanLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : filteredFans.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No cross-pollinated fans found</TableCell></TableRow>
                ) : filteredFans.map((f: any) => {
                  const sourceLink = linkLookup[f.first_seen_tracking_link];
                  const sourceAcc = accountLookup[f.first_seen_model];
                  return (
                    <TableRow key={f.id} className="border-border">
                      <TableCell className="font-mono text-xs text-foreground">{f.fan_id?.slice(0, 12)}…</TableCell>
                      <TableCell className="text-foreground max-w-[180px] truncate">{sourceLink?.campaign_name || f.first_seen_tracking_link || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{sourceAcc?.display_name || f.first_seen_model || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{f.first_seen_date || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(f.models_spent_on || []).map((m: string, i: number) => {
                            const acc = accounts.find((a: any) => a.id === m || a.display_name === m);
                            return (
                              <Badge
                                key={i}
                                variant="outline"
                                className="text-[10px] border-border"
                                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] + "22", color: MODEL_COLORS[i % MODEL_COLORS.length], borderColor: MODEL_COLORS[i % MODEL_COLORS.length] + "44" }}
                              >
                                {acc?.display_name || m}
                              </Badge>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

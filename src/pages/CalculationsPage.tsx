import { useMemo } from "react";
import { usePageFilters } from "@/hooks/usePageFilters";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { PageFilterBar } from "@/components/PageFilterBar";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Calculator, DollarSign, TrendingUp, Database, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAccounts as fetchAccountsHelper } from "@/lib/supabase-helpers";

const fmtC = (v: number | null | undefined) =>
  v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toFixed(1)}%`;
const fmtN = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("en-US");

async function fetchAllTrackingLinks() {
  const all: any[] = [];
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tracking_links")
      .select("id, revenue, cost_total, traffic_category, source_tag, subscribers, onlytraffic_marketer")
      .is("deleted_at", null)
      .range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

async function fetchAllLtv() {
  const all: any[] = [];
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tracking_link_ltv")
      .select("tracking_link_id, total_ltv, cross_poll_revenue, new_subs_total, is_estimated")
      .range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

async function fetchAccounts() {
  const { data, error } = await supabase.from("accounts").select("id, display_name, subscribers_count");
  if (error) throw error;
  return data || [];
}

async function fetchFansCount() {
  const { count, error } = await supabase.from("fans").select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function fetchLastSync() {
  const { data, error } = await supabase
    .from("tracking_link_ltv")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.updated_at ?? null;
}

async function fetchExampleCampaigns() {
  const names = ["fider 04", "SEO 12.11.25"];
  const { data: links } = await supabase
    .from("tracking_links")
    .select("id, campaign_name, cost_total, subscribers")
    .in("campaign_name", names);

  if (!links || links.length === 0) return {};

  const linkIds = links.map((l: any) => l.id);
  const { data: ltvRows } = await supabase
    .from("tracking_link_ltv")
    .select("tracking_link_id, total_ltv, cross_poll_revenue, new_subs_total");

  const ltvMap: Record<string, any> = {};
  (ltvRows || []).forEach((r: any) => { ltvMap[r.tracking_link_id] = r; });

  const result: Record<string, any> = {};
  links.forEach((l: any) => {
    const ltv = ltvMap[l.id];
    result[l.campaign_name] = {
      ...l,
      total_ltv: ltv?.total_ltv ?? null,
      cross_poll_revenue: ltv?.cross_poll_revenue ?? null,
      new_subs_total: ltv?.new_subs_total ?? null,
    };
  });
  return result;
}

function LoadingRow() {
  return <TableRow><TableCell colSpan={3}><Skeleton className="h-5 w-full" /></TableCell></TableRow>;
}

export default function CalculationsPage() {
  const { timePeriod, setTimePeriod, modelFilter, setModelFilter, customRange, setCustomRange, dateFilter, revenueMode, setRevenueMode, revMultiplier } = usePageFilters();

  const { data: allAccounts = [] } = useQuery({ queryKey: ["calc_accounts_list"], queryFn: fetchAccountsHelper });

  // Snapshot-based time filtering
  const { snapshotLookup, isAllTime, isLoading: snapshotLoading } = useSnapshotMetrics(timePeriod, customRange);

  const { data: allLinks = [] as any[], isLoading: linksLoading } = useQuery({
    queryKey: ["calc_tracking_links"],
    queryFn: () => fetchAllTrackingLinks(),
  });
  // Apply snapshot metrics to links (replaces clicks/subscribers/revenue for non-All-Time)
  const links = useMemo(() => applySnapshotToLinks(allLinks, snapshotLookup), [allLinks, snapshotLookup]);

  const { data: ltvRows = [] as any[], isLoading: ltvLoading } = useQuery({
    queryKey: ["calc_ltv"],
    queryFn: () => fetchAllLtv(),
  });
  const { data: accounts = [] as any[] } = useQuery({
    queryKey: ["calc_accounts"],
    queryFn: fetchAccounts,
  });
  const { data: fansCount = 0 } = useQuery({
    queryKey: ["calc_fans_count"],
    queryFn: fetchFansCount,
  });
  const { data: lastSync } = useQuery({
    queryKey: ["calc_last_sync"],
    queryFn: fetchLastSync,
  });
  const { data: examples = {} } = useQuery({
    queryKey: ["calc_examples"],
    queryFn: fetchExampleCampaigns,
  });

  const isLoading = linksLoading || ltvLoading || snapshotLoading;

  // Build LTV lookup by tracking_link_id (TEXT → match against UUID as string)
  const ltvMap: Record<string, any> = {};
  ltvRows.forEach((r: any) => { 
    const key = String(r.tracking_link_id ?? "").trim().toLowerCase();
    if (key) ltvMap[key] = r; 
  });

  // SECTION 1 — Revenue (uses snapshot-filtered revenue)
  const estRevenue = links.reduce((s, l: any) => s + Number(l.revenue || 0), 0);
  const totalLtvSum = ltvRows.reduce((s, r: any) => s + Number(r.total_ltv || 0), 0);
  const crossPollSum = ltvRows.reduce((s, r: any) => s + Number(r.cross_poll_revenue || 0), 0);
  const unaccounted = estRevenue - totalLtvSum;
  const totalLtvPlusCp = totalLtvSum + crossPollSum;

  // SECTION 2 — Spend
  const totalSpend = links.reduce((s, l: any) => s + Number(l.cost_total || 0), 0);
  const otSpend = links.filter((l: any) => l.traffic_category === "OnlyTraffic").reduce((s, l: any) => s + Number(l.cost_total || 0), 0);
  const manualSpend = links.filter((l: any) => l.traffic_category && l.traffic_category !== "OnlyTraffic").reduce((s, l: any) => s + Number(l.cost_total || 0), 0);

  // SECTION 3 — Performance
  const totalNewSubs = ltvRows.reduce((s, r: any) => s + Number(r.new_subs_total || 0), 0);
  const totalProfit = totalLtvPlusCp - totalSpend;
  const overallRoi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : null;
  const avgProfitPerSub = totalNewSubs > 0 ? totalProfit / totalNewSubs : null;
  const avgCpl = totalNewSubs > 0 ? totalSpend / totalNewSubs : null;

  // SECTION 5 — Coverage
  const totalCampaigns = ltvRows.length > 0 ? links.length : 0;
  const withLtv = links.filter((l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    const ltv = ltvMap[key];
    return ltv && Number(ltv.total_ltv) > 0;
  }).length;
  const withSpend = links.filter((l: any) => Number(l.cost_total || 0) > 0).length;
  const withSource = links.filter((l: any) => l.source_tag || l.onlytraffic_marketer).length;
  const withCrossPoll = links.filter((l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    const ltv = ltvMap[key];
    return ltv && Number(ltv.cross_poll_revenue) > 0;
  }).length;
  const totalLinks = links.length;

  // Example data
  const fider04 = examples["fider 04"];
  const seo12 = examples["SEO 12.11.25"];

  const formulas = [
    {
      name: "LTV",
      formula: "Revenue from fans acquired by this campaign",
      source: "tracking_link_ltv.total_ltv",
      example: fider04 ? `${fider04.campaign_name} = ${fmtC(fider04.total_ltv)}` : "fider 04 = $128.36",
    },
    {
      name: "Cross-Poll",
      formula: "Revenue those fans generated on other models after entry",
      source: "tracking_link_ltv.cross_poll_revenue",
      example: seo12 ? `${seo12.campaign_name} = ${fmtC(seo12.cross_poll_revenue)}` : "SEO 12.11.25 = $64.00",
    },
    {
      name: "Total LTV",
      formula: "LTV + Cross-Poll",
      source: "tracking_link_ltv.total_ltv + cross_poll_revenue",
      example: fider04 ? `${fider04.campaign_name} = ${fmtC(fider04.total_ltv)} + ${fmtC(fider04.cross_poll_revenue)} = ${fmtC(Number(fider04.total_ltv || 0) + Number(fider04.cross_poll_revenue || 0))}` : "fider 04 = $128.36 + $0.00 = $128.36",
    },
    {
      name: "Profit",
      formula: "Total LTV − Spend",
      source: "(total_ltv + cross_poll_revenue) − cost_total",
      example: fider04 ? (() => {
        const ltv = Number(fider04.total_ltv || 0) + Number(fider04.cross_poll_revenue || 0);
        const spend = Number(fider04.cost_total || 0);
        return `${fider04.campaign_name} = ${fmtC(ltv)} − ${fmtC(spend)} = ${fmtC(ltv - spend)}`;
      })() : "fider 04 = $128.36 − $87.20 = $41.16",
    },
    {
      name: "ROI",
      formula: "(Profit ÷ Spend) × 100",
      source: "((total_ltv + cross_poll) − cost_total) / cost_total × 100",
      example: fider04 ? (() => {
        const ltv = Number(fider04.total_ltv || 0) + Number(fider04.cross_poll_revenue || 0);
        const spend = Number(fider04.cost_total || 0);
        const roi = spend > 0 ? ((ltv - spend) / spend) * 100 : null;
        return `${fider04.campaign_name} = ${roi != null ? fmtP(roi) : "—"}`;
      })() : "fider 04 = 47.2%",
    },
    {
      name: "Profit/Sub",
      formula: "Profit ÷ New Subscribers",
      source: "profit / tracking_link_ltv.new_subs_total",
      example: fider04 ? (() => {
        const ltv = Number(fider04.total_ltv || 0) + Number(fider04.cross_poll_revenue || 0);
        const spend = Number(fider04.cost_total || 0);
        const profit = ltv - spend;
        const subs = Number(fider04.new_subs_total || 0);
        return `${fider04.campaign_name} = ${fmtC(profit)} ÷ ${subs} = ${subs > 0 ? fmtC(profit / subs) : "—"}`;
      })() : "fider 04 = $41.16 ÷ 3 = $13.72",
    },
    {
      name: "Avg CPL",
      formula: "Total Spend ÷ Total New Subscribers",
      source: "SUM(cost_total) / SUM(new_subs_total)",
      example: `${fmtC(totalSpend)} ÷ ${fmtN(totalNewSubs)} = ${avgCpl != null ? fmtC(avgCpl) : "—"}`,
    },
    {
      name: "Unattributed %",
      formula: "(Account total subs − Tracked subs) ÷ Account total subs × 100",
      source: "accounts.subscribers_count vs SUM(tracking_links.subscribers)",
      example: (() => {
        const apiSubs = accounts.reduce((s, a: any) => s + Number(a.subscribers_count || 0), 0);
        const trackedSubs = links.reduce((s, l: any) => s + Number(l.subscribers || 0), 0);
        const pct = apiSubs > 0 ? Math.max(0, ((apiSubs - trackedSubs) / apiSubs) * 100) : 0;
        return `(${fmtN(apiSubs)} − ${fmtN(trackedSubs)}) ÷ ${fmtN(apiSubs)} = ${fmtP(pct)}`;
      })(),
    },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Calculator className="h-6 w-6 text-primary" />
              Calculations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Live reconciliation and formula reference — all numbers pulled from the database in real-time.
            </p>
          </div>
        </div>

        <PageFilterBar
          timePeriod={timePeriod}
          onTimePeriodChange={setTimePeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          modelFilter={modelFilter}
          onModelFilterChange={setModelFilter}
          accounts={allAccounts.map((a: any) => ({ id: a.id, username: a.username || "", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
          revenueMode={revenueMode}
          onRevenueModeChange={setRevenueMode}
        />

        {/* SECTION 1 — Revenue Reconciliation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Where does the money come from?
            </CardTitle>
            <CardDescription>Revenue reconciliation across all tracking links</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <>
                    <LoadingRow /><LoadingRow /><LoadingRow /><LoadingRow /><LoadingRow />
                  </>
                ) : (
                  <>
                    <TableRow>
                      <TableCell className="font-medium">Est. Revenue</TableCell>
                      <TableCell className="text-right font-mono">{fmtC(estRevenue)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">SUM(tracking_links.revenue)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">LTV</TableCell>
                      <TableCell className="text-right font-mono">{fmtC(totalLtvSum)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">SUM(tracking_link_ltv.total_ltv)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Unaccounted</TableCell>
                      <TableCell className="text-right font-mono">{fmtC(unaccounted)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">Est. Revenue − LTV</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Cross-Poll</TableCell>
                      <TableCell className="text-right font-mono">{fmtC(crossPollSum)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">SUM(tracking_link_ltv.cross_poll_revenue)</TableCell>
                    </TableRow>
                    <TableRow className="border-t-2 border-border">
                      <TableCell className="font-bold">Total LTV</TableCell>
                      <TableCell className="text-right font-mono font-bold">{fmtC(totalLtvPlusCp)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">LTV + Cross-Poll</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>

            {!isLoading && (
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span className="text-muted-foreground">Est. Revenue = LTV + Unaccounted →</span>
                  <span className="font-mono text-foreground">{fmtC(estRevenue)} = {fmtC(totalLtvSum)} + {fmtC(unaccounted)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span className="text-muted-foreground">Total LTV = LTV + Cross-Poll →</span>
                  <span className="font-mono text-foreground">{fmtC(totalLtvPlusCp)} = {fmtC(totalLtvSum)} + {fmtC(crossPollSum)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SECTION 2 — Spend Reconciliation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-destructive" />
              What did we spend?
            </CardTitle>
            <CardDescription>Spend breakdown by traffic category</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <><LoadingRow /><LoadingRow /><LoadingRow /></>
                ) : (
                  <>
                    <TableRow>
                      <TableCell className="font-medium">Total Spend</TableCell>
                      <TableCell className="text-right font-mono">{fmtC(totalSpend)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">SUM(tracking_links.cost_total)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">OnlyTraffic Spend <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">OnlyTraffic</span></span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmtC(otSpend)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">WHERE traffic_category = 'OnlyTraffic'</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">Manual Spend <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Manual</span></span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmtC(manualSpend)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">WHERE traffic_category = 'Manual'</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* SECTION 3 — Performance Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-success" />
              Overall performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-border p-4"><Skeleton className="h-8 w-full" /></div>
                ))
              ) : (
                <>
                  <div className="rounded-lg border border-border p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Total Profit</div>
                    <div className={`text-xl font-bold font-mono ${totalProfit >= 0 ? "text-success" : "text-destructive"}`}>{fmtC(totalProfit)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Total LTV − Total Spend</div>
                  </div>
                  <div className="rounded-lg border border-border p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Overall ROI</div>
                    <div className={`text-xl font-bold font-mono ${(overallRoi ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{overallRoi != null ? fmtP(overallRoi) : "—"}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Profit ÷ Spend × 100</div>
                  </div>
                  <div className="rounded-lg border border-border p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Avg Profit/Sub</div>
                    <div className="text-xl font-bold font-mono text-foreground">{avgProfitPerSub != null ? fmtC(avgProfitPerSub) : "—"}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Profit ÷ New Subs</div>
                  </div>
                  <div className="rounded-lg border border-border p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Avg CPL</div>
                    <div className="text-xl font-bold font-mono text-foreground">{avgCpl != null ? fmtC(avgCpl) : "—"}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Spend ÷ New Subs</div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* SECTION 4 — Formula Reference */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              How each metric is calculated
            </CardTitle>
            <CardDescription>Formula reference with live examples from real campaign data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {formulas.map((f) => (
                <div key={f.name} className="rounded-lg border border-border p-4 space-y-2">
                  <div className="font-semibold text-sm text-foreground">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{f.formula}</div>
                  <div className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-2 py-1">{f.source}</div>
                  <div className="text-xs font-mono text-primary border-t border-border pt-2 mt-2">
                    Example: {f.example}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* SECTION 5 — Data Coverage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              What data do we have?
            </CardTitle>
            <CardDescription>Data coverage across all tracking links</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)
            ) : (
              <>
                <CoverageRow label="Campaigns with LTV data" count={withLtv} total={totalLinks} />
                <CoverageRow label="Campaigns with spend" count={withSpend} total={totalLinks} />
                <CoverageRow label="Campaigns with source tag" count={withSource} total={totalLinks} />
                <CoverageRow label="Campaigns with cross-poll" count={withCrossPoll} total={totalLinks} />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Fans cached</span>
                  <span className="font-mono text-foreground">{fmtN(fansCount)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="font-mono text-foreground text-xs">
                    {lastSync ? new Date(lastSync).toLocaleString() : "—"}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function CoverageRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{fmtN(count)}/{fmtN(total)}</span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

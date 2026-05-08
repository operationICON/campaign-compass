import { useState, useMemo } from "react";
import { usePageFilters } from "@/hooks/usePageFilters";
import { PageFilterBar } from "@/components/PageFilterBar";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinkLtv, fetchTrackingLinks } from "@/lib/supabase-helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelAvatar } from "@/components/ModelAvatar";
import { CrossPollDetailTable } from "@/components/crosspoll/CrossPollDetailTable";
import { GitBranch, Users, DollarSign, Award, Percent, ChevronDown, ChevronUp } from "lucide-react";
import { useSnapshotMetrics, getSnapshotMetrics } from "@/hooks/useSnapshotMetrics";
import { useDateScopedMetrics } from "@/hooks/useDateScopedMetrics";
import { filterLtvByActiveLinks, buildActiveLinkIdSet } from "@/lib/calc-helpers";

type CampSortKey =
  | "campaignName" | "modelName" | "new_subs_total" | "directLtv"
  | "cross_poll_revenue" | "totalLtv" | "cross_poll_fans" | "cross_poll_conversion_pct";

const fmtC = (v: number | null) =>
  v == null ? "—" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtP = (v: number | null) =>
  v == null ? "—" : v.toFixed(1) + "%";

export default function CrossPollPage() {
  const { timePeriod, setTimePeriod, modelFilter, setModelFilter, customRange, setCustomRange, dateFilter } = usePageFilters();

  const [sortKey, setSortKey] = useState<CampSortKey>("cross_poll_revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const handleSort = (k: CampSortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };
  const SortHead = ({ label, k, align = "left" }: { label: string; k: CampSortKey; align?: "left" | "right" }) => (
    <TableHead
      className={`text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
      onClick={() => handleSort(k)}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {sortKey === k ? (
          sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />
        ) : <ChevronDown className="h-3 w-3 opacity-30" />}
      </span>
    </TableHead>
  );

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  // Snapshot-based time filtering
  const { snapshotLookup, isAllTime } = useSnapshotMetrics(timePeriod, customRange);
  // Shared date-scoped aggregator — available for KPI cards.
  const dateScoped = useDateScopedMetrics(timePeriod, customRange, modelFilter !== "all" ? [modelFilter] : null);
  void dateScoped;

  // Cross-poll LTV data (cumulative)
  const { data: allLtvDataRaw = [], isLoading: ltvLoading } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });
  const allLtvData = useMemo(
    () => (allLtvDataRaw as any[]).filter((r: any) => Number(r.cross_poll_revenue || 0) > 0),
    [allLtvDataRaw]
  );

  const { data: trackingLinks = [] } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: fetchTrackingLinks,
  });

  const linkLookup = useMemo(() => {
    const map: Record<string, any> = {};
    trackingLinks.forEach((l: any) => { map[String(l.id).toLowerCase()] = l; });
    return map;
  }, [trackingLinks]);

  const accountLookup = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[String(a.id).toLowerCase()] = a; });
    return map;
  }, [accounts]);

  // Filter LTV data: exclude rows tied to deleted tracking_links (deleted_at IS NOT NULL)
  // and apply snapshot/model filters.
  const activeLinkIdSet = useMemo(() => buildActiveLinkIdSet(trackingLinks), [trackingLinks]);
  const ltvData = useMemo(() => {
    // RULE: only keep LTV rows whose tracking_link is non-deleted (shared helper).
    // Cross-Poll is always agency-wide — no model filter applied.
    let data = filterLtvByActiveLinks(allLtvData, activeLinkIdSet);
    if (!isAllTime && snapshotLookup) {
      data = data.filter((r: any) => {
        const tlId = String(r.tracking_link_id ?? "").trim().toLowerCase();
        return snapshotLookup[tlId] !== undefined;
      });
    }
    return data;
  }, [allLtvData, isAllTime, snapshotLookup, activeLinkIdSet]);

  const filteredLtv = ltvData;

  // Summary cards
    const summary = useMemo(() => {
    const totalRevenue = filteredLtv.reduce((s: number, r: any) => s + Number(r.cross_poll_revenue || 0), 0);
    const totalFans = filteredLtv.reduce((s: number, r: any) => s + Number(r.cross_poll_fans || 0), 0);
    const avgPerFan = totalFans > 0 ? totalRevenue / totalFans : 0;
    const totalNewFans = filteredLtv.reduce((s: number, r: any) => s + Number(r.new_subs_total || 0), 0);
    const conversionPct = totalNewFans > 0 ? (totalFans / totalNewFans) * 100 : 0;

    const byAccount: Record<string, number> = {};
    filteredLtv.forEach((r: any) => {
      byAccount[r.account_id] = (byAccount[r.account_id] || 0) + Number(r.cross_poll_revenue || 0);
    });
    let topModel = "—";
    let topVal = 0;
    let topAccId = "";
    Object.entries(byAccount).forEach(([accId, val]) => {
      if (val > topVal) { topVal = val; topAccId = accId; topModel = accountLookup[String(accId).toLowerCase()]?.display_name || accId; }
    });

    return { totalRevenue, totalFans, avgPerFan, topModel, topAccId, conversionPct };
  }, [filteredLtv, accountLookup]);

  // Campaign table with new columns + sorting
  const topCampaigns = useMemo(() => {
    const enriched = filteredLtv.map((r: any) => {
      const link = linkLookup[String(r.tracking_link_id ?? "").toLowerCase()];
      const acc = accountLookup[String(r.account_id ?? "").toLowerCase()];
      const directLtv = Number(r.total_ltv || 0);
      const crossPollRev = Number(r.cross_poll_revenue || 0);
      return {
        ...r,
        campaignName: link?.campaign_name || r.tracking_link_id,
        modelName: acc?.display_name || "—",
        avatarUrl: acc?.avatar_thumb_url,
        directLtv,
        totalLtv: directLtv + crossPollRev,
      };
    });
    const dir = sortAsc ? 1 : -1;
    const getVal = (r: any): number | string => {
      switch (sortKey) {
        case "campaignName": return String(r.campaignName || "").toLowerCase();
        case "modelName": return String(r.modelName || "").toLowerCase();
        case "new_subs_total": return Number(r.new_subs_total || 0);
        case "directLtv": return Number(r.directLtv || 0);
        case "cross_poll_revenue": return Number(r.cross_poll_revenue || 0);
        case "totalLtv": return Number(r.totalLtv || 0);
        case "cross_poll_fans": return Number(r.cross_poll_fans || 0);
        case "cross_poll_conversion_pct": return Number(r.cross_poll_conversion_pct || 0);
      }
    };
    enriched.sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
    return enriched.slice(0, 50);
  }, [filteredLtv, linkLookup, accountLookup, sortKey, sortAsc]);

  return (
    <DashboardLayout>
      <div className="w-full px-6 py-4 space-y-4">
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
        </div>

        {/* ═══ TIME + MODEL FILTER BAR ═══ */}
        <PageFilterBar
          timePeriod={timePeriod}
          onTimePeriodChange={setTimePeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          modelFilter={modelFilter}
          onModelFilterChange={setModelFilter}
          accounts={accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
          hideModelFilter
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversion %</CardTitle>
              <Percent className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{fmtP(summary.conversionPct)}</div>
              <p className="text-xs text-muted-foreground mt-1">Fans who crossed / total new fans</p>
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
                  <SortHead label="Campaign" k="campaignName" />
                  <SortHead label="Source Model" k="modelName" />
                  <SortHead label="New Fans" k="new_subs_total" align="right" />
                  <SortHead label="Cross-Poll Revenue" k="cross_poll_revenue" align="right" />
                  <SortHead label="Total Fan Rev" k="totalLtv" align="right" />
                  <SortHead label="Cross-Poll Fans" k="cross_poll_fans" align="right" />
                  <SortHead label="Conversion %" k="cross_poll_conversion_pct" align="right" />
                  <TableHead className="text-muted-foreground">Received By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ltvLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : topCampaigns.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No cross-pollination data yet</TableCell></TableRow>
                ) : topCampaigns.map((r: any) => {
                  // "Received By" = all other models (exclude source)
                  const otherModels = accounts.filter((a: any) => String(a.id).toLowerCase() !== String(r.account_id).toLowerCase());
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

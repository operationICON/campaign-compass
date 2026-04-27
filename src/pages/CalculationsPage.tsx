import React, { useMemo } from "react";
import { usePageFilters } from "@/hooks/usePageFilters";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { PageFilterBar } from "@/components/PageFilterBar";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAccounts as fetchAccountsHelper, fetchTrackingLinks, fetchTrackingLinkLtv } from "@/lib/supabase-helpers";
import { buildActiveLinkIdSet, filterLtvByActiveLinks } from "@/lib/calc-helpers";
import { apiFetch } from "@/lib/api";
import { differenceInDays } from "date-fns";
import { Calculator, TrendingUp, DollarSign, Users, Database, BarChart3 } from "lucide-react";

const fmtC = (v: number | null | undefined) =>
  v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toFixed(1)}%`;
const fmtN = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("en-US");

async function fetchFansCount() {
  const data: any[] = await apiFetch("/fans");
  return data.length;
}

async function fetchLastSync() {
  const data: any[] = await apiFetch("/tracking-link-ltv");
  return data.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0]?.updated_at ?? null;
}

async function fetchExampleCampaigns() {
  const names = new Set(["fider 04", "SEO 12.11.25"]);
  const [allLinks, allLtv] = await Promise.all([fetchTrackingLinks(), fetchTrackingLinkLtv()]);
  const links = (allLinks as any[]).filter((l: any) => names.has(l.campaign_name));
  if (!links.length) return {};
  const ltvMap: Record<string, any> = {};
  (allLtv as any[]).forEach((r: any) => { ltvMap[r.tracking_link_id] = r; });
  const result: Record<string, any> = {};
  links.forEach((l: any) => {
    const ltv = ltvMap[l.id];
    result[l.campaign_name] = { ...l, total_ltv: ltv?.total_ltv ?? null, cross_poll_revenue: ltv?.cross_poll_revenue ?? null, new_subs_total: ltv?.new_subs_total ?? null };
  });
  return result;
}

export default function CalculationsPage() {
  const { timePeriod, setTimePeriod, modelFilter, setModelFilter, customRange, setCustomRange, revenueMode, setRevenueMode } = usePageFilters();

  const { data: allAccounts = [] } = useQuery({ queryKey: ["calc_accounts_list"], queryFn: fetchAccountsHelper });
  const { snapshotLookup, isLoading: snapshotLoading } = useSnapshotMetrics(timePeriod, customRange);

  const { data: allLinks = [] as any[], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: fetchTrackingLinks,
  });
  const links = useMemo(() => applySnapshotToLinks(allLinks, snapshotLookup), [allLinks, snapshotLookup]);

  const { data: ltvRowsRaw = [] as any[], isLoading: ltvLoading } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });
  const activeLinkIdSet = useMemo(() => buildActiveLinkIdSet(allLinks), [allLinks]);
  const ltvRows = useMemo(() => filterLtvByActiveLinks(ltvRowsRaw, activeLinkIdSet), [ltvRowsRaw, activeLinkIdSet]);

  const { data: fansCount = 0 } = useQuery({ queryKey: ["calc_fans_count"], queryFn: fetchFansCount });
  const { data: lastSync } = useQuery({ queryKey: ["calc_last_sync"], queryFn: fetchLastSync });
  const { data: examples = {} } = useQuery({ queryKey: ["calc_examples"], queryFn: fetchExampleCampaigns });

  const isLoading = linksLoading || ltvLoading || snapshotLoading;

  const ltvMap: Record<string, any> = {};
  ltvRows.forEach((r: any) => {
    const key = String(r.tracking_link_id ?? "").trim().toLowerCase();
    if (key) ltvMap[key] = r;
  });

  // ── Revenue ──
  const estRevenue = links.reduce((s, l: any) => s + Number(l.revenue || 0), 0);
  const crossPollSum = ltvRows.reduce((s, r: any) => s + Number(r.cross_poll_revenue || 0), 0);
  const totalLtvPlusCp = ltvRows.reduce((s, r: any) => s + Number(r.total_ltv || 0) + Number(r.cross_poll_revenue || 0), 0);

  // ── Spend ──
  const totalSpend = links.reduce((s, l: any) => s + Number(l.cost_total || 0), 0);
  const otSpend = links.filter((l: any) => l.traffic_category === "OnlyTraffic").reduce((s, l: any) => s + Number(l.cost_total || 0), 0);
  const manualSpend = links.filter((l: any) => l.traffic_category && l.traffic_category !== "OnlyTraffic").reduce((s, l: any) => s + Number(l.cost_total || 0), 0);
  const untaggedSpend = links.filter((l: any) => !l.traffic_category).reduce((s, l: any) => s + Number(l.cost_total || 0), 0);

  // ── Performance ──
  const totalNewSubs = ltvRows.reduce((s, r: any) => s + Number(r.new_subs_total || 0), 0);
  const totalProfit = estRevenue - totalSpend;
  const overallRoi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : null;
  const avgProfitPerSub = totalNewSubs > 0 ? totalProfit / totalNewSubs : null;
  const avgCpl = totalNewSubs > 0 ? totalSpend / totalNewSubs : null;
  const ltvPerSub = totalNewSubs > 0 ? totalLtvPlusCp / totalNewSubs : null;

  const subsFromLinks = links.reduce((s, l: any) => s + (l.subscribers || 0), 0);
  const ages = links.filter((l: any) => l.created_at).map((l: any) => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
  const avgAge = ages.length > 0 ? ages.reduce((a: number, b: number) => a + b, 0) / ages.length : 1;
  const subsPerDay = avgAge > 0 ? subsFromLinks / avgAge : 0;

  // ── Coverage ──
  const totalLinks = links.length;
  const withLtv = links.filter((l: any) => { const key = String(l.id ?? "").trim().toLowerCase(); return ltvMap[key] && Number(ltvMap[key].total_ltv) > 0; }).length;
  const withSpend = links.filter((l: any) => Number(l.cost_total || 0) > 0).length;
  const withSource = links.filter((l: any) => l.source_tag || l.onlytraffic_marketer).length;
  const withCrossPoll = links.filter((l: any) => { const key = String(l.id ?? "").trim().toLowerCase(); return ltvMap[key] && Number(ltvMap[key].cross_poll_revenue) > 0; }).length;
  const tagged = links.filter((l: any) => !!l.traffic_category).length;

  const fider04 = (examples as any)["fider 04"];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-10 max-w-6xl mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" />
            Calculations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every metric explained — formula, data source, and live value.
          </p>
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

        {/* Live Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard label="Revenue" value={isLoading ? null : fmtC(estRevenue)} color="#16a34a" />
          <SummaryCard label="Total Spend" value={isLoading ? null : fmtC(totalSpend)} color="#dc2626" />
          <SummaryCard label="Profit" value={isLoading ? null : fmtC(totalProfit)} color={totalProfit >= 0 ? "#16a34a" : "#dc2626"} />
          <SummaryCard label="ROI" value={isLoading ? null : fmtP(overallRoi)} color={(overallRoi ?? 0) >= 0 ? "#16a34a" : "#dc2626"} />
          <SummaryCard label="Avg CPL" value={isLoading ? null : fmtC(avgCpl)} color="#0891b2" />
          <SummaryCard label="New Subs" value={isLoading ? null : fmtN(totalNewSubs)} color="#7c3aed" />
        </div>

        {/* SECTION: Revenue */}
        <Section
          icon={<DollarSign className="h-4 w-4" style={{ color: "#16a34a" }} />}
          title="Revenue"
          description="How revenue is sourced, split, and reconciled"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              label="Revenue"
              formula="Sum of revenue stamped on each tracking link by the data sync. This is the primary revenue number used for Profit and ROI calculations."
              source="SUM(tracking_links.revenue)"
              value={isLoading ? undefined : fmtC(estRevenue)}
              color="#16a34a"
              isLoading={isLoading}
            />
            <MetricCard
              label="Cross-Poll Revenue"
              formula="Revenue fans generated on other models after their first subscription through this campaign. Feeds into LTV/Sub only."
              source="SUM(tracking_link_ltv.cross_poll_revenue)"
              value={isLoading ? undefined : fmtC(crossPollSum)}
              color="#0891b2"
              isLoading={isLoading}
            />
          </div>
        </Section>

        {/* SECTION: Spend */}
        <Section
          icon={<DollarSign className="h-4 w-4" style={{ color: "#dc2626" }} />}
          title="Spend"
          description="How costs are recorded and broken down by traffic category"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Total Spend"
              formula="Sum of all campaign costs across every tracking link, regardless of traffic category."
              source="SUM(tracking_links.cost_total)"
              value={isLoading ? undefined : fmtC(totalSpend)}
              color="#dc2626"
              isLoading={isLoading}
            />
            <MetricCard
              label="OnlyTraffic Spend"
              formula="Spend on campaigns sourced and tagged as OnlyTraffic."
              source="SUM(cost_total) WHERE traffic_category = 'OnlyTraffic'"
              value={isLoading ? undefined : fmtC(otSpend)}
              color="#dc2626"
              isLoading={isLoading}
            />
            <MetricCard
              label="Manual Spend"
              formula="Spend on manually-tagged campaigns — any traffic_category that is not OnlyTraffic."
              source="SUM(cost_total) WHERE traffic_category != 'OnlyTraffic' AND IS NOT NULL"
              value={isLoading ? undefined : fmtC(manualSpend)}
              color="#d97706"
              isLoading={isLoading}
            />
            <MetricCard
              label="Untagged Spend"
              formula="Spend on campaigns with no traffic category assigned yet — these need tagging."
              source="SUM(cost_total) WHERE traffic_category IS NULL"
              value={isLoading ? undefined : fmtC(untaggedSpend)}
              color="#94a3b8"
              isLoading={isLoading}
            />
          </div>
        </Section>

        {/* SECTION: Performance */}
        <Section
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          title="Performance"
          description="Profitability and efficiency metrics across all campaigns"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              label="Profit"
              formula="What we actually made after costs. Revenue minus total spend across all campaigns."
              source="SUM(tracking_links.revenue) − SUM(cost_total)"
              value={isLoading ? undefined : fmtC(totalProfit)}
              color={totalProfit >= 0 ? "#16a34a" : "#dc2626"}
              isLoading={isLoading}
            />
            <MetricCard
              label="ROI"
              formula="Return on investment — profit as a percentage of spend. Positive means we made more than we spent."
              source="(Profit ÷ Total Spend) × 100"
              value={isLoading ? undefined : fmtP(overallRoi)}
              color={(overallRoi ?? 0) >= 0 ? "#16a34a" : "#dc2626"}
              isLoading={isLoading}
            />
            <MetricCard
              label="Avg CPL"
              formula="Average cost per new subscriber. Computed across all campaigns that have LTV data."
              source="SUM(cost_total) ÷ SUM(new_subs_total)"
              value={isLoading ? undefined : fmtC(avgCpl)}
              color="#0891b2"
              isLoading={isLoading}
            />
            <MetricCard
              label="Avg Profit / Sub"
              formula="How much profit each new subscriber generates on average. Key indicator of acquisition quality."
              source="Profit ÷ SUM(new_subs_total)"
              value={isLoading ? undefined : fmtC(avgProfitPerSub)}
              color="#7c3aed"
              isLoading={isLoading}
            />
            <MetricCard
              label="LTV / Sub"
              formula="Average lifetime value earned per new subscriber — total revenue attributed, not just profit."
              source="(total_ltv + cross_poll_revenue) ÷ SUM(new_subs_total)"
              value={isLoading ? undefined : fmtC(ltvPerSub)}
              color="#0891b2"
              isLoading={isLoading}
            />
            <MetricCard
              label="Subs / Day"
              formula="New subscribers per day, averaged over the age of all campaigns. Measures the overall subscriber acquisition rate."
              source="SUM(subscribers) ÷ AVG(days since created_at)"
              value={isLoading ? undefined : subsPerDay > 0 ? subsPerDay.toFixed(1) : "0"}
              color="#d97706"
              isLoading={isLoading}
            />
          </div>
        </Section>

        {/* SECTION: Per-Campaign */}
        <Section
          icon={<BarChart3 className="h-4 w-4 text-primary" />}
          title="Per-Campaign Metrics"
          description="How each individual tracking link is evaluated"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              label="Campaign Profit"
              formula="What this specific campaign made after its spend is deducted. Null if the campaign has no spend."
              source="tracking_links.revenue − cost_total"
              value={fider04 ? (() => {
                const rev = Number(fider04.revenue || 0);
                const spend = Number(fider04.cost_total || 0);
                return `e.g. ${fider04.campaign_name}: ${fmtC(rev - spend)}`;
              })() : undefined}
              color="#16a34a"
            />
            <MetricCard
              label="Campaign ROI"
              formula="Profit as a percentage of spend for this specific campaign. Drives the status badge."
              source="(revenue − cost_total) ÷ cost_total × 100"
              value={fider04 ? (() => {
                const rev = Number(fider04.revenue || 0);
                const spend = Number(fider04.cost_total || 0);
                const roi = spend > 0 ? ((rev - spend) / spend) * 100 : null;
                return `e.g. ${fider04.campaign_name}: ${fmtP(roi)}`;
              })() : undefined}
              color="#16a34a"
            />
            <MetricCard
              label="Profit / Sub"
              formula="Profit this campaign generated per new subscriber it acquired."
              source="(revenue − cost_total) ÷ subscribers"
              value={fider04 ? (() => {
                const rev = Number(fider04.revenue || 0);
                const spend = Number(fider04.cost_total || 0);
                const subs = Number(fider04.new_subs_total || 0);
                return `e.g. ${fider04.campaign_name}: ${subs > 0 ? fmtC((rev - spend) / subs) : "—"}`;
              })() : undefined}
              color="#7c3aed"
            />
            <MetricCard
              label="LTV / Sub"
              formula="Average lifetime value per subscriber acquired by this campaign — includes cross-poll revenue."
              source="(total_ltv + cross_poll_revenue) ÷ new_subs_total"
              value={fider04 ? (() => {
                const ltv = Number(fider04.total_ltv || 0) + Number(fider04.cross_poll_revenue || 0);
                const subs = Number(fider04.new_subs_total || 0);
                return `e.g. ${fider04.campaign_name}: ${subs > 0 ? fmtC(ltv / subs) : "—"}`;
              })() : undefined}
              color="#0891b2"
            />
            <MetricCard
              label="CPL (per campaign)"
              formula="Cost per subscriber for CPL-type campaigns. Spend divided by the subscribers this link brought in."
              source="cost_total ÷ subscribers  [payment_type = 'CPL']"
              color="#d97706"
            />
            <MetricCard
              label="Subs / Day"
              formula="How fast this specific campaign acquires subscribers relative to its age since creation."
              source="subscribers ÷ MAX(1, days since created_at)"
              color="#d97706"
            />
          </div>

          {/* Status badge thresholds */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="text-sm font-semibold text-foreground">Status Badges</div>
            <p className="text-xs text-muted-foreground">Assigned per campaign based on ROI. Campaigns with no spend are labeled NO SPEND. No clicks and no subscribers = TESTING. Inactive beyond 30 days = INACTIVE.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <BadgeThreshold label="SCALE" condition="ROI > 150%" color="#16a34a" bg="hsl(142 71% 45% / 0.15)" />
              <BadgeThreshold label="WATCH" condition="ROI 50% – 150%" color="#0891b2" bg="hsl(199 89% 48% / 0.15)" />
              <BadgeThreshold label="LOW" condition="ROI 0% – 50%" color="#854d0e" bg="hsl(45 93% 47% / 0.15)" />
              <BadgeThreshold label="KILL" condition="ROI < 0%" color="#dc2626" bg="hsl(0 84% 60% / 0.15)" />
            </div>
          </div>
        </Section>

        {/* SECTION: Subscribers */}
        <Section
          icon={<Users className="h-4 w-4 text-primary" />}
          title="Subscribers"
          description="How subscriber counts are sourced and used"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              label="New Subs (LTV)"
              formula="Total new subscribers attributed via the LTV sync — these are fans whose payment history has been fully computed."
              source="SUM(tracking_link_ltv.new_subs_total)"
              value={isLoading ? undefined : fmtN(totalNewSubs)}
              color="#7c3aed"
              isLoading={isLoading}
            />
            <MetricCard
              label="Subscribers (tracking links)"
              formula="Raw subscriber count on each tracking link as reported by the platform. Used for Subs/Day and filtering; not the same as LTV new subs."
              source="SUM(tracking_links.subscribers)"
              value={isLoading ? undefined : fmtN(subsFromLinks)}
              color="#7c3aed"
              isLoading={isLoading}
            />
            <MetricCard
              label="Fans Cached"
              formula="Total distinct fan records stored locally from the OnlyFans API. Used for cross-poll attribution lookups."
              source="COUNT(*) FROM fans"
              value={isLoading ? undefined : fmtN(fansCount)}
              color="#7c3aed"
              isLoading={isLoading}
            />
          </div>
        </Section>

        {/* SECTION: Data Coverage */}
        <Section
          icon={<Database className="h-4 w-4 text-primary" />}
          title="Data Coverage"
          description="What data we have and how complete it is"
        >
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campaign Coverage</div>
                <CoverageRow label="With LTV data" count={withLtv} total={totalLinks} />
                <CoverageRow label="With spend logged" count={withSpend} total={totalLinks} />
                <CoverageRow label="With source tag" count={withSource} total={totalLinks} />
                <CoverageRow label="With cross-poll revenue" count={withCrossPoll} total={totalLinks} />
                <CoverageRow label="Tagged (traffic category)" count={tagged} total={totalLinks} />
              </div>
              <div className="space-y-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sync Status</div>
                <div className="space-y-2">
                  <DataRow label="Total tracking links" value={fmtN(totalLinks)} />
                  <DataRow label="Fans cached" value={fmtN(fansCount)} />
                  <DataRow label="New subs via LTV" value={fmtN(totalNewSubs)} />
                  <DataRow label="Last LTV sync" value={lastSync ? new Date(lastSync).toLocaleString() : "—"} />
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* SECTION: Revenue Breakdown Sync Status */}
        <Section
          icon={<BarChart3 className="h-4 w-4" style={{ color: "#16a34a" }} />}
          title="Revenue Breakdown Sync Status"
          description="Per-account LTV sync coverage — shows how much revenue data has been captured"
        >
          {(() => {
            const activeAccounts = (allAccounts as any[]).filter((a: any) => a.is_active !== false);
            const synced = activeAccounts.filter((a: any) => a.ltv_updated_at);
            const notSynced = activeAccounts.filter((a: any) => !a.ltv_updated_at);
            const syncedCount = synced.length;
            const totalCount = activeAccounts.length;
            const pct = totalCount > 0 ? (syncedCount / totalCount) * 100 : 0;
            const estMinRemaining = notSynced.length * 3;

            const fmtDate = (d: string | null) => {
              if (!d) return "—";
              const dt = new Date(d);
              const diff = Math.floor((Date.now() - dt.getTime()) / 60000);
              if (diff < 60) return `${diff}m ago`;
              if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
              return `${Math.floor(diff / 1440)}d ago`;
            };

            return (
              <div className="space-y-4">
                {/* Summary bar */}
                <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{syncedCount} of {totalCount} accounts synced</span>
                    <span className="text-sm font-mono text-muted-foreground">{pct.toFixed(0)}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{notSynced.length > 0 ? `${notSynced.length} not yet synced` : "All accounts synced"}</span>
                    {notSynced.length > 0 && (
                      <span>~{estMinRemaining} min to sync remaining (est. 3 min/account)</span>
                    )}
                  </div>
                </div>

                {/* Per-account table */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Account</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total LTV</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Messages</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tips</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Subscriptions</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Posts</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Last Synced</th>
                        <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAccounts
                        .sort((a: any, b: any) => {
                          if (a.ltv_updated_at && !b.ltv_updated_at) return -1;
                          if (!a.ltv_updated_at && b.ltv_updated_at) return 1;
                          return (b.ltv_total || 0) - (a.ltv_total || 0);
                        })
                        .map((acc: any) => {
                          const isSynced = !!acc.ltv_updated_at;
                          const total = Number(acc.ltv_total || 0);
                          const msgs = Number(acc.ltv_messages || 0);
                          const tips = Number(acc.ltv_tips || 0);
                          const subs = Number(acc.ltv_subscriptions || 0);
                          const posts = Number(acc.ltv_posts || 0);
                          return (
                            <tr key={acc.id} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="px-4 py-2.5 font-medium text-foreground text-[13px]">{acc.display_name || acc.username || "—"}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-foreground">{total > 0 ? fmtC(total) : "—"}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{msgs > 0 ? fmtC(msgs) : "—"}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{tips > 0 ? fmtC(tips) : "—"}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{subs > 0 ? fmtC(subs) : "—"}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{posts > 0 ? fmtC(posts) : "—"}</td>
                              <td className="px-4 py-2.5 text-right text-[12px] text-muted-foreground">{fmtDate(acc.ltv_updated_at)}</td>
                              <td className="px-4 py-2.5 text-center">
                                {isSynced ? (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500">Synced</span>
                                ) : (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500">Not Synced</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </Section>

      </div>
    </DashboardLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string | null; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3" style={{ borderTop: `3px solid ${color}` }}>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      {value == null ? (
        <Skeleton className="h-5 w-16" />
      ) : (
        <div className="font-mono font-bold text-base text-foreground">{value}</div>
      )}
    </div>
  );
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="p-1.5 rounded-lg bg-muted">{icon}</div>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function MetricCard({ label, formula, source, value, color = "#0891b2", isLoading = false }: {
  label: string; formula: string; source: string; value?: string; color?: string; isLoading?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2 flex flex-col" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-sm text-foreground">{label}</div>
        {isLoading ? (
          <Skeleton className="h-4 w-16 shrink-0" />
        ) : value != null ? (
          <div className="font-mono font-bold text-sm shrink-0" style={{ color }}>{value}</div>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed flex-1">{formula}</div>
      <code className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-2 py-1 block break-all mt-auto">{source}</code>
    </div>
  );
}

function BadgeThreshold({ label, condition, color, bg }: { label: string; condition: string; color: string; bg: string }) {
  return (
    <div className="flex flex-col gap-1.5 items-start">
      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: bg, color }}>{label}</span>
      <span className="text-[11px] text-muted-foreground">{condition}</span>
    </div>
  );
}

function CoverageRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{fmtN(count)}/{fmtN(total)}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

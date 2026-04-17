import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TagBadge } from "@/components/TagBadge";
import { getEffectiveSource } from "@/lib/source-helpers";
import { subDays } from "date-fns";

type SubsPeriod = "since_last_sync" | "3d" | "7d" | "14d" | "30d";

const PERIOD_OPTIONS: { key: SubsPeriod; label: string }[] = [
  { key: "since_last_sync", label: "Since last sync" },
  { key: "3d", label: "Last 3 days" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
];

const fmtCurrency = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number) => v.toLocaleString();

interface SubsTabProps {
  accountId: string;
  accLinks: any[];
  modelName?: string;
  avatarUrl?: string;
  onRowClick?: (link: any) => void;
}

interface LinkDelta {
  link: any;
  source: string;
  subsGained: number;
  clicksGained: number;
  revenueGained: number;
  days: number;
  hasDelta: boolean; // ≥ 2 snapshots
}

export function SubsTab({ accountId, accLinks, modelName, avatarUrl, onRowClick }: SubsTabProps) {
  const [period, setPeriod] = useState<SubsPeriod>("since_last_sync");

  // Fetch ALL snapshots for this account (cumulative). We compute deltas client-side.
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["subs_tab_snapshots", accountId],
    queryFn: async () => {
      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("daily_snapshots")
          .select("tracking_link_id, snapshot_date, clicks, subscribers, revenue")
          .eq("account_id", accountId)
          .order("snapshot_date", { ascending: true })
          .range(rangeFrom, rangeFrom + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        rangeFrom += batchSize;
      }
      return allRows;
    },
    enabled: !!accountId,
  });

  // Group snapshots per link (sorted ascending by date). Note: daily_snapshots
  // currently store DAILY DELTAS (per memory note in useSnapshotMetrics), but
  // the spec asks us to treat them as cumulative. We accumulate them into
  // cumulative values to match the spec ("cumulative per day").
  const cumulativeByLink = useMemo(() => {
    const grouped: Record<string, { date: string; clicks: number; subs: number; rev: number }[]> = {};
    for (const r of snapshots) {
      const lid = String(r.tracking_link_id ?? "");
      if (!lid || !r.snapshot_date) continue;
      if (!grouped[lid]) grouped[lid] = [];
      grouped[lid].push({
        date: r.snapshot_date as string,
        clicks: Number(r.clicks || 0),
        subs: Number(r.subscribers || 0),
        rev: Number(r.revenue || 0),
      });
    }
    // Sort + accumulate
    const out: Record<string, { date: string; clicks: number; subs: number; rev: number }[]> = {};
    for (const [lid, rows] of Object.entries(grouped)) {
      rows.sort((a, b) => a.date.localeCompare(b.date));
      let cClicks = 0, cSubs = 0, cRev = 0;
      out[lid] = rows.map((r) => {
        cClicks += r.clicks;
        cSubs += r.subs;
        cRev += r.rev;
        return { date: r.date, clicks: cClicks, subs: cSubs, rev: cRev };
      });
    }
    return out;
  }, [snapshots]);

  // Determine the period date window based on selection
  const periodWindow = useMemo(() => {
    if (snapshots.length === 0) return null;
    // Find global max snapshot_date for this account
    const allDates = Array.from(new Set(snapshots.map((s: any) => s.snapshot_date as string))).sort();
    if (allDates.length === 0) return null;
    const maxDate = allDates[allDates.length - 1];

    if (period === "since_last_sync") {
      if (allDates.length < 2) return { fromDate: null, toDate: maxDate, mode: "since_last_sync" as const, needsTwo: true };
      const prevDate = allDates[allDates.length - 2];
      return { fromDate: prevDate, toDate: maxDate, mode: "since_last_sync" as const, needsTwo: false };
    }

    const days = period === "3d" ? 3 : period === "7d" ? 7 : period === "14d" ? 14 : 30;
    const cutoff = subDays(new Date(maxDate + "T00:00:00Z"), days).toISOString().slice(0, 10);
    return { fromDate: cutoff, toDate: maxDate, mode: "rolling" as const, needsTwo: false };
  }, [snapshots, period]);

  // Calculate deltas per link for selected period
  const linkDeltas = useMemo<LinkDelta[]>(() => {
    if (!periodWindow || periodWindow.needsTwo) return [];
    const { fromDate, toDate } = periodWindow;
    const result: LinkDelta[] = [];
    for (const link of accLinks) {
      const lid = String(link.id);
      const series = cumulativeByLink[lid];
      if (!series || series.length === 0) continue;

      // latest = most recent <= toDate
      const inRange = series.filter((s) => s.date <= toDate!);
      if (inRange.length === 0) continue;
      const latest = inRange[inRange.length - 1];

      // earliest = most recent <= fromDate (baseline BEFORE the period),
      // OR if none, the first snapshot in the series within the window.
      let earliest: typeof latest | null = null;
      if (fromDate) {
        const baseline = series.filter((s) => s.date <= fromDate);
        if (baseline.length > 0) earliest = baseline[baseline.length - 1];
      }
      if (!earliest) {
        // fall back to the earliest snapshot we have (≤ toDate)
        earliest = inRange[0];
      }

      if (earliest.date === latest.date) {
        // Only a single data point — cannot compute delta
        result.push({
          link,
          source: getEffectiveSource(link) || "Untagged",
          subsGained: 0,
          clicksGained: 0,
          revenueGained: 0,
          days: 0,
          hasDelta: false,
        });
        continue;
      }

      const subsGained = Math.max(0, latest.subs - earliest.subs);
      const clicksGained = Math.max(0, latest.clicks - earliest.clicks);
      const revenueGained = Math.max(0, latest.rev - earliest.rev);
      const days = Math.max(
        1,
        Math.round(
          (new Date(latest.date + "T00:00:00Z").getTime() -
            new Date(earliest.date + "T00:00:00Z").getTime()) /
            86400000
        )
      );
      result.push({
        link,
        source: getEffectiveSource(link) || "Untagged",
        subsGained,
        clicksGained,
        revenueGained,
        days,
        hasDelta: true,
      });
    }
    return result;
  }, [accLinks, cumulativeByLink, periodWindow]);

  const totals = useMemo(() => {
    let totalSubs = 0, totalClicks = 0, totalRev = 0, maxDays = 0;
    for (const d of linkDeltas) {
      if (!d.hasDelta) continue;
      totalSubs += d.subsGained;
      totalClicks += d.clicksGained;
      totalRev += d.revenueGained;
      if (d.days > maxDays) maxDays = d.days;
    }
    return { totalSubs, totalClicks, totalRev, days: maxDays };
  }, [linkDeltas]);

  const sourceAgg = useMemo(() => {
    const map: Record<string, { source: string; subs: number; clicks: number; rev: number; days: number }> = {};
    for (const d of linkDeltas) {
      if (!d.hasDelta) continue;
      if (!map[d.source]) map[d.source] = { source: d.source, subs: 0, clicks: 0, rev: 0, days: 0 };
      map[d.source].subs += d.subsGained;
      map[d.source].clicks += d.clicksGained;
      map[d.source].rev += d.revenueGained;
      if (d.days > map[d.source].days) map[d.source].days = d.days;
    }
    return Object.values(map).sort((a, b) => {
      if (a.source === "Untagged" && b.source !== "Untagged") return 1;
      if (b.source === "Untagged" && a.source !== "Untagged") return -1;
      return b.subs - a.subs;
    });
  }, [linkDeltas]);

  const topSource = sourceAgg.length > 0 ? sourceAgg[0] : null;

  const sortedLinkDeltas = useMemo(
    () => [...linkDeltas].sort((a, b) => b.subsGained - a.subsGained),
    [linkDeltas]
  );

  const visibleLinkDeltas = sortedLinkDeltas.filter((d) => d.hasDelta);

  return (
    <div className="space-y-5">
      {/* Date filter pills */}
      <div className="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((opt) => {
          const active = period === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : !periodWindow ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No snapshot data for this model</p>
      ) : periodWindow.needsTwo ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Need at least 2 syncs to compute growth</p>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Total Gained</p>
              <p className="text-2xl font-bold font-mono text-emerald-500">
                {totals.totalSubs > 0 ? `+${fmtNum(totals.totalSubs)}` : fmtNum(totals.totalSubs)}
              </p>
            </div>
            <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Subs / Day</p>
              <p className="text-2xl font-bold font-mono text-foreground">
                {totals.days > 0 ? `${(totals.totalSubs / totals.days).toFixed(1)}/day` : "—"}
              </p>
            </div>
            <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Top Source</p>
              <p className="text-lg font-bold font-mono text-foreground truncate">
                {topSource ? `${topSource.source} (+${fmtNum(topSource.subs)})` : "—"}
              </p>
            </div>
          </div>

          {totals.totalSubs === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No new subs in this period</p>
          ) : (
            <>
              {/* By source */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">By source</p>
                <div className="rounded-lg border border-border divide-y divide-border/50 bg-card">
                  {sourceAgg.map((s) => {
                    const pct = totals.totalSubs > 0 ? (s.subs / totals.totalSubs) * 100 : 0;
                    const subsPerDay = s.days > 0 ? s.subs / s.days : 0;
                    return (
                      <div key={s.source} className="flex items-center justify-between px-4 py-2.5 text-[12px]">
                        <TagBadge tagName={s.source} size="md" />
                        <div className="flex items-center gap-6 font-mono">
                          <span className="text-emerald-500 font-bold">+{fmtNum(s.subs)}</span>
                          <span className="text-muted-foreground w-16 text-right">
                            {subsPerDay > 0 ? `${subsPerDay.toFixed(1)}/day` : "—"}
                          </span>
                          <span className="text-muted-foreground w-14 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By tracking link */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">By tracking link</p>
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <th className="text-left py-2 px-3">Tracking Link</th>
                        <th className="text-left py-2 px-3">Source</th>
                        <th className="text-right py-2 px-3">Subs Gained</th>
                        <th className="text-right py-2 px-3">Subs/Day</th>
                        <th className="text-right py-2 px-3">Clicks Gained</th>
                        <th className="text-right py-2 px-3">CVR</th>
                        <th className="text-right py-2 px-3">Revenue Gained</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLinkDeltas.map((d) => {
                        const subsPerDay = d.days > 0 ? d.subsGained / d.days : 0;
                        const cvr = d.clicksGained > 0 ? (d.subsGained / d.clicksGained) * 100 : null;
                        return (
                          <tr
                            key={d.link.id}
                            className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                            onClick={() =>
                              onRowClick?.({ ...d.link, avatarUrl, modelName })
                            }
                          >
                            <td className="py-3 px-3">
                              <p className="font-medium text-foreground text-[12px] truncate max-w-[260px]">
                                {d.link.campaign_name || "—"}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate max-w-[260px]">{d.link.url}</p>
                            </td>
                            <td className="py-3 px-3 text-[12px]">
                              <TagBadge tagName={d.source} />
                            </td>
                            <td className="text-right py-3 px-3 font-mono text-[12px] text-emerald-500 font-bold">
                              {d.subsGained > 0 ? `+${fmtNum(d.subsGained)}` : fmtNum(d.subsGained)}
                            </td>
                            <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">
                              {subsPerDay > 0 ? `${subsPerDay.toFixed(1)}/day` : "—"}
                            </td>
                            <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(d.clicksGained)}</td>
                            <td className="text-right py-3 px-3 font-mono text-[12px]">
                              {cvr != null ? `${cvr.toFixed(1)}%` : "—"}
                            </td>
                            <td className="text-right py-3 px-3 font-mono text-[12px] font-semibold text-foreground">
                              {fmtCurrency(d.revenueGained)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Showing {visibleLinkDeltas.length} of {accLinks.length} tracking links
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

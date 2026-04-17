import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TagBadge } from "@/components/TagBadge";
import { SortableTh } from "@/components/SortableTh";
import { getEffectiveSource } from "@/lib/source-helpers";
import { subDays } from "date-fns";

type SubsSortKey = "campaign" | "source" | "subs" | "subsDay" | "clicks" | "cvr" | "rev";

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
  hasDelta: boolean;
}

export function SubsTab({ accountId, accLinks, modelName, avatarUrl, onRowClick }: SubsTabProps) {
  const [period, setPeriod] = useState<SubsPeriod>("since_last_sync");
  const [sortKey, setSortKey] = useState<SubsSortKey>("subs");
  const [sortAsc, setSortAsc] = useState(false);
  const handleSort = (k: SubsSortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };

  // Fetch ALL snapshots for this account. Snapshots store DAILY DELTAS
  // (incremental gains per day) — NOT cumulative totals — per
  // mem://infrastructure/sync-optimization. So per-period totals are
  // computed by SUMMING rows whose snapshot_date falls inside the window.
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

  // Determine the period window using actual snapshot dates available.
  const periodWindow = useMemo(() => {
    if (snapshots.length === 0) return null;
    const allDates = Array.from(new Set(snapshots.map((s: any) => s.snapshot_date as string))).sort();
    if (allDates.length === 0) return null;
    const maxDate = allDates[allDates.length - 1];

    if (period === "since_last_sync") {
      // Just the latest snapshot date — that day's deltas = "what was gained
      // since the previous sync".
      if (allDates.length < 1) return { fromDate: maxDate, toDate: maxDate, days: 1, needsTwo: true };
      return { fromDate: maxDate, toDate: maxDate, days: 1, needsTwo: false };
    }

    const days = period === "3d" ? 3 : period === "7d" ? 7 : period === "14d" ? 14 : 30;
    const cutoff = subDays(new Date(maxDate + "T00:00:00Z"), days - 1).toISOString().slice(0, 10);
    return { fromDate: cutoff, toDate: maxDate, days, needsTwo: false };
  }, [snapshots, period]);

  // Sum incremental deltas per link within the selected window.
  const linkDeltas = useMemo<LinkDelta[]>(() => {
    if (!periodWindow || periodWindow.needsTwo) return [];
    const { fromDate, toDate, days } = periodWindow;

    // Build per-link sums for snapshots inside [fromDate, toDate]
    const sums: Record<string, { subs: number; clicks: number; rev: number; dates: Set<string> }> = {};
    for (const r of snapshots) {
      const lid = String(r.tracking_link_id ?? "");
      if (!lid || !r.snapshot_date) continue;
      const d = r.snapshot_date as string;
      if (d < fromDate || d > toDate) continue;
      if (!sums[lid]) sums[lid] = { subs: 0, clicks: 0, rev: 0, dates: new Set() };
      sums[lid].subs += Math.max(0, Number(r.subscribers || 0));
      sums[lid].clicks += Math.max(0, Number(r.clicks || 0));
      sums[lid].rev += Math.max(0, Number(r.revenue || 0));
      sums[lid].dates.add(d);
    }

    const result: LinkDelta[] = [];
    for (const link of accLinks) {
      const lid = String(link.id);
      const s = sums[lid];
      if (!s) continue;
      result.push({
        link,
        source: getEffectiveSource(link) || "Untagged",
        subsGained: s.subs,
        clicksGained: s.clicks,
        revenueGained: s.rev,
        days,
        hasDelta: true,
      });
    }
    return result;
  }, [accLinks, snapshots, periodWindow]);

  const totals = useMemo(() => {
    let totalSubs = 0, totalClicks = 0, totalRev = 0;
    for (const d of linkDeltas) {
      totalSubs += d.subsGained;
      totalClicks += d.clicksGained;
      totalRev += d.revenueGained;
    }
    return { totalSubs, totalClicks, totalRev, days: periodWindow?.days || 0 };
  }, [linkDeltas, periodWindow]);

  const sourceAgg = useMemo(() => {
    const map: Record<string, { source: string; subs: number; clicks: number; rev: number; days: number }> = {};
    for (const d of linkDeltas) {
      if (!map[d.source]) map[d.source] = { source: d.source, subs: 0, clicks: 0, rev: 0, days: d.days };
      map[d.source].subs += d.subsGained;
      map[d.source].clicks += d.clicksGained;
      map[d.source].rev += d.revenueGained;
    }
    return Object.values(map).sort((a, b) => {
      if (a.source === "Untagged" && b.source !== "Untagged") return 1;
      if (b.source === "Untagged" && a.source !== "Untagged") return -1;
      return b.subs - a.subs;
    });
  }, [linkDeltas]);

  const topSource = sourceAgg.find((s) => s.source !== "Untagged" && s.subs > 0) || sourceAgg[0] || null;

  const sortedLinkDeltas = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    const getVal = (d: LinkDelta): number | string => {
      switch (sortKey) {
        case "campaign": return (d.link.campaign_name || "").toLowerCase();
        case "source": return (d.source || "").toLowerCase();
        case "subs": return d.subsGained;
        case "subsDay": return d.days > 0 ? d.subsGained / d.days : 0;
        case "clicks": return d.clicksGained;
        case "cvr": return d.clicksGained > 0 ? (d.subsGained / d.clicksGained) * 100 : -Infinity;
        case "rev": return d.revenueGained;
      }
    };
    return [...linkDeltas].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
  }, [linkDeltas, sortKey, sortAsc]);

  const visibleLinkDeltas = sortedLinkDeltas.filter(
    (d) => d.subsGained > 0 || d.clicksGained > 0 || d.revenueGained > 0
  );

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
                        <SortableTh<SubsSortKey> label="Tracking Link" sortKey="campaign" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" className="py-2 px-3" />
                        <SortableTh<SubsSortKey> label="Source" sortKey="source" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" className="py-2 px-3" />
                        <SortableTh<SubsSortKey> label="Subs Gained" sortKey="subs" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2 px-3" />
                        <SortableTh<SubsSortKey> label="Subs/Day" sortKey="subsDay" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2 px-3" />
                        <SortableTh<SubsSortKey> label="Clicks Gained" sortKey="clicks" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2 px-3" />
                        <SortableTh<SubsSortKey> label="CVR" sortKey="cvr" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2 px-3" />
                        <SortableTh<SubsSortKey> label="Revenue Gained" sortKey="rev" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2 px-3" />
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

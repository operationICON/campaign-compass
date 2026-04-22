import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange, getOnlytrafficOrders } from "@/lib/api";
import { TagBadge } from "@/components/TagBadge";
import { getEffectiveSource } from "@/lib/source-helpers";
import { subDays } from "date-fns";
import { ArrowDown, ArrowUp, Zap, Trophy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/**
 * Growth tab — replaces Subs tab.
 *
 * IMPORTANT data note:
 * daily_snapshots store CUMULATIVE TOTALS (running total as of each snapshot date).
 * Per-period gains are computed as DELTA between the latest snapshot in the window
 * and the earliest applicable snapshot (latest - earliest), NOT by summing rows.
 *
 * Duplicates: if a (tracking_link_id, snapshot_date) pair has multiple rows, we keep
 * the row with MAX(subscribers) and discard the rest before processing.
 */

type GrowthPeriod = "since_last_sync" | "7d" | "14d" | "30d";

// NOTE: Extended ranges (7d/14d/30d) are temporarily hidden from the UI until
// daily sync is fully established. The filter logic is preserved — just unhide
// the entries below to re-enable.
const PERIOD_OPTIONS: { key: GrowthPeriod; label: string }[] = [
  { key: "since_last_sync", label: "Since last sync" },
  // { key: "7d", label: "Last 7 days" },
  // { key: "14d", label: "Last 14 days" },
  // { key: "30d", label: "Last 30 days" },
];

const fmtCurrency = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number) => v.toLocaleString();

interface GrowthTabProps {
  accountId: string;
  accLinks: any[];
  modelName?: string;
  avatarUrl?: string;
  onRowClick?: (link: any) => void;
}

interface PeriodAgg {
  subs: number;
  clicks: number;
  rev: number;
  days: number; // distinct snapshot dates in window
  spend: number; // OnlyTraffic spend in window
}

interface LinkRow {
  link: any;
  source: string;
  cur: PeriodAgg;
  prev: PeriodAgg;
}

type SortKey = "subs" | "subsDay" | "rev" | "clicks" | "cvr" | "cpl" | "campaign" | "source" | "created";

function pctChange(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Trend chip — green ▲ for growth, red ▼ for decline. CPL is reversed. */
function TrendChip({ value, reverse = false, size = "xs" }: { value: number | null; reverse?: boolean; size?: "xs" | "sm" }) {
  if (value === null || !isFinite(value)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const up = value > 0;
  const isGood = reverse ? !up : up;
  const cls = isGood ? "text-emerald-500" : "text-destructive";
  const Icon = up ? ArrowUp : ArrowDown;
  const fontSize = size === "sm" ? "text-[11px]" : "text-[10px]";
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${fontSize} ${cls}`}>
      <Icon className={size === "sm" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export function GrowthTab({ accountId, accLinks, modelName, avatarUrl, onRowClick }: GrowthTabProps) {
  const [period, setPeriod] = useState<GrowthPeriod>("since_last_sync");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };

  // Fetch ALL snapshots for this account
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["growth_tab_snapshots", accountId],
    queryFn: () => getSnapshotsByDateRange({ account_ids: [accountId] }),
    enabled: !!accountId,
  });

  // OnlyTraffic orders for CPL — scoped to this account's tracking_links
  const linkIds = useMemo(() => accLinks.map((l) => l.id), [accLinks]);
  const { data: orders = [] } = useQuery({
    queryKey: ["growth_tab_orders", accountId, linkIds.length],
    queryFn: () => getOnlytrafficOrders({ tracking_link_ids: linkIds }),
    enabled: !!accountId && linkIds.length > 0,
  });

  // Deduplicate snapshots: per (tracking_link_id, snapshot_date), keep MAX(subscribers).
  // Also build a per-link series sorted ascending by date.
  const seriesByLink = useMemo(() => {
    const dedup = new Map<string, any>(); // key = lid|date
    for (const r of snapshots) {
      const lid = String(r.tracking_link_id ?? "");
      const d = r.snapshot_date as string | undefined;
      if (!lid || !d) continue;
      const key = `${lid}|${d}`;
      const existing = dedup.get(key);
      const subs = Number(r.subscribers || 0);
      if (!existing || subs > Number(existing.subscribers || 0)) {
        dedup.set(key, r);
      }
    }
    const map: Record<string, Array<{ date: string; subs: number; clicks: number; rev: number }>> = {};
    for (const r of dedup.values()) {
      const lid = String(r.tracking_link_id);
      (map[lid] ||= []).push({
        date: r.snapshot_date as string,
        subs: Math.max(0, Number(r.subscribers || 0)),
        clicks: Math.max(0, Number(r.clicks || 0)),
        rev: Math.max(0, Number(r.revenue || 0)),
      });
    }
    for (const lid of Object.keys(map)) {
      map[lid].sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [snapshots]);

  // Determine current + previous period windows + the "earliest boundary" date that
  // anchors the delta. For since_last_sync, anchor is the previous snapshot_date.
  // For extended ranges, anchor is the latest snapshot ON OR BEFORE the window start.
  const windows = useMemo(() => {
    if (snapshots.length === 0) return null;
    const allDates = Array.from(new Set(snapshots.map((s: any) => s.snapshot_date as string))).sort();
    if (allDates.length === 0) return null;
    const maxDate = allDates[allDates.length - 1];

    if (period === "since_last_sync") {
      if (allDates.length < 2) {
        return { mode: "sync" as const, curTo: maxDate, curAnchor: null as string | null,
                 prevTo: null as string | null, prevAnchor: null as string | null, days: 1, needsTwo: true };
      }
      const prevDate = allDates[allDates.length - 2];
      const prevPrev = allDates.length >= 3 ? allDates[allDates.length - 3] : null;
      return {
        mode: "sync" as const,
        curTo: maxDate, curAnchor: prevDate,
        prevTo: prevDate, prevAnchor: prevPrev,
        days: 1, needsTwo: false,
      };
    }

    const days = period === "7d" ? 7 : period === "14d" ? 14 : 30;
    const curStart = subDays(new Date(maxDate + "T00:00:00Z"), days).toISOString().slice(0, 10);
    const prevStart = subDays(new Date(maxDate + "T00:00:00Z"), days * 2).toISOString().slice(0, 10);
    return {
      mode: "range" as const,
      curTo: maxDate, curAnchor: curStart,
      prevTo: curStart, prevAnchor: prevStart,
      days, needsTwo: false,
    };
  }, [snapshots, period]);

  // Helper: latest series point with date <= bound (or null)
  const latestOnOrBefore = (
    series: Array<{ date: string; subs: number; clicks: number; rev: number }>,
    bound: string
  ) => {
    let pick: typeof series[number] | null = null;
    for (const p of series) {
      if (p.date <= bound) pick = p; else break;
    }
    return pick;
  };

  // Per-link, per-period delta aggregates (subs/clicks/rev gained, days, spend).
  const linkRows = useMemo<LinkRow[]>(() => {
    if (!windows || windows.needsTwo) return [];
    const { curTo, curAnchor, prevTo, prevAnchor } = windows;

    const emptyAgg = (): PeriodAgg => ({ subs: 0, clicks: 0, rev: 0, days: 0, spend: 0 });

    // OnlyTraffic spend per link per period (window = anchor < date <= to)
    const spendCur: Record<string, number> = {};
    const spendPrev: Record<string, number> = {};
    for (const o of orders) {
      const lid = String(o.tracking_link_id ?? "");
      if (!lid || !o.order_created_at) continue;
      const status = String(o.status || "").toLowerCase();
      if (!["completed", "accepted", "active", "waiting"].includes(status)) continue;
      const dt = (o.order_created_at as string).slice(0, 10);
      const amt = Number(o.total_spent || 0);
      // Current window: (curAnchor, curTo]  (or [curStart, curTo] if no anchor needed)
      if (curAnchor) {
        if (dt > curAnchor && dt <= curTo) spendCur[lid] = (spendCur[lid] || 0) + amt;
      } else {
        if (dt === curTo) spendCur[lid] = (spendCur[lid] || 0) + amt;
      }
      if (prevTo && prevAnchor) {
        if (dt > prevAnchor && dt <= prevTo) spendPrev[lid] = (spendPrev[lid] || 0) + amt;
      } else if (prevTo) {
        if (dt === prevTo) spendPrev[lid] = (spendPrev[lid] || 0) + amt;
      }
    }

    const dayDiff = (a: string, b: string) =>
      Math.max(
        0,
        Math.round(
          (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) /
            86400000
        )
      );

    const rows: LinkRow[] = [];
    for (const link of accLinks) {
      const lid = String(link.id);
      const series = seriesByLink[lid];
      if (!series || series.length === 0) continue;

      // CURRENT delta
      const curLatest = latestOnOrBefore(series, curTo);
      const curEarliest = curAnchor ? latestOnOrBefore(series, curAnchor) : null;
      const cur: PeriodAgg = emptyAgg();
      if (curLatest && curEarliest && curLatest.date !== curEarliest.date) {
        cur.subs = Math.max(0, curLatest.subs - curEarliest.subs);
        cur.clicks = Math.max(0, curLatest.clicks - curEarliest.clicks);
        cur.rev = Math.max(0, curLatest.rev - curEarliest.rev);
        cur.days = Math.max(1, dayDiff(curEarliest.date, curLatest.date));
      }
      cur.spend = spendCur[lid] || 0;

      // PREVIOUS delta
      const prev: PeriodAgg = emptyAgg();
      if (prevTo) {
        const prevLatest = latestOnOrBefore(series, prevTo);
        const prevEarliest = prevAnchor ? latestOnOrBefore(series, prevAnchor) : null;
        if (prevLatest && prevEarliest && prevLatest.date !== prevEarliest.date) {
          prev.subs = Math.max(0, prevLatest.subs - prevEarliest.subs);
          prev.clicks = Math.max(0, prevLatest.clicks - prevEarliest.clicks);
          prev.rev = Math.max(0, prevLatest.rev - prevEarliest.rev);
          prev.days = Math.max(1, dayDiff(prevEarliest.date, prevLatest.date));
        }
      }
      prev.spend = spendPrev[lid] || 0;

      // Skip links with no signal in either window
      if (
        cur.subs === 0 && cur.clicks === 0 && cur.rev === 0 && cur.spend === 0 &&
        prev.subs === 0 && prev.clicks === 0 && prev.rev === 0 && prev.spend === 0
      ) continue;

      rows.push({
        link,
        source: getEffectiveSource(link) || "Untagged",
        cur,
        prev,
      });
    }
    return rows;
  }, [accLinks, seriesByLink, orders, windows]);

  // Hide rows where current subs_gained = 0 AND clicks_gained = 0
  const visibleRows = useMemo(
    () => linkRows.filter((r) => r.cur.subs > 0 || r.cur.clicks > 0),
    [linkRows]
  );

  const sortedRows = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    const getVal = (r: LinkRow): number | string => {
      switch (sortKey) {
        case "campaign": return (r.link.campaign_name || "").toLowerCase();
        case "source": return (r.source || "").toLowerCase();
        case "created": return r.link.created_at ? new Date(r.link.created_at).getTime() : 0;
        case "subs": return r.cur.subs;
        case "subsDay": return r.cur.days > 0 ? r.cur.subs / r.cur.days : 0;
        case "rev": return r.cur.rev;
        case "clicks": return r.cur.clicks;
        case "cvr": return r.cur.clicks > 0 ? (r.cur.subs / r.cur.clicks) * 100 : -Infinity;
        case "cpl": return r.cur.subs > 0 && r.cur.spend > 0 ? r.cur.spend / r.cur.subs : -Infinity;
      }
    };
    return [...visibleRows].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
  }, [visibleRows, sortKey, sortAsc]);

  // Hero totals
  const totals = useMemo(() => {
    let curSubs = 0, prevSubs = 0;
    for (const r of linkRows) {
      curSubs += r.cur.subs;
      prevSubs += r.prev.subs;
    }
    return { curSubs, prevSubs, pct: pctChange(curSubs, prevSubs), days: windows?.days || 0 };
  }, [linkRows, windows]);

  const fastest = useMemo(() => {
    let best: LinkRow | null = null;
    let bestPerDay = -1;
    for (const r of linkRows) {
      if (r.cur.subs <= 0) continue;
      const days = Math.max(1, r.cur.days);
      const perDay = r.cur.subs / days;
      if (perDay > bestPerDay) { bestPerDay = perDay; best = r; }
    }
    return best ? { row: best, perDay: bestPerDay } : null;
  }, [linkRows]);

  const topSource = useMemo(() => {
    const map: Record<string, number> = {};
    let total = 0;
    for (const r of linkRows) {
      map[r.source] = (map[r.source] || 0) + r.cur.subs;
      total += r.cur.subs;
    }
    const entries = Object.entries(map).filter(([s]) => s !== "Untagged");
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length === 0 || entries[0][1] <= 0) return null;
    const [src, subs] = entries[0];
    return { source: src, subs, pct: total > 0 ? (subs / total) * 100 : 0 };
  }, [linkRows]);

  // CVR thresholds (per spec)
  const cvrColor = (cvr: number | null) => {
    if (cvr === null) return "text-muted-foreground";
    if (cvr > 51.17) return "text-emerald-500";
    if (cvr < 16.69) return "text-destructive";
    return "text-foreground";
  };

  return (
    <div className="space-y-5">
      {/* Date filter pills */}
      <div className="space-y-1.5">
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
        <p className="text-[11px] text-muted-foreground">
          Extended date ranges will be available once daily sync is fully established.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : !windows ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No growth data for this period. Try selecting a longer date range.
        </p>
      ) : windows.needsTwo ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Need at least 2 syncs to compute growth.
        </p>
      ) : (
        <>
          {/* HERO summary row — 3 cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Total Subs Gained */}
            <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Total Subs Gained</p>
              <p className="text-3xl font-bold font-mono text-emerald-500 leading-tight">
                {totals.curSubs > 0 ? `+${fmtNum(totals.curSubs)}` : fmtNum(totals.curSubs)}
              </p>
              <div className="mt-1">
                <TrendChip value={totals.pct} size="sm" />
                <span className="text-[10px] text-muted-foreground ml-1">vs prev</span>
              </div>
            </div>

            {/* Fastest Growing Link */}
            <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 inline-flex items-center gap-1">
                <Zap className="h-3 w-3" /> Fastest Growing Link
              </p>
              {fastest ? (
                <>
                  <p className="text-lg font-bold text-foreground truncate" title={fastest.row.link.campaign_name || ""}>
                    {fastest.row.link.campaign_name || "—"}
                  </p>
                  <p className="text-[12px] font-mono text-emerald-500 mt-0.5">
                    +{fmtNum(fastest.row.cur.subs)} · {fastest.perDay.toFixed(1)}/day
                  </p>
                </>
              ) : (
                <p className="text-lg font-bold text-muted-foreground">—</p>
              )}
            </div>

            {/* Top Source */}
            <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 inline-flex items-center gap-1">
                <Trophy className="h-3 w-3" /> Top Source
              </p>
              {topSource ? (
                <>
                  <p className="text-lg font-bold text-foreground truncate">{topSource.source}</p>
                  <p className="text-[12px] font-mono text-emerald-500 mt-0.5">
                    +{fmtNum(topSource.subs)} · {topSource.pct.toFixed(1)}%
                  </p>
                </>
              ) : (
                <p className="text-lg font-bold text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {/* Empty state */}
          {visibleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No growth data for this period. Try selecting a longer date range.
            </p>
          ) : (
            <div>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <SortHeader label="Campaign" k="campaign" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" />
                      <SortHeader label="Source" k="source" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" />
                      <SortHeader label="Created" k="created" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" />
                      <SortHeader label="Subs Gained" k="subs" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" hero />
                      <SortHeader label="Subs/Day" k="subsDay" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" hero />
                      <SortHeader label="Revenue" k="rev" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                      <SortHeader label="Clicks" k="clicks" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                      <SortHeader label="CVR" k="cvr" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                      <SortHeader label="CPL" k="cpl" sortKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => {
                      const curSubsPerDay = r.cur.days > 0 ? r.cur.subs / r.cur.days : 0;
                      const prevSubsPerDay = r.prev.days > 0 ? r.prev.subs / r.prev.days : 0;
                      const curCvr = r.cur.clicks > 0 ? (r.cur.subs / r.cur.clicks) * 100 : null;
                      const prevCvr = r.prev.clicks > 0 ? (r.prev.subs / r.prev.clicks) * 100 : null;
                      const curCpl = r.cur.subs > 0 && r.cur.spend > 0 ? r.cur.spend / r.cur.subs : null;
                      const prevCpl = r.prev.subs > 0 && r.prev.spend > 0 ? r.prev.spend / r.prev.subs : null;
                      return (
                        <tr
                          key={r.link.id}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => onRowClick?.({ ...r.link, avatarUrl, modelName })}
                        >
                          {/* Campaign */}
                          <td className="py-3 px-3">
                            <p className="font-medium text-foreground text-[12px] truncate max-w-[260px]">
                              {r.link.campaign_name || "—"}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate max-w-[260px]">{r.link.url}</p>
                          </td>
                          {/* Source */}
                          <td className="py-3 px-3 text-[12px]">
                            <TagBadge tagName={r.source} />
                          </td>
                          {/* Created */}
                          <td className="py-3 px-3 text-[11px] text-muted-foreground whitespace-nowrap">
                            {r.link.created_at
                              ? formatDistanceToNow(new Date(r.link.created_at), { addSuffix: true })
                              : "—"}
                          </td>
                          {/* HERO: Subs Gained */}
                          <td className="text-right py-3 px-3 font-mono">
                            <p className="text-[15px] font-bold text-emerald-500 leading-tight">
                              {r.cur.subs > 0 ? `+${fmtNum(r.cur.subs)}` : fmtNum(r.cur.subs)}
                            </p>
                            <TrendChip value={pctChange(r.cur.subs, r.prev.subs)} />
                          </td>
                          {/* HERO: Subs/Day */}
                          <td className="text-right py-3 px-3 font-mono">
                            <p className="text-[15px] font-bold text-foreground leading-tight">
                              {curSubsPerDay > 0 ? `${curSubsPerDay.toFixed(1)}/day` : "—"}
                            </p>
                            <TrendChip value={pctChange(curSubsPerDay, prevSubsPerDay)} />
                          </td>
                          {/* Revenue */}
                          <td className="text-right py-3 px-3 font-mono">
                            <p className="text-[12px] font-semibold text-primary">{fmtCurrency(r.cur.rev)}</p>
                            <TrendChip value={pctChange(r.cur.rev, r.prev.rev)} />
                          </td>
                          {/* Clicks */}
                          <td className="text-right py-3 px-3 font-mono">
                            <p className="text-[12px] text-muted-foreground">{fmtNum(r.cur.clicks)}</p>
                            <TrendChip value={pctChange(r.cur.clicks, r.prev.clicks)} />
                          </td>
                          {/* CVR */}
                          <td className="text-right py-3 px-3 font-mono">
                            <p className={`text-[12px] font-medium ${cvrColor(curCvr)}`}>
                              {curCvr != null ? `${curCvr.toFixed(1)}%` : "—"}
                            </p>
                            <TrendChip value={pctChange(curCvr ?? 0, prevCvr ?? 0)} />
                          </td>
                          {/* CPL — reverse trend coloring */}
                          <td className="text-right py-3 px-3 font-mono">
                            <p className="text-[12px] text-muted-foreground">
                              {curCpl != null ? `$${curCpl.toFixed(2)}` : "—"}
                            </p>
                            <TrendChip value={pctChange(curCpl ?? 0, prevCpl ?? 0)} reverse />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Showing {sortedRows.length} of {accLinks.length} campaigns · Sorted by {sortKey === "created" ? "newest first" : "subs gained"} · Data from daily snapshots
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ──────────── Sortable header cell ──────────── */
function SortHeader({
  label, k, sortKey, asc, onSort, align, hero = false,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  asc: boolean;
  onSort: (k: SortKey) => void;
  align: "left" | "right";
  hero?: boolean;
}) {
  const active = sortKey === k;
  const arrow = active ? (asc ? "▲" : "▼") : "";
  const widthClass = hero ? "min-w-[120px]" : "";
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors ${widthClass} ${hero ? "text-foreground" : ""}`}
      onClick={() => onSort(k)}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {arrow && <span className="text-primary text-[9px]">{arrow}</span>}
      </span>
    </th>
  );
}

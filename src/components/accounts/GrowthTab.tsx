import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TagBadge } from "@/components/TagBadge";
import { getEffectiveSource } from "@/lib/source-helpers";
import { subDays } from "date-fns";
import { ArrowDown, ArrowUp, Zap, Trophy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/**
 * Growth tab — replaces Subs tab.
 *
 * IMPORTANT data note:
 * Per `mem://infrastructure/sync-optimization`, daily_snapshots store DAILY DELTAS
 * (incremental gains per day) — NOT cumulative totals. So per-period totals are
 * computed by SUMMING rows whose snapshot_date falls inside the window.
 * "Days" used for /day metrics is the count of distinct snapshot dates in the window.
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

type SortKey = "subs" | "subsDay" | "rev" | "clicks" | "cvr" | "cpl" | "campaign" | "source";

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
  const [sortKey, setSortKey] = useState<SortKey>("subs");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };

  // Fetch ALL snapshots for this account
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["growth_tab_snapshots", accountId],
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

  // OnlyTraffic orders for CPL — scoped to this account's tracking_links
  const linkIds = useMemo(() => accLinks.map((l) => l.id), [accLinks]);
  const { data: orders = [] } = useQuery({
    queryKey: ["growth_tab_orders", accountId, linkIds.length],
    queryFn: async () => {
      if (linkIds.length === 0) return [];
      const allRows: any[] = [];
      const chunkSize = 200;
      for (let i = 0; i < linkIds.length; i += chunkSize) {
        const chunk = linkIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("onlytraffic_orders")
          .select("tracking_link_id, total_spent, order_created_at, status")
          .in("tracking_link_id", chunk);
        if (error) throw error;
        allRows.push(...(data || []));
      }
      return allRows;
    },
    enabled: !!accountId && linkIds.length > 0,
  });

  // Determine current + previous period windows (inclusive date strings)
  const windows = useMemo(() => {
    if (snapshots.length === 0) return null;
    const allDates = Array.from(new Set(snapshots.map((s: any) => s.snapshot_date as string))).sort();
    if (allDates.length === 0) return null;
    const maxDate = allDates[allDates.length - 1];

    if (period === "since_last_sync") {
      // Current = latest snapshot date only.
      // Previous = the snapshot date immediately before the latest.
      const cur = { from: maxDate, to: maxDate, days: 1 };
      if (allDates.length < 2) {
        return { cur, prev: null as null | { from: string; to: string; days: number }, needsTwo: allDates.length < 1 };
      }
      const prevDate = allDates[allDates.length - 2];
      return { cur, prev: { from: prevDate, to: prevDate, days: 1 }, needsTwo: false };
    }

    const days = period === "7d" ? 7 : period === "14d" ? 14 : 30;
    const curFrom = subDays(new Date(maxDate + "T00:00:00Z"), days - 1).toISOString().slice(0, 10);
    const cur = { from: curFrom, to: maxDate, days };

    const prevTo = subDays(new Date(maxDate + "T00:00:00Z"), days).toISOString().slice(0, 10);
    const prevFrom = subDays(new Date(maxDate + "T00:00:00Z"), days * 2 - 1).toISOString().slice(0, 10);
    const prev = { from: prevFrom, to: prevTo, days };
    return { cur, prev, needsTwo: false };
  }, [snapshots, period]);

  // Aggregate snapshot deltas + orders into per-link, per-period totals
  const linkRows = useMemo<LinkRow[]>(() => {
    if (!windows || windows.needsTwo) return [];
    const { cur, prev } = windows;

    const emptyAgg = (): PeriodAgg => ({ subs: 0, clicks: 0, rev: 0, days: 0, spend: 0 });
    const sumsCur: Record<string, PeriodAgg> = {};
    const sumsPrev: Record<string, PeriodAgg> = {};
    const datesCur: Record<string, Set<string>> = {};
    const datesPrev: Record<string, Set<string>> = {};

    for (const r of snapshots) {
      const lid = String(r.tracking_link_id ?? "");
      if (!lid || !r.snapshot_date) continue;
      const d = r.snapshot_date as string;

      const subs = Math.max(0, Number(r.subscribers || 0));
      const clicks = Math.max(0, Number(r.clicks || 0));
      const rev = Math.max(0, Number(r.revenue || 0));

      if (d >= cur.from && d <= cur.to) {
        if (!sumsCur[lid]) { sumsCur[lid] = emptyAgg(); datesCur[lid] = new Set(); }
        sumsCur[lid].subs += subs;
        sumsCur[lid].clicks += clicks;
        sumsCur[lid].rev += rev;
        datesCur[lid].add(d);
      }
      if (prev && d >= prev.from && d <= prev.to) {
        if (!sumsPrev[lid]) { sumsPrev[lid] = emptyAgg(); datesPrev[lid] = new Set(); }
        sumsPrev[lid].subs += subs;
        sumsPrev[lid].clicks += clicks;
        sumsPrev[lid].rev += rev;
        datesPrev[lid].add(d);
      }
    }

    // OnlyTraffic spend per link per period (from order_created_at)
    for (const o of orders) {
      const lid = String(o.tracking_link_id ?? "");
      if (!lid || !o.order_created_at) continue;
      const status = String(o.status || "").toLowerCase();
      if (!["completed", "accepted", "active", "waiting"].includes(status)) continue;
      const dt = (o.order_created_at as string).slice(0, 10);
      const amt = Number(o.total_spent || 0);
      if (dt >= cur.from && dt <= cur.to) {
        if (!sumsCur[lid]) { sumsCur[lid] = emptyAgg(); datesCur[lid] = new Set(); }
        sumsCur[lid].spend += amt;
      }
      if (prev && dt >= prev.from && dt <= prev.to) {
        if (!sumsPrev[lid]) { sumsPrev[lid] = emptyAgg(); datesPrev[lid] = new Set(); }
        sumsPrev[lid].spend += amt;
      }
    }

    // Set days from distinct dates
    for (const lid of Object.keys(sumsCur)) {
      sumsCur[lid].days = datesCur[lid]?.size || 0;
    }
    for (const lid of Object.keys(sumsPrev)) {
      sumsPrev[lid].days = datesPrev[lid]?.size || 0;
    }

    const rows: LinkRow[] = [];
    for (const link of accLinks) {
      const lid = String(link.id);
      const c = sumsCur[lid];
      const p = sumsPrev[lid];
      // include if ANY period has data
      if (!c && !p) continue;
      rows.push({
        link,
        source: getEffectiveSource(link) || "Untagged",
        cur: c || emptyAgg(),
        prev: p || emptyAgg(),
      });
    }
    return rows;
  }, [accLinks, snapshots, orders, windows]);

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
    return { curSubs, prevSubs, pct: pctChange(curSubs, prevSubs), days: windows?.cur.days || 0 };
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
                Showing {sortedRows.length} of {accLinks.length} campaigns · Sorted by subs gained · Data from daily snapshots
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

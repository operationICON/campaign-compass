import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange, getSnapshotDistinctDates } from "@/lib/api";
import { format, subDays, addDays, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { isActiveAccount } from "@/lib/calc-helpers";
import { Clock, ChevronRight, CalendarDays, ChevronLeft, ArrowRight, ChevronUp, ChevronDown } from "lucide-react";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";

const COLOR_CYCLE = [
  "#0891b2", "#16a34a", "#d97706", "#7c3aed", "#ec4899",
  "#f97316", "#dc2626", "#64748b", "#0ea5e9", "#22c55e",
  "#f59e0b", "#8b5cf6", "#14b8a6", "#e879f9",
];

// ─── Inline date range picker ────────────────────────────────────────────────

const QUICK_PRESETS = [
  { label: "Today",          fn: () => ({ from: new Date(), to: new Date() }) },
  { label: "Yesterday",      fn: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
  { label: "Last 7 days",    fn: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: "Last 30 days",   fn: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "This month",     fn: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Previous month", fn: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: "This year",      fn: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

const WEEK_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function getMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(new Date(year, month, d));
  return cells;
}

function isSameDayLocal(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface DateRange { from: Date; to: Date }

function SubsDatePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [leftYear, setLeftYear] = useState(() => value.to.getFullYear());
  const [leftMonth, setLeftMonth] = useState(() => { const m = value.to.getMonth(); return m === 0 ? 0 : m - 1; });
  const [picking, setPicking] = useState<{ from: Date; to: Date | null } | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);

  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;
  const rightMonth = (leftMonth + 1) % 12;

  function prevMonth() {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1); } else setLeftMonth(m => m - 1);
  }
  function nextMonth() {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1); } else setLeftMonth(m => m + 1);
  }
  function handleDayClick(day: Date) {
    if (!picking || picking.to !== null) { setPicking({ from: day, to: null }); }
    else {
      const from = day < picking.from ? day : picking.from;
      const to = day < picking.from ? picking.from : day;
      setPicking({ from, to });
    }
  }
  function handleApply() {
    if (picking?.from && picking?.to) { onChange({ from: picking.from, to: picking.to }); setOpen(false); }
  }

  const effectiveTo = picking?.to ?? hovered ?? null;

  function renderMonth(year: number, month: number) {
    const cells = getMonthGrid(year, month);
    const today = new Date();
    return (
      <div style={{ width: 210 }}>
        <div className="text-center text-[12px] font-semibold text-foreground mb-2">
          {format(new Date(year, month, 1), "MMMM yyyy")}
        </div>
        <div className="grid grid-cols-7">
          {WEEK_DAYS.map(d => (
            <div key={d} className="text-center text-[10px] text-muted-foreground py-1 font-medium">{d}</div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} />;
            const isStart = picking?.from && isSameDayLocal(day, picking.from);
            const isEnd = effectiveTo && isSameDayLocal(day, effectiveTo);
            const inRange = picking?.from && effectiveTo
              ? day >= (picking.from < effectiveTo ? picking.from : effectiveTo) &&
                day <= (picking.from < effectiveTo ? effectiveTo : picking.from)
              : false;
            const isToday = isSameDayLocal(day, today);
            return (
              <button
                key={day.toISOString()}
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => setHovered(day)}
                className={[
                  "h-7 text-[11px] relative transition-colors",
                  isStart || isEnd ? "bg-primary text-primary-foreground rounded-full font-bold z-10" : "",
                  !isStart && !isEnd && inRange ? "bg-primary/15 text-foreground rounded-none" : "",
                  !isStart && !isEnd && !inRange ? "hover:bg-secondary rounded-full" : "",
                ].filter(Boolean).join(" ")}
              >
                {day.getDate()}
                {isToday && !isStart && !isEnd && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative" onMouseLeave={() => setHovered(null)}>
      <button
        onClick={() => { setOpen(o => !o); setPicking({ from: value.from, to: value.to }); }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary border border-border text-xs text-foreground font-medium hover:border-primary/50 transition-colors"
      >
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        {format(value.from, "MMM d")} – {format(value.to, "MMM d, yyyy")}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-2 z-50 bg-card rounded-xl p-4 shadow-2xl"
            style={{ border: "1px solid hsl(var(--border))", minWidth: 520 }}>
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1 rounded hover:bg-secondary transition-colors">
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              <div className="flex-1" />
              <button onClick={nextMonth} className="p-1 rounded hover:bg-secondary transition-colors">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex gap-5 mb-4">{renderMonth(leftYear, leftMonth)}{renderMonth(rightYear, rightMonth)}</div>
            <div className="flex items-end justify-between gap-4 pt-3 border-t border-border">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PRESETS.map(p => (
                  <button key={p.label} onClick={() => { const r = p.fn(); setPicking({ from: r.from, to: r.to }); }}
                    className="px-2 py-1 text-[11px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors border border-border">
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-[12px] border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                  Cancel
                </button>
                <button onClick={handleApply} disabled={!picking?.from || !picking?.to}
                  className="px-3 py-1.5 text-[12px] font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-colors">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return format(new Date(y, m - 1, day), "MMM d");
};
const fmtLtv = (rev: number, subs: number) =>
  subs > 0 ? `$${(rev / subs).toFixed(2)}` : "—";
const fmtCvr = (subs: number, clicks: number) =>
  clicks > 0 ? `${((subs / clicks) * 100).toFixed(1)}%` : "—";

function getSourceKey(link: any): string {
  const tag = (link.source_tag || "").trim();
  if (tag) return tag;
  const cat = (link.traffic_category || "").trim();
  if (cat) return cat;
  return "Direct / Untagged";
}

interface LinkRow {
  id: string;
  campaign_name: string;
  model: string;
  dailySubs: Record<string, number>;
  total: number;
  avgPerDay: number;
  totalRevenue: number;
  totalClicks: number;
}

interface SourceRow {
  key: string;
  color: string;
  dailySubs: Record<string, number>;
  total: number;
  avgPerDay: number;
  pct: number;
  totalRevenue: number;
  totalClicks: number;
  links: LinkRow[];
}

interface Props {
  accounts: any[];
  allLinks: any[];
}

export function DailySubsBreakdown({ accounts, allLinks }: Props) {
  const activeAccounts = accounts.filter(isActiveAccount);
  const [accountId, setAccountId] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [drawerLink, setDrawerLink] = useState<any | null>(null);
  const [sortCol, setSortCol] = useState<string>("total");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 14),
    to: new Date(),
  });

  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const allDatesInRange = useMemo(() => {
    const dates: string[] = [];
    let cur = new Date(dateRange.from);
    const end = new Date(dateRange.to);
    while (cur <= end) { dates.push(format(cur, "yyyy-MM-dd")); cur = addDays(cur, 1); }
    return dates;
  }, [dateRange]);

  const selectedAccountIds = useMemo(
    () => accountId === "all" ? activeAccounts.map((a: any) => a.id) : [accountId],
    [accountId, activeAccounts],
  );

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots_source_breakdown", accountId, dateFrom, dateTo],
    queryFn: () =>
      selectedAccountIds.length > 0
        ? getSnapshotsByDateRange({ date_from: dateFrom, date_to: dateTo, account_ids: selectedAccountIds, cols: "slim" })
        : Promise.resolve([]),
    enabled: selectedAccountIds.length > 0,
  });

  const { data: latestDates = [] } = useQuery({
    queryKey: ["snapshot_distinct_dates_1"],
    queryFn: () => getSnapshotDistinctDates(1),
    staleTime: 5 * 60 * 1000,
  });
  const lastSynced: string | null = (latestDates as string[])[0] ?? null;

  const accountMap = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a: any) => { map[a.id] = a.display_name || a.username || "Unknown"; });
    return map;
  }, [accounts]);

  const linkMetaMap = useMemo(() => {
    const map: Record<string, { sourceKey: string; campaign_name: string; model: string }> = {};
    const links = accountId === "all" ? allLinks : allLinks.filter((l: any) => l.account_id === accountId);
    for (const l of links) {
      map[String(l.id)] = {
        sourceKey: getSourceKey(l),
        campaign_name: (l.campaign_name || "").trim() || "Unnamed Campaign",
        model: accountMap[l.account_id] || "Unknown",
      };
    }
    return map;
  }, [allLinks, accountId, accountMap]);

  const activeLinksSet = useMemo(() => {
    const last5 = new Set<string>();
    for (let i = 0; i < 5; i++) last5.add(format(subDays(new Date(), i), "yyyy-MM-dd"));
    const ids = new Set<string>();
    for (const snap of snapshots as any[]) {
      const date = String(snap.snapshot_date).slice(0, 10);
      if (last5.has(date) && Number(snap.subscribers) >= 1) ids.add(String(snap.tracking_link_id));
    }
    return ids;
  }, [snapshots]);

  const { sourceRows, chartData } = useMemo(() => {
    const rows = snapshots as any[];
    if (!rows.length) return { sourceRows: [], chartData: [] };

    // Per-link: daily subs + total revenue + total clicks
    const linkStats: Record<string, { dailySubs: Record<string, number>; revenue: number; clicks: number }> = {};
    for (const snap of rows) {
      const lid = String(snap.tracking_link_id);
      const date = String(snap.snapshot_date).slice(0, 10);
      const subs = Number(snap.subscribers) || 0;
      const rev = Number(snap.revenue) || 0;
      const clk = Number(snap.clicks) || 0;
      if (!linkStats[lid]) linkStats[lid] = { dailySubs: {}, revenue: 0, clicks: 0 };
      if (subs > 0) linkStats[lid].dailySubs[date] = (linkStats[lid].dailySubs[date] || 0) + subs;
      linkStats[lid].revenue += rev;
      linkStats[lid].clicks += clk;
    }

    // Group by source key — only links with subs
    const sourceGroups: Record<string, Map<string, { campaign_name: string; model: string; dailySubs: Record<string, number>; revenue: number; clicks: number }>> = {};
    for (const [lid, stats] of Object.entries(linkStats)) {
      if (Object.keys(stats.dailySubs).length === 0) continue;
      const meta = linkMetaMap[lid] ?? { sourceKey: "Direct / Untagged", campaign_name: lid.slice(0, 8), model: "Unknown" };
      if (!sourceGroups[meta.sourceKey]) sourceGroups[meta.sourceKey] = new Map();
      sourceGroups[meta.sourceKey].set(lid, {
        campaign_name: meta.campaign_name,
        model: meta.model,
        dailySubs: stats.dailySubs,
        revenue: stats.revenue,
        clicks: stats.clicks,
      });
    }

    const sourceTotals: Record<string, number> = {};
    for (const [key, linksMap] of Object.entries(sourceGroups)) {
      let t = 0;
      for (const l of linksMap.values()) for (const s of Object.values(l.dailySubs)) t += s;
      sourceTotals[key] = t;
    }
    const grandTotal = Object.values(sourceTotals).reduce((a, b) => a + b, 0);
    const daysCount = allDatesInRange.length || 1;

    const sourceRowsRaw: SourceRow[] = Object.entries(sourceGroups)
      .sort(([ka], [kb]) => sourceTotals[kb] - sourceTotals[ka])
      .map(([key, linksMap], i) => {
        const dailySubs: Record<string, number> = {};
        const linkRows: LinkRow[] = [];
        let sourceRev = 0;
        let sourceClicks = 0;

        for (const [lid, ld] of linksMap.entries()) {
          const linkTotal = Object.values(ld.dailySubs).reduce((a, b) => a + b, 0);
          linkRows.push({
            id: lid,
            campaign_name: ld.campaign_name,
            model: ld.model,
            dailySubs: ld.dailySubs,
            total: linkTotal,
            avgPerDay: linkTotal / daysCount,
            totalRevenue: ld.revenue,
            totalClicks: ld.clicks,
          });
          for (const [date, subs] of Object.entries(ld.dailySubs)) {
            dailySubs[date] = (dailySubs[date] || 0) + subs;
          }
          sourceRev += ld.revenue;
          sourceClicks += ld.clicks;
        }
        linkRows.sort((a, b) => b.total - a.total);
        const total = sourceTotals[key];
        return {
          key,
          color: COLOR_CYCLE[i % COLOR_CYCLE.length],
          dailySubs,
          total,
          avgPerDay: total / daysCount,
          pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
          totalRevenue: sourceRev,
          totalClicks: sourceClicks,
          links: linkRows,
        };
      });

    const chartData = allDatesInRange.map(date => {
      const entry: Record<string, any> = { date };
      for (const row of sourceRowsRaw) entry[row.key] = row.dailySubs[date] || 0;
      return entry;
    });

    return { sourceRows: sourceRowsRaw, chartData };
  }, [snapshots, linkMetaMap, allDatesInRange]);

  const displayDates = useMemo(
    () => allDatesInRange.filter(d => sourceRows.some(r => (r.dailySubs[d] || 0) > 0)),
    [allDatesInRange, sourceRows],
  );

  const displayRows = useMemo(() => {
    const getVal = (row: SourceRow | LinkRow): number | string => {
      const name = "key" in row ? row.key : row.campaign_name;
      if (sortCol === "name")    return name.toLowerCase();
      if (sortCol === "total")   return row.total;
      if (sortCol === "avgPerDay") return row.avgPerDay;
      if (sortCol === "ltv")     return row.total > 0 ? row.totalRevenue / row.total : 0;
      if (sortCol === "cvr")     return row.totalClicks > 0 ? row.total / row.totalClicks : 0;
      // date column — sort by subs on that date
      return (row.dailySubs as Record<string, number>)[sortCol] || 0;
    };
    const cmp = (a: SourceRow | LinkRow, b: SourceRow | LinkRow) => {
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    };

    let rows = sourceFilter === "all" ? sourceRows : sourceRows.filter(r => r.key === sourceFilter);
    if (activeFilter === "active") {
      rows = rows
        .map(row => ({ ...row, links: row.links.filter(l => activeLinksSet.has(l.id)) }))
        .filter(row => row.links.length > 0);
    }
    return [...rows]
      .sort(cmp)
      .map(row => ({ ...row, links: [...row.links].sort(cmp) }));
  }, [sourceRows, sourceFilter, activeFilter, activeLinksSet, sortCol, sortDir]);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const toggleSource = (key: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  function openDrawer(linkId: string) {
    const full = allLinks.find((l: any) => String(l.id) === linkId);
    if (full) setDrawerLink(full);
  }

  if (!activeAccounts.length) return null;

  const selectedAccountName = activeAccounts.find((a: any) => a.id === accountId)?.display_name ?? "";

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Daily Subs by Source</h3>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-[11px] text-muted-foreground">
              New subscribers per day · {accountId === "all" ? "all models" : selectedAccountName}
            </p>
            {lastSynced && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Synced through {fmtDate(lastSynced)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Active toggle */}
          <div className="flex border border-border rounded-lg overflow-hidden">
            {(["all", "active"] as const).map(f => (
              <button key={f} onClick={() => setActiveFilter(f)}
                className={`px-2.5 py-1.5 text-xs font-medium border-r border-border last:border-r-0 transition-colors ${
                  activeFilter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                }`}>
                {f === "all" ? "All" : "Active"}
              </button>
            ))}
          </div>

          {/* Source filter */}
          {sourceRows.length > 1 && (
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="all">All Sources</option>
              {sourceRows.map(r => <option key={r.key} value={r.key}>{r.key}</option>)}
            </select>
          )}

          {/* Model selector */}
          <select value={accountId}
            onChange={e => { setAccountId(e.target.value); setSourceFilter("all"); setExpandedSources(new Set()); }}
            className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="all">All Models</option>
            {activeAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.display_name || a.username}</option>
            ))}
          </select>

          {/* Date range picker */}
          <SubsDatePicker
            value={dateRange}
            onChange={r => { setDateRange(r); setExpandedSources(new Set()); }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="h-52 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
      ) : sourceRows.length === 0 ? (
        <div className="h-52 flex items-center justify-center border border-dashed border-border rounded-lg">
          <span className="text-xs text-muted-foreground">No snapshot data for this period</span>
        </div>
      ) : (
        <>
          {/* Stacked bar chart */}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={fmtDate} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                labelFormatter={v => fmtDate(String(v))}
                formatter={(value: any, name: string) => [fmtN(Number(value)), name]}
              />
              {displayRows.map((row, i) => (
                <Bar key={row.key} dataKey={row.key} stackId="a" fill={row.color} name={row.key}
                  radius={i === displayRows.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>

          {/* Pivot table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="bg-secondary border-b border-border">
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap sticky left-0 bg-secondary z-10 cursor-pointer select-none"
                    style={{ minWidth: 200 }} onClick={() => handleSort("name")}>
                    <span className={`inline-flex items-center gap-1 ${sortCol === "name" ? "text-foreground" : "text-muted-foreground"}`}>
                      Source / Campaign
                      {sortCol === "name" ? (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
                    </span>
                  </th>
                  {([
                    { col: "total" as const,   label: "Total",   w: 62 },
                    { col: "avgPerDay" as const, label: "Avg/Day", w: 62 },
                    { col: "ltv" as const,     label: "LTV/Sub", w: 72 },
                    { col: "cvr" as const,     label: "CVR",     w: 58 },
                  ] as const).map(({ col, label, w }) => (
                    <th key={col} className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                      style={{ minWidth: w }} onClick={() => handleSort(col)}>
                      <span className={`inline-flex items-center gap-1 justify-end ${sortCol === col ? "text-foreground" : "text-muted-foreground"}`}>
                        {label}
                        {sortCol === col ? (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
                      </span>
                    </th>
                  ))}
                  {displayDates.map(d => (
                    <th key={d}
                      onClick={() => handleSort(d)}
                      className={`text-right px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap cursor-pointer select-none ${
                        d === todayStr ? "bg-primary/10" : ""
                      } ${sortCol === d ? "text-foreground" : d === todayStr ? "text-primary" : "text-muted-foreground"}`}
                      style={{ minWidth: 52 }}>
                      <span className="inline-flex items-center gap-0.5 justify-end">
                        {fmtDate(d)}
                        {sortCol === d
                          ? (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)
                          : <ChevronDown className="h-3 w-3 opacity-20" />}
                      </span>
                    </th>
                  ))}
                  <th style={{ minWidth: 24 }} />
                </tr>
              </thead>
              <tbody>
                {displayRows.map(row => (
                  <React.Fragment key={row.key}>
                    {/* Source header row — expand/collapse only */}
                    <tr className="border-b border-border hover:bg-secondary/30 cursor-pointer transition-colors"
                      onClick={() => toggleSource(row.key)}>
                      <td className="px-3 py-2.5 sticky left-0 bg-card z-10" style={{ borderRight: "1px solid hsl(var(--border))" }}>
                        <div className="flex items-center gap-2">
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0 ${expandedSources.has(row.key) ? "rotate-90" : ""}`} />
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                          <span className="text-[12px] text-foreground font-semibold">{row.key}</span>
                          <span className="text-[11px] text-muted-foreground">({row.links.length})</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] font-semibold text-foreground">{fmtN(row.total)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{row.avgPerDay.toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{fmtLtv(row.totalRevenue, row.total)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{fmtCvr(row.total, row.totalClicks)}</td>
                      {displayDates.map(d => (
                        <td key={d} className={`px-2 py-2.5 text-right font-mono text-[12px] ${d === todayStr ? "bg-primary/5" : ""}`}>
                          {row.dailySubs[d]
                            ? <span className="text-foreground">{fmtN(row.dailySubs[d])}</span>
                            : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      ))}
                      <td />
                    </tr>

                    {/* Campaign rows — clickable, open drawer */}
                    {expandedSources.has(row.key) && row.links.map(link => (
                      <tr key={link.id}
                        className="border-b border-border/50 bg-secondary/10 hover:bg-secondary/25 cursor-pointer transition-colors group"
                        onClick={() => openDrawer(link.id)}>
                        <td className="px-3 py-2 sticky left-0 bg-[hsl(var(--secondary)/0.1)] group-hover:bg-[hsl(var(--secondary)/0.25)] z-10 transition-colors" style={{ borderRight: "1px solid hsl(var(--border))" }}>
                          <div className="flex items-center gap-2 pl-7">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                            <span className="text-[11px] text-foreground font-medium truncate max-w-[130px]" title={link.campaign_name}>
                              {link.campaign_name}
                            </span>
                            {accountId === "all" && (
                              <span className="text-[10px] text-muted-foreground shrink-0">· {link.model}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-foreground">{fmtN(link.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">{link.avgPerDay.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">{fmtLtv(link.totalRevenue, link.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">{fmtCvr(link.total, link.totalClicks)}</td>
                        {displayDates.map(d => (
                          <td key={d} className={`px-2 py-2 text-right font-mono text-[11px] ${d === todayStr ? "bg-primary/5" : ""}`}>
                            {link.dailySubs[d]
                              ? <span className="text-muted-foreground">{fmtN(link.dailySubs[d])}</span>
                              : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right">
                          <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Campaign detail drawer */}
      <CampaignDetailDrawer
        campaign={drawerLink}
        onClose={() => setDrawerLink(null)}
        onCampaignUpdated={updated => setDrawerLink(updated)}
      />
    </div>
  );
}

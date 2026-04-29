import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange, getSnapshotDistinctDates } from "@/lib/api";
import { format, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { isActiveAccount } from "@/lib/calc-helpers";
import { Clock, ChevronRight } from "lucide-react";

const COLOR_CYCLE = [
  "#0891b2", "#16a34a", "#d97706", "#7c3aed", "#ec4899",
  "#f97316", "#dc2626", "#64748b", "#0ea5e9", "#22c55e",
  "#f59e0b", "#8b5cf6", "#14b8a6", "#e879f9",
];

const RANGES = [
  { label: "7D", days: 7 },
  { label: "14D", days: 14 },
  { label: "30D", days: 30 },
];

const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return format(new Date(y, m - 1, day), "MMM d");
};

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
}

interface SourceRow {
  key: string;
  color: string;
  dailySubs: Record<string, number>;
  total: number;
  avgPerDay: number;
  pct: number;
  links: LinkRow[];
}

interface Props {
  accounts: any[];
  allLinks: any[];
}

export function DailySubsBreakdown({ accounts, allLinks }: Props) {
  const activeAccounts = (accounts as any[]).filter(isActiveAccount);
  const [accountId, setAccountId] = useState<string>("all");
  const [days, setDays] = useState(14);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const dateFrom = format(subDays(new Date(), days), "yyyy-MM-dd");
  const dateTo = format(new Date(), "yyyy-MM-dd");

  // Full ordered date range for columns
  const allDatesInRange = useMemo(() => {
    const dates: string[] = [];
    for (let i = days; i >= 0; i--) {
      dates.push(format(subDays(new Date(), i), "yyyy-MM-dd"));
    }
    return dates;
  }, [days]);

  const selectedAccountIds = useMemo(
    () => accountId === "all" ? activeAccounts.map((a: any) => a.id) : [accountId],
    [accountId, activeAccounts],
  );

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots_source_breakdown", accountId, days],
    queryFn: () =>
      selectedAccountIds.length > 0
        ? getSnapshotsByDateRange({
            date_from: dateFrom,
            date_to: dateTo,
            account_ids: selectedAccountIds,
            cols: "slim",
          })
        : Promise.resolve([]),
    enabled: selectedAccountIds.length > 0,
  });

  const { data: latestDates = [] } = useQuery({
    queryKey: ["snapshot_distinct_dates_1"],
    queryFn: () => getSnapshotDistinctDates(1),
    staleTime: 5 * 60 * 1000,
  });
  const lastSynced: string | null = (latestDates as string[])[0] ?? null;

  // Build account display name map
  const accountMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accounts as any[]).forEach((a: any) => {
      map[a.id] = a.display_name || a.username || "Unknown";
    });
    return map;
  }, [accounts]);

  // Build tracking link metadata map — only for relevant accounts
  const linkMetaMap = useMemo(() => {
    const map: Record<string, { sourceKey: string; campaign_name: string; model: string }> = {};
    const links = accountId === "all"
      ? (allLinks as any[])
      : (allLinks as any[]).filter((l: any) => l.account_id === accountId);
    for (const l of links) {
      map[String(l.id)] = {
        sourceKey: getSourceKey(l),
        campaign_name: (l.campaign_name || "").trim() || "Unnamed Campaign",
        model: accountMap[l.account_id] || "Unknown",
      };
    }
    return map;
  }, [allLinks, accountId, accountMap]);

  // Core pivot: build source rows + chart data
  const { sourceRows, chartData } = useMemo(() => {
    const rows = snapshots as any[];
    if (!rows.length) return { sourceRows: [], chartData: [] };

    // Step 1: aggregate subs per link per date
    const linkDateSubs: Record<string, Record<string, number>> = {};
    for (const snap of rows) {
      const lid = String(snap.tracking_link_id);
      const date = String(snap.snapshot_date).slice(0, 10);
      const subs = Number(snap.subscribers) || 0;
      if (subs === 0) continue;
      if (!linkDateSubs[lid]) linkDateSubs[lid] = {};
      linkDateSubs[lid][date] = (linkDateSubs[lid][date] || 0) + subs;
    }

    // Step 2: group links by source key
    const sourceGroups: Record<string, Map<string, { campaign_name: string; model: string; dailySubs: Record<string, number> }>> = {};
    for (const [lid, dateSubs] of Object.entries(linkDateSubs)) {
      const meta = linkMetaMap[lid] ?? {
        sourceKey: "Direct / Untagged",
        campaign_name: lid.slice(0, 8),
        model: "Unknown",
      };
      if (!sourceGroups[meta.sourceKey]) sourceGroups[meta.sourceKey] = new Map();
      if (!sourceGroups[meta.sourceKey].has(lid)) {
        sourceGroups[meta.sourceKey].set(lid, {
          campaign_name: meta.campaign_name,
          model: meta.model,
          dailySubs: {},
        });
      }
      const entry = sourceGroups[meta.sourceKey].get(lid)!;
      for (const [date, subs] of Object.entries(dateSubs)) {
        entry.dailySubs[date] = (entry.dailySubs[date] || 0) + subs;
      }
    }

    // Step 3: compute totals per source (for ordering and pct)
    const sourceTotals: Record<string, number> = {};
    for (const [key, linksMap] of Object.entries(sourceGroups)) {
      let t = 0;
      for (const link of linksMap.values()) {
        for (const s of Object.values(link.dailySubs)) t += s;
      }
      sourceTotals[key] = t;
    }
    const grandTotal = Object.values(sourceTotals).reduce((a, b) => a + b, 0);
    const daysCount = allDatesInRange.length || 1;

    // Step 4: build SourceRow[]
    const sourceRowsRaw: SourceRow[] = Object.entries(sourceGroups)
      .sort(([ka], [kb]) => sourceTotals[kb] - sourceTotals[ka])
      .map(([key, linksMap], i) => {
        const dailySubs: Record<string, number> = {};
        const linkRows: LinkRow[] = [];

        for (const [lid, linkData] of linksMap.entries()) {
          const linkTotal = Object.values(linkData.dailySubs).reduce((a, b) => a + b, 0);
          linkRows.push({
            id: lid,
            campaign_name: linkData.campaign_name,
            model: linkData.model,
            dailySubs: linkData.dailySubs,
            total: linkTotal,
            avgPerDay: linkTotal / daysCount,
          });
          for (const [date, subs] of Object.entries(linkData.dailySubs)) {
            dailySubs[date] = (dailySubs[date] || 0) + subs;
          }
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
          links: linkRows,
        };
      });

    // Step 5: chart data — one entry per date
    const chartData = allDatesInRange.map(date => {
      const entry: Record<string, any> = { date };
      for (const row of sourceRowsRaw) {
        entry[row.key] = row.dailySubs[date] || 0;
      }
      return entry;
    });

    return { sourceRows: sourceRowsRaw, chartData };
  }, [snapshots, linkMetaMap, allDatesInRange]);

  // Apply source filter
  const displayRows = useMemo(
    () => sourceFilter === "all" ? sourceRows : sourceRows.filter(r => r.key === sourceFilter),
    [sourceRows, sourceFilter],
  );

  const toggleSource = (key: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

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
          {/* Source filter — only show when data loaded */}
          {sourceRows.length > 1 && (
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Sources</option>
              {sourceRows.map(r => (
                <option key={r.key} value={r.key}>{r.key}</option>
              ))}
            </select>
          )}

          {/* Model selector */}
          <select
            value={accountId}
            onChange={e => { setAccountId(e.target.value); setSourceFilter("all"); setExpandedSources(new Set()); }}
            className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Models</option>
            {activeAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.display_name || a.username}</option>
            ))}
          </select>

          {/* Period */}
          <div className="flex border border-border rounded-lg overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => { setDays(r.days); setExpandedSources(new Set()); }}
                className={`px-2.5 py-1.5 text-xs font-medium border-r border-border last:border-r-0 transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
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
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={fmtDate}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "hsl(var(--foreground))",
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                labelFormatter={v => fmtDate(String(v))}
                formatter={(value: any, name: string) => [fmtN(Number(value)), name]}
              />
              {displayRows.map((row, i) => (
                <Bar
                  key={row.key}
                  dataKey={row.key}
                  stackId="a"
                  fill={row.color}
                  name={row.key}
                  radius={i === displayRows.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          {/* Pivot table — horizontally scrollable */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="bg-secondary border-b border-border">
                  {/* Fixed columns */}
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap" style={{ minWidth: 200 }}>
                    Source / Campaign
                  </th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap" style={{ minWidth: 70 }}>Total</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap" style={{ minWidth: 70 }}>Avg/Day</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap" style={{ minWidth: 60 }}>Share</th>
                  {/* Date columns */}
                  {allDatesInRange.map(d => (
                    <th
                      key={d}
                      className="text-right px-2 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                      style={{ minWidth: 52 }}
                    >
                      {fmtDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map(row => (
                  <React.Fragment key={row.key}>
                    {/* Source row */}
                    <tr
                      className="border-b border-border hover:bg-secondary/30 cursor-pointer transition-colors"
                      onClick={() => toggleSource(row.key)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <ChevronRight
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0 ${expandedSources.has(row.key) ? "rotate-90" : ""}`}
                          />
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                          <span className="text-[12px] text-foreground font-semibold">{row.key}</span>
                          <span className="text-[11px] text-muted-foreground">({row.links.length})</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] font-semibold text-foreground">{fmtN(row.total)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{row.avgPerDay.toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">{row.pct.toFixed(1)}%</td>
                      {allDatesInRange.map(d => (
                        <td key={d} className="px-2 py-2.5 text-right font-mono text-[12px]">
                          {row.dailySubs[d]
                            ? <span className="text-foreground">{fmtN(row.dailySubs[d])}</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </td>
                      ))}
                    </tr>

                    {/* Campaign rows — shown when expanded */}
                    {expandedSources.has(row.key) && row.links.map(link => (
                      <tr key={link.id} className="border-b border-border/50 bg-secondary/10 hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2 text-right text-[11px] text-muted-foreground/40">—</td>
                        {allDatesInRange.map(d => (
                          <td key={d} className="px-2 py-2 text-right font-mono text-[11px]">
                            {link.dailySubs[d]
                              ? <span className="text-muted-foreground">{fmtN(link.dailySubs[d])}</span>
                              : <span className="text-muted-foreground/30">—</span>
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

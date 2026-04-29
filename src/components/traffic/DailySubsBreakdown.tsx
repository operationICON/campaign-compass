import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange } from "@/lib/api";
import { format, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { isActiveAccount } from "@/lib/calc-helpers";

const COLOR_CYCLE = ["#0891b2", "#16a34a", "#d97706", "#7c3aed", "#ec4899", "#f97316", "#dc2626", "#64748b"];

const RANGES = [
  { label: "7D", days: 7 },
  { label: "14D", days: 14 },
  { label: "30D", days: 30 },
];

const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtDate = (d: string) => {
  const parts = d.split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return format(date, "MMM d");
};

interface Props {
  accounts: any[];
  allLinks: any[];
}

export function DailySubsBreakdown({ accounts, allLinks }: Props) {
  const activeAccounts = (accounts as any[]).filter(isActiveAccount);
  const [accountId, setAccountId] = useState<string>(() => activeAccounts[0]?.id || "");
  const [days, setDays] = useState(14);

  const dateFrom = format(subDays(new Date(), days), "yyyy-MM-dd");
  const dateTo = format(new Date(), "yyyy-MM-dd");

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots_source_breakdown", accountId, days],
    queryFn: () =>
      accountId
        ? getSnapshotsByDateRange({ date_from: dateFrom, date_to: dateTo, account_ids: [accountId], cols: "slim" })
        : Promise.resolve([]),
    enabled: !!accountId,
  });

  // tracking_link_id → display label (source_tag || campaign_name || "Untagged")
  const sourceLookup = useMemo(() => {
    const map: Record<string, string> = {};
    (allLinks as any[]).forEach((l: any) => {
      map[String(l.id)] = (l.source_tag || "").trim() || (l.campaign_name || "").trim() || "Untagged";
    });
    return map;
  }, [allLinks]);

  // Pivot snapshots: date → { [source]: subs }
  const { chartData, sortedSources } = useMemo(() => {
    const rows = snapshots as any[];
    if (!rows.length) return { chartData: [], sortedSources: [] };

    const dateMap: Record<string, Record<string, number>> = {};
    const sourceTotals: Record<string, number> = {};

    for (const snap of rows) {
      const date = String(snap.snapshot_date).slice(0, 10);
      const source = sourceLookup[String(snap.tracking_link_id)] || "Untagged";
      const subs = Number(snap.subscribers) || 0;
      if (!dateMap[date]) dateMap[date] = {};
      dateMap[date][source] = (dateMap[date][source] || 0) + subs;
      sourceTotals[source] = (sourceTotals[source] || 0) + subs;
    }

    // Sort sources by total subs desc, so the chart legend is ordered by importance
    const sortedSources = Object.keys(sourceTotals).sort((a, b) => sourceTotals[b] - sourceTotals[a]);

    const sortedDates = Object.keys(dateMap).sort();
    const chartData = sortedDates.map(date => {
      const entry: Record<string, any> = { date };
      for (const s of sortedSources) entry[s] = dateMap[date][s] || 0;
      return entry;
    });

    return { chartData, sortedSources };
  }, [snapshots, sourceLookup]);

  // Summary table rows
  const summary = useMemo(() => {
    const grandTotal = chartData.reduce((sum, row) => {
      return sum + sortedSources.reduce((s, src) => s + (row[src] || 0), 0);
    }, 0);
    return sortedSources.map((name, i) => {
      const total = chartData.reduce((s, row) => s + (row[name] || 0), 0);
      return {
        name,
        total,
        dailyAvg: chartData.length > 0 ? total / chartData.length : 0,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        color: COLOR_CYCLE[i % COLOR_CYCLE.length],
      };
    });
  }, [chartData, sortedSources]);

  if (!activeAccounts.length) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Daily Subs by Source</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">New subscribers per day, broken down by traffic source</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {activeAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.display_name || a.username}</option>
            ))}
          </select>
          <div className="flex">
            {RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setDays(r.days)}
                className={`px-2.5 py-1.5 text-xs font-medium border-y border-r first:border-l first:rounded-l-lg last:rounded-r-lg transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-muted-foreground border-border hover:bg-secondary/80"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center border border-dashed border-border rounded-lg">
          <span className="text-xs text-muted-foreground">No snapshot data for this period</span>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
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
                labelFormatter={(v) => fmtDate(String(v))}
                formatter={(value: any, name: string) => [fmtN(Number(value)), name]}
              />
              {sortedSources.map((s, i) => (
                <Bar
                  key={s}
                  dataKey={s}
                  stackId="a"
                  fill={COLOR_CYCLE[i % COLOR_CYCLE.length]}
                  name={s}
                  radius={i === sortedSources.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Avg/Day</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map(row => (
                  <tr key={row.name} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="text-[12px] text-foreground font-medium truncate max-w-[200px]">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] text-foreground">{fmtN(row.total)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] text-muted-foreground">{row.dailyAvg.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] text-muted-foreground">{row.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

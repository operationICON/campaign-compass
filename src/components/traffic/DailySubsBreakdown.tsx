import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange, getSnapshotDistinctDates } from "@/lib/api";
import { format, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { isActiveAccount } from "@/lib/calc-helpers";
import { Clock } from "lucide-react";

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

type GroupBy = "source" | "campaign";

const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return format(new Date(y, m - 1, day), "MMM d");
};

interface Props {
  accounts: any[];
  allLinks: any[];
}

export function DailySubsBreakdown({ accounts, allLinks }: Props) {
  const activeAccounts = (accounts as any[]).filter(isActiveAccount);
  const [accountId, setAccountId] = useState<string>("all");
  const [days, setDays] = useState(14);
  const [groupBy, setGroupBy] = useState<GroupBy>("source");

  const dateFrom = format(subDays(new Date(), days), "yyyy-MM-dd");
  const dateTo = format(new Date(), "yyyy-MM-dd");

  const selectedAccountIds = accountId === "all"
    ? activeAccounts.map((a: any) => a.id)
    : [accountId];

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots_source_breakdown", accountId, days],
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

  // Build lookup: tracking_link_id → { label, source, model }
  const linkLookup = useMemo(() => {
    const accountMap: Record<string, string> = {};
    (accounts as any[]).forEach((a: any) => {
      accountMap[a.id] = a.display_name || a.username || "Unknown";
    });
    const map: Record<string, { label: string; source: string; model: string }> = {};
    (allLinks as any[]).forEach((l: any) => {
      const source = (l.source_tag || "").trim() || "Untagged";
      const campaign = (l.campaign_name || "").trim() || "Unnamed";
      const model = accountMap[l.account_id] || "Unknown";
      map[String(l.id)] = {
        label: groupBy === "campaign" ? campaign : source,
        source,
        model,
      };
    });
    return map;
  }, [allLinks, accounts, groupBy]);

  // Pivot: date → { [label]: subs }
  const { chartData, sortedLabels } = useMemo(() => {
    const rows = snapshots as any[];
    if (!rows.length) return { chartData: [], sortedLabels: [] };

    const dateMap: Record<string, Record<string, number>> = {};
    const labelTotals: Record<string, number> = {};

    for (const snap of rows) {
      const date = String(snap.snapshot_date).slice(0, 10);
      const info = linkLookup[String(snap.tracking_link_id)];
      const label = info?.label || "Untagged";
      const subs = Number(snap.subscribers) || 0;
      if (!dateMap[date]) dateMap[date] = {};
      dateMap[date][label] = (dateMap[date][label] || 0) + subs;
      labelTotals[label] = (labelTotals[label] || 0) + subs;
    }

    const sortedLabels = Object.keys(labelTotals).sort((a, b) => labelTotals[b] - labelTotals[a]);
    const sortedDates = Object.keys(dateMap).sort();
    const chartData = sortedDates.map(date => {
      const entry: Record<string, any> = { date };
      for (const lbl of sortedLabels) entry[lbl] = dateMap[date][lbl] || 0;
      return entry;
    });

    return { chartData, sortedLabels };
  }, [snapshots, linkLookup]);

  // Summary table
  const summary = useMemo(() => {
    const grandTotal = chartData.reduce(
      (sum, row) => sum + sortedLabels.reduce((s, lbl) => s + (row[lbl] || 0), 0),
      0,
    );
    // For campaign mode: grab source + model for each label from linkLookup
    const labelMeta: Record<string, { source: string; model: string }> = {};
    if (groupBy === "campaign") {
      for (const info of Object.values(linkLookup)) {
        if (!labelMeta[info.label]) labelMeta[info.label] = { source: info.source, model: info.model };
      }
    }
    return sortedLabels.map((name, i) => {
      const total = chartData.reduce((s, row) => s + (row[name] || 0), 0);
      return {
        name,
        total,
        dailyAvg: chartData.length > 0 ? total / chartData.length : 0,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        color: COLOR_CYCLE[i % COLOR_CYCLE.length],
        source: labelMeta[name]?.source ?? "",
        model: labelMeta[name]?.model ?? "",
      };
    });
  }, [chartData, sortedLabels, groupBy, linkLookup]);

  if (!activeAccounts.length) return null;

  const showSourceCol = groupBy === "campaign";
  const showModelCol = groupBy === "campaign" && accountId === "all";

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Daily Subs by {groupBy === "source" ? "Source" : "Campaign"}
          </h3>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-[11px] text-muted-foreground">
              New subscribers per day · {accountId === "all" ? "all models" : activeAccounts.find((a: any) => a.id === accountId)?.display_name ?? ""}
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
          {/* Group by */}
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setGroupBy("source")}
              className={`px-2.5 py-1.5 text-xs font-medium border-r border-border transition-colors ${
                groupBy === "source"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              Source
            </button>
            <button
              onClick={() => setGroupBy("campaign")}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                groupBy === "campaign"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              Campaign
            </button>
          </div>

          {/* Model selector */}
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Models</option>
            {activeAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.display_name || a.username}</option>
            ))}
          </select>

          {/* Range */}
          <div className="flex border border-border rounded-lg overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setDays(r.days)}
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
      ) : chartData.length === 0 ? (
        <div className="h-52 flex items-center justify-center border border-dashed border-border rounded-lg">
          <span className="text-xs text-muted-foreground">No snapshot data for this period</span>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
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
              {sortedLabels.map((lbl, i) => (
                <Bar
                  key={lbl}
                  dataKey={lbl}
                  stackId="a"
                  fill={COLOR_CYCLE[i % COLOR_CYCLE.length]}
                  name={lbl}
                  radius={i === sortedLabels.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {groupBy === "campaign" ? "Campaign" : "Source"}
                  </th>
                  {showSourceCol && (
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                  )}
                  {showModelCol && (
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Model</th>
                  )}
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Avg/Day</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map(row => (
                  <tr key={row.name} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="text-[12px] text-foreground font-medium truncate">{row.name}</span>
                      </div>
                    </td>
                    {showSourceCol && (
                      <td className="px-3 py-2 text-[12px] text-muted-foreground">
                        <span className="truncate block max-w-[140px]">{row.source || "—"}</span>
                      </td>
                    )}
                    {showModelCol && (
                      <td className="px-3 py-2 text-[12px] text-muted-foreground">
                        <span className="truncate block max-w-[120px]">{row.model || "—"}</span>
                      </td>
                    )}
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

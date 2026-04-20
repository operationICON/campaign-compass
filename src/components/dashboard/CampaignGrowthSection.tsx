import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

/**
 * Growth section for the Campaign Detail Drawer.
 *
 * IMPORTANT: daily_snapshots stores DAILY DELTAS (incremental gains per day).
 * Same logic as GrowthTab.
 *
 * "Since last sync":
 *   current  = latest snapshot_date for this tracking_link_id
 *   previous = second latest snapshot_date for this tracking_link_id
 *   subs/rev/clicks gained = the value on the latest date
 *
 * Charts plot per-snapshot-date deltas directly (no cumulative diffing).
 */

type GrowthPeriod = "since_last_sync" | "7d" | "14d" | "30d";

// Extended ranges hidden until daily sync is established (logic preserved).
const PERIOD_OPTIONS: { key: GrowthPeriod; label: string }[] = [
  { key: "since_last_sync", label: "Since last sync" },
  // { key: "7d", label: "Last 7 days" },
  // { key: "14d", label: "Last 14 days" },
  // { key: "30d", label: "Last 30 days" },
];

const fmtCurrency = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number) => v.toLocaleString();

function pctChange(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function TrendChip({ value }: { value: number | null }) {
  if (value === null || !isFinite(value)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const up = value > 0;
  const cls = up ? "text-emerald-500" : "text-destructive";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium text-[11px] ${cls}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

interface Snap {
  snapshot_date: string;
  subscribers: number;
  clicks: number;
  revenue: number;
}

export function CampaignGrowthSection({ trackingLinkId }: { trackingLinkId: string }) {
  const [period, setPeriod] = useState<GrowthPeriod>("since_last_sync");

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["campaign_drawer_snapshots", trackingLinkId],
    enabled: !!trackingLinkId,
    queryFn: async (): Promise<Snap[]> => {
      const allRows: any[] = [];
      let from = 0;
      const batch = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("daily_snapshots")
          .select("snapshot_date, subscribers, clicks, revenue")
          .eq("tracking_link_id", trackingLinkId)
          .order("snapshot_date", { ascending: true })
          .range(from, from + batch - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batch) break;
        from += batch;
      }
      return allRows
        .filter((r) => r.snapshot_date)
        .map((r) => ({
          snapshot_date: r.snapshot_date as string,
          subscribers: Math.max(0, Number(r.subscribers || 0)),
          clicks: Math.max(0, Number(r.clicks || 0)),
          revenue: Math.max(0, Number(r.revenue || 0)),
        }));
    },
  });

  const dedupedByDate = useMemo<Snap[]>(() => {
    // If multiple rows per snapshot_date, sum them.
    const map = new Map<string, Snap>();
    for (const s of snapshots) {
      const ex = map.get(s.snapshot_date);
      if (ex) {
        ex.subscribers += s.subscribers;
        ex.clicks += s.clicks;
        ex.revenue += s.revenue;
      } else {
        map.set(s.snapshot_date, { ...s });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.snapshot_date.localeCompare(b.snapshot_date)
    );
  }, [snapshots]);

  const computed = useMemo(() => {
    if (dedupedByDate.length === 0) return null;

    let curSubs = 0, curClicks = 0, curRev = 0, days = 1;
    let prevSubs = 0, prevClicks = 0, prevRev = 0;
    let hasPrev = false;

    if (period === "since_last_sync") {
      const latest = dedupedByDate[dedupedByDate.length - 1];
      curSubs = latest.subscribers;
      curClicks = latest.clicks;
      curRev = latest.revenue;
      days = 1;
      if (dedupedByDate.length >= 2) {
        const prev = dedupedByDate[dedupedByDate.length - 2];
        prevSubs = prev.subscribers;
        prevClicks = prev.clicks;
        prevRev = prev.revenue;
        hasPrev = true;
      }
    } else {
      const n = period === "7d" ? 7 : period === "14d" ? 14 : 30;
      const cur = dedupedByDate.slice(-n);
      const prev = dedupedByDate.slice(-2 * n, -n);
      days = Math.max(1, cur.length);
      for (const s of cur) {
        curSubs += s.subscribers;
        curClicks += s.clicks;
        curRev += s.revenue;
      }
      for (const s of prev) {
        prevSubs += s.subscribers;
        prevClicks += s.clicks;
        prevRev += s.revenue;
      }
      hasPrev = prev.length > 0;
    }

    const subsTrend = hasPrev ? pctChange(curSubs, prevSubs) : null;
    const revTrend = hasPrev ? pctChange(curRev, prevRev) : null;
    const clicksTrend = hasPrev ? pctChange(curClicks, prevClicks) : null;
    const cvr = curClicks > 0 ? (curSubs / curClicks) * 100 : null;
    const subsPerDay = days > 0 ? curSubs / days : 0;
    const revPerDay = days > 0 ? curRev / days : 0;

    return {
      curSubs, curClicks, curRev,
      subsTrend, revTrend, clicksTrend,
      cvr, subsPerDay, revPerDay, days, hasPrev,
    };
  }, [dedupedByDate, period]);

  const chartData = useMemo(
    () =>
      dedupedByDate.map((s) => ({
        date: s.snapshot_date.slice(5), // MM-DD
        subs: s.subscribers,
        revenue: Number(s.revenue.toFixed(2)),
      })),
    [dedupedByDate]
  );

  return (
    <div className="px-6 pb-3">
      <div className="border-t border-border pt-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
            Growth
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_OPTIONS.map((opt) => {
              const active = period === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setPeriod(opt.key)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
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
        </div>

        {isLoading ? (
          <p className="text-[11px] text-muted-foreground italic py-3">Loading growth data…</p>
        ) : !computed ? (
          <p className="text-[11px] text-muted-foreground italic py-3">
            Growth data available after next sync.
          </p>
        ) : (
          <>
            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {/* Subs Gained */}
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  Subs Gained
                </p>
                <p className="text-2xl font-bold font-mono text-emerald-500 leading-tight">
                  {computed.curSubs > 0 ? `+${fmtNum(computed.curSubs)}` : fmtNum(computed.curSubs)}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <TrendChip value={computed.subsTrend} />
                  <span className="text-[10px] text-muted-foreground">vs prev</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {computed.subsPerDay.toFixed(1)}/day
                </p>
              </div>

              {/* Revenue Gained */}
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  Revenue Gained
                </p>
                <p className="text-2xl font-bold font-mono text-primary leading-tight">
                  {fmtCurrency(computed.curRev)}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <TrendChip value={computed.revTrend} />
                  <span className="text-[10px] text-muted-foreground">vs prev</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {fmtCurrency(computed.revPerDay)}/day
                </p>
              </div>

              {/* Clicks Gained */}
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  Clicks Gained
                </p>
                <p className="text-2xl font-bold font-mono text-foreground leading-tight">
                  {fmtNum(computed.curClicks)}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <TrendChip value={computed.clicksTrend} />
                  <span className="text-[10px] text-muted-foreground">vs prev</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  CVR {computed.cvr != null ? `${computed.cvr.toFixed(1)}%` : "—"}
                </p>
              </div>
            </div>

            {/* CHARTS */}
            {chartData.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-secondary/30 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 px-1">
                    Subscribers over time
                  </p>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                      />
                      <Bar dataKey="subs" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-secondary/30 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 px-1">
                    Revenue over time
                  </p>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                        formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Revenue"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 2, fill: "hsl(var(--primary))" }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

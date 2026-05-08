import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, eachDayOfInterval } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  getAccounts, getTransactionDaily,
  getOnlytrafficOrders, getTrackingLinks,
} from "@/lib/api";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar, Cell,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, Plus } from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:      "#0a0b0e",
  card:    "#111318",
  cardAlt: "#0d0e13",
  border:  "#1c1f2b",
  accent:  "#ef4444",
  green:   "#22c55e",
  red:     "#ef4444",
  muted:   "#4b5568",
  white:   "#f1f5f9",
  dim:     "#6b7280",
  dark:    "#1e2333",
} as const;

const MODEL_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#06b6d4",
  "#3b82f6","#8b5cf6","#ec4899","#14b8a6","#84cc16",
];

// ── Utilities ──────────────────────────────────────────────────────────────────
function fmtD(d: Date) { return format(d, "yyyy-MM-dd"); }
function fmtMoney(n: number) {
  if (!isFinite(n)) return "$0.00";
  const neg = n < 0;
  return (neg ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(n: number) {
  if (!isFinite(n) || n === 0) return "$0";
  const neg = n < 0; const abs = Math.abs(n);
  const s = neg ? "-$" : "$";
  if (abs >= 1_000_000) return `${s}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${s}${(abs / 1_000).toFixed(1)}K`;
  return `${s}${abs.toFixed(0)}`;
}
function pctDelta(curr: number, prev: number): number | null {
  if (!prev || !isFinite(prev)) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
function computeDateRange(isAllTime: boolean, custom: { from: Date; to: Date } | null) {
  if (isAllTime) return { from: null as string | null, to: null as string | null };
  if (custom)    return { from: fmtD(custom.from), to: fmtD(custom.to) };
  return { from: null as string | null, to: null as string | null };
}
function prevRange(from: string, to: string) {
  const f = new Date(from), t = new Date(to);
  const days = Math.ceil((t.getTime() - f.getTime()) / 86400000) + 1;
  return { prevFrom: fmtD(subDays(f, days)), prevTo: fmtD(subDays(f, 1)) };
}

// ── Delta badge ────────────────────────────────────────────────────────────────
function Delta({ pct, size = "md" }: { pct: number | null; size?: "sm" | "md" }) {
  if (pct === null || !isFinite(pct)) return null;
  const up = pct >= 0;
  const cls = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold rounded-full font-mono ${cls}`}
      style={{ background: up ? `${T.green}20` : `${T.red}20`, color: up ? T.green : T.red }}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Mini sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ data, color = T.green }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return <div style={{ width: 80, height: 36 }} />;
  const pts = data.map((value, index) => ({ index, value }));
  return (
    <div style={{ width: 80, height: 36 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Model card ─────────────────────────────────────────────────────────────────
function ModelCard({
  name, avatar, revenue, pct, spark, isAdd,
}: {
  name?: string; avatar?: string; revenue?: number; pct?: number | null;
  spark?: number[]; color?: string; isAdd?: boolean;
}) {
  if (isAdd) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-5 cursor-pointer transition-opacity hover:opacity-70"
        style={{ background: "transparent", border: `1.5px dashed ${T.border}`, borderRadius: "0.875rem", minWidth: 160 }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: T.dark }}>
          <Plus className="w-4 h-4" style={{ color: T.dim }} />
        </div>
        <p className="text-xs text-center leading-snug" style={{ color: T.dim }}>
          Add another<br />model to track
        </p>
      </div>
    );
  }
  const initials = (name || "?").slice(0, 2).toUpperCase();
  const isPos = (pct ?? 0) >= 0;
  return (
    <div className="p-5 flex flex-col gap-4 relative overflow-hidden"
      style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "0.875rem", minWidth: 160 }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `radial-gradient(${T.border} 1px, transparent 1px)`, backgroundSize: "20px 20px", opacity: 0.4 }} />
      <div className="relative flex items-center gap-2">
        {avatar
          ? <img src={avatar} className="w-7 h-7 rounded-full object-cover shrink-0" alt="" />
          : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: T.dark, color: T.dim }}>{initials}</div>}
        <span className="text-sm font-semibold truncate" style={{ color: T.white }}>{name}</span>
      </div>
      <div className="relative">
        <p className="text-2xl font-bold font-mono leading-none" style={{ color: T.white }}>{fmtShort(revenue ?? 0)}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <Delta pct={pct ?? null} size="sm" />
          <span className="text-[10px]" style={{ color: T.muted }}>vs prev</span>
        </div>
      </div>
      <div className="relative self-end">
        <Sparkline data={spark ?? []} color={isPos ? T.green : T.red} />
      </div>
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-lg text-xs shadow-xl"
      style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.accent}` }}>
      <p className="mb-1" style={{ color: T.muted }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-mono font-semibold" style={{ color: p.color || T.white }}>
          {p.name}: {fmtMoney(p.value)}
        </p>
      ))}
    </div>
  );
}

// ── Revenue heatmap ────────────────────────────────────────────────────────────
function RevenueHeatmap({ data }: { data: Array<{ date: string; value: number }> }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const weeks: typeof data[] = [];
  for (let i = 0; i < data.length; i += 7) weeks.push(data.slice(i, i + 7));
  return (
    <div className="flex gap-1">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {week.map((d, di) => {
            const intensity = max > 0 ? d.value / max : 0;
            const alpha = 0.12 + intensity * 0.88;
            return (
              <div key={di} title={`${d.date}: ${fmtMoney(d.value)}`}
                className="w-3 h-3 rounded-sm cursor-default"
                style={{ background: `rgba(239,68,68,${alpha})` }} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Revenue flow chart (Sankey-style SVG) ─────────────────────────────────────
function RevenueFlowChart({
  models, attributed, unattributed, total,
}: {
  models: Array<{ name: string; value: number; color: string }>;
  attributed: number; unattributed: number; total: number;
}) {
  if (!total) return <div className="h-48 flex items-center justify-center text-sm" style={{ color: T.muted }}>No data</div>;
  const leftH = 160;
  return (
    <div className="relative w-full h-48">
      <svg width="100%" height="100%" viewBox="0 0 280 180" preserveAspectRatio="xMidYMid meet">
        {(() => {
          let y = 10;
          return models.filter(m => m.value > 0).slice(0, 5).map((m, i) => {
            const h = Math.max(6, (m.value / total) * leftH);
            const cy = y + h / 2;
            const block = (
              <g key={i}>
                <rect x={0} y={y} width={50} height={h} rx={3} fill={m.color} opacity={0.85} />
                <text x={56} y={cy + 3} fontSize={8} fill={T.dim}>
                  {m.name.slice(0, 12)}{m.name.length > 12 ? "…" : ""}
                </text>
                <path
                  d={`M 50 ${cy} C 130 ${cy} 130 90 180 90`}
                  stroke={m.color} strokeWidth={Math.max(1.5, h * 0.35)} fill="none" opacity={0.25}
                />
              </g>
            );
            y += h + 5;
            return block;
          });
        })()}
        <rect x={180} y={10} width={40} height={leftH} rx={4} fill={T.accent} opacity={0.1} />
        <rect x={180} y={10} width={40} height={leftH} rx={4} stroke={T.accent} strokeWidth={1} fill="none" />
        <text x={200} y={97} fontSize={8} fill={T.white} textAnchor="middle">Total</text>
        {[
          { label: "Campaigns", value: attributed,   y: 20,  color: T.accent },
          { label: "Direct",    value: unattributed, y: 110, color: T.dark   },
        ].map((seg, i) => {
          const h = Math.max(5, (seg.value / total) * (leftH - 20));
          return (
            <g key={i}>
              <path
                d={`M 220 90 C 245 90 245 ${seg.y + h / 2} 260 ${seg.y + h / 2}`}
                stroke={seg.color} strokeWidth={Math.max(1.5, h * 0.3)} fill="none" opacity={0.5}
              />
              <rect x={260} y={seg.y} width={18} height={Math.max(5, h)} rx={3} fill={seg.color} opacity={0.85} />
              <text x={240} y={seg.y + h / 2 + 3} fontSize={7.5} fill={T.dim}>{seg.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const [isAllTime, setIsAllTime] = useState(true);
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | null>(null);

  const { from: dateFrom, to: dateTo } = useMemo(
    () => computeDateRange(isAllTime, customRange),
    [isAllTime, customRange]
  );

  // For comparison period — fall back to last 30 vs 30 when all-time
  const { prevFrom, prevTo } = useMemo(() => {
    if (dateFrom && dateTo) return prevRange(dateFrom, dateTo);
    const to   = fmtD(new Date());
    const from = fmtD(subDays(new Date(), 30));
    return prevRange(from, to);
  }, [dateFrom, dateTo]);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"], queryFn: getAccounts, staleTime: 5 * 60_000,
  });

  const { data: links = [] } = useQuery({
    queryKey: ["tracking_links"], queryFn: () => getTrackingLinks(), staleTime: 5 * 60_000,
  });

  const { data: dailyTx = [], isLoading: txLoading } = useQuery({
    queryKey: ["ov2_tx", dateFrom, dateTo],
    queryFn: () => getTransactionDaily({ date_from: dateFrom!, date_to: dateTo!, account_ids: [] }),
    enabled: !isAllTime && !!dateFrom && !!dateTo,
    staleTime: 5 * 60_000,
  });

  const { data: prevDailyTx = [] } = useQuery({
    queryKey: ["ov2_prev_tx", prevFrom, prevTo],
    queryFn: () => getTransactionDaily({ date_from: prevFrom, date_to: prevTo, account_ids: [] }),
    enabled: !!prevFrom && !!prevTo,
    staleTime: 5 * 60_000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["ov2_orders", dateFrom, dateTo],
    queryFn: () => getOnlytrafficOrders({ date_from: dateFrom ?? undefined, date_to: dateTo ?? undefined, statuses: ["completed","accepted","active","waiting"] }),
    staleTime: 5 * 60_000,
  });

  // ── Derived metrics ──────────────────────────────────────────────────────────

  // Revenue by account — all-time uses ltv_total, period uses daily tx
  const revByAcct = useMemo(() => {
    const map: Record<string, number> = {};
    if (isAllTime) {
      (accounts as any[]).forEach((a: any) => { map[a.id] = Number(a.ltv_total || 0); });
    } else {
      (dailyTx as any[]).forEach((tx: any) => {
        map[tx.account_id] = (map[tx.account_id] || 0) + Number(tx.revenue || 0);
      });
    }
    return map;
  }, [accounts, dailyTx, isAllTime]);

  const prevRevByAcct = useMemo(() => {
    const map: Record<string, number> = {};
    (prevDailyTx as any[]).forEach((tx: any) => {
      map[tx.account_id] = (map[tx.account_id] || 0) + Number(tx.revenue || 0);
    });
    return map;
  }, [prevDailyTx]);

  const totalRevenue = useMemo(() =>
    Object.values(revByAcct).reduce((s, v) => s + v, 0), [revByAcct]);

  const prevRevenue = useMemo(() =>
    Object.values(prevRevByAcct).reduce((s, v) => s + v, 0), [prevRevByAcct]);

  const revPct = useMemo(() => pctDelta(totalRevenue, prevRevenue), [totalRevenue, prevRevenue]);

  // Top models by revenue
  const topModels = useMemo(() =>
    (accounts as any[])
      .map((a: any, i: number) => ({
        id: a.id, name: a.display_name, avatar: a.avatar_thumb_url,
        revenue: revByAcct[a.id] || 0,
        pct: pctDelta(revByAcct[a.id] || 0, prevRevByAcct[a.id] || 0),
        color: MODEL_COLORS[i % MODEL_COLORS.length],
      }))
      .filter(m => m.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3),
  [accounts, revByAcct, prevRevByAcct]);

  // Revenue chart (monthly for all-time, daily for period)
  const revenueChartData = useMemo(() => {
    if (isAllTime) {
      const m: Record<string, number> = {};
      (accounts as any[]).forEach((a: any) => {
        const monthly = a.revenue_monthly as Record<string, number> | null;
        if (!monthly) return;
        Object.entries(monthly).forEach(([month, amount]) => {
          m[month] = (m[month] || 0) + Number(amount);
        });
      });
      return Object.entries(m)
        .filter(([, v]) => v > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, total]) => ({
          date: format(new Date(key + "-15"), "MMM yy"),
          total,
          attributed: total * 0.72,
        }));
    }
    const byDate: Record<string, number> = {};
    (dailyTx as any[]).forEach((tx: any) => {
      const d = String(tx.date).split("T")[0];
      byDate[d] = (byDate[d] || 0) + Number(tx.revenue || 0);
    });
    return Object.keys(byDate).sort().map(date => ({
      date: format(new Date(date + "T12:00:00"), "MMM d"),
      total: byDate[date],
      attributed: byDate[date] * 0.72,
    }));
  }, [accounts, dailyTx, isAllTime]);

  // Weekly bar (day-of-week aggregation)
  const weeklyBarData = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const byDay: Record<number, number> = { 0:0,1:0,2:0,3:0,4:0,5:0,6:0 };
    (dailyTx as any[]).forEach((tx: any) => {
      const d = new Date(String(tx.date).split("T")[0] + "T12:00:00");
      byDay[d.getDay()] = (byDay[d.getDay()] || 0) + Number(tx.revenue || 0);
    });
    const maxVal = Math.max(...Object.values(byDay));
    return days.map((day, i) => ({ day, revenue: byDay[i], highlight: byDay[i] === maxVal && maxVal > 0 }));
  }, [dailyTx]);

  // Per-account sparklines (last 14 data points from daily tx)
  const sparkByAcct = useMemo(() => {
    const byAcctDate: Record<string, Record<string, number>> = {};
    (dailyTx as any[]).forEach((tx: any) => {
      const d = String(tx.date).split("T")[0];
      if (!byAcctDate[tx.account_id]) byAcctDate[tx.account_id] = {};
      byAcctDate[tx.account_id][d] = (byAcctDate[tx.account_id][d] || 0) + Number(tx.revenue || 0);
    });
    const result: Record<string, number[]> = {};
    // All-time: build from monthly data
    if (isAllTime) {
      (accounts as any[]).forEach((a: any) => {
        const monthly = a.revenue_monthly as Record<string, number> | null;
        if (!monthly) return;
        result[a.id] = Object.entries(monthly)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-12)
          .map(([, v]) => Number(v));
      });
      return result;
    }
    Object.entries(byAcctDate).forEach(([id, dateMap]) => {
      const sorted = Object.keys(dateMap).sort().slice(-14);
      result[id] = sorted.map(d => dateMap[d]);
    });
    return result;
  }, [dailyTx, accounts, isAllTime]);

  // Attribution — all-time from tracking links revenue, period from orders
  const attributedRevenue = useMemo(() => {
    if (isAllTime) {
      const linkRev = (links as any[]).reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
      return Math.min(linkRev, totalRevenue);
    }
    const orderTotal = (orders as any[]).reduce((s: number, o: any) => s + Number(o.total_spent || 0), 0);
    return Math.min(orderTotal, totalRevenue);
  }, [links, orders, totalRevenue, isAllTime]);
  const unattributedRevenue = Math.max(0, totalRevenue - attributedRevenue);

  // Recent activity (last 8 daily tx rows)
  const recentTx = useMemo(() =>
    [...(dailyTx as any[])]
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8)
      .map((tx: any) => {
        const acct = (accounts as any[]).find((a: any) => a.id === tx.account_id);
        return {
          id: String(tx.date) + tx.account_id,
          name: acct?.display_name || "Unknown",
          avatar: acct?.avatar_thumb_url,
          date: format(new Date(String(tx.date).split("T")[0] + "T12:00:00"), "EEE"),
          amount: Number(tx.revenue || 0),
        };
      }),
  [dailyTx, accounts]);

  // Heatmap — last 49 days of daily tx
  const heatmapData = useMemo(() => {
    const byDate: Record<string, number> = {};
    (dailyTx as any[]).forEach((tx: any) => {
      const d = String(tx.date).split("T")[0];
      byDate[d] = (byDate[d] || 0) + Number(tx.revenue || 0);
    });
    const end = new Date();
    const start = subDays(end, 48);
    return eachDayOfInterval({ start, end }).map(d => ({ date: fmtD(d), value: byDate[fmtD(d)] || 0 }));
  }, [dailyTx]);

  const netCashflow = totalRevenue - prevRevenue;
  const cashflowPct = pctDelta(totalRevenue, prevRevenue);

  // Flow chart model data
  const flowModels = useMemo(() =>
    (accounts as any[])
      .map((a: any, i: number) => ({ name: a.display_name, value: revByAcct[a.id] || 0, color: MODEL_COLORS[i % MODEL_COLORS.length] }))
      .filter(m => m.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  [accounts, revByAcct]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="min-h-full p-6 space-y-5" style={{ background: T.bg }}>

        {/* ── Header: Total Revenue ──────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: T.muted }}>Total Revenue</p>
            <div className="flex items-baseline gap-3">
              <h1 className="text-5xl font-bold font-mono leading-none" style={{ color: T.white }}>
                {txLoading && !isAllTime ? "…" : fmtMoney(totalRevenue)}
              </h1>
              <Delta pct={revPct} />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-sm" style={{ color: T.muted }}>
                Attributed: <span style={{ color: T.white }}>{fmtShort(attributedRevenue)}</span>
              </span>
              <span className="text-[10px]" style={{ color: T.border }}>·</span>
              <span className="text-sm" style={{ color: T.muted }}>
                Unattributed: <span style={{ color: T.dim }}>{fmtShort(unattributedRevenue)}</span>
              </span>
            </div>
          </div>

          {/* Date controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setIsAllTime(true); setCustomRange(null); }}
              className="h-8 px-3 rounded-lg text-xs font-medium transition-colors"
              style={isAllTime
                ? { background: T.accent, color: T.white }
                : { background: T.card, border: `1px solid ${T.border}`, color: T.muted }}
            >
              All Time
            </button>
            <DateRangePicker
              value={customRange}
              onChange={range => {
                if (range) { setCustomRange(range); setIsAllTime(false); }
              }}
            />
          </div>
        </div>

        {/* ── Model cards ───────────────────────────────────────────────────── */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {topModels.map(m => (
            <ModelCard
              key={m.id}
              name={m.name}
              avatar={m.avatar}
              revenue={m.revenue}
              pct={m.pct}
              spark={sparkByAcct[m.id] || []}
              color={m.color}
            />
          ))}
          {topModels.length < 4 && <ModelCard isAdd />}
        </div>

        {/* ── Revenue chart + Weekly bar ─────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">

          {/* Revenue over time */}
          <div className="p-5" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "0.875rem" }}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-xs uppercase tracking-widest" style={{ color: T.muted }}>Revenue Over Time</p>
                <p className="text-3xl font-bold font-mono mt-0.5" style={{ color: T.white }}>{fmtMoney(totalRevenue)}</p>
              </div>
              <div className="flex gap-4 text-xs" style={{ color: T.muted }}>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-6 h-0.5" style={{ background: T.white }} />Total
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-6 h-0.5" style={{ background: T.accent }} />Campaign
                </span>
              </div>
            </div>
            <div className="mt-4" style={{ height: 220 }}>
              {revenueChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm" style={{ color: T.muted }}>
                  {txLoading ? "Loading…" : "No data for this period"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gtotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={T.white}  stopOpacity={0.12} />
                        <stop offset="95%" stopColor={T.white}  stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gattr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={T.accent} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={T.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={T.border} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false}
                      interval={Math.max(0, Math.floor(revenueChartData.length / 8) - 1)} />
                    <YAxis tickFormatter={v => fmtShort(v)} tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="total"      name="Total"    stroke={T.white}  strokeWidth={2} fill="url(#gtotal)" dot={false} />
                    <Area type="monotone" dataKey="attributed" name="Campaign" stroke={T.accent} strokeWidth={2} fill="url(#gattr)"  dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Weekly breakdown */}
          <div className="p-5" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "0.875rem" }}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-xs uppercase tracking-widest" style={{ color: T.muted }}>Weekly Breakdown</p>
                <p className="text-2xl font-bold font-mono mt-0.5" style={{ color: T.white }}>
                  {fmtShort(weeklyBarData.reduce((s, d) => s + d.revenue, 0))}
                </p>
              </div>
            </div>
            <div className="mt-4" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyBarData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barSize={22}>
                  <CartesianGrid vertical={false} stroke={T.border} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => fmtShort(v)} tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                    {weeklyBarData.map((entry, index) => (
                      <Cell key={index} fill={entry.highlight ? T.accent : T.dark} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ── Bottom row: Recent Activity + Flow + Heatmap ──────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr_1fr] gap-4">

          {/* Recent Activity */}
          <div className="p-5" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "0.875rem" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold" style={{ color: T.white }}>Recent Activity</p>
            </div>
            <div className="space-y-3">
              {recentTx.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: T.muted }}>
                  {isAllTime ? "Select a date range to see activity" : txLoading ? "Loading…" : "No recent transactions"}
                </p>
              ) : recentTx.map(tx => (
                <div key={tx.id} className="flex items-center gap-3">
                  {tx.avatar
                    ? <img src={tx.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt="" />
                    : <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: T.dark, color: T.dim }}>
                        {tx.name.slice(0, 2).toUpperCase()}
                      </div>}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: T.white }}>{tx.name}</p>
                    <p className="text-[11px]" style={{ color: T.muted }}>Revenue · {tx.date}</p>
                  </div>
                  <p className="text-sm font-mono font-semibold shrink-0" style={{ color: T.green }}>
                    +{fmtShort(tx.amount)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Revenue Flow */}
          <div className="p-5" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "0.875rem" }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs uppercase tracking-widest" style={{ color: T.muted }}>Revenue Flow</p>
                <p className="text-2xl font-bold font-mono mt-0.5" style={{ color: T.white }}>{fmtMoney(totalRevenue)}</p>
              </div>
            </div>
            <RevenueFlowChart
              models={flowModels}
              attributed={attributedRevenue}
              unattributed={unattributedRevenue}
              total={totalRevenue}
            />
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-sm" style={{ background: T.accent }} />
                  <span className="text-xs" style={{ color: T.muted }}>Via Campaigns</span>
                </div>
                <span className="text-xs font-mono" style={{ color: T.white }}>{fmtShort(attributedRevenue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-sm" style={{ background: T.dark, border: `1px solid ${T.border}` }} />
                  <span className="text-xs" style={{ color: T.muted }}>Direct</span>
                </div>
                <span className="text-xs font-mono" style={{ color: T.white }}>{fmtShort(unattributedRevenue)}</span>
              </div>
            </div>
          </div>

          {/* Net Cashflow + Heatmap */}
          <div className="p-5" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "0.875rem" }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs uppercase tracking-widest" style={{ color: T.muted }}>Net Cashflow</p>
                <p className="text-2xl font-bold font-mono mt-0.5"
                  style={{ color: netCashflow >= 0 ? T.green : T.red }}>
                  {netCashflow >= 0 ? "+" : ""}{fmtMoney(netCashflow)}
                </p>
                <div className="mt-1"><Delta pct={cashflowPct} size="sm" /></div>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.muted }}>
                Daily Activity (49 days)
              </p>
              {heatmapData.some(d => d.value > 0)
                ? <RevenueHeatmap data={heatmapData} />
                : <p className="text-xs" style={{ color: T.muted }}>
                    {isAllTime ? "Select a date range to see heatmap" : "No data"}
                  </p>}
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}

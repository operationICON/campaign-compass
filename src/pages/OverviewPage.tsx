import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format, subDays, startOfMonth, endOfMonth, subMonths,
  startOfYear, startOfWeek, endOfWeek,
} from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  getAccounts, getEarningsByAccount, getTransactionDaily,
  getSnapshotsByDateRange, getOnlytrafficOrders, getTrackingLinks, getFanStats,
} from "@/lib/api";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ChevronDown, Check, Search,
  ArrowUpRight, ArrowDownRight,
  BarChart2, TrendingUp, Users, DollarSign, Activity, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";

// ── Colors ────────────────────────────────────────────────────────────────────
const MODEL_COLORS = [
  "#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#ec4899","#14b8a6","#84cc16",
  "#a855f7","#22c55e","#eab308","#3b82f6","#e11d48",
];

// ── Date presets ──────────────────────────────────────────────────────────────
type PresetKey =
  | "today" | "yesterday" | "last_7" | "last_14" | "last_30" | "last_60"
  | "last_90" | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_year" | "all_time" | "custom";

const DATE_PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today",      label: "Today" },
  { key: "yesterday",  label: "Yesterday" },
  { key: "last_7",     label: "Last 7 Days" },
  { key: "last_14",    label: "Last 14 Days" },
  { key: "last_30",    label: "Last 30 Days" },
  { key: "last_60",    label: "Last 60 Days" },
  { key: "last_90",    label: "Last 90 Days" },
  { key: "this_week",  label: "This Week" },
  { key: "last_week",  label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "this_year",  label: "This Year" },
  { key: "all_time",   label: "All Time" },
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtD(d: Date) { return format(d, "yyyy-MM-dd"); }

function fmtMoney(n: number) {
  if (!isFinite(n)) return "$0.00";
  const neg = n < 0;
  const abs = Math.abs(n);
  return (neg ? "-$" : "$") + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(n: number) {
  if (!isFinite(n) || n === 0) return "$0";
  const neg = n < 0; const abs = Math.abs(n);
  const s = neg ? "-$" : "$";
  if (abs >= 1_000_000) return `${s}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${s}${(abs / 1_000).toFixed(1)}K`;
  return `${s}${abs.toFixed(0)}`;
}

function computeDateRange(preset: PresetKey, custom: { from: Date; to: Date } | null) {
  const today = new Date();
  if (preset === "all_time") return { from: null as string | null, to: null as string | null, isAllTime: true };
  if (preset === "custom" && custom) return { from: fmtD(custom.from), to: fmtD(custom.to), isAllTime: false };
  let from: Date, to: Date = today;
  switch (preset) {
    case "today":      from = today; break;
    case "yesterday":  from = to = subDays(today, 1); break;
    case "last_7":     from = subDays(today, 7); break;
    case "last_14":    from = subDays(today, 14); break;
    case "last_30":    from = subDays(today, 30); break;
    case "last_60":    from = subDays(today, 60); break;
    case "last_90":    from = subDays(today, 90); break;
    case "this_week":  from = startOfWeek(today, { weekStartsOn: 1 }); break;
    case "last_week": {
      const lw = startOfWeek(subDays(today, 7), { weekStartsOn: 1 });
      from = lw; to = endOfWeek(lw, { weekStartsOn: 1 }); break;
    }
    case "this_month": from = startOfMonth(today); break;
    case "last_month":
      from = startOfMonth(subMonths(today, 1));
      to   = endOfMonth(subMonths(today, 1)); break;
    case "this_year":  from = startOfYear(today); break;
    default:           from = subDays(today, 30);
  }
  return { from: fmtD(from), to: fmtD(to), isAllTime: false };
}

function prevRange(from: string, to: string) {
  const f = new Date(from), t = new Date(to);
  const days = Math.ceil((t.getTime() - f.getTime()) / 86400000) + 1;
  return { prevFrom: fmtD(subDays(f, days)), prevTo: fmtD(subDays(f, 1)) };
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div className="w-20 h-8" />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const W = 80, H = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} className="opacity-75">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

// ── Change chip ───────────────────────────────────────────────────────────────
function ChangeChip({ pct }: { pct: number | null }) {
  if (pct === null || !isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md mt-0.5",
      up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
    )}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, pct, sparkData, accent, icon }: {
  label: string; value: string; sub?: string;
  pct?: number | null; sparkData?: number[];
  accent: string; icon: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3" style={{ borderBottom: `3px solid ${accent}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-bold text-foreground mt-1 leading-none">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center" style={{ background: `${accent}18` }}>
          <span style={{ color: accent }}>{icon}</span>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          {pct !== undefined && pct !== null ? (
            <>
              <ChangeChip pct={pct} />
              <p className="text-[10px] text-muted-foreground mt-0.5">vs prev period</p>
            </>
          ) : <div />}
        </div>
        {sparkData && <Sparkline data={sparkData} color={accent} />}
      </div>
    </div>
  );
}

// ── Account multi-select ──────────────────────────────────────────────────────
function AccountFilter({ accounts, selected, onChange }: {
  accounts: any[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const filtered = accounts.filter(a => !search || a.display_name.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground flex items-center gap-2 hover:bg-accent/30 transition-colors select-none">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Accounts ({selected.length})</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-2xl z-[60]">
          <div className="p-2.5 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts…"
                className="w-full h-8 pl-8 pr-3 text-xs bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
            <button onClick={() => onChange(accounts.map(a => a.id))} className="text-xs text-primary hover:underline">Select All</button>
            <span className="text-muted-foreground/40">·</span>
            <button onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-foreground hover:underline">Deselect All</button>
          </div>
          <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
            {filtered.map(a => {
              const checked = selected.includes(a.id);
              return (
                <button key={a.id} onClick={() => toggle(a.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left">
                  <div className={cn("w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    checked ? "bg-primary border-primary" : "border-border")}>
                    {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </div>
                  {a.avatar_thumb_url
                    ? <img src={a.avatar_thumb_url} className="w-6 h-6 rounded-full object-cover shrink-0" alt="" />
                    : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                        {(a.display_name || "?").slice(0, 2).toUpperCase()}
                      </div>}
                  <span className="text-sm text-foreground truncate">{a.display_name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const [selectedIds, setSelectedIds]   = useState<string[]>([]);
  const [idsReady, setIdsReady]         = useState(false);
  const [preset, setPreset]             = useState<PresetKey>("all_time");
  const [customRange, setCustomRange]   = useState<{ from: Date; to: Date } | null>(null);
  const [chartType, setChartType]       = useState<"bar" | "line">("bar");
  const [tableSort, setTableSort]       = useState<{ key: string; dir: "asc" | "desc" }>({ key: "revenue", dir: "desc" });
  const [tablePage, setTablePage]       = useState(0);
  const [tablePageSize, setTablePageSize] = useState(10);

  const { from: dateFrom, to: dateTo, isAllTime } = useMemo(() => computeDateRange(preset, customRange), [preset, customRange]);
  const { prevFrom, prevTo } = useMemo(() =>
    dateFrom && dateTo ? prevRange(dateFrom, dateTo) : { prevFrom: null as string | null, prevTo: null as string | null },
    [dateFrom, dateTo]);
  const revMult = 1.0;

  const pickerValue = useMemo(() => {
    if (isAllTime) return null;
    if (preset === "custom") return customRange;
    return dateFrom && dateTo ? { from: new Date(dateFrom + "T12:00:00"), to: new Date(dateTo + "T12:00:00") } : null;
  }, [preset, customRange, dateFrom, dateTo, isAllTime]);

  // Queries
  const { data: accountsRaw = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts, staleTime: 5 * 60 * 1000 });
  const available = useMemo(() => (accountsRaw as any[]).filter(a => a.is_active && !a.sync_excluded), [accountsRaw]);

  useEffect(() => {
    if (!idsReady && available.length > 0) { setSelectedIds(available.map((a: any) => a.id)); setIdsReady(true); }
  }, [available, idsReady]);

  const { data: linksRaw = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => getTrackingLinks(), staleTime: 5 * 60 * 1000 });

  // Live earnings from OFAPI — exact same numbers their dashboard shows
  const { data: earningsRows = [], isLoading: snapsLoading } = useQuery({
    queryKey: ["ov2_earnings", dateFrom, dateTo, selectedIds.join(",")],
    queryFn: () => getEarningsByAccount({ date_from: dateFrom ?? undefined, date_to: dateTo ?? undefined, account_ids: selectedIds }),
    enabled: selectedIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const { data: prevEarningsRows = [] } = useQuery({
    queryKey: ["ov2_prev_earnings", prevFrom, prevTo, selectedIds.join(",")],
    queryFn: () => getEarningsByAccount({ date_from: prevFrom!, date_to: prevTo!, account_ids: selectedIds }),
    enabled: !isAllTime && !!prevFrom && !!prevTo && selectedIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  // Transaction daily data — used only for chart shape / sparklines
  const { data: txRows = [] } = useQuery({
    queryKey: ["ov2_tx", dateFrom, dateTo, selectedIds.join(",")],
    queryFn: () => getTransactionDaily({ date_from: dateFrom ?? "2020-01-01", date_to: dateTo ?? fmtD(new Date()), account_ids: selectedIds }),
    enabled: selectedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Snapshot-based subscriber counts (tracking-link new subs for Fans KPI)
  const { data: snaps = [] } = useQuery({
    queryKey: ["ov2_snaps", dateFrom, dateTo, selectedIds.join(",")],
    queryFn: () => getSnapshotsByDateRange({ date_from: dateFrom ?? "2020-01-01", date_to: dateTo ?? fmtD(new Date()), account_ids: selectedIds, cols: "slim" }),
    enabled: selectedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: prevSnaps = [] } = useQuery({
    queryKey: ["ov2_prev_snaps", prevFrom, prevTo, selectedIds.join(",")],
    queryFn: () => getSnapshotsByDateRange({ date_from: prevFrom!, date_to: prevTo!, account_ids: selectedIds, cols: "slim" }),
    enabled: !isAllTime && !!prevFrom && !!prevTo && selectedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["ov2_orders", dateFrom, dateTo],
    queryFn: () => getOnlytrafficOrders({ date_from: dateFrom ?? undefined, date_to: dateTo ?? undefined, statuses: ["completed","accepted","active","waiting"] }),
    enabled: !!dateFrom,
    staleTime: 5 * 60 * 1000,
  });

  const { data: prevOrders = [] } = useQuery({
    queryKey: ["ov2_prev_orders", prevFrom, prevTo],
    queryFn: () => getOnlytrafficOrders({ date_from: prevFrom!, date_to: prevTo!, statuses: ["completed","accepted","active","waiting"] }),
    enabled: !isAllTime && !!prevFrom && !!prevTo,
    staleTime: 5 * 60 * 1000,
  });

  const { data: fanStats } = useQuery({ queryKey: ["fan_stats_all"], queryFn: () => getFanStats(), staleTime: 10 * 60 * 1000 });

  // Derived maps
  const linkToAccount = useMemo(() => {
    const m: Record<string, string> = {};
    (linksRaw as any[]).forEach(l => { if (l.id && l.account_id) m[l.id] = l.account_id; });
    return m;
  }, [linksRaw]);

  const linkCountByAccount = useMemo(() => {
    const m: Record<string, number> = {};
    (linksRaw as any[]).filter((l: any) => !l.deleted_at).forEach((l: any) => { m[l.account_id] = (m[l.account_id] || 0) + 1; });
    return m;
  }, [linksRaw]);

  const selectedAccounts = useMemo(() => available.filter((a: any) => selectedIds.includes(a.id)), [available, selectedIds]);

  // Aggregation helpers
  const aggSnaps = (data: any[], field: string, ids: string[]) => {
    const m: Record<string, number> = {};
    (data as any[]).forEach(s => {
      if (!ids.includes(s.account_id)) return;
      m[s.account_id] = (m[s.account_id] || 0) + Number(s[field] || 0);
    });
    return m;
  };

  // Revenue from live OFAPI earnings (exact match to their dashboard)
  const revByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    earningsRows.forEach(e => { if (selectedIds.includes(e.account_id)) m[e.account_id] = e.total; });
    return m;
  }, [earningsRows, selectedIds]);

  const prevRevByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    prevEarningsRows.forEach(e => { if (selectedIds.includes(e.account_id)) m[e.account_id] = e.total; });
    return m;
  }, [prevEarningsRows, selectedIds]);

  const subsByAcct      = useMemo(() => aggSnaps(snaps, "subscribers", selectedIds),     [snaps, selectedIds]);
  const prevSubsByAcct  = useMemo(() => aggSnaps(prevSnaps, "subscribers", selectedIds), [prevSnaps, selectedIds]);

  const spendByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    (orders as any[]).forEach(o => {
      const aid = linkToAccount[o.tracking_link_id];
      if (!aid || !selectedIds.includes(aid)) return;
      m[aid] = (m[aid] || 0) + Number(o.total_spent || 0);
    });
    return m;
  }, [orders, linkToAccount, selectedIds]);

  const prevSpendByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    (prevOrders as any[]).forEach(o => {
      const aid = linkToAccount[o.tracking_link_id];
      if (!aid || !selectedIds.includes(aid)) return;
      m[aid] = (m[aid] || 0) + Number(o.total_spent || 0);
    });
    return m;
  }, [prevOrders, linkToAccount, selectedIds]);

  // KPI totals
  const totalRevenue = useMemo(() => {
    const txTotal = Object.values(revByAcct).reduce((s, v) => s + v, 0);
    // For all_time: fall back to ltv_total only if transaction data hasn't loaded yet
    if (isAllTime && txTotal === 0) {
      return selectedAccounts.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0) * revMult;
    }
    return txTotal * revMult;
  }, [isAllTime, selectedAccounts, revByAcct, revMult]);

  const prevTotalRevenue = useMemo(() => Object.values(prevRevByAcct).reduce((s, v) => s + v, 0) * revMult, [prevRevByAcct, revMult]);

  const totalFans = useMemo(() => {
    if (isAllTime) return selectedAccounts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
    return Object.values(subsByAcct).reduce((s, v) => s + v, 0);
  }, [isAllTime, selectedAccounts, subsByAcct]);

  const prevTotalFans = useMemo(() => Object.values(prevSubsByAcct).reduce((s, v) => s + v, 0), [prevSubsByAcct]);

  const totalLtv = useMemo(() => {
    const subs = selectedAccounts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
    const ltv  = selectedAccounts.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
    return subs > 0 ? (ltv / subs) * revMult : 0;
  }, [selectedAccounts, revMult]);

  // Sparklines (daily arrays)
  const dailyRevSpark = useMemo(() => {
    const m: Record<string, number> = {};
    txRows.forEach(s => {
      if (!selectedIds.includes(s.account_id)) return;
      const d = String(s.date).split("T")[0];
      m[d] = (m[d] || 0) + Number(s.revenue || 0);
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [txRows, selectedIds]);

  const dailySubsSpark = useMemo(() => {
    const m: Record<string, number> = {};
    (snaps as any[]).forEach(s => {
      if (!selectedIds.includes(s.account_id)) return;
      const d = String(s.snapshot_date).split("T")[0];
      m[d] = (m[d] || 0) + Number(s.subscribers || 0);
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [snaps, selectedIds]);

  // Donut
  const donutData = useMemo(() =>
    selectedAccounts
      .map((a: any, i: number) => ({
        name: a.display_name,
        value: (isAllTime ? Number(a.ltv_total || 0) : (revByAcct[a.id] || 0)) * revMult,
        color: MODEL_COLORS[i % MODEL_COLORS.length],
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value),
    [selectedAccounts, isAllTime, revByAcct, revMult]);

  const donutTotal = useMemo(() => donutData.reduce((s, d) => s + d.value, 0), [donutData]);

  // Chart
  const chartData = useMemo(() => {
    const daysDiff = dateFrom && dateTo
      ? Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000)
      : 366;
    const byMonth = isAllTime || daysDiff > 90;
    const m: Record<string, number> = {};
    txRows.forEach(s => {
      if (!selectedIds.includes(s.account_id)) return;
      const d = String(s.date).split("T")[0];
      const key = byMonth ? d.slice(0, 7) : d;
      m[key] = (m[key] || 0) + Number(s.revenue || 0);
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([key, revenue]) => ({
      date: key, revenue,
      label: byMonth
        ? format(new Date(key + "-15"), "MMM yy")
        : format(new Date(key + "T12:00:00"), "MMM d"),
    }));
  }, [txRows, selectedIds, isAllTime, dateFrom, dateTo]);

  const chartTotal = useMemo(() => chartData.reduce((s, d) => s + d.revenue, 0), [chartData]);

  const dateLabel = useMemo(() => {
    if (isAllTime) return "All Time";
    if (dateFrom && dateTo)
      return `${format(new Date(dateFrom + "T12:00:00"), "MMM d")} – ${format(new Date(dateTo + "T12:00:00"), "MMM d, yyyy")}`;
    return "";
  }, [isAllTime, dateFrom, dateTo]);

  // Table rows
  const tableRows = useMemo(() => {
    const rows = selectedAccounts.map((a: any) => {
      const rev        = (isAllTime ? Number(a.ltv_total || 0) : (revByAcct[a.id] || 0)) * revMult;
      const prevRev    = (prevRevByAcct[a.id] || 0) * revMult;
      const spend      = spendByAcct[a.id] || 0;
      const prevSpend  = prevSpendByAcct[a.id] || 0;
      const profit     = rev - spend;
      const prevProfit = prevRev - prevSpend;
      const newFans    = isAllTime ? Number(a.subscribers_count || 0) : (subsByAcct[a.id] || 0);
      const prevNewFans = prevSubsByAcct[a.id] || 0;
      const subs       = Number(a.subscribers_count || 0);
      const ltv        = subs > 0 ? (Number(a.ltv_total || 0) / subs) * revMult : 0;
      return { account: a, rev, prevRev, spend, prevSpend, profit, prevProfit, newFans, prevNewFans, ltv, linkCount: linkCountByAccount[a.id] || 0 };
    });
    const dir = tableSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (tableSort.key) {
        case "revenue":  return dir * (a.rev - b.rev);
        case "spend":    return dir * (a.spend - b.spend);
        case "profit":   return dir * (a.profit - b.profit);
        case "newFans":  return dir * (a.newFans - b.newFans);
        case "ltv":      return dir * (a.ltv - b.ltv);
        case "account":  return dir * a.account.display_name.localeCompare(b.account.display_name);
        default: return 0;
      }
    });
    return rows;
  }, [selectedAccounts, isAllTime, revByAcct, prevRevByAcct, spendByAcct, prevSpendByAcct,
      subsByAcct, prevSubsByAcct, revMult, tableSort, linkCountByAccount]);

  const totalPages = Math.ceil(tableRows.length / tablePageSize);
  const pagedRows  = tableRows.slice(tablePage * tablePageSize, (tablePage + 1) * tablePageSize);

  const sortBy = (key: string) => {
    setTableSort(s => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
    setTablePage(0);
  };

  function SortIcon({ k }: { k: string }) {
    if (tableSort.key !== k) return <ChevronDown className="w-3 h-3 opacity-30 ml-0.5" />;
    return <ChevronDown className={cn("w-3 h-3 text-primary ml-0.5 transition-transform", tableSort.dir === "asc" && "rotate-180")} />;
  }

  const handleExport = () => {
    const csv = [
      ["Account","Username","Revenue","Spend","Profit","New Fans","LTV"].join(","),
      ...tableRows.map(r => [`"${r.account.display_name}"`, r.account.username || "", r.rev.toFixed(2), r.spend.toFixed(2), r.profit.toFixed(2), r.newFans, r.ltv.toFixed(2)].join(",")),
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `overview-${dateFrom ?? "all-time"}.csv`;
    a.click();
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dateLabel} · {selectedIds.length} account{selectedIds.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* ── Section 1: Filters ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <AccountFilter accounts={available} selected={selectedIds} onChange={setSelectedIds} />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {DATE_PRESETS.map(p => (
              <button key={p.key} onClick={() => { setPreset(p.key); setCustomRange(null); setTablePage(0); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                  preset === p.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
                )}>
                {p.label}
              </button>
            ))}
            <div className={cn("rounded-lg border overflow-hidden transition-colors", preset === "custom" ? "border-primary" : "border-transparent")}>
              <DateRangePicker
                value={pickerValue}
                onChange={range => { if (range) { setCustomRange(range); setPreset("custom"); setTablePage(0); } }}
              />
            </div>
          </div>
        </div>

        {/* ── Section 2: KPI Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Fans"
            value={snapsLoading ? "…" : totalFans.toLocaleString()}
            sub={isAllTime ? "Total subscribers" : "New subscribers in period"}
            pct={!isAllTime && prevTotalFans > 0 ? ((totalFans - prevTotalFans) / prevTotalFans) * 100 : null}
            sparkData={dailySubsSpark.length > 1 ? dailySubsSpark : undefined}
            accent="#6366f1" icon={<Users className="h-4 w-4" />}
          />
          <KpiCard
            label="Spenders"
            value={fanStats?.spenders != null ? fanStats.spenders.toLocaleString() : "…"}
            sub="Total unique spenders"
            accent="#10b981" icon={<Zap className="h-4 w-4" />}
          />
          <KpiCard
            label="Revenue"
            value={snapsLoading ? "…" : fmtShort(totalRevenue)}
            sub={isAllTime ? "Total historical earnings" : "Net earnings in period"}
            pct={!isAllTime && prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 : null}
            sparkData={dailyRevSpark.length > 1 ? dailyRevSpark : undefined}
            accent="#f59e0b" icon={<DollarSign className="h-4 w-4" />}
          />
          <KpiCard
            label="LTV"
            value={fmtMoney(totalLtv)}
            sub="Revenue per subscriber"
            accent="#8b5cf6" icon={<Activity className="h-4 w-4" />}
          />
        </div>

        {/* ── Section 3: Revenue Breakdown + Revenue Overview ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Donut */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Revenue Breakdown</h2>
            {donutData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                {snapsLoading ? "Loading…" : "No revenue data for selected period"}
              </div>
            ) : (
              <div className="flex items-center gap-5">
                <div className="relative shrink-0" style={{ width: 180, height: 180 }}>
                  <ResponsiveContainer width={180} height={180}>
                    <PieChart>
                      <Pie data={donutData} cx="50%" cy="50%" innerRadius={52} outerRadius={82}
                        dataKey="value" strokeWidth={0} paddingAngle={2}>
                        {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xl font-bold text-foreground leading-none">{fmtShort(donutTotal)}</span>
                    <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Total</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left pb-2 text-muted-foreground font-medium">Model</th>
                        <th className="text-right pb-2 text-muted-foreground font-medium">%</th>
                        <th className="text-right pb-2 text-muted-foreground font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donutData.slice(0, 9).map((d, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="py-1.5 pr-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                              <span className="text-foreground truncate">{d.name}</span>
                            </div>
                          </td>
                          <td className="py-1.5 text-right text-muted-foreground">
                            {donutTotal > 0 ? ((d.value / donutTotal) * 100).toFixed(1) : "0"}%
                          </td>
                          <td className="py-1.5 text-right font-semibold text-foreground">{fmtShort(d.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Bar/Line chart */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Revenue Overview</h2>
                <p className="text-2xl font-bold text-foreground mt-1">{fmtMoney(chartTotal)}</p>
                <p className="text-xs text-muted-foreground">{dateLabel}</p>
              </div>
              <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5">
                {([["bar", BarChart2], ["line", TrendingUp]] as [string, any][]).map(([type, Icon]) => (
                  <button key={type} onClick={() => setChartType(type as "bar" | "line")}
                    className={cn("p-1.5 rounded-md transition-colors",
                      chartType === type ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
            <div style={{ height: 200 }}>
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  {snapsLoading ? "Loading…" : "No data"}
                </div>
              ) : chartType === "bar" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false}
                      interval={Math.max(0, Math.floor(chartData.length / 8) - 1)} />
                    <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={48}
                      tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                    <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any) => [fmtMoney(v), "Revenue"]} labelStyle={{ color: "#9ca3af" }} />
                    <Bar dataKey="revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false}
                      interval={Math.max(0, Math.floor(chartData.length / 8) - 1)} />
                    <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={48}
                      tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                    <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any) => [fmtMoney(v), "Revenue"]} labelStyle={{ color: "#9ca3af" }} />
                    <Line dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 4: Per Model Table ───────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
            <h2 className="text-sm font-semibold text-foreground">Overview</h2>
            <div className="flex items-center gap-2">
              <select value={tablePageSize} onChange={e => { setTablePageSize(Number(e.target.value)); setTablePage(0); }}
                className="h-8 px-2 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none">
                {[10, 20, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
              </select>
              <button onClick={handleExport}
                className="h-8 px-3 rounded-lg border border-border bg-card text-xs text-muted-foreground hover:text-foreground transition-colors">
                Export
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    { key: "account", label: "Account",  right: false },
                    { key: "revenue", label: "Revenue",  right: true  },
                    { key: "spend",   label: "Spend",    right: true  },
                    { key: "profit",  label: "Profit",   right: true  },
                    { key: "newFans", label: "New Fans", right: true  },
                    { key: "ltv",     label: "LTV",      right: true  },
                  ].map(col => (
                    <th key={col.key} onClick={() => sortBy(col.key)}
                      className={cn("px-5 py-3.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest cursor-pointer select-none hover:text-foreground transition-colors",
                        col.right ? "text-right" : "text-left")}>
                      <span className={cn("inline-flex items-center gap-0.5", col.right && "justify-end w-full")}>
                        {col.label}<SortIcon k={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {snapsLoading ? "Loading…" : selectedIds.length === 0 ? "Select at least one account" : "No data"}
                  </td></tr>
                ) : pagedRows.map(row => {
                  const a = row.account;
                  const rp = !isAllTime && row.prevRev > 0     ? ((row.rev     - row.prevRev)    / row.prevRev)              * 100 : null;
                  const sp = !isAllTime && row.prevSpend > 0   ? ((row.spend   - row.prevSpend)  / row.prevSpend)            * 100 : null;
                  const pp = !isAllTime && row.prevProfit !== 0 ? ((row.profit - row.prevProfit) / Math.abs(row.prevProfit)) * 100 : null;
                  const fp = !isAllTime && row.prevNewFans > 0  ? ((row.newFans - row.prevNewFans) / row.prevNewFans)         * 100 : null;
                  return (
                    <tr key={a.id} className="border-b border-border/40 hover:bg-white/[0.02] transition-colors">
                      {/* Account */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {a.avatar_thumb_url
                            ? <img src={a.avatar_thumb_url} className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-border" alt="" />
                            : <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                                {(a.display_name || "?").slice(0, 2).toUpperCase()}
                              </div>}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground text-sm leading-tight truncate">{a.display_name}</span>
                              {row.linkCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">{row.linkCount}</span>
                              )}
                            </div>
                            {a.username && <div className="text-xs text-muted-foreground/70 mt-0.5">@{a.username}</div>}
                          </div>
                        </div>
                      </td>
                      {/* Revenue */}
                      <td className="px-5 py-4 text-right">
                        <div className="text-sm font-bold text-foreground">{fmtMoney(row.rev)}</div>
                        <div className="flex justify-end mt-0.5"><ChangeChip pct={rp} /></div>
                      </td>
                      {/* Spend */}
                      <td className="px-5 py-4 text-right">
                        <div className="text-sm font-bold text-foreground">{row.spend > 0 ? fmtMoney(row.spend) : <span className="text-muted-foreground/40">—</span>}</div>
                        {row.spend > 0 && <div className="flex justify-end mt-0.5"><ChangeChip pct={sp} /></div>}
                      </td>
                      {/* Profit */}
                      <td className="px-5 py-4 text-right">
                        <div className={cn("text-sm font-bold", row.profit >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {fmtMoney(row.profit)}
                        </div>
                        <div className="flex justify-end mt-0.5"><ChangeChip pct={pp} /></div>
                      </td>
                      {/* New Fans */}
                      <td className="px-5 py-4 text-right">
                        <div className="text-sm font-bold text-foreground">{row.newFans.toLocaleString()}</div>
                        <div className="flex justify-end mt-0.5"><ChangeChip pct={fp} /></div>
                      </td>
                      {/* LTV */}
                      <td className="px-5 py-4 text-right">
                        <div className="text-sm font-bold text-foreground">{fmtMoney(row.ltv)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {tablePage * tablePageSize + 1}–{Math.min((tablePage + 1) * tablePageSize, tableRows.length)} of {tableRows.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setTablePage(p => Math.max(0, p - 1))} disabled={tablePage === 0}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Prev</button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i).map(i => (
                  <button key={i} onClick={() => setTablePage(i)}
                    className={cn("w-7 h-7 rounded-lg text-xs transition-colors",
                      i === tablePage ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground")}>
                    {i + 1}
                  </button>
                ))}
                <button onClick={() => setTablePage(p => Math.min(totalPages - 1, p + 1))} disabled={tablePage >= totalPages - 1}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}

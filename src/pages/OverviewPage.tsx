import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  getAccounts, getTransactionDaily,
  getOnlytrafficOrders, getTrackingLinks,
  getFanCampaignBreakdown, getSnapshotLatestDate,
} from "@/lib/api";
import { useSnapshotDeltaMetrics } from "@/hooks/useSnapshotDeltaMetrics";
import { usePageFilters, TIME_PERIODS } from "@/hooks/usePageFilters";
import type { TimePeriod } from "@/hooks/usePageFilters";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ChevronDown, ChevronRight, Check, Search,
  ArrowUpRight, ArrowDownRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:      "#080d14",
  card:    "#0f1624",
  cardAlt: "#0c1220",
  border:  "#1e2d47",
  blue:    "#3b82f6",
  green:   "#22c55e",
  red:     "#ef4444",
  muted:   "#64748b",
  white:   "#f1f5f9",
  dark:    "#1e2d45",
} as const;

const MODEL_COLORS = [
  "#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899",
  "#06b6d4","#10b981","#f59e0b","#f97316","#ef4444",
  "#22c55e","#eab308","#14b8a6","#84cc16","#0ea5e9",
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtD(d: Date) { return format(d, "yyyy-MM-dd"); }

function fmtMoney(n: number) {
  if (!isFinite(n)) return "$0.00";
  const neg = n < 0;
  const abs = Math.abs(n);
  return (neg ? "-$" : "$") + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


function computeDateRange(isAllTime: boolean, custom: { from: Date; to: Date } | null) {
  if (isAllTime) return { from: null as string | null, to: null as string | null };
  if (custom) return { from: fmtD(custom.from), to: fmtD(custom.to) };
  return { from: null as string | null, to: null as string | null };
}

function sumMonthlyRevenue(monthly: Record<string, number> | null | undefined, fromDate: string | null, toDate: string | null): number {
  if (!monthly || !fromDate || !toDate) return 0;
  const fromMonth = fromDate.slice(0, 7);
  const toMonth   = toDate.slice(0, 7);
  return Object.entries(monthly)
    .filter(([month]) => month >= fromMonth && month <= toMonth)
    .reduce((s, [, v]) => s + Number(v), 0);
}

function prevRange(from: string, to: string) {
  const f = new Date(from), t = new Date(to);
  const days = Math.ceil((t.getTime() - f.getTime()) / 86400000) + 1;
  return { prevFrom: fmtD(subDays(f, days)), prevTo: fmtD(subDays(f, 1)) };
}

// ── Tiny sparkline (recharts LineChart, no axes) ───────────────────────────────
function TinySparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <div style={{ width: 64, height: 32 }} />;
  const pts = data.map((value, index) => ({ index, value }));
  return (
    <div style={{ width: 64, height: 32 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="value" stroke={T.white} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Delta badge ───────────────────────────────────────────────────────────────
function Delta({ pct }: { pct: number | null }) {
  if (pct === null || !isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full font-mono"
      style={{ background: up ? `${T.green}18` : `${T.red}18`, color: up ? T.green : T.red }}
    >
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, pct, sparkData }: {
  label: string; value: string; sub?: string;
  pct?: number | null; sparkData?: number[];
}) {
  return (
    <div className="p-5 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "14px" }}>
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T.muted }}>{label}</p>
      <p className="text-2xl font-bold font-mono leading-none" style={{ color: T.white }}>{value}</p>
      {sub && <p className="text-xs leading-snug" style={{ color: T.muted }}>{sub}</p>}
      <div className="flex items-end justify-between mt-auto pt-1">
        <div>
          {pct !== undefined && pct !== null
            ? <><Delta pct={pct} /><p className="text-[10px] mt-1" style={{ color: T.muted }}>vs prev period</p></>
            : <div />}
        </div>
        {false && sparkData && <TinySparkline data={sparkData} />}
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

  const btnCls = "h-8 px-3 rounded-md text-sm font-medium flex items-center gap-2 transition-colors select-none";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={btnCls}
        style={{ background: T.card, border: `1px solid ${T.border}`, color: T.muted }}
      >
        <Users className="w-3.5 h-3.5" />
        <span style={{ color: T.white }}>Models ({selected.length})</span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-72 rounded-xl shadow-2xl z-[60]"
          style={{ background: T.card, border: `1px solid ${T.border}` }}>
          <div className="p-2.5" style={{ borderBottom: `1px solid ${T.border}` }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T.muted }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…"
                className="w-full h-8 pl-8 pr-3 text-xs rounded-lg focus:outline-none"
                style={{ background: T.cardAlt, border: `1px solid ${T.border}`, color: T.white }} />
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: `1px solid ${T.border}` }}>
            <button onClick={() => onChange(accounts.map(a => a.id))} className="text-xs" style={{ color: T.blue }}>Select All</button>
            <span style={{ color: T.muted }}>·</span>
            <button onClick={() => onChange([])} className="text-xs hover:text-white transition-colors" style={{ color: T.muted }}>Deselect All</button>
          </div>
          <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
            {filtered.map(a => {
              const checked = selected.includes(a.id);
              return (
                <button key={a.id} onClick={() => toggle(a.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors hover:bg-[#1c1f2b]/60">
                  <div className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
                    style={{ background: checked ? T.blue : "transparent", borderColor: checked ? T.blue : T.border }}>
                    {checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  {a.avatar_thumb_url
                    ? <img src={a.avatar_thumb_url} className="w-6 h-6 rounded-full object-cover shrink-0" alt="" />
                    : <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: T.dark, color: T.muted }}>
                        {(a.display_name || "?").slice(0, 2).toUpperCase()}
                      </div>}
                  <span className="text-sm truncate" style={{ color: T.white }}>{a.display_name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-lg text-xs"
      style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.red}` }}>
      <p className="mb-1" style={{ color: T.muted }}>{label}</p>
      <p className="font-mono font-semibold" style={{ color: T.white }}>{fmtMoney(payload[0].value)}</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [idsReady, setIdsReady]       = useState(false);
  const { timePeriod, setTimePeriod, customRange: customDateRange, setCustomRange: setCustomDateRange } = usePageFilters();
  const [tableSort, setTableSort]       = useState<{ key: string; dir: "asc" | "desc" }>({ key: "revenue", dir: "desc" });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [drawerCampaign, setDrawerCampaign] = useState<any | null>(null);

  const { data: latestDateData } = useQuery({
    queryKey: ["snapshot_latest_date"],
    queryFn: () => getSnapshotLatestDate(),
    staleTime: 5 * 60 * 1000,
  });
  const latestDate = latestDateData?.date ?? fmtD(new Date());

  const isAllTime = timePeriod === "all" && !customDateRange;

  const customRange = useMemo(() => {
    if (customDateRange) return customDateRange;
    if (timePeriod === "all") return null;
    const latestAsDate = new Date(latestDate + "T12:00:00");
    const yesterday = subDays(new Date(), 1);
    const end = latestAsDate >= subDays(new Date(), 3) ? latestAsDate : yesterday;
    if (timePeriod === "prev_month") {
      const ref = new Date(latestDate + "T12:00:00");
      return { from: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1)), to: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0)) };
    }
    const from = new Date(end);
    if (timePeriod === "week")  from.setDate(from.getDate() - 6);
    if (timePeriod === "month") from.setDate(from.getDate() - 29);
    return { from, to: end };
  }, [timePeriod, customDateRange, latestDate]);

  const { from: dateFrom, to: dateTo } = useMemo(() => computeDateRange(isAllTime, customRange), [isAllTime, customRange]);
  const { prevFrom, prevTo } = useMemo(() =>
    dateFrom && dateTo ? prevRange(dateFrom, dateTo) : { prevFrom: null as string | null, prevTo: null as string | null },
    [dateFrom, dateTo]);
  const revMult = 1.0;

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: accountsRaw = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts, staleTime: 5 * 60 * 1000 });
  const available = useMemo(() => (accountsRaw as any[]).filter(a => a.is_active && !a.sync_excluded), [accountsRaw]);

  useEffect(() => {
    if (!idsReady && available.length > 0) { setSelectedIds(available.map((a: any) => a.id)); setIdsReady(true); }
  }, [available, idsReady]);

  const { data: linksRaw = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => getTrackingLinks(), staleTime: 5 * 60 * 1000 });

  const { data: txRows = [], isLoading: txLoading } = useQuery({
    queryKey: ["ov2_tx", dateFrom, dateTo, selectedIds.join(",")],
    queryFn: () => getTransactionDaily({ date_from: dateFrom ?? "2018-01-01", date_to: dateTo ?? fmtD(new Date()), account_ids: selectedIds }),
    enabled: selectedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: prevTxRows = [] } = useQuery({
    queryKey: ["ov2_prev_tx", prevFrom, prevTo, selectedIds.join(",")],
    queryFn: () => getTransactionDaily({ date_from: prevFrom!, date_to: prevTo!, account_ids: selectedIds }),
    enabled: !isAllTime && !!prevFrom && !!prevTo && selectedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // New Fans: use the exact same hook as Campaigns page — current period + prev period for delta
  const snapshotPeriod: TimePeriod = timePeriod;
  const snapshotCustomRange = customDateRange;
  const { deltaLookup: fansDeltaLookup } = useSnapshotDeltaMetrics(snapshotPeriod, snapshotCustomRange);
  const prevSnapshotRange = prevFrom && prevTo ? { from: new Date(prevFrom + "T12:00:00"), to: new Date(prevTo + "T12:00:00") } : null;
  const { deltaLookup: prevFansDeltaLookup } = useSnapshotDeltaMetrics("day", prevSnapshotRange);

  const { data: orders = [] } = useQuery({
    queryKey: ["ov2_orders", dateFrom, dateTo],
    queryFn: () => getOnlytrafficOrders({ date_from: dateFrom ?? undefined, date_to: dateTo ?? undefined, statuses: ["completed","accepted","active","waiting"] }),
    enabled: selectedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: prevOrders = [] } = useQuery({
    queryKey: ["ov2_prev_orders", prevFrom, prevTo],
    queryFn: () => getOnlytrafficOrders({ date_from: prevFrom!, date_to: prevTo!, statuses: ["completed","accepted","active","waiting"] }),
    enabled: !isAllTime && !!prevFrom && !!prevTo,
    staleTime: 5 * 60 * 1000,
  });

  // All-time fan attribution per link (fans table first_subscribe_link_id)
  const { data: campBreakdown = [] } = useQuery({
    queryKey: ["ov2_camp_breakdown", selectedIds.join(",")],
    queryFn: () => getFanCampaignBreakdown({ account_ids: selectedIds }),
    enabled: selectedIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  // New Fans per link — same hook as Campaigns "Last Sync · 1d" so numbers always match
  const newFansByLink = useMemo(() => {
    const m: Record<string, number> = {};
    (linksRaw as any[]).filter((l: any) => !l.deleted_at).forEach((l: any) => {
      const delta = fansDeltaLookup[String(l.id).toLowerCase()];
      if (delta) m[l.id] = delta.subsGained || 0;
    });
    return m;
  }, [fansDeltaLookup, linksRaw]);

  // ── Derived maps ──────────────────────────────────────────────────────────
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

  const clicksByAccount = useMemo(() => {
    const m: Record<string, number> = {};
    (linksRaw as any[]).filter((l: any) => !l.deleted_at).forEach((l: any) => { m[l.account_id] = (m[l.account_id] || 0) + Number(l.clicks || 0); });
    return m;
  }, [linksRaw]);

  const selectedAccounts = useMemo(() => available.filter((a: any) => selectedIds.includes(a.id)), [available, selectedIds]);


  // Transactions table covers ~last 30 days. If range starts before that, use revenue_monthly.
  const txCoverageStart = useMemo(() => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }, []);

  const revByAcct = useMemo(() => {
    if (isAllTime) {
      const m: Record<string, number> = {};
      selectedAccounts.forEach((a: any) => { m[a.id] = Number(a.ltv_total || 0); });
      return m;
    }
    const m: Record<string, number> = {};
    // Use revenue_monthly when range starts before transaction coverage (avoids partial-month gaps)
    const useMonthly = !!dateFrom && dateFrom < txCoverageStart;
    if (useMonthly) {
      selectedAccounts.forEach((a: any) => {
        const v = sumMonthlyRevenue(a.revenue_monthly, dateFrom, dateTo);
        if (v > 0) m[a.id] = v;
      });
    } else {
      txRows.forEach(r => { if (selectedIds.includes(r.account_id)) m[r.account_id] = (m[r.account_id] || 0) + Number(r.revenue || 0); });
      // Still fall back to revenue_monthly if transactions are completely empty
      if (!Object.values(m).some(v => v > 0)) {
        selectedAccounts.forEach((a: any) => {
          const v = sumMonthlyRevenue(a.revenue_monthly, dateFrom, dateTo);
          if (v > 0) m[a.id] = v;
        });
      }
    }
    return m;
  }, [txRows, selectedIds, isAllTime, selectedAccounts, dateFrom, dateTo, txCoverageStart]);

  const prevRevByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    const useMonthly = !!prevFrom && prevFrom < txCoverageStart;
    if (useMonthly) {
      selectedAccounts.forEach((a: any) => {
        const v = sumMonthlyRevenue(a.revenue_monthly, prevFrom, prevTo);
        if (v > 0) m[a.id] = v;
      });
    } else {
      prevTxRows.forEach(r => { if (selectedIds.includes(r.account_id)) m[r.account_id] = (m[r.account_id] || 0) + Number(r.revenue || 0); });
      if (!Object.values(m).some(v => v > 0)) {
        selectedAccounts.forEach((a: any) => {
          const v = sumMonthlyRevenue(a.revenue_monthly, prevFrom, prevTo);
          if (v > 0) m[a.id] = v;
        });
      }
    }
    return m;
  }, [prevTxRows, selectedIds, selectedAccounts, prevFrom, prevTo, txCoverageStart]);

  // Sum new fans per account from the same deltaLookup as Campaigns page
  const subsByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    (linksRaw as any[]).filter((l: any) => !l.deleted_at && selectedIds.includes(l.account_id)).forEach((l: any) => {
      const delta = fansDeltaLookup[String(l.id).toLowerCase()];
      if (delta) m[l.account_id] = (m[l.account_id] || 0) + (delta.subsGained || 0);
    });
    return m;
  }, [fansDeltaLookup, linksRaw, selectedIds]);

  const prevSubsByAcct = useMemo(() => {
    const m: Record<string, number> = {};
    (linksRaw as any[]).filter((l: any) => !l.deleted_at && selectedIds.includes(l.account_id)).forEach((l: any) => {
      const delta = prevFansDeltaLookup[String(l.id).toLowerCase()];
      if (delta) m[l.account_id] = (m[l.account_id] || 0) + (delta.subsGained || 0);
    });
    return m;
  }, [prevFansDeltaLookup, linksRaw, selectedIds]);

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

  const totalRevenue = useMemo(() =>
    Object.values(revByAcct).reduce((s, v) => s + v, 0) * revMult,
    [revByAcct, revMult]);

  const totalFans = useMemo(() => {
    if (isAllTime) return selectedAccounts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
    return Object.values(subsByAcct).reduce((s, v) => s + v, 0);
  }, [isAllTime, selectedAccounts, subsByAcct]);

  const totalCurrentSubs = useMemo(() =>
    selectedAccounts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0),
  [selectedAccounts]);

  const newSubsKpi = totalFans;
  const newSubsPerDay = useMemo(() => {
    if (isAllTime) return 0;
    const days = dateFrom && dateTo
      ? Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1
      : 30;
    return days > 0 ? totalFans / days : 0;
  }, [isAllTime, totalFans, dateFrom, dateTo]);

  const revenuePerSub = useMemo(() => {
    const subs = selectedAccounts.reduce((s: number, a: any) => s + Number(a.subscribers_count || 0), 0);
    const rev  = selectedAccounts.reduce((s: number, a: any) => s + Number(a.ltv_total || 0), 0);
    return subs > 0 ? rev / subs : 0;
  }, [selectedAccounts]);

  const campaignRevenue = useMemo(() =>
    (linksRaw as any[])
      .filter((l: any) => !l.deleted_at && selectedIds.includes(l.account_id))
      .reduce((s: number, l: any) => s + Number(l.revenue || 0), 0),
  [linksRaw, selectedIds]);

  const unattributedRevenue = useMemo(() => Math.max(0, totalRevenue - campaignRevenue), [totalRevenue, campaignRevenue]);

  const unattributedPct = useMemo(() =>
    totalRevenue > 0 ? (unattributedRevenue / totalRevenue) * 100 : 0,
  [unattributedRevenue, totalRevenue]);

  // Chart data
  const chartData = useMemo(() => {
    if (isAllTime) {
      // prefer revenue_monthly from account objects (pre-aggregated)
      const m: Record<string, number> = {};
      let hasMonthlyData = false;
      selectedAccounts.forEach((a: any) => {
        const monthly = a.revenue_monthly as Record<string, number> | null;
        if (!monthly || Object.keys(monthly).length === 0) return;
        hasMonthlyData = true;
        Object.entries(monthly).forEach(([month, amount]) => {
          m[month] = (m[month] || 0) + Number(amount);
        });
      });
      if (hasMonthlyData) {
        return Object.entries(m)
          .filter(([, v]) => v > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, revenue]) => ({ date: key, revenue, label: format(new Date(key + "-15"), "MMM yy") }));
      }
      // fallback: group txRows by month for all-time view
      const mb: Record<string, number> = {};
      txRows.forEach(s => {
        if (!selectedIds.includes(s.account_id)) return;
        const key = String(s.date).slice(0, 7);
        mb[key] = (mb[key] || 0) + Number(s.revenue || 0);
      });
      return Object.entries(mb).sort(([a], [b]) => a.localeCompare(b)).map(([key, revenue]) => ({
        date: key, revenue, label: format(new Date(key + "-15"), "MMM yy"),
      }));
    }
    const daysDiff = dateFrom && dateTo
      ? Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000)
      : 90;
    const byMonth = daysDiff > 90;
    const useMonthly = !!dateFrom && dateFrom < txCoverageStart;
    const m: Record<string, number> = {};

    if (useMonthly && dateFrom && dateTo) {
      // Range predates transaction coverage — use monthly bars from revenue_monthly
      const fromMonth = dateFrom.slice(0, 7);
      const toMonth   = dateTo.slice(0, 7);
      selectedAccounts.forEach((a: any) => {
        const monthly = a.revenue_monthly as Record<string, number> | null;
        if (!monthly) return;
        Object.entries(monthly).forEach(([month, amount]) => {
          if (month >= fromMonth && month <= toMonth && Number(amount) > 0)
            m[month] = (m[month] || 0) + Number(amount);
        });
      });
    } else {
      txRows.forEach(s => {
        if (!selectedIds.includes(s.account_id)) return;
        const d = String(s.date).split("T")[0];
        const key = byMonth ? d.slice(0, 7) : d;
        m[key] = (m[key] || 0) + Number(s.revenue || 0);
      });
      // Still fall back to revenue_monthly if transactions completely empty
      if (!Object.values(m).some(v => v > 0) && dateFrom && dateTo) {
        const fromMonth = dateFrom.slice(0, 7);
        const toMonth   = dateTo.slice(0, 7);
        selectedAccounts.forEach((a: any) => {
          const monthly = a.revenue_monthly as Record<string, number> | null;
          if (!monthly) return;
          Object.entries(monthly).forEach(([month, amount]) => {
            if (month >= fromMonth && month <= toMonth && Number(amount) > 0)
              m[month] = (m[month] || 0) + Number(amount);
          });
        });
      }
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([key, revenue]) => ({
      date: key, revenue,
      label: key.length === 7 || useMonthly
        ? format(new Date(key + "-15"), "MMM yy")
        : byMonth
          ? format(new Date(key + "-15"), "MMM yy")
          : format(new Date(key + "T12:00:00"), "MMM d"),
    }));
  }, [txRows, selectedIds, isAllTime, dateFrom, dateTo, selectedAccounts]);

  const chartTotal = useMemo(() => chartData.reduce((s, d) => s + d.revenue, 0), [chartData]);

  // Sparkline data derived from chart
  const revSparkData = useMemo(() => chartData.slice(-20).map(d => d.revenue), [chartData]);

  const dateLabel = useMemo(() => {
    if (isAllTime) return "All Time";
    if (dateFrom && dateTo)
      return `${format(new Date(dateFrom + "T12:00:00"), "MMM d")} – ${format(new Date(dateTo + "T12:00:00"), "MMM d, yyyy")}`;
    return "";
  }, [isAllTime, dateFrom, dateTo]);

  const campByAcct = useMemo(() => {
    const m: Record<string, Array<{ link_id: string; campaign_name: string | null; external_tracking_link_id: string | null; fan_count: number; link_deleted: boolean }>> = {};
    for (const item of (campBreakdown as any[])) {
      if (!item.account_id) continue;
      if (!m[item.account_id]) m[item.account_id] = [];
      m[item.account_id].push(item);
    }
    return m;
  }, [campBreakdown]);

  const toggleRow = (id: string) =>
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Table rows — active links only
  const tableRows = useMemo(() => {
    const rows = selectedAccounts
      .filter((a: any) => (linkCountByAccount[a.id] || 0) > 0)
      .map((a: any) => {
      const rev        = (revByAcct[a.id] || 0) * revMult;
      const prevRev    = (prevRevByAcct[a.id] || 0) * revMult;
      const spend      = spendByAcct[a.id] || 0;
      const prevSpend  = prevSpendByAcct[a.id] || 0;
      const profit     = rev - spend;
      const prevProfit = prevRev - prevSpend;
      const newFans    = isAllTime ? Number(a.subscribers_count || 0) : (subsByAcct[a.id] || 0);
      const prevNewFans = prevSubsByAcct[a.id] || 0;
      const clicks     = clicksByAccount[a.id] || 0;
      const cvr        = isAllTime && clicks > 0 ? (newFans / clicks) * 100 : null;
      const roi        = spend > 0 ? ((rev - spend) / spend) * 100 : null;
      return { account: a, rev, prevRev, spend, prevSpend, profit, prevProfit, newFans, prevNewFans, clicks, cvr, roi, linkCount: linkCountByAccount[a.id] || 0 };
    });
    const dir = tableSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (tableSort.key) {
        case "revenue":  return dir * (a.rev - b.rev);
        case "spend":    return dir * (a.spend - b.spend);
        case "profit":   return dir * (a.profit - b.profit);
        case "newFans":  return dir * (a.newFans - b.newFans);
        case "cvr":      return dir * ((a.cvr ?? -1) - (b.cvr ?? -1));
        case "roi":      return dir * ((a.roi ?? -Infinity) - (b.roi ?? -Infinity));
        case "account":  return dir * a.account.display_name.localeCompare(b.account.display_name);
        default: return 0;
      }
    });
    return rows;
  }, [selectedAccounts, isAllTime, revByAcct, prevRevByAcct, spendByAcct, prevSpendByAcct,
      subsByAcct, prevSubsByAcct, revMult, tableSort, linkCountByAccount]);

  const donutData = useMemo(() =>
    selectedAccounts
      .map((a: any) => ({ name: a.display_name, value: (revByAcct[a.id] || 0) * revMult }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value),
    [selectedAccounts, revByAcct, revMult]);
  const donutTotal = useMemo(() => donutData.reduce((s, d) => s + d.value, 0), [donutData]);

  const sortBy = (key: string) => {
    setTableSort(s => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  };

  function SortIcon({ k }: { k: string }) {
    if (tableSort.key !== k) return <ChevronDown className="w-3 h-3 ml-0.5 opacity-20" />;
    return <ChevronDown className={cn("w-3 h-3 ml-0.5 transition-transform", tableSort.dir === "asc" && "rotate-180")} style={{ color: T.blue }} />;
  }


  // ── Render ─────────────────────────────────────────────────────────────────
  const cardStyle = { background: `linear-gradient(135deg, ${T.card} 0%, ${T.cardAlt} 100%)`, border: `1px solid ${T.border}`, borderRadius: "14px" };

  const filterBtnCls = (active: boolean) => cn(
    "h-8 px-3.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap select-none",
    active
      ? "text-white"
      : "text-[#475569] hover:text-[#f1f5f9]"
  );

  return (
    <DashboardLayout>
      <div className="w-full px-6 py-4 space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="pb-3" style={{ borderBottom: `1px solid ${T.border}` }}>
          <h1 className="text-xl font-semibold" style={{ color: T.white }}>Overview</h1>
          <p className="text-sm mt-0.5 mb-3" style={{ color: T.muted }}>
            {dateLabel} · {selectedIds.length} model{selectedIds.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <AccountFilter accounts={available} selected={selectedIds} onChange={setSelectedIds} />
            {TIME_PERIODS.map(tp => (
              <button
                key={tp.key}
                onClick={() => { setTimePeriod(tp.key); setCustomDateRange(null); }}
                className={filterBtnCls(!customDateRange && timePeriod === tp.key)}
                style={!customDateRange && timePeriod === tp.key
                  ? { background: T.white, color: T.bg }
                  : { background: T.card, border: `1px solid ${T.border}`, color: T.muted }}
              >
                {tp.label}
              </button>
            ))}
            <DateRangePicker
              value={customDateRange}
              onChange={range => { if (range) setCustomDateRange(range); }}
            />
          </div>
        </div>

        {/* ── Row 1: KPI Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="LTV / Sub"
            value={fmtMoney(revenuePerSub)}
            sub="All time · revenue per subscriber"
            sparkData={revSparkData}
          />
          {/* New Subscribers — custom card */}
          <div className="p-5 flex flex-col gap-3" style={{ background: `linear-gradient(135deg, ${T.card} 0%, ${T.cardAlt} 100%)`, border: `1px solid ${T.border}`, borderRadius: "14px" }}>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T.muted }}>New Subscribers</p>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.12)", color: T.blue }}>{dateLabel || "All Time"}</span>
            </div>
            <p className="text-3xl font-bold font-mono leading-none" style={{ color: T.white }}>{newSubsKpi.toLocaleString()}</p>
            <p className="text-xs leading-snug" style={{ color: T.muted }}>
              Total Sub: {totalCurrentSubs.toLocaleString()}
              {newSubsPerDay > 0 && <span className="ml-4">{newSubsPerDay.toFixed(1)}/day</span>}
            </p>
          </div>
          <KpiCard
            label="Unattributed %"
            value={`${unattributedPct.toFixed(1)}%`}
            sub={`Campaign: ${fmtMoney(campaignRevenue)} · Unattributed: ${fmtMoney(unattributedRevenue)}`}
            sparkData={revSparkData}
          />
          <KpiCard
            label="Total Revenue"
            value={txLoading ? "…" : fmtMoney(totalRevenue)}
            sub={isAllTime ? "All time · all models" : "Net earnings in period"}
            sparkData={revSparkData}
          />
        </div>

        {/* ── Row 2: Revenue Chart ─────────────────────────────────────────── */}
        <div className="p-5" style={cardStyle}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: T.muted }}>
                Revenue Overview
              </p>
              <p className="text-2xl font-bold font-mono" style={{ color: T.white }}>
                {fmtMoney(isAllTime ? totalRevenue : chartTotal)}
              </p>
            </div>
            {chartData.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: T.muted }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: T.blue }} />
                {chartData[0]?.label} – {chartData[chartData.length - 1]?.label}
              </div>
            )}
          </div>
          <div className={chartData.length === 0 ? "flex items-center justify-center py-8" : "h-64"}>
            {chartData.length === 0 ? (
              <p className="text-sm" style={{ color: T.muted }}>
                {txLoading ? "Loading…" : "No data for this period"}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 8) - 1)} />
                  <YAxis tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false} width={52}
                    tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="revenue" fill={T.blue} radius={[3, 3, 0, 0]} maxBarSize={28}
                    activeBar={{ fill: "#60a5fa" }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Row 3: Revenue Breakdown + Model Performance ─────────────────── */}
        <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: "420px 1fr" }}>

          {/* Revenue Breakdown Donut — LEFT */}
          <div className="flex flex-col" style={cardStyle}>
            <div className="px-5 py-3.5 shrink-0" style={{ borderBottom: `1px solid ${T.border}` }}>
              <p className="text-sm font-semibold" style={{ color: T.white }}>Revenue Breakdown</p>
              <p className="text-xs mt-0.5" style={{ color: T.muted }}>{dateLabel}</p>
            </div>
            <div className="flex-1 flex flex-col items-center px-5 pt-5 pb-4 gap-3 min-h-0">
              <div className="relative shrink-0" style={{ width: 260, height: 260 }}>
                <ResponsiveContainer width={260} height={260}>
                  <PieChart>
                    <Pie
                      data={donutData.length > 0 ? donutData : [{ name: "—", value: 1 }]}
                      cx="50%" cy="50%"
                      innerRadius={82} outerRadius={122}
                      dataKey="value" strokeWidth={0} paddingAngle={2}
                    >
                      {(donutData.length > 0 ? donutData : [{ name: "—", value: 1 }]).map((_, i) => (
                        <Cell key={i} fill={donutData.length > 0 ? MODEL_COLORS[i % MODEL_COLORS.length] : T.border} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold font-mono leading-tight" style={{ color: T.white }}>{fmtMoney(donutTotal).split(".")[0]}</span>
                  <span className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: T.muted }}>Total</span>
                </div>
              </div>
              <div className="flex-1 w-full overflow-y-auto min-h-0 space-y-1.5">
                {donutData.length === 0 ? (
                  <p className="text-sm text-center" style={{ color: T.muted }}>No revenue data</p>
                ) : donutData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                      <span className="text-sm truncate" style={{ color: T.white }}>{d.name}</span>
                    </div>
                    <span className="text-sm font-mono font-semibold shrink-0" style={{ color: T.white }}>
                      {donutTotal > 0 ? `${((d.value / donutTotal) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Model Performance Table — RIGHT */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${T.border}` }}>
              <p className="text-sm font-semibold" style={{ color: T.white }}>Model Performance</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.cardAlt }}>
                    {[
                      { key: "account", label: "Account",  right: false },
                      { key: "newFans", label: "New Fans", right: true  },
                      { key: "revenue", label: "Revenue",  right: true  },
                      { key: "spend",   label: "Spend",    right: true  },
                      { key: "profit",  label: "Profit",   right: true  },
                      { key: "cvr",     label: "CVR",      right: true  },
                      { key: "roi",     label: "ROI",      right: true  },
                    ].map(col => (
                      <th key={col.key} onClick={() => sortBy(col.key)}
                        className={cn("px-4 py-2 text-[11px] font-semibold uppercase tracking-widest cursor-pointer select-none transition-colors",
                          col.right ? "text-right" : "text-left")}
                        style={{ color: T.muted }}>
                        <span className={cn("inline-flex items-center gap-0.5", col.right && "justify-end w-full")}>
                          {col.label}<SortIcon k={col.key} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: T.muted }}>
                        {txLoading ? "Loading…" : selectedIds.length === 0 ? "Select at least one model" : "No data"}
                      </td>
                    </tr>
                  ) : tableRows.map((row, rowIdx) => {
                    const a = row.account;
                    const rowBg = rowIdx % 2 === 0 ? T.card : T.cardAlt;
                    const isExpanded = expandedRows.has(a.id);
                    const fanDelta = row.newFans - row.prevNewFans;
                    const fanPct = row.prevNewFans > 0 ? (fanDelta / row.prevNewFans) * 100 : null;
                    // Use snapshot-based subs (same source as parent row) when on a date range,
                    // fall back to all-time fan attribution for All Time view
                    const fansByLink: Record<string, number> = isAllTime
                      ? Object.fromEntries((campByAcct[a.id] ?? []).map(c => [c.link_id, Number(c.fan_count)]))
                      : newFansByLink;
                    const linkIdsWithFans = new Set(
                      Object.entries(fansByLink).filter(([, v]) => v > 0).map(([k]) => k)
                    );
                    const hasData = linkIdsWithFans.size > 0;
                    const acctLinks = (linksRaw as any[])
                      .filter(l => l.account_id === a.id && !l.deleted_at && (hasData ? linkIdsWithFans.has(l.id) : true))
                      .sort((x, y) => {
                        const fd = (fansByLink[y.id] || 0) - (fansByLink[x.id] || 0);
                        return fd !== 0 ? fd : Number(y.revenue || 0) - Number(x.revenue || 0);
                      })
                      .slice(0, hasData ? 50 : 15);
                    return (
                      <React.Fragment key={a.id}>
                      <tr
                        className="transition-colors"
                        style={{ background: rowBg, borderBottom: isExpanded ? "none" : `1px solid ${T.border}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = T.border)}
                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                      >
                        {/* Account */}
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => toggleRow(a.id)}
                              className="shrink-0 rounded transition-colors"
                              style={{ color: acctLinks.length > 0 ? T.blue : T.muted, opacity: acctLinks.length > 0 ? 1 : 0.3 }}
                              disabled={acctLinks.length === 0}
                            >
                              <ChevronRight className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-90")} />
                            </button>
                            {a.avatar_thumb_url
                              ? <img src={a.avatar_thumb_url} className="w-7 h-7 rounded-full object-cover shrink-0" style={{ border: `1px solid ${T.border}` }} alt="" />
                              : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                  style={{ background: T.dark, color: T.muted }}>
                                  {(a.display_name || "?").slice(0, 2).toUpperCase()}
                                </div>}
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="text-sm font-semibold" style={{ color: T.white }}>{a.display_name}</span>
                              {a.username && <span className="text-xs" style={{ color: T.muted }}>@{a.username}</span>}
                              {row.linkCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                                  style={{ background: `${T.blue}20`, color: T.blue }}>{row.linkCount} links</span>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* New Fans */}
                        <td className="px-4 py-2 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-sm font-mono font-semibold" style={{ color: T.white }}>{row.newFans.toLocaleString()}</span>
                            {!isAllTime && (
                              <span className="text-[11px] font-mono leading-none" style={{ color: fanDelta >= 0 ? T.green : T.red }}>
                                {fanDelta >= 0 ? "▲" : "▼"} {Math.abs(fanDelta).toLocaleString()}
                                {fanPct !== null && ` / ${Math.abs(fanPct).toFixed(1)}%`}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Revenue */}
                        <td className="px-4 py-2 text-right">
                          <span className="text-sm font-mono font-semibold" style={{ color: T.white }}>{fmtMoney(row.rev)}</span>
                        </td>
                        {/* Spend */}
                        <td className="px-4 py-2 text-right">
                          <span className="text-sm font-mono font-semibold" style={{ color: row.spend > 0 ? T.white : T.muted }}>
                            {row.spend > 0 ? fmtMoney(row.spend) : "—"}
                          </span>
                        </td>
                        {/* Profit */}
                        <td className="px-4 py-2 text-right">
                          <span className="text-sm font-mono font-semibold"
                            style={{ color: row.profit >= 0 ? T.green : T.red }}>
                            {fmtMoney(row.profit)}
                          </span>
                        </td>
                        {/* CVR */}
                        <td className="px-4 py-2 text-right">
                          <span className="text-sm font-mono font-semibold"
                            style={{ color: row.cvr != null ? T.white : T.muted }}>
                            {row.cvr != null ? `${row.cvr.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                        {/* ROI */}
                        <td className="px-4 py-2 text-right">
                          <span className="text-sm font-mono font-semibold"
                            style={{ color: row.roi == null ? T.muted : row.roi >= 0 ? T.green : T.red }}>
                            {row.roi != null ? `${row.roi.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                      </tr>
                      {/* Campaign sub-header — same columns as parent, aligned */}
                      {isExpanded && (
                        <tr style={{ background: T.bg, borderTop: `1px solid ${T.border}` }}>
                          <td className="pl-10 pr-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: T.muted }}>
                            Campaigns ({acctLinks.length})
                          </td>
                          {["New Fans","Revenue","Spend","Profit","CVR","ROI"].map(h => (
                            <td key={h} className="px-4 py-1.5 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: T.muted }}>{h}</td>
                          ))}
                        </tr>
                      )}
                      {isExpanded && acctLinks.map((l: any) => {
                        const lRev    = Number(l.revenue || 0);
                        const lSpend  = Number(l.cost_total || 0);
                        const lProfit = lRev - lSpend;
                        const lCvr    = Number(l.cvr || 0);
                        const lRoi    = lSpend > 0 ? ((lRev - lSpend) / lSpend) * 100 : null;
                        const lNewFans = fansByLink[l.id];
                        const isLast  = acctLinks[acctLinks.length - 1]?.id === l.id;
                        return (
                          <tr key={l.id}
                            style={{ background: T.bg, borderTop: `1px solid ${T.border}20`, borderBottom: isLast ? `1px solid ${T.border}` : "none" }}
                            onMouseEnter={e => (e.currentTarget.style.background = `${T.dark}60`)}
                            onMouseLeave={e => (e.currentTarget.style.background = T.bg)}
                          >
                            <td className="pl-10 pr-4 py-2">
                              <button
                                className="text-left group"
                                onClick={() => setDrawerCampaign(l)}
                              >
                                <span className="text-xs font-semibold group-hover:underline" style={{ color: T.white }}>
                                  {l.campaign_name || l.external_tracking_link_id || "Unnamed"}
                                </span>
                                {l.url && <p className="text-[10px] truncate max-w-xs mt-0.5" style={{ color: T.muted }}>{l.url}</p>}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-xs font-mono" style={{ color: lNewFans ? T.white : T.muted }}>
                                {lNewFans ? lNewFans.toLocaleString() : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-xs font-mono font-semibold" style={{ color: T.white }}>{fmtMoney(lRev)}</span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-xs font-mono" style={{ color: lSpend > 0 ? T.white : T.muted }}>
                                {lSpend > 0 ? fmtMoney(lSpend) : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-xs font-mono font-semibold" style={{ color: lProfit >= 0 ? T.green : T.red }}>
                                {lProfit >= 0 ? "+" : ""}{fmtMoney(lProfit)}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-xs font-mono" style={{ color: lCvr > 0 ? T.white : T.muted }}>
                                {lCvr > 0 ? `${lCvr.toFixed(1)}%` : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-xs font-mono font-semibold"
                                style={{ color: lRoi == null ? T.muted : lRoi >= 0 ? T.green : T.red }}>
                                {lRoi != null ? `${lRoi.toFixed(1)}%` : "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>

        </div>

      </div>
      <CampaignDetailDrawer campaign={drawerCampaign} onClose={() => setDrawerCampaign(null)} onCampaignUpdated={setDrawerCampaign} />
    </DashboardLayout>
  );
}

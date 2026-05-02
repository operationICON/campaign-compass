import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, parseISO } from "date-fns";
import {
  ComposedChart, BarChart, Bar, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  ArrowLeft, TrendingUp, Users, MousePointer, DollarSign,
  ChevronRight, Info,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelAvatar } from "@/components/ModelAvatar";
import { fetchAccounts } from "@/lib/supabase-helpers";
import {
  getCampaignAnalyticsList, getCampaignTrend,
  getCampaignSpenders, getCampaignCohortArps,
} from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtC = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCShort = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
};

const TT_STYLE = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    color: "hsl(var(--foreground))",
    fontSize: 12,
  },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

const TREND_DAYS = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "All", value: 730 },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}22` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
        <div className="text-xl font-bold text-foreground leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function ArpsCard({
  label, arps, revenue, highlighted,
}: {
  label: string; arps: number; revenue: number; highlighted?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 text-center transition-colors ${highlighted ? "border-primary bg-primary/8" : "border-border bg-card"}`}>
      <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1">
        ARPS After {label}
      </div>
      <div className={`text-lg font-bold ${highlighted ? "text-primary" : "text-foreground"}`}>
        {fmtC(arps)}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">Rev {fmtC(revenue)}</div>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Campaign List ────────────────────────────────────────────────────────────

function CampaignList({
  campaigns, onSelect,
}: {
  campaigns: any[]; onSelect: (c: any) => void;
}) {
  if (campaigns.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        No campaigns found for this account.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {["Campaign", "Clicks", "Subscribers", "Revenue", "Spenders", "ROI", "ARPS", "Created"].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
            <th className="px-3 py-2.5 w-8" />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const revenue = Number(c.revenue ?? 0);
            const cost = Number(c.cost_total ?? 0);
            const profit = revenue - cost;
            const roi = cost > 0 ? (profit / cost) * 100 : null;
            const arpu = c.subscribers > 0 ? revenue / c.subscribers : 0;
            return (
              <tr
                key={c.id}
                className="border-b border-border/60 hover:bg-muted/40 cursor-pointer transition-colors"
                onClick={() => onSelect(c)}
              >
                <td className="px-3 py-3 max-w-[220px]">
                  <div className="font-medium text-foreground truncate">{c.campaign_name || "—"}</div>
                  {c.url && (
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">{c.url}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtN(c.clicks ?? 0)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtN(c.subscribers ?? 0)}</td>
                <td className="px-3 py-3 text-right tabular-nums font-medium text-green-400">
                  {fmtC(revenue)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtN(c.spenders ?? 0)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {roi !== null
                    ? <span className={roi >= 0 ? "text-green-400" : "text-red-400"}>{fmtPct(roi)}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {arpu > 0 ? fmtC(arpu) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                  {c.created_at ? format(parseISO(c.created_at), "MMM d, yy") : "—"}
                </td>
                <td className="px-3 py-3">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Campaign Detail ──────────────────────────────────────────────────────────

function CampaignDetail({ campaign, onBack }: { campaign: any; onBack: () => void }) {
  const [trendDays, setTrendDays] = useState(30);
  const [cumulative, setCumulative] = useState(false);

  const defaultAcqStart = campaign.created_at
    ? campaign.created_at.slice(0, 10)
    : format(subDays(new Date(), 90), "yyyy-MM-dd");
  const defaultAcqEnd = format(new Date(), "yyyy-MM-dd");

  const [acqStart, setAcqStart] = useState(defaultAcqStart);
  const [acqEnd, setAcqEnd] = useState(defaultAcqEnd);
  const [appliedAcqStart, setAppliedAcqStart] = useState(defaultAcqStart);
  const [appliedAcqEnd, setAppliedAcqEnd] = useState(defaultAcqEnd);
  const [revBasis, setRevBasis] = useState<"net" | "gross">("net");
  const [appliedRevBasis, setAppliedRevBasis] = useState<"net" | "gross">("net");
  const [breakEvenCost, setBreakEvenCost] = useState("");

  const { data: trendRaw = [], isLoading: trendLoading } = useQuery({
    queryKey: ["ca_trend", campaign.id, trendDays],
    queryFn: () => getCampaignTrend(campaign.id, trendDays),
  });

  const { data: spenders = [], isLoading: spendersLoading } = useQuery({
    queryKey: ["ca_spenders", campaign.id],
    queryFn: () => getCampaignSpenders(campaign.id, 20),
  });

  const { data: cohort, isLoading: cohortLoading } = useQuery({
    queryKey: ["ca_cohort", campaign.id, appliedAcqStart, appliedAcqEnd, appliedRevBasis],
    queryFn: () => getCampaignCohortArps(campaign.id, {
      acq_start: appliedAcqStart,
      acq_end: appliedAcqEnd,
      revenue_basis: appliedRevBasis,
    }),
  });

  // Build trend chart data
  const trendData = useMemo(() => {
    const rows = (trendRaw as any[]).map(r => ({
      date: format(parseISO(r.date), "MMM d"),
      clicks: Number(r.clicks ?? 0),
      subscribers: Number(r.subscribers ?? 0),
      revenue: Number(r.revenue ?? 0),
      spenders: Number(r.spenders ?? 0),
    }));

    if (!cumulative) return rows;

    let cClicks = 0, cSubs = 0, cRev = 0, cSpenders = 0;
    return rows.map(r => {
      cClicks += r.clicks;
      cSubs += r.subscribers;
      cRev += r.revenue;
      cSpenders += r.spenders;
      return { date: r.date, clicks: cClicks, subscribers: cSubs, revenue: cRev, spenders: cSpenders };
    });
  }, [trendRaw, cumulative]);

  // Break-even calculation
  const breakEvenResult = useMemo(() => {
    const cost = parseFloat(breakEvenCost);
    if (!cost || !cohort || cohort.total_source_subs === 0) return null;

    const cps = cost / cohort.total_source_subs;
    const cpc = (Number(campaign.clicks ?? 0) > 0) ? cost / Number(campaign.clicks ?? 0) : null;

    const periods = [
      { label: "48h", rev: cohort.rev_48h },
      { label: "7d", rev: cohort.rev_7d },
      { label: "14d", rev: cohort.rev_14d },
      { label: "21d", rev: cohort.rev_21d },
      { label: "30d", rev: cohort.rev_30d },
      { label: "All Time", rev: cohort.rev_all_time },
    ];

    const breakEvenPeriod = periods.find(p => p.rev >= cost);

    return { cps, cpc, breakEvenPeriod: breakEvenPeriod?.label ?? null };
  }, [breakEvenCost, cohort, campaign.clicks]);

  const revenue = Number(campaign.revenue ?? 0);
  const cost = Number(campaign.cost_total ?? 0);
  const profit = revenue - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="mt-0.5 p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground">{campaign.campaign_name || "Campaign"}</h2>
          {campaign.url && (
            <a
              href={campaign.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline truncate block mt-0.5"
            >
              {campaign.url}
            </a>
          )}
        </div>
      </div>

      {/* Overview stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Clicks" value={fmtN(campaign.clicks ?? 0)} icon={MousePointer} color="#0891b2" />
        <StatCard label="Subscribers" value={fmtN(campaign.subscribers ?? 0)} icon={Users} color="#7c3aed" />
        <StatCard label="Spenders" value={fmtN(campaign.spenders ?? 0)} icon={TrendingUp} color="#f59e0b"
          sub={campaign.subscribers > 0 ? `${fmtPct((campaign.spenders / campaign.subscribers) * 100)} rate` : undefined} />
        <StatCard label="Revenue (Net)" value={fmtC(revenue)} icon={DollarSign} color="#16a34a"
          sub={roi !== null ? `ROI ${fmtPct(roi)}` : undefined} />
      </div>

      {/* Performance Trend */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold text-foreground">Performance Trend</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {TREND_DAYS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTrendDays(opt.value)}
                  className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    trendDays === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["Daily", "Cumulative"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setCumulative(v === "Cumulative")}
                  className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    cumulative === (v === "Cumulative")
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {trendLoading ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : trendData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
            No daily data available for this campaign.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={trendData} margin={{ top: 4, right: 28, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="caSubGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0891b2" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0891b2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={36} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} width={56} />
              <RechartsTip
                {...TT_STYLE}
                formatter={(v: number, name: string) =>
                  name === "revenue" ? [fmtC(v), "Revenue"] :
                  name === "subscribers" ? [fmtN(v), "Subscribers"] :
                  name === "clicks" ? [fmtN(v), "Clicks"] :
                  [fmtN(v), "Spenders"]
                }
              />
              <Area yAxisId="left" type="monotone" dataKey="subscribers" stroke="#0891b2" strokeWidth={2} fill="url(#caSubGrad)" dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#a855f7" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-[#0891b2] inline-block" />Subscribers (left)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-[#a855f7] inline-block" />Revenue (right)</span>
        </div>
      </div>

      {/* Top Spenders */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground mb-4">Top Spenders</h3>
        {spendersLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : (spenders as any[]).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No spender data available. Fan sync may be needed.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Fan</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">First Sub</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(spenders as any[]).map((s, i) => (
                <tr key={s.id ?? i} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <ModelAvatar avatarUrl={s.avatar_url} name={s.display_name || s.username || s.fan_id} size={28} />
                      <div>
                        <div className="font-medium text-foreground text-xs">
                          {s.display_name || s.username || s.fan_id}
                        </div>
                        {s.username && s.display_name && (
                          <div className="text-[10px] text-muted-foreground">@{s.username}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {fmtDate(s.first_subscribe_date)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-green-400">
                    {fmtC(Number(s.revenue ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cohort ARPS */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-5">
        <h3 className="font-semibold text-foreground">
          Cohort ARPS
          <InfoTip text="Average Revenue Per Subscriber at different time windows after their first subscription date." />
        </h3>

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
              Acquisition Range
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={acqStart}
                onChange={e => setAcqStart(e.target.value)}
                className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground"
              />
              <span className="text-muted-foreground text-xs">→</span>
              <input
                type="date"
                value={acqEnd}
                onChange={e => setAcqEnd(e.target.value)}
                className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
              Revenue Basis
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["net", "gross"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setRevBasis(v)}
                  className={`px-3 py-1.5 text-[11px] font-medium capitalize transition-colors ${
                    revBasis === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setAppliedAcqStart(acqStart); setAppliedAcqEnd(acqEnd); setAppliedRevBasis(revBasis); }}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              Apply
            </button>
            <button
              onClick={() => {
                const s = defaultAcqStart; const e = defaultAcqEnd;
                setAcqStart(s); setAcqEnd(e); setRevBasis("net");
                setAppliedAcqStart(s); setAppliedAcqEnd(e); setAppliedRevBasis("net");
              }}
              className="px-4 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs font-medium hover:text-foreground transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        {cohortLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
            <Skeleton className="h-48 rounded-xl" />
          </div>
        ) : cohort ? (
          <>
            {/* Coverage row */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Observed Subscribers</span>
                <div className="font-bold text-foreground">{fmtN(cohort.cohort_size)}</div>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">
                  Source Subscribers Total
                  <InfoTip text="All subscribers ever acquired via this link." />
                </span>
                <div className="font-bold text-foreground">{fmtN(cohort.total_source_subs)}</div>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">
                  Coverage
                  <InfoTip text="% of source subscribers observed in the acquisition date range." />
                </span>
                <div className="font-bold text-foreground">{fmtPct(cohort.coverage)}</div>
              </div>
            </div>

            {/* ARPS cards */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
              <ArpsCard label="48h" arps={cohort.arps_48h} revenue={cohort.rev_48h} />
              <ArpsCard label="7d" arps={cohort.arps_7d} revenue={cohort.rev_7d} />
              <ArpsCard label="14d" arps={cohort.arps_14d} revenue={cohort.rev_14d} />
              <ArpsCard label="21d" arps={cohort.arps_21d} revenue={cohort.rev_21d} />
              <ArpsCard label="30d" arps={cohort.arps_30d} revenue={cohort.rev_30d} />
              <ArpsCard label="All Time" arps={cohort.arps_all_time} revenue={cohort.rev_all_time} highlighted />
            </div>

            {/* Time-to-Profit Curve + Break-even side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  Time-to-Profit Curve
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={cohort.curve} margin={{ top: 4, right: 28, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} width={56} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={v => `$${v.toFixed(2)}`} width={52} />
                    <RechartsTip
                      {...TT_STYLE}
                      formatter={(v: number, name: string) =>
                        name === "revenue" ? [fmtC(v), "Cumulative Revenue"] : [fmtC(v), "ARPS"]
                      }
                    />
                    <Bar yAxisId="left" dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {cohort.curve.map((_, i) => (
                        <Cell key={i} fill="#0891b2" fillOpacity={0.7} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="arps" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: "#f59e0b", r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Break-even Calculator */}
              <div className="bg-background rounded-xl border border-border p-4 flex flex-col gap-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Break-even Calculator
                  <InfoTip text="Enter your total promo cost to see when revenue covers it." />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Cost Per Promo</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 250.00"
                      value={breakEvenCost}
                      onChange={e => setBreakEvenCost(e.target.value)}
                      className="w-full bg-card border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-foreground"
                    />
                  </div>
                </div>

                {breakEvenResult ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cost / Sub</span>
                      <span className="font-semibold text-foreground">{fmtC(breakEvenResult.cps)}</span>
                    </div>
                    {breakEvenResult.cpc !== null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cost / Click</span>
                        <span className="font-semibold text-foreground">{fmtC(breakEvenResult.cpc!)}</span>
                      </div>
                    )}
                    <div className="mt-1 pt-2 border-t border-border flex justify-between items-center">
                      <span className="text-muted-foreground">Break-even</span>
                      <span className={`font-bold text-sm ${breakEvenResult.breakEvenPeriod ? "text-green-400" : "text-red-400"}`}>
                        {breakEvenResult.breakEvenPeriod
                          ? `Within ${breakEvenResult.breakEvenPeriod}`
                          : "Not reached"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Enter cost settings to estimate break-even time.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function CampaignAnalyticsTab() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);

  const { data: rawAccounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  const accounts = useMemo(() => {
    return [...(rawAccounts as any[])]
      .filter(a => a.is_active !== false)
      .sort((a, b) => (Number(b.subscribers_count ?? 0)) - (Number(a.subscribers_count ?? 0)));
  }, [rawAccounts]);

  const activeAccountId = selectedAccountId ?? accounts[0]?.id ?? null;

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ["ca_campaigns", activeAccountId],
    queryFn: () => getCampaignAnalyticsList(activeAccountId!),
    enabled: !!activeAccountId,
  });

  const activeAccount = accounts.find((a: any) => a.id === activeAccountId);

  if (accountsLoading) {
    return (
      <div className="space-y-3 py-4">
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Account selector */}
      <div className="flex flex-wrap gap-2">
        {accounts.map((a: any) => (
          <button
            key={a.id}
            onClick={() => { setSelectedAccountId(a.id); setSelectedCampaign(null); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
              a.id === activeAccountId
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            <ModelAvatar avatarUrl={a.avatar_thumb_url} name={a.display_name || a.username} size={22} />
            <span>{a.display_name || a.username}</span>
            {a.subscribers_count != null && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                a.id === activeAccountId ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {fmtN(a.subscribers_count)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      {selectedCampaign ? (
        <CampaignDetail
          campaign={selectedCampaign}
          onBack={() => setSelectedCampaign(null)}
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div>
              <span className="font-semibold text-foreground text-sm">
                {activeAccount?.display_name || activeAccount?.username || "Campaigns"}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {campaignsLoading ? "…" : `${(campaigns as any[]).length} campaigns`}
              </span>
            </div>
          </div>

          {campaignsLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : (
            <CampaignList
              campaigns={campaigns as any[]}
              onSelect={c => setSelectedCampaign(c)}
            />
          )}
        </div>
      )}
    </div>
  );
}

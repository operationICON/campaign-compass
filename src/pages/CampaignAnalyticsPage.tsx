import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";
import {
  ComposedChart, BarChart, Bar, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  ChevronLeft, Search, Info, Copy, Check,
  TrendingUp, ChevronDown,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelAvatar } from "@/components/ModelAvatar";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts } from "@/lib/supabase-helpers";
import {
  getCampaignAnalyticsList, getCampaignTrend,
  getCampaignSpenders, getCampaignCohortArps,
} from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
const CAMPAIGN_COLORS = [
  "#0891b2", "#7c3aed", "#16a34a", "#f59e0b", "#ec4899",
  "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316",
];
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
const TREND_WINDOWS = [
  { label: "Last 7 Days", value: 7 },
  { label: "Last 14 Days", value: 14 },
  { label: "Last 30 Days", value: 30 },
  { label: "Last 90 Days", value: 90 },
  { label: "All Time", value: 730 },
];

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help inline-block ml-1 shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

// ─── ACCOUNT DROPDOWN ────────────────────────────────────────────────────────
function AccountDropdown({
  accounts,
  selected,           // "all" | account UUID
  onChange,
}: {
  accounts: any[];
  selected: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = selected === "all" ? null : accounts.find((a: any) => a.id === selected);
  const label = current
    ? (current.display_name || current.username)
    : `All Accounts (${accounts.length})`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted/40 transition-colors min-w-[200px]"
      >
        {current ? (
          <ModelAvatar avatarUrl={current.avatar_thumb_url} name={label} size={20} />
        ) : (
          <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
            {accounts.length}
          </span>
        )}
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-xl shadow-xl z-20 py-1 min-w-[240px] max-h-[360px] overflow-y-auto">
            {/* Select All */}
            <button
              onClick={() => { onChange("all"); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                selected === "all" ? "text-primary bg-primary/10" : "text-foreground hover:bg-muted/40"
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                {accounts.length}
              </span>
              <span className="font-medium">All Accounts</span>
              {selected === "all" && <span className="ml-auto text-primary text-xs">✓</span>}
            </button>
            <div className="h-px bg-border mx-3 my-1" />
            {accounts.map((a: any) => (
              <button
                key={a.id}
                onClick={() => { onChange(a.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                  selected === a.id ? "text-primary bg-primary/10" : "text-foreground hover:bg-muted/40"
                }`}
              >
                <ModelAvatar avatarUrl={a.avatar_thumb_url} name={a.display_name || a.username} size={24} />
                <span className="flex-1 text-left truncate">{a.display_name || a.username}</span>
                {a.subscribers_count != null && (
                  <span className="text-[11px] text-muted-foreground tabular-nums ml-1">
                    {fmtN(a.subscribers_count)}
                  </span>
                )}
                {selected === a.id && <span className="ml-1 text-primary text-xs">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── LIST VIEW ────────────────────────────────────────────────────────────────
function ListView({
  accounts,
  selectedAccount,
  onSelectAccount,
  onOpenCampaign,
}: {
  accounts: any[];
  selectedAccount: string;   // "all" | account UUID
  onSelectAccount: (v: string) => void;
  onOpenCampaign: (c: any) => void;
}) {
  const [search, setSearch] = useState("");
  const accountId = selectedAccount === "all" ? undefined : selectedAccount;

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["ca_campaigns", selectedAccount],
    queryFn: () => getCampaignAnalyticsList(accountId),
  });

  // Build a lookup so we can show the account name in multi-account mode
  const accountMap = useMemo(() => {
    const m: Record<string, any> = {};
    accounts.forEach((a: any) => { m[a.id] = a; });
    return m;
  }, [accounts]);

  const showAccountCol = selectedAccount === "all";

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (campaigns as any[]).filter(c =>
      !q || (c.campaign_name ?? "").toLowerCase().includes(q)
    );
  }, [campaigns, search]);

  const colCount = showAccountCol ? 12 : 11;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaign Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor your campaigns to track subscribers and revenue performance.
          </p>
        </div>
      </div>

      {/* Controls row: account dropdown + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <AccountDropdown
          accounts={accounts}
          selected={selectedAccount}
          onChange={onSelectAccount}
        />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground w-52 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {showAccountCol && (
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Account</th>
                )}
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide min-w-[220px]">Name</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Clicks</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Subscribers</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Cost</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Revenue (Net)</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Spenders</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Profit</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">ROI</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">CVR</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">ARPS/Sub</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Created at</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-6 text-center text-muted-foreground text-sm">
                    {search ? "No campaigns match your search." : "No campaigns found."}
                  </td>
                </tr>
              ) : (
                filtered.map((c: any, idx: number) => {
                  const revenue = Number(c.revenue ?? 0);
                  const cost = Number(c.cost_total ?? 0);
                  const profit = c.profit != null ? Number(c.profit) : revenue - cost;
                  const roi = c.roi != null ? Number(c.roi) : (cost > 0 ? (profit / cost) * 100 : null);
                  const arps = c.revenue_per_subscriber != null ? Number(c.revenue_per_subscriber) : ((c.subscribers ?? 0) > 0 ? revenue / c.subscribers : 0);
                  const cvr = c.cvr != null ? Number(c.cvr) : ((c.clicks ?? 0) > 0 ? ((c.subscribers ?? 0) / c.clicks) * 100 : null);
                  const color = CAMPAIGN_COLORS[idx % CAMPAIGN_COLORS.length];
                  const acct = accountMap[c.account_id];
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/60 hover:bg-muted/30 cursor-pointer transition-colors group"
                      onClick={() => onOpenCampaign(c)}
                    >
                      {showAccountCol && (
                        <td className="px-4 py-3">
                          {(c.account_display_name || c.account_username || acct) ? (
                            <div className="flex items-center gap-1.5">
                              <ModelAvatar
                                avatarUrl={c.account_avatar_thumb_url || acct?.avatar_thumb_url}
                                name={c.account_display_name || c.account_username || acct?.display_name}
                                size={20}
                              />
                              <span className="text-xs text-muted-foreground truncate max-w-[70px]">
                                {c.account_display_name || c.account_username || acct?.display_name}
                              </span>
                            </div>
                          ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div
                            className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold mt-0.5"
                            style={{ background: color }}
                          >
                            {(c.campaign_name ?? "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate max-w-[200px] group-hover:text-primary transition-colors">
                              {c.campaign_name || "—"}
                            </div>
                            {c.url && (
                              <div className="text-[11px] text-muted-foreground truncate max-w-[200px] mt-0.5">
                                {c.url}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{fmtN(c.clicks ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{fmtN(c.subscribers ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {cost > 0 ? fmtC(cost) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-green-400">
                        {fmtC(revenue)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1 text-foreground">
                          <span>{fmtN(c.spenders ?? 0)}</span>
                          {(c.spenders ?? 0) > 0 && (
                            <span className="text-[10px] text-muted-foreground">spenders</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {cost > 0
                          ? <span className={profit >= 0 ? "text-green-400" : "text-red-400"}>{fmtC(profit)}</span>
                          : <span className="text-muted-foreground/40">N/A</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {roi !== null
                          ? <span className={roi >= 0 ? "text-green-400" : "text-red-400"}>{fmtPct(roi)}</span>
                          : <span className="text-muted-foreground/40">N/A</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {cvr !== null ? fmtPct(cvr) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {arps > 0 ? fmtC(arps) : <span className="text-muted-foreground/40">$0.00</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap text-xs">
                        {c.created_at ? format(parseISO(c.created_at), "MMM d, h:mmaaa") : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── PERFORMANCE VIEW ─────────────────────────────────────────────────────────
function PerformanceView({
  campaign,
  onBack,
  onCohortArps,
}: {
  campaign: any;
  onBack: () => void;
  onCohortArps: () => void;
}) {
  const [trendWindow, setTrendWindow] = useState(30);
  const [cumulative, setCumulative] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showWindowDropdown, setShowWindowDropdown] = useState(false);

  const { data: trendRaw = [], isLoading: trendLoading } = useQuery({
    queryKey: ["ca_trend", campaign.id, trendWindow],
    queryFn: () => getCampaignTrend(campaign.id, trendWindow),
  });

  const { data: spenders = [], isLoading: spendersLoading } = useQuery({
    queryKey: ["ca_spenders", campaign.id],
    queryFn: () => getCampaignSpenders(campaign.id, 20),
  });

  const trendData = useMemo(() => {
    const rows = (trendRaw as any[]).map(r => ({
      date: format(parseISO(r.date), "MMM d"),
      clicks: Number(r.clicks ?? 0),
      subscribers: Number(r.subscribers ?? 0),
      revenue: Number(r.revenue ?? 0),
      spenders: Number(r.spenders ?? 0),
    }));
    if (!cumulative) return rows;
    let cSubs = 0, cRev = 0;
    return rows.map(r => {
      cSubs += r.subscribers;
      cRev += r.revenue;
      return { ...r, subscribers: cSubs, revenue: cRev };
    });
  }, [trendRaw, cumulative]);

  const revenue = Number(campaign.revenue ?? 0);
  const windowLabel = TREND_WINDOWS.find(w => w.value === trendWindow)?.label ?? "Last 30 Days";

  const handleCopyUrl = () => {
    if (campaign.url) {
      navigator.clipboard.writeText(campaign.url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Campaign Analytics
      </button>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-foreground">
          {campaign.campaign_name || "Campaign"} — Performance
        </h1>
        <div className="flex items-center gap-2">
          {campaign.url && (
            <button
              onClick={handleCopyUrl}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Share Link"}
            </button>
          )}
          <button
            onClick={onCohortArps}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Cohort ARPS
          </button>
        </div>
      </div>

      {/* Overview card */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-6">
          {/* Left — campaign info */}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Campaign</div>
            <div className="text-lg font-bold text-foreground">{campaign.campaign_name || "—"}</div>
            {campaign.url && (
              <a
                href={campaign.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline break-all mt-1 block"
              >
                {campaign.url}
              </a>
            )}
          </div>
          {/* Right — stats */}
          <div className="flex flex-wrap gap-6 lg:gap-10 shrink-0">
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Clicks</div>
              <div className="text-2xl font-bold text-foreground mt-1">{fmtN(campaign.clicks ?? 0)}</div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Subscribers</div>
              <div className="text-2xl font-bold text-foreground mt-1">{fmtN(campaign.subscribers ?? 0)}</div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Spenders</div>
              <div className="text-2xl font-bold text-foreground mt-1">{fmtN(campaign.spenders ?? 0)}</div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Revenue</div>
              <div className="text-2xl font-bold text-green-400 mt-1">{fmtC(revenue)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Trend chart */}
      <div className="bg-card rounded-xl border border-border p-5">
        {/* Controls row */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          {/* Date window dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowWindowDropdown(v => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground hover:bg-muted/40 transition-colors"
            >
              {windowLabel}
              <ChevronLeft className="h-3.5 w-3.5 rotate-[-90deg]" />
            </button>
            {showWindowDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-xl shadow-xl z-20 py-1 min-w-[160px]">
                {TREND_WINDOWS.map(w => (
                  <button
                    key={w.value}
                    onClick={() => { setTrendWindow(w.value); setShowWindowDropdown(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                      trendWindow === w.value
                        ? "text-primary bg-primary/10"
                        : "text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Daily / Cumulative */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["Daily", "Cumulative"] as const).map(v => (
              <button
                key={v}
                onClick={() => setCumulative(v === "Cumulative")}
                className={`px-4 py-2 text-[12px] font-medium transition-colors ${
                  cumulative === (v === "Cumulative")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Chart title */}
        <div className="flex items-center gap-1 mb-3">
          <span className="text-sm font-semibold text-foreground">Performance Trend</span>
          <InfoTip text="Daily new subscribers (left axis) and daily revenue (right axis) for this campaign." />
        </div>

        {trendLoading ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : trendData.length === 0 ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground text-sm">
            No daily data synced for this campaign yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={trendData} margin={{ top: 4, right: 32, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="perfSubGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0891b2" stopOpacity={0.35} />
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
                  [fmtN(v), name]
                }
              />
              <Area yAxisId="left" type="monotone" dataKey="subscribers" stroke="#0891b2" strokeWidth={2} fill="url(#perfSubGrad)" dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#a855f7" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        <div className="flex items-center gap-5 mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded bg-[#0891b2] inline-block" />Subscribers (left)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded bg-[#a855f7] inline-block" />Revenue (right)
          </span>
        </div>
      </div>

      {/* Top Spenders */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Top Spenders</h2>
        </div>

        {spendersLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : (spenders as any[]).length === 0 ? (
          <div className="px-5 py-5 text-center text-muted-foreground text-sm">
            No spender data yet. Fan sync may be needed.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Fan</th>
                <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tracking Period</th>
                <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Revenue</th>
                <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(spenders as any[]).map((s: any, i: number) => {
                const subDate = s.first_subscribe_date
                  ? parseISO(s.first_subscribe_date)
                  : null;
                const endDate = subDate
                  ? format(new Date(subDate.getTime() + 14 * 86400000), "MMM d, yyyy")
                  : null;
                return (
                  <tr key={s.id ?? i} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <ModelAvatar avatarUrl={s.avatar_url} name={s.display_name || s.username || s.fan_id} size={32} />
                        <div>
                          <div className="font-medium text-foreground text-sm">
                            {s.display_name || s.username || s.fan_id}
                          </div>
                          {s.username && (
                            <div className="text-[11px] text-muted-foreground">@{s.username}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {subDate && endDate
                        ? `${format(subDate, "MMM d, yyyy")} — ${endDate}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-green-400">
                      {fmtC(Number(s.revenue ?? 0))}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="px-3 py-1 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer">
                        View
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {(spenders as any[]).length > 0 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Page 1 of 1</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COHORT ARPS VIEW ─────────────────────────────────────────────────────────
function CohortArpsView({
  campaign,
  onBack,
}: {
  campaign: any;
  onBack: () => void;
}) {
  const defaultStart = campaign.created_at
    ? campaign.created_at.slice(0, 10)
    : format(subDays(new Date(), 90), "yyyy-MM-dd");
  const defaultEnd = format(new Date(), "yyyy-MM-dd");

  const [acqStart, setAcqStart] = useState(defaultStart);
  const [acqEnd, setAcqEnd] = useState(defaultEnd);
  const [appliedStart, setAppliedStart] = useState(defaultStart);
  const [appliedEnd, setAppliedEnd] = useState(defaultEnd);
  const [revBasis, setRevBasis] = useState<"net" | "gross">("net");
  const [appliedBasis, setAppliedBasis] = useState<"net" | "gross">("net");
  const [breakEvenCost, setBreakEvenCost] = useState("");

  const { data: cohort, isLoading } = useQuery({
    queryKey: ["ca_cohort", campaign.id, appliedStart, appliedEnd, appliedBasis],
    queryFn: () =>
      getCampaignCohortArps(campaign.id, {
        acq_start: appliedStart,
        acq_end: appliedEnd,
        revenue_basis: appliedBasis,
      }),
  });

  const breakEven = useMemo(() => {
    const cost = parseFloat(breakEvenCost);
    if (!cost || !cohort || cohort.total_source_subs === 0) return null;
    const cps = cost / cohort.total_source_subs;
    const cpc =
      Number(campaign.clicks ?? 0) > 0
        ? cost / Number(campaign.clicks ?? 0)
        : null;
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

  const isLowCoverage = cohort ? cohort.coverage < 70 : false;

  const arpsCards = cohort
    ? [
        { label: "48H",      arps: cohort.arps_48h,      rev: cohort.rev_48h },
        { label: "7D",       arps: cohort.arps_7d,       rev: cohort.rev_7d },
        { label: "14D",      arps: cohort.arps_14d,      rev: cohort.rev_14d },
        { label: "21D",      arps: cohort.arps_21d,      rev: cohort.rev_21d },
        { label: "30D",      arps: cohort.arps_30d,      rev: cohort.rev_30d },
        { label: "ALL TIME", arps: cohort.arps_all_time, rev: cohort.rev_all_time },
      ]
    : [];

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        {campaign.campaign_name || "Campaign"}
      </button>

      {/* Page title */}
      <h1 className="text-xl font-bold text-foreground">
        {campaign.campaign_name || "Campaign"} — Cohort ARPS
      </h1>

      {/* Controls */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Acquisition Range
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={acqStart}
                onChange={e => setAcqStart(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-muted-foreground text-sm">→</span>
              <input
                type="date"
                value={acqEnd}
                onChange={e => setAcqEnd(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Revenue Basis
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["net", "gross"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setRevBasis(v)}
                  className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                    revBasis === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30 bg-card"
                  }`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setAppliedStart(acqStart); setAppliedEnd(acqEnd); setAppliedBasis(revBasis); }}
              className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Apply
            </button>
            <button
              onClick={() => {
                setAcqStart(defaultStart); setAcqEnd(defaultEnd); setRevBasis("net");
                setAppliedStart(defaultStart); setAppliedEnd(defaultEnd); setAppliedBasis("net");
              }}
              className="px-5 py-2 bg-muted text-muted-foreground rounded-lg text-sm font-medium hover:text-foreground transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* ARPS Section */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-5">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-foreground">Time-to-Profit Cohort ARPS</h2>
          {isLowCoverage && (
            <span className="px-2.5 py-0.5 bg-red-500/15 text-red-400 rounded-full text-[11px] font-semibold">
              Low coverage
            </span>
          )}
          <InfoTip text="Average Revenue Per Subscriber computed at specific time windows after their first subscription date." />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="flex gap-6">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-40 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          </div>
        ) : cohort ? (
          <>
            {/* Coverage stats */}
            <div className="flex flex-wrap gap-8">
              <div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Observed Subscribers
                  <InfoTip text="Subscribers with a known first subscription date within the acquisition range." />
                </div>
                <div className="text-2xl font-bold text-foreground mt-1">{fmtN(cohort.cohort_size)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Source Subscribers Total
                  <InfoTip text="All subscribers ever acquired via this campaign link." />
                </div>
                <div className="text-2xl font-bold text-foreground mt-1">{fmtN(cohort.total_source_subs)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Coverage
                  <InfoTip text="% of source subscribers observed in the selected acquisition range." />
                </div>
                <div className="text-2xl font-bold text-foreground mt-1">{fmtPct(cohort.coverage)}</div>
              </div>
            </div>

            {/* ARPS cards */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              {arpsCards.map(({ label, arps, rev }) => (
                <div key={label} className="bg-background rounded-xl border border-border p-3">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                    ARPS After {label}
                  </div>
                  <div className="text-lg font-bold text-foreground">{fmtC(arps)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Revenue {fmtC(rev)}</div>
                </div>
              ))}
            </div>

            {/* Curve + Break-even */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-2">
              <div className="lg:col-span-2">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-3">
                  Time-to-Profit Curve
                  <InfoTip text="Cumulative revenue (bars) and ARPS (line) at each time milestone after subscription." />
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={cohort.curve} margin={{ top: 4, right: 32, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={fmtCShort} width={60} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={v => `$${v.toFixed(2)}`} width={56} />
                    <RechartsTip
                      {...TT_STYLE}
                      formatter={(v: number, name: string) =>
                        name === "revenue" ? [fmtC(v), "Cumulative Revenue"] : [fmtC(v), "ARPS"]
                      }
                    />
                    <Bar yAxisId="left" dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {cohort.curve.map((_, i) => (
                        <Cell key={i} fill="#0891b2" fillOpacity={0.75} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="arps" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: "#f59e0b", r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-5 mt-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#0891b2]/75 inline-block" /> Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded bg-[#f59e0b] inline-block" /> ARPS</span>
                </div>
                {cohort.cohort_size > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-2">
                    Observed data from {fmtDate(appliedStart)}.
                  </div>
                )}
              </div>

              {/* Break-even Calculator */}
              <div className="bg-background rounded-xl border border-border p-5">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-4">
                  Break-even Calculator
                  <InfoTip text="Enter your total promo cost to see which time window generates enough revenue to cover it." />
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1.5 font-medium">Cost Input</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 250.00"
                          value={breakEvenCost}
                          onChange={e => setBreakEvenCost(e.target.value)}
                          className="w-full bg-card border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">Cost Per Promo</span>
                    </div>
                  </div>

                  {breakEven ? (
                    <div className="space-y-2.5 pt-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Cost Per Sub</span>
                        <span className="font-semibold text-foreground">—</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Cost Per Sub — </span>
                        <span className="font-semibold text-foreground">{fmtC(breakEven.cps)}</span>
                      </div>
                      {breakEven.cpc !== null && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Cost Per Click — </span>
                          <span className="font-semibold text-foreground">{fmtC(breakEven.cpc!)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t border-border">
                        <div className="text-[11px] text-muted-foreground mb-1 font-medium">Break-even at:</div>
                        <div className={`text-lg font-bold ${breakEven.breakEvenPeriod ? "text-green-400" : "text-red-400"}`}>
                          {breakEven.breakEvenPeriod
                            ? `Within ${breakEven.breakEvenPeriod}`
                            : "Not reached in 30d"}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground pt-1">
                      Based on {fmtN(cohort.total_source_subs)} source subscribers, {fmtN(Number(campaign.clicks ?? 0))} clicks.
                      <br /><br />
                      Enter cost settings to estimate break-even time.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── PAGE ROOT ────────────────────────────────────────────────────────────────
type View = "list" | "performance" | "cohort";

export default function CampaignAnalyticsPage() {
  const [view, setView] = useState<View>("list");
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);

  const { data: rawAccounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  const accounts = useMemo(
    () =>
      [...(rawAccounts as any[])]
        .filter(a => a.is_active !== false)
        .sort((a, b) => Number(b.subscribers_count ?? 0) - Number(a.subscribers_count ?? 0)),
    [rawAccounts]
  );

  const handleOpenCampaign = (c: any) => {
    setSelectedCampaign(c);
    setView("performance");
  };

  return (
    <DashboardLayout>
      {view === "list" && (
        <ListView
          accounts={accounts}
          selectedAccount={selectedAccount}
          onSelectAccount={setSelectedAccount}
          onOpenCampaign={handleOpenCampaign}
        />
      )}
      {view === "performance" && selectedCampaign && (
        <PerformanceView
          campaign={selectedCampaign}
          onBack={() => setView("list")}
          onCohortArps={() => setView("cohort")}
        />
      )}
      {view === "cohort" && selectedCampaign && (
        <CohortArpsView
          campaign={selectedCampaign}
          onBack={() => setView("performance")}
        />
      )}
    </DashboardLayout>
  );
}

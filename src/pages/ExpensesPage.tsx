import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { CsvCostImportModal } from "@/components/dashboard/CsvCostImportModal";
import { fetchTrackingLinks, fetchAccounts, clearTrackingLinkSpend } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, BarChart3, Receipt, Pencil, X, Plus, Upload,
  ChevronUp, ChevronDown, Search, Lock
} from "lucide-react";

const ACCOUNT_COLORS: Record<string, { bg: string; text: string }> = {
  "jessie_ca_xo": { bg: "bg-[hsl(24_95%_53%/0.15)]", text: "text-[hsl(24_95%_53%)]" },
  "miakitty.ts": { bg: "bg-[hsl(0_72%_51%/0.15)]", text: "text-[hsl(0_72%_51%)]" },
  "zoey.skyy": { bg: "bg-[hsl(40_96%_53%/0.15)]", text: "text-[hsl(40_96%_53%)]" },
  "ella_cherryy": { bg: "bg-[hsl(15_80%_45%/0.15)]", text: "text-[hsl(15_80%_45%)]" },
  "aylin_bigts": { bg: "bg-[hsl(30_75%_40%/0.15)]", text: "text-[hsl(30_75%_40%)]" },
};

function getAccountColor(username: string | null) {
  if (!username) return { bg: "bg-secondary", text: "text-muted-foreground" };
  const key = username.replace("@", "").toLowerCase();
  return ACCOUNT_COLORS[key] || { bg: "bg-secondary", text: "text-muted-foreground" };
}

const STATUS_STYLES: Record<string, string> = {
  SCALE: "bg-[hsl(142_71%_45%/0.1)] text-[hsl(142_71%_45%)]",
  WATCH: "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]",
  LOW: "bg-[hsl(38_92%_50%/0.12)] text-[hsl(38_92%_50%)]",
  KILL: "bg-[hsl(0_84%_60%/0.12)] text-[hsl(0_84%_60%)]",
  DEAD: "bg-[hsl(0_72%_51%/0.1)] text-[hsl(0_72%_51%)]",
  NO_DATA: "bg-secondary text-muted-foreground",
};

const SPEND_TYPE_STYLES: Record<string, string> = {
  CPC: "bg-[hsl(217_91%_60%/0.15)] text-[hsl(217_91%_60%)]",
  CPL: "bg-primary/15 text-primary",
  FIXED: "bg-[hsl(38_92%_50%/0.15)] text-[hsl(38_92%_50%)]",
};

type SortKey = "campaign_name" | "cost_total" | "revenue" | "profit" | "roi";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (v: number) => `${v.toFixed(1)}%`;

function formatCostValue(type: string | null, value: number | null) {
  if (!type || value == null) return "—";
  const v = Number(value);
  if (type === "CPC") return `$${v.toFixed(2)}/click`;
  if (type === "CPL") return `$${v.toFixed(2)}/sub`;
  return `$${v.toFixed(0)} fixed`;
}

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [addManuallyOpen, setAddManuallyOpen] = useState(false);
  const [clearConfirmId, setClearConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortAsc, setSortAsc] = useState(false);
  const [accountFilter, setAccountFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<"all" | "this_month" | "last_month">("all");

  const { data: allLinks = [], isLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: () => fetchTrackingLinks(),
  });

  // Debug log to help diagnose data issues
  useEffect(() => {
    if (allLinks.length > 0) {
      const withSpend = allLinks.filter((l: any) => Number(l.cost_total) > 0);
      console.log('Expenses page — tracking_links with spend:', withSpend.length, withSpend[0]);
      console.log('Expenses page — first 3 links cost_total:', allLinks.slice(0, 3).map((l: any) => ({ name: l.campaign_name, cost_total: l.cost_total, profit: l.profit, roi: l.roi, status: l.status })));
    }
  }, [allLinks]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  const linksWithSpend = useMemo(() =>
    allLinks.filter((l: any) => l.cost_total !== null && l.cost_total !== undefined && Number(l.cost_total) > 0),
    [allLinks]
  );

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const totalSpend = useMemo(() => linksWithSpend.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0), [linksWithSpend]);
  const spendThisMonth = useMemo(() =>
    linksWithSpend
      .filter((l: any) => l.updated_at >= monthStart)
      .reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0),
    [linksWithSpend, monthStart]
  );
  const totalProfit = useMemo(() => linksWithSpend.reduce((s: number, l: any) => s + Number(l.profit || 0), 0), [linksWithSpend]);
  const blendedROI = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : null;
  const campaignsWithSpend = linksWithSpend.length;

  // Distinct values for filters
  const distinctAccounts = useMemo(() => {
    const map = new Map<string, string>();
    linksWithSpend.forEach((l: any) => {
      const u = l.accounts?.username;
      if (u) map.set(l.account_id, u);
    });
    return Array.from(map.entries()).map(([id, username]) => ({ id, username }));
  }, [linksWithSpend]);

  const distinctSources = useMemo(() => {
    const set = new Set<string>();
    linksWithSpend.forEach((l: any) => set.add(l.source_tag || "Untagged"));
    return Array.from(set).sort();
  }, [linksWithSpend]);

  // Date filter helpers
  const now2 = new Date();
  const thisMonthStart = new Date(now2.getFullYear(), now2.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now2.getFullYear(), now2.getMonth() - 1, 1).toISOString();

  // Filtered + sorted
  const filtered = useMemo(() => {
    let result = linksWithSpend;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) ||
        (l.accounts?.username || "").toLowerCase().includes(q)
      );
    }
    if (accountFilter !== "all") result = result.filter((l: any) => l.account_id === accountFilter);
    if (sourceFilter !== "all") result = result.filter((l: any) => (l.source_tag || "Untagged") === sourceFilter);
    if (dateFilter === "this_month") result = result.filter((l: any) => l.updated_at >= thisMonthStart);
    if (dateFilter === "last_month") result = result.filter((l: any) => l.updated_at >= lastMonthStart && l.updated_at < thisMonthStart);
    result.sort((a: any, b: any) => {
      const av = sortKey === "campaign_name" ? (a.campaign_name || "") : Number(a[sortKey] || 0);
      const bv = sortKey === "campaign_name" ? (b.campaign_name || "") : Number(b[sortKey] || 0);
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return result;
  }, [linksWithSpend, searchQuery, sortKey, sortAsc, accountFilter, sourceFilter, dateFilter, thisMonthStart, lastMonthStart]);

  // Breakdown by source
  const bySource = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; spend: number; ltv: number; profit: number }> = {};
    linksWithSpend.forEach((l: any) => {
      const src = l.source_tag || "Untagged";
      if (!map[src]) map[src] = { source: src, campaigns: 0, spend: 0, ltv: 0, profit: 0 };
      map[src].campaigns++;
      map[src].spend += Number(l.cost_total || 0);
      map[src].ltv += Number(l.revenue || 0);
      map[src].profit += Number(l.profit || 0);
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }, [linksWithSpend]);

  // Breakdown by model
  const byModel = useMemo(() => {
    const map: Record<string, { name: string; username: string; avatar: string | null; campaigns: number; spend: number; ltv: number; profit: number }> = {};
    linksWithSpend.forEach((l: any) => {
      const aid = l.account_id;
      if (!map[aid]) {
        const acc = accounts.find((a: any) => a.id === aid);
        map[aid] = {
          name: acc?.display_name || l.accounts?.display_name || "Unknown",
          username: acc?.username || l.accounts?.username || "",
          avatar: acc?.avatar_thumb_url || null,
          campaigns: 0, spend: 0, ltv: 0, profit: 0
        };
      }
      map[aid].campaigns++;
      map[aid].spend += Number(l.cost_total || 0);
      map[aid].ltv += Number(l.revenue || 0);
      map[aid].profit += Number(l.profit || 0);
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }, [linksWithSpend, accounts]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="h-3 w-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const handleClearSpend = async (link: any) => {
    try {
      await clearTrackingLinkSpend(link.id, link.campaign_id);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success("Spend cleared");
      setClearConfirmId(null);
    } catch {
      toast.error("Failed to clear spend");
    }
  };

  const onSpendSaved = () => {
    setCostSlideIn(null);
    setAddManuallyOpen(false);
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    toast.success("Spend saved — ROI and Profit updated");
  };

  const hasAnySpend = totalSpend > 0;

  const kpis = [
    { label: "Total Spend", value: hasAnySpend ? fmtC(totalSpend) : "$0.00", icon: DollarSign, color: "text-foreground" },
    { label: "Spend This Month", value: hasAnySpend ? fmtC(spendThisMonth) : "$0.00", icon: Receipt, color: "text-foreground" },
    { label: "Total Profit", value: hasAnySpend ? (totalProfit >= 0 ? `+${fmtC(totalProfit)}` : fmtC(totalProfit)) : "—", icon: TrendingUp, color: hasAnySpend ? (totalProfit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground", sub: !hasAnySpend ? "Enter spend to calculate" : undefined },
    { label: "Blended ROI", value: hasAnySpend && blendedROI != null ? fmtP(blendedROI) : "—", icon: BarChart3, color: hasAnySpend && blendedROI != null ? (blendedROI >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground", sub: !hasAnySpend ? "Enter spend to calculate" : undefined },
    { label: "Campaigns with Spend", value: String(campaignsWithSpend), icon: Receipt, color: "text-foreground" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Expenses</h1>
            <p className="text-sm text-muted-foreground">Campaign spend management and profitability tracking</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddManuallyOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-primary text-primary rounded-[10px] hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Manually
            </button>
            <button
              onClick={() => setCsvOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border text-muted-foreground rounded-[10px] hover:bg-secondary transition-colors"
            >
              <Upload className="h-3.5 w-3.5" /> Bulk CSV Upload
            </button>
            <button
              disabled
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border text-muted-foreground/50 rounded-[10px] cursor-not-allowed opacity-60"
              title="Coming soon — configure in Settings"
            >
              <Lock className="h-3.5 w-3.5" /> Sync AirTable
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-5 gap-3">
          {kpis.map((kpi, i) => (
            <div key={i} className="bg-card border border-border rounded-[16px] p-4 shadow-sm">
              <div className="flex items-center gap-1.5 mb-2">
                <kpi.icon className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</span>
              </div>
              <p className={`text-[22px] font-bold ${kpi.color}`}>{kpi.value}</p>
              {kpi.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>}
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="px-3 py-2 text-xs bg-secondary border border-border rounded-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary">
            <option value="all">All Accounts</option>
            {distinctAccounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}
          </select>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="px-3 py-2 text-xs bg-secondary border border-border rounded-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary">
            <option value="all">All Sources</option>
            {distinctSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-0.5 bg-secondary border border-border rounded-[10px] p-0.5">
            {([["all", "All Time"], ["this_month", "This Month"], ["last_month", "Last Month"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => setDateFilter(val)} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${dateFilter === val ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search campaigns..." className="w-full pl-9 pr-3 py-2 text-xs bg-secondary border border-border rounded-[10px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        {/* Main Table */}
        <div className="bg-card border border-border rounded-[16px] shadow-sm overflow-x-auto">
          {filtered.length === 0 && !isLoading ? (
            <div className="p-12 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium text-muted-foreground">No spend set yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Go to Tracking Links to set spend on campaigns.</p>
            </div>
          ) : (
            <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 200 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 60 }} />
              </colgroup>
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  {[
                    { key: "campaign_name" as SortKey, label: "Campaign" },
                    { key: null, label: "Account" },
                    { key: null, label: "Source" },
                    { key: null, label: "Type" },
                    { key: null, label: "Cost Value" },
                    { key: "cost_total" as SortKey, label: "Total Spend" },
                    { key: "revenue" as SortKey, label: "LTV" },
                    { key: "profit" as SortKey, label: "Profit" },
                    { key: "roi" as SortKey, label: "ROI" },
                    { key: null, label: "Status" },
                    { key: null, label: "" },
                  ].map((col, i) => (
                    <th
                      key={i}
                      className={`px-3 py-3 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider ${col.key ? "cursor-pointer hover:text-foreground" : ""}`}
                      onClick={() => col.key && handleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {col.key && <SortIcon col={col.key} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((link: any) => {
                  const username = link.accounts?.username || "";
                  const acColor = getAccountColor(username);
                  const profit = Number(link.profit || 0);
                  const roi = Number(link.roi || 0);
                  const status = link.status || "NO_DATA";
                  return (
                    <tr key={link.id} className="border-b border-border/50 hover:bg-[hsl(var(--primary)/0.03)] transition-colors" style={{ height: 52 }}>
                      <td className="px-3 py-2">
                        <p className="text-[13px] font-semibold text-foreground truncate">{link.campaign_name || "—"}</p>
                        <p className="text-[10px] text-muted-foreground break-all">{link.url}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-5 h-5 rounded-full shrink-0 ${acColor.bg} flex items-center justify-center`}>
                            <span className={`text-[8px] font-bold ${acColor.text}`}>{(username || "?")[0]?.toUpperCase()}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground truncate">@{username || "?"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2"><TagBadge tagName={link.source_tag} /></td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${SPEND_TYPE_STYLES[link.cost_type] || "bg-secondary text-muted-foreground"}`}>
                          {link.cost_type || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[12px] text-muted-foreground font-mono">{formatCostValue(link.cost_type, link.cost_value)}</td>
                      <td className="px-3 py-2 text-[12px] font-mono font-semibold text-foreground">{fmtC(Number(link.cost_total || 0))}</td>
                      <td className="px-3 py-2 text-[13px] font-mono font-bold text-primary">{fmtC(Number(link.revenue || 0))}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[12px] font-mono font-semibold ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
                          {profit >= 0 ? "+" : ""}{fmtC(profit)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[12px] font-mono font-semibold ${roi >= 0 ? "text-primary" : "text-destructive"}`}>{fmtP(roi)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-bold whitespace-nowrap min-w-[80px] text-center ${STATUS_STYLES[status]}`}>
                          {status === "NO_DATA" ? "No Spend" : status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => setCostSlideIn(link)} className="p-1 rounded hover:bg-primary/10 text-primary transition-colors" title="Edit spend">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {clearConfirmId === link.id ? (
                            <span className="text-[10px] flex items-center gap-1">
                              <button onClick={() => handleClearSpend(link)} className="text-destructive font-bold hover:underline">Yes</button>
                              <span className="text-muted-foreground">/</span>
                              <button onClick={() => setClearConfirmId(null)} className="text-muted-foreground hover:underline">Cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => setClearConfirmId(link.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Clear spend">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > 0 && (
          <p className="text-[12px] text-muted-foreground">Showing {filtered.length} campaign{filtered.length !== 1 ? "s" : ""} with spend set</p>
        )}

        {/* Breakdown Panels */}
        <div className="grid grid-cols-2 gap-4">
          {/* Spend by Source */}
          <div className="bg-card border border-border rounded-[16px] shadow-sm p-4">
            <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-primary" /> Spend by Source
            </h3>
            {bySource.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No data yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Source</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Campaigns</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Spend</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">LTV</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Profit</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.map((row, i) => {
                    const roi = row.spend > 0 ? (row.profit / row.spend) * 100 : 0;
                    return (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-2 text-[12px]"><TagBadge tagName={row.source} /></td>
                        <td className="py-2 text-right text-muted-foreground">{row.campaigns}</td>
                        <td className="py-2 text-right font-mono">{fmtC(row.spend)}</td>
                        <td className="py-2 text-right font-mono text-primary">{fmtC(row.ltv)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${row.profit >= 0 ? "text-primary" : "text-destructive"}`}>{row.profit >= 0 ? "+" : ""}{fmtC(row.profit)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${roi >= 0 ? "text-primary" : "text-destructive"}`}>{fmtP(roi)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Spend by Model */}
          <div className="bg-card border border-border rounded-[16px] shadow-sm p-4">
            <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-primary" /> Spend by Model
            </h3>
            {byModel.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No data yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Campaigns</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Spend</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">LTV</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Profit</th>
                    <th className="text-right py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((row, i) => {
                    const roi = row.spend > 0 ? (row.profit / row.spend) * 100 : 0;
                    const acColor = getAccountColor(row.username);
                    return (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            {row.avatar ? (
                              <img src={row.avatar} className="w-5 h-5 rounded-full object-cover" alt="" />
                            ) : (
                              <div className={`w-5 h-5 rounded-full ${acColor.bg} flex items-center justify-center`}>
                                <span className={`text-[8px] font-bold ${acColor.text}`}>{row.name[0]}</span>
                              </div>
                            )}
                            <div>
                              <p className="text-[12px] font-medium text-foreground">{row.name}</p>
                              <p className="text-[10px] text-muted-foreground">@{row.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 text-right text-muted-foreground">{row.campaigns}</td>
                        <td className="py-2 text-right font-mono">{fmtC(row.spend)}</td>
                        <td className="py-2 text-right font-mono text-primary">{fmtC(row.ltv)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${row.profit >= 0 ? "text-primary" : "text-destructive"}`}>{row.profit >= 0 ? "+" : ""}{fmtC(row.profit)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${roi >= 0 ? "text-primary" : "text-destructive"}`}>{fmtP(roi)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Set Spend slide-in */}
      {(costSlideIn || addManuallyOpen) && (
        <CostSettingSlideIn
          link={costSlideIn || { clicks: 0, subscribers: 0, revenue: 0, created_at: new Date().toISOString(), campaign_name: "", id: "", campaign_id: "", account_id: "", source: "" }}
          onClose={() => { setCostSlideIn(null); setAddManuallyOpen(false); }}
          onSaved={onSpendSaved}
        />
      )}

      {/* CSV Import Modal */}
      <CsvCostImportModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onComplete={() => {
          setCsvOpen(false);
          queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
        }}
        trackingLinks={allLinks}
      />
    </DashboardLayout>
  );
}

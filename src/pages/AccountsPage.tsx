import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";

import { format, differenceInDays, subDays } from "date-fns";
import { ArrowLeft, ChevronUp, ChevronDown, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { RefreshButton } from "@/components/RefreshButton";
import { toast } from "sonner";

const DEFAULT_CATEGORIES: Record<string, string> = {
  "jessie_ca_xo": "Female",
  "zoey.skyy": "Female",
  "miakitty.ts": "Trans",
  "ella_cherryy": "Female",
  "aylin_bigts": "Trans",
};

function loadModelCategories(): Record<string, string> {
  try {
    const saved = localStorage.getItem("ct_model_categories");
    if (saved) return { ...DEFAULT_CATEGORIES, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_CATEGORIES };
}

function saveModelCategories(cats: Record<string, string>) {
  localStorage.setItem("ct_model_categories", JSON.stringify(cats));
}

const AVATAR_COLORS = [
  "from-teal-400 to-cyan-500",
  "from-blue-400 to-indigo-500",
  "from-emerald-400 to-green-500",
  "from-amber-400 to-orange-500",
  "from-pink-400 to-rose-500",
  "from-purple-400 to-violet-500",
];

type SortKey = "campaign_name" | "revenue" | "clicks" | "subscribers" | "profit" | "roi" | "created_at";

export default function AccountsPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"campaigns" | "sources" | "performance">("campaigns");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [modelCategories, setModelCategories] = useState<Record<string, string>>(loadModelCategories);
  const [editingCatFor, setEditingCatFor] = useState<string | null>(null);
  const [editCatValue, setEditCatValue] = useState("");

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: trackingLinkLtv = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tracking_link_ltv").select("*");
      if (error) throw error;
      return data || [];
    },
  });

  // LTV lookup map
  const ltvLookup = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trackingLinkLtv) {
      map[r.tracking_link_id] = r;
    }
    return map;
  }, [trackingLinkLtv]);

  // Auto-select model from URL param
  useEffect(() => {
    const modelId = searchParams.get("model");
    if (modelId && accounts.length > 0 && !selectedAccount) {
      const acc = accounts.find((a: any) => a.id === modelId);
      if (acc) setSelectedAccount(acc);
    }
  }, [searchParams, accounts, selectedAccount]);

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const getCategory = (account: any) => modelCategories[account.username] || "Uncategorized";

  // All unique categories
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    accounts.forEach((a: any) => cats.add(getCategory(a)));
    return Array.from(cats).sort();
  }, [accounts, modelCategories]);

  const handleSaveCategory = (username: string, category: string) => {
    const updated = { ...modelCategories, [username]: category };
    setModelCategories(updated);
    saveModelCategories(updated);
    setEditingCatFor(null);
    toast.success(`Category set to "${category}"`);
  };

  const handleDeleteCategory = (username: string) => {
    const updated = { ...modelCategories };
    delete updated[username];
    setModelCategories(updated);
    saveModelCategories(updated);
    setEditingCatFor(null);
    toast.success("Category removed");
  };

  // Agency benchmark CVR
  const agencyAvgCvr = useMemo(() => {
    const qualified = links.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const totalS = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalC = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return totalC > 0 ? (totalS / totalC) * 100 : null;
  }, [links]);

  const accountStats = useMemo(() => {
    const stats: Record<string, any> = {};
    for (const acc of accounts) {
      const accLinks = links.filter((l: any) => l.account_id === acc.id);
      const totalRevenue = accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
      const totalLtv = accLinks.reduce((s: number, l: any) => s + Number(l.ltv || 0), 0);
      const totalSpend = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
      const totalClicks = accLinks.reduce((s: number, l: any) => s + (l.clicks || 0), 0);
      const totalSubs = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const activeLinks = accLinks.filter((l: any) => {
        const days = l.created_at ? differenceInDays(new Date(), new Date(l.created_at)) : 999;
        return l.clicks > 0 || days <= 30;
      });

      // Last 30d LTV from daily_metrics
      const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
      const accMetrics = dailyMetrics.filter((m: any) => m.account_id === acc.id && m.date >= thirtyDaysAgo);
      const ltv30d = accMetrics.reduce((s: number, m: any) => s + Number(m.revenue || 0), 0);

      // Model CVR (qualified links only)
      const qualifiedLinks = accLinks.filter((l: any) => l.clicks > 100);
      const qSubs = qualifiedLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const qClicks = qualifiedLinks.reduce((s: number, l: any) => s + l.clicks, 0);
      const avgCvr = qClicks > 0 ? (qSubs / qClicks) * 100 : null;
      const cvrDiff = avgCvr !== null && agencyAvgCvr !== null ? avgCvr - agencyAvgCvr : null;

      const unattributedSubs = Math.max(0, (acc.subscribers_count || 0) - totalSubs);
      const unattributedPct = (acc.subscribers_count || 0) > 0 ? (unattributedSubs / acc.subscribers_count) * 100 : 0;

        const effectiveLtv = totalLtv > 0 ? totalLtv : totalRevenue;
        const profit = effectiveLtv - totalSpend;
        const profitPerSub = totalSubs > 0 ? profit / totalSubs : null;
        stats[acc.id] = {
          totalRevenue,
          totalLtv,
          totalSpend,
          totalProfit: profit,
          totalCampaigns: accLinks.length,
          activeCampaigns: activeLinks.length,
          avgSubsDay: accLinks.length > 1 ? (totalSubs / Math.max(1, accLinks.length)).toFixed(0) : "—",
          ltv30d: accMetrics.length > 0 ? ltv30d : null,
          totalClicks,
          totalSubs,
          apiSubs: acc.subscribers_count || 0,
          blendedRoi: totalSpend > 0 ? ((effectiveLtv - totalSpend) / totalSpend) * 100 : null,
          avgCvr,
          cvrDiff,
          unattributedPct,
          profitPerSub,
        };
    }
    return stats;
  }, [accounts, links, dailyMetrics, agencyAvgCvr]);

  const filteredAccounts = useMemo(() => {
    if (categoryFilter === "all") return accounts;
    return accounts.filter((a: any) => getCategory(a) === categoryFilter);
  }, [accounts, categoryFilter, modelCategories]);

  const AvatarCircle = ({ account, size = 80 }: { account: any; size?: number }) => {
    const colorIdx = accounts.indexOf(account) % AVATAR_COLORS.length;
    const thumbUrl = account.avatar_thumb_url;
    return (
      <div style={{ width: size, height: size }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt={account.display_name} className="rounded-full object-cover border-[3px] border-white shadow-md" style={{ width: size, height: size }} />
        ) : (
          <div className={`rounded-full bg-gradient-to-br ${AVATAR_COLORS[colorIdx]} flex items-center justify-center text-white font-bold border-[3px] border-white shadow-md`} style={{ width: size, height: size, fontSize: size * 0.35 }}>
            {account.display_name.charAt(0)}
          </div>
        )}
      </div>
    );
  };

  // === SORT HELPER for campaigns tab ===
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const getStatus = (link: any) => {
    if (link.status === "SCALE") return { label: "Scale", cls: "bg-[#f0fdf4] text-[#16a34a] dark:bg-[rgba(16,185,129,0.15)] dark:text-[#10B981]" };
    if (link.status === "WATCH") return { label: "Watch", cls: "bg-[#fffbeb] text-[#d97706] dark:bg-[rgba(245,158,11,0.15)] dark:text-[#F59E0B]" };
    if (link.status === "LOW") return { label: "Low", cls: "bg-[#fffbeb] text-[#d97706] dark:bg-[rgba(245,158,11,0.15)] dark:text-[#F59E0B]" };
    if (link.status === "KILL") return { label: "Kill", cls: "bg-[#fef2f2] text-[#dc2626] dark:bg-[rgba(239,68,68,0.15)] dark:text-[#EF4444]" };
    if (link.status === "INACTIVE") return { label: "Inactive", cls: "bg-[#f3f4f6] text-[#6b7280] dark:bg-[rgba(107,114,128,0.15)] dark:text-[#9CA3AF]" };
    if (link.status === "TESTING") return { label: "Testing", cls: "bg-[#f3f4f6] text-[#6b7280] dark:bg-[rgba(107,114,128,0.15)] dark:text-[#9CA3AF]" };
    return { label: "No Spend", cls: "bg-muted text-muted-foreground" };
  };

  // Derived data for selected account (must be above conditional return)
  const selectedAccLinks = useMemo(() => {
    if (!selectedAccount) return [];
    return links.filter((l: any) => l.account_id === selectedAccount.id);
  }, [selectedAccount, links]);

  const sourceGroups = useMemo(() => {
    const groups: Record<string, { source: string; links: number; spend: number; ltv: number; profit: number; roi: number | null }> = {};
    for (const l of selectedAccLinks) {
      const src = l.source_tag || "Untagged";
      if (!groups[src]) groups[src] = { source: src, links: 0, spend: 0, ltv: 0, profit: 0, roi: null };
      groups[src].links++;
      groups[src].spend += Number(l.cost_total || 0);
      groups[src].ltv += Number(l.ltv || 0) > 0 ? Number(l.ltv) : Number(l.revenue || 0);
    }
    for (const g of Object.values(groups)) {
      g.profit = g.ltv - g.spend;
      g.roi = g.spend > 0 ? (g.profit / g.spend) * 100 : null;
    }
    return Object.values(groups).sort((a, b) => b.profit - a.profit);
  }, [selectedAccLinks]);

  const perfData = useMemo(() => {
    const linkIds = new Set(selectedAccLinks.map((l: any) => l.id));
    const byDate: Record<string, { date: string; ltv: number; subs: number }> = {};
    for (const m of dailyMetrics) {
      if (!linkIds.has(m.tracking_link_id)) continue;
      if (!byDate[m.date]) byDate[m.date] = { date: m.date, ltv: 0, subs: 0 };
      byDate[m.date].ltv += Number(m.revenue || 0);
      byDate[m.date].subs += (m.subscribers || 0);
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedAccLinks, dailyMetrics]);

  // ============ VIEW 2 — Individual Model Profile ============
  if (selectedAccount) {
    const acc = selectedAccount;
    const stats = accountStats[acc.id] || {};
    const accLinks = selectedAccLinks;
    const category = getCategory(acc);

    const sortedLinks = [...accLinks].sort((a: any, b: any) => {
      const av = sortKey === "campaign_name" ? (a.campaign_name || "") : Number(a[sortKey] || 0);
      const bv = sortKey === "campaign_name" ? (b.campaign_name || "") : Number(b[sortKey] || 0);
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return (
      <DashboardLayout>
        <div className="space-y-5">
          {/* Back button */}
          <button onClick={() => { setSelectedAccount(null); setActiveTab("campaigns"); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> All Models
          </button>

          {/* Profile card */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-col md:flex-row">
              {/* Left column */}
              <div className="md:w-[30%] p-6 border-b md:border-b-0 md:border-r border-border flex flex-col items-center text-center">
                <AvatarCircle account={acc} size={120} />
                <p className="text-[10px] text-muted-foreground mt-1.5">Synced from OnlyFans</p>
                <h2 className="text-xl font-bold text-foreground mt-4">{acc.display_name}</h2>
                <p className="text-sm text-primary font-medium">@{acc.username || "—"}</p>
                <span className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${category === "Trans" ? "bg-[#ede9fe] text-[#7c3aed] dark:bg-purple-500/15 dark:text-purple-400" : "bg-[#dbeafe] text-[#1d4ed8] dark:bg-blue-500/15 dark:text-blue-400"}`}>
                  {category}
                </span>
                {acc.performer_top != null && (
                  <span className="mt-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                    Top {acc.performer_top}%
                  </span>
                )}

                <div className="w-full border-t border-border mt-5 pt-4 space-y-3 text-left text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="text-foreground font-medium">{category}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className={`font-medium ${acc.is_active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{acc.is_active ? "Active" : "Inactive"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Date added</span><span className="text-foreground">{format(new Date(acc.created_at), "MMM d, yyyy")}</span></div>
                  {acc.subscribe_price != null && acc.subscribe_price > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Sub price</span><span className="text-foreground">${Number(acc.subscribe_price).toFixed(2)}</span></div>
                  )}
                </div>
              </div>

              {/* Right column */}
              <div className="md:w-[70%] p-6">
                {/* Stats row 1 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Total Revenue", value: fmtCurrency(stats.totalRevenue || 0) },
                    { label: "Total LTV", value: stats.totalLtv > 0 ? fmtCurrency(stats.totalLtv) : "Fan sync needed", accent: stats.totalLtv > 0 },
                    { label: "Last 30d LTV", value: stats.ltv30d != null ? fmtCurrency(stats.ltv30d) : "Syncing..." },
                    { label: "Total Spend", value: fmtCurrency(stats.totalSpend || 0) },
                    { label: "Total Profit", value: stats.totalSpend > 0 ? fmtCurrency(stats.totalProfit) : "—", positive: stats.totalProfit >= 0 },
                  ].map((s) => (
                    <div key={s.label} className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                      <p className={`text-lg font-bold font-mono ${s.accent ? "text-primary" : s.positive === false ? "text-destructive" : "text-foreground"}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {/* Stats row 2 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  {[
                    { label: "Total Tracking Links", value: String(stats.totalCampaigns || 0) },
                    { label: "Active Tracking Links", value: String(stats.activeCampaigns || 0) },
                    { label: "Avg Subs/Day", value: stats.avgSubsDay },
                    { label: "ROI %", value: stats.blendedRoi != null ? fmtPct(stats.blendedRoi) : "—" },
                    { label: "Unattributed", value: stats.unattributedPct != null ? fmtPct(stats.unattributedPct) : "—",
                      colored: true, pctVal: stats.unattributedPct },
                  ].map((s: any) => (
                    <div key={s.label} className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                      <p className={`text-lg font-bold font-mono ${
                        s.colored
                          ? ((s.pctVal ?? 0) <= 30 ? "text-primary" : (s.pctVal ?? 0) <= 40 ? "text-[hsl(38_92%_50%)]" : "text-destructive")
                          : "text-foreground"
                      }`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {/* CVR comparison */}
                {stats.avgCvr !== null && (
                  <div className="flex items-center gap-3 mb-6 px-1">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Avg CVR:</span>
                    <span className="font-mono text-sm font-bold text-foreground">{stats.avgCvr.toFixed(1)}%</span>
                    {stats.cvrDiff !== null && (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${stats.cvrDiff >= 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                        {stats.cvrDiff >= 0 ? "+" : ""}{stats.cvrDiff.toFixed(1)}% vs agency avg
                      </span>
                    )}
                  </div>
                )}

                {/* Tabs */}
                <div className="border-b border-border mb-4">
                  <div className="flex gap-6">
                    {(["campaigns", "sources", "performance"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
                          activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "campaigns" ? "Tracking Links" : tab === "sources" ? "Traffic Sources" : "Performance"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab content */}
                {activeTab === "campaigns" && (
                  <div className="overflow-x-auto">
                    {sortedLinks.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">No tracking links found for this model</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("campaign_name")}>Tracking Link <SortIcon col="campaign_name" /></th>
                            <th className="text-left py-2 px-3">Source</th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("clicks")}>Clicks <SortIcon col="clicks" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("subscribers")}>Subs <SortIcon col="subscribers" /></th>
                            <th className="text-right py-2 px-3">Subs/Day</th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("revenue")}>LTV <SortIcon col="revenue" /></th>
                            <th className="text-right py-2 px-3">Cross-Poll</th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("profit")}>Profit <SortIcon col="profit" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("roi")}>ROI <SortIcon col="roi" /></th>
                            <th className="text-center py-2 px-3">Status</th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("created_at")}>Created <SortIcon col="created_at" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedLinks.map((l: any) => {
                            const status = getStatus(l);
                            const hasSpend = Number(l.cost_total || 0) > 0;
                            const ltvRecord = ltvLookup[l.id] || null;
                            const ltvVal = ltvRecord ? Number(ltvRecord.total_ltv || 0) : null;
                            const crossPoll = ltvRecord ? Number(ltvRecord.cross_poll_revenue || 0) : null;
                            const hasLtv = ltvVal !== null && ltvVal > 0;
                            const effectiveRevL = hasLtv ? ltvVal : Number(l.revenue || 0);
                            const profit = effectiveRevL - Number(l.cost_total || 0);
                            const daysActive = l.created_at ? differenceInDays(new Date(), new Date(l.created_at)) : null;
                            const subsPerDay = daysActive && daysActive > 0 && l.subscribers > 0 ? (l.subscribers / daysActive).toFixed(0) : null;
                            return (
                              <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                <td className="py-3 px-3">
                                  <p className="font-medium text-foreground text-[12px] truncate max-w-[200px]">{l.campaign_name || "—"}</p>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{l.url}</p>
                                </td>
                                <td className="py-3 px-3 text-[12px]">
                                  <TagBadge tagName={l.source_tag} />
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(l.clicks)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(l.subscribers)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">{subsPerDay ? `${subsPerDay}/day` : "—"}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  <span className={hasLtv ? "text-primary font-semibold" : "text-muted-foreground"}>
                                    {hasLtv ? fmtCurrency(ltvVal) : ltvVal === 0 ? "$0.00" : "—"}
                                  </span>
                                  {!hasLtv && ltvVal === null && <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground leading-none">No data</span>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {crossPoll !== null && crossPoll > 0 ? (
                                    <span className="text-[#7c3aed] font-semibold">{fmtCurrency(crossPoll)}</span>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${hasSpend ? (profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {hasSpend ? fmtCurrency(profit) : "—"}
                                </td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${hasSpend && l.roi != null ? (l.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {hasSpend && l.roi != null ? fmtPct(l.roi) : "—"}
                                </td>
                                <td className="text-center py-3 px-3">
                                  <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${status.cls}`}>{status.label}</span>
                                </td>
                                <td className="text-right py-3 px-3 text-[11px] text-muted-foreground">
                                  {l.created_at ? format(new Date(l.created_at), "MMM d, yyyy") : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {activeTab === "sources" && (
                  <div className="overflow-x-auto">
                    {sourceGroups.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">No source tags assigned yet — go to Tracking Links to tag campaigns</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <th className="text-left py-2 px-3">Source</th>
                            <th className="text-right py-2 px-3">Active Links</th>
                            <th className="text-right py-2 px-3">Total Spend</th>
                            <th className="text-right py-2 px-3">Total LTV</th>
                            <th className="text-right py-2 px-3">Profit</th>
                            <th className="text-right py-2 px-3">ROI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sourceGroups.map((g) => (
                            <tr key={g.source} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                              <td className="py-3 px-3 font-medium text-[12px]"><TagBadge tagName={g.source} /></td>
                              <td className="text-right py-3 px-3 font-mono text-[12px]">{g.links}</td>
                              <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtCurrency(g.spend)}</td>
                              <td className="text-right py-3 px-3 font-mono text-[12px] font-semibold text-primary">{fmtCurrency(g.ltv)}</td>
                              <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${g.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{fmtCurrency(g.profit)}</td>
                              <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${g.roi != null ? (g.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>{g.roi != null ? fmtPct(g.roi) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {activeTab === "performance" && (
                  <div className="space-y-6">
                    {perfData.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">Performance data builds after multiple syncs</p>
                    ) : (
                      <>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-3">LTV Over Time</p>
                          <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={perfData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(d) => format(new Date(d), "MMM d")} />
                                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `$${v}`} />
                                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "LTV"]} labelFormatter={(l) => format(new Date(l), "MMM d, yyyy")} />
                                <Line type="monotone" dataKey="ltv" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-3">Subscribers / Day</p>
                          <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={perfData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(d) => format(new Date(d), "MMM d")} />
                                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                                <Tooltip formatter={(v: number) => [v, "Subs"]} labelFormatter={(l) => format(new Date(l), "MMM d, yyyy")} />
                                <Bar dataKey="subs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ============ VIEW 1 — All Models Overview ============
  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Models</h1>
            <p className="text-sm text-muted-foreground">All accounts connected to Campaign Tracker</p>
          </div>
          <RefreshButton queryKeys={["accounts", "tracking_links", "daily_metrics"]} />
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              categoryFilter === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
            }`}
          >
            All <span className="ml-1.5 text-xs opacity-70">{accounts.length}</span>
          </button>
          {allCategories.map((cat) => {
            const count = accounts.filter((a: any) => getCategory(a) === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  categoryFilter === cat
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                {cat} <span className="ml-1.5 text-xs opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Model cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAccounts.map((acc: any) => {
            const stats = accountStats[acc.id] || {};
            const category = getCategory(acc);
            const isEditing = editingCatFor === acc.id;
            return (
              <div
                key={acc.id}
                className="bg-card border border-border rounded-2xl p-5 card-hover transition-all duration-200 hover:border-primary/40 cursor-pointer"
              >
                <div className="flex items-start gap-4 mb-4" onClick={() => { setSelectedAccount(acc); setActiveTab("campaigns"); setSortKey("created_at"); setSortAsc(false); }}>
                  <AvatarCircle account={acc} size={72} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">{acc.display_name}</h3>
                    <p className="text-[13px] text-muted-foreground">@{acc.username || "—"}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {isEditing ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={editCatValue}
                            onChange={(e) => setEditCatValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && editCatValue.trim()) handleSaveCategory(acc.username, editCatValue.trim()); if (e.key === "Escape") setEditingCatFor(null); }}
                            className="w-24 px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground outline-none"
                            placeholder="e.g. Female"
                          />
                          <button onClick={() => editCatValue.trim() && handleSaveCategory(acc.username, editCatValue.trim())} className="text-primary hover:text-primary/80"><Check className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setEditingCatFor(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ) : (
                        <>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${category === "Trans" ? "bg-[#ede9fe] text-[#7c3aed] dark:bg-purple-500/15 dark:text-purple-400" : category === "Uncategorized" ? "bg-muted text-muted-foreground" : "bg-[#dbeafe] text-[#1d4ed8] dark:bg-blue-500/15 dark:text-blue-400"}`}>
                            {category}
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); setEditingCatFor(acc.id); setEditCatValue(category === "Uncategorized" ? "" : category); }} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                          {category !== "Uncategorized" && (
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(acc.username); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                          )}
                        </>
                      )}
                      {acc.performer_top != null && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                          Top {acc.performer_top}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div onClick={() => { setSelectedAccount(acc); setActiveTab("campaigns"); setSortKey("created_at"); setSortAsc(false); }}>
                  {/* KPI grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] mb-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Subs (API)</span>
                      <span className="font-mono font-semibold text-foreground">{fmtNum(stats.apiSubs || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tracked Subs</span>
                      <span className="font-mono font-semibold text-foreground">{fmtNum(stats.totalSubs || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">LTV (All)</span>
                      <span className="font-mono font-semibold text-primary">{stats.totalLtv > 0 ? fmtCurrency(stats.totalLtv) : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">LTV (30d)</span>
                      <span className="font-mono font-semibold text-primary">{stats.ltv30d != null ? fmtCurrency(stats.ltv30d) : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Spend</span>
                      <span className="font-mono font-semibold text-foreground">{fmtCurrency(stats.totalSpend || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Revenue</span>
                      <span className="font-mono font-semibold text-foreground">{fmtCurrency(stats.totalRevenue || 0)}</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span className="text-muted-foreground">Profit/Sub</span>
                      <span className={`font-mono font-semibold ${stats.profitPerSub != null ? (stats.profitPerSub >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                        {stats.profitPerSub != null ? fmtCurrency(stats.profitPerSub) : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t border-border">
                    <span>{stats.totalCampaigns || 0} tracking links</span>
                    <span className="text-border">·</span>
                    <span>{stats.activeCampaigns || 0} active</span>
                    <span className="text-border">·</span>
                    <span>{stats.avgSubsDay} subs/day</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}

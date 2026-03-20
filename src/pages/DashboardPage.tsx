import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendSlideIn } from "@/components/dashboard/AdSpendSlideIn";
import { DailyDecisionView } from "@/components/dashboard/DailyDecisionView";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { fetchAccounts, fetchCampaigns, fetchTrackingLinks, fetchAdSpend, fetchDailyMetrics, fetchAlerts, fetchSyncSettings, triggerSync, addAdSpend } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  RefreshCw, DollarSign, MousePointerClick, Users, TrendingUp,
  Percent, PiggyBank, BarChart3, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown,
  AlertTriangle, Download, FileText, LayoutGrid, Search, X, Columns, List
} from "lucide-react";

type SortKey = "campaign_name" | "clicks" | "subscribers" | "spenders" | "revenue" | "epc" | "revenue_per_subscriber" | "roi" | "ad_spend" | "created_at";

function SkeletonCard({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`bg-card border border-border rounded-lg p-5 ${wide ? "col-span-2" : ""}`}>
      <div className="skeleton-shimmer h-3 w-20 rounded mb-3" />
      <div className="skeleton-shimmer h-8 w-28 rounded mb-2" />
      <div className="skeleton-shimmer h-3 w-16 rounded" />
    </div>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ account_id: "all", campaign_id: "all", traffic_source: "all", date_preset: "all" });
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"compact" | "full">("compact");
  const [adSpendSlideIn, setAdSpendSlideIn] = useState<any>(null);
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links", filters.account_id, filters.campaign_id],
    queryFn: () => fetchTrackingLinks({
      account_id: filters.account_id !== "all" ? filters.account_id : undefined,
      campaign_id: filters.campaign_id !== "all" ? filters.campaign_id : undefined,
    }),
  });
  const { data: adSpendData = [] } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts"], queryFn: () => fetchAlerts(true) });
  const { data: syncSettings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });

  const syncFrequency = useMemo(() => {
    const s = syncSettings.find((s: any) => s.key === "sync_frequency_days");
    return s ? parseInt(s.value) : 3;
  }, [syncSettings]);

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(filters.account_id !== "all" ? filters.account_id : undefined, true),
    onSuccess: (data) => {
      const count = data?.dispatched?.length ?? 0;
      toast.success(`Sync dispatched for ${count} account(s) — check logs for progress`);
      ["tracking_links", "accounts", "campaigns", "ad_spend", "sync_logs", "alerts", "daily_metrics"].forEach(k =>
        queryClient.invalidateQueries({ queryKey: [k] })
      );
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  const sparklineData = useMemo(() => {
    const map: Record<string, { date: string; revenue: number }[]> = {};
    dailyMetrics.forEach((m: any) => {
      if (!map[m.tracking_link_id]) map[m.tracking_link_id] = [];
      map[m.tracking_link_id].push({ date: m.date, revenue: Number(m.revenue) });
    });
    Object.keys(map).forEach((k) => {
      map[k] = map[k].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
    });
    return map;
  }, [dailyMetrics]);

  const filteredLinks = useMemo(() => {
    return links.filter((link: any) => {
      if (filters.traffic_source !== "all" && link.source !== filters.traffic_source) return false;
      if (selectedModel && link.account_id !== selectedModel) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = (link.campaign_name || "").toLowerCase().includes(q);
        const matchAccount = (link.accounts?.username || "").toLowerCase().includes(q) || (link.accounts?.display_name || "").toLowerCase().includes(q);
        if (!matchName && !matchAccount) return false;
      }
      return true;
    });
  }, [links, filters.traffic_source, selectedModel, searchQuery]);

  const adSpendByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    adSpendData.forEach((a: any) => { map[a.campaign_id] = (map[a.campaign_id] || 0) + Number(a.amount); });
    return map;
  }, [adSpendData]);

  const enrichedLinks = useMemo(() => {
    return filteredLinks.map((link: any) => {
      const spend = adSpendByCampaign[link.campaign_id] || 0;
      const profit = Number(link.revenue) - spend;
      const roi = spend > 0 ? (profit / spend) * 100 : null;
      return { ...link, ad_spend: spend, profit, roi };
    });
  }, [filteredLinks, adSpendByCampaign]);

  const sortedLinks = useMemo(() => {
    return [...enrichedLinks].sort((a, b) => {
      if (sortKey === "campaign_name") {
        const av = (a.campaign_name || "").toLowerCase();
        const bv = (b.campaign_name || "").toLowerCase();
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === "created_at") {
        const av = new Date(a.created_at || 0).getTime();
        const bv = new Date(b.created_at || 0).getTime();
        return sortAsc ? av - bv : bv - av;
      }
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortAsc ? av - bv : bv - av;
    });
  }, [enrichedLinks, sortKey, sortAsc]);

  // Revenue percentiles for color coding
  const revenuePercentiles = useMemo(() => {
    const revenues = enrichedLinks.map((l: any) => Number(l.revenue)).sort((a, b) => a - b);
    const p20 = revenues[Math.floor(revenues.length * 0.2)] ?? 0;
    const p80 = revenues[Math.floor(revenues.length * 0.8)] ?? 0;
    return { p20, p80 };
  }, [enrichedLinks]);

  // KPIs
  const totalRevenue = filteredLinks.reduce((s: number, l: any) => s + Number(l.revenue), 0);
  const totalClicks = filteredLinks.reduce((s: number, l: any) => s + l.clicks, 0);
  const totalSubscribers = filteredLinks.reduce((s: number, l: any) => s + l.subscribers, 0);
  const totalAdSpend = adSpendData.reduce((s: number, a: any) => s + Number(a.amount), 0);
  const totalCostFromLinks = filteredLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
  const epc = totalClicks > 0 ? totalRevenue / totalClicks : 0;
  const conversionRate = totalClicks > 0 ? (totalSubscribers / totalClicks) * 100 : 0;
  const profit = totalRevenue - totalAdSpend;
  const roi = totalAdSpend > 0 ? (profit / totalAdSpend) * 100 : 0;
  const blendedCvr = totalClicks > 0 ? (totalSubscribers / totalClicks) * 100 : 0;
  const linksWithCost = filteredLinks.filter((l: any) => l.cost_type && Number(l.cost_total) > 0);
  const totalCostForCpl = linksWithCost.reduce((s: number, l: any) => s + Number(l.cost_total), 0);
  const totalSubsForCpl = linksWithCost.reduce((s: number, l: any) => s + l.subscribers, 0);
  const blendedCpl = totalSubsForCpl > 0 ? totalCostForCpl / totalSubsForCpl : 0;

  const lastSynced = useMemo(() => {
    const syncTimes = accounts.map((a: any) => a.last_synced_at).filter(Boolean).sort().reverse();
    return syncTimes[0] ?? null;
  }, [accounts]);

  const nextSyncDays = useMemo(() => {
    if (!lastSynced) return null;
    const lastDate = new Date(lastSynced);
    const nextDate = new Date(lastDate.getTime() + syncFrequency * 24 * 60 * 60 * 1000);
    const diff = differenceInDays(nextDate, new Date());
    return Math.max(0, diff);
  }, [lastSynced, syncFrequency]);

  const modelSummary = useMemo(() => {
    const map: Record<string, { id: string; display_name: string; username: string; revenue: number; subscribers: number; clicks: number; topCampaign: string; convRate: number; epc: number }> = {};
    links.forEach((link: any) => {
      const accId = link.account_id;
      if (!map[accId]) {
        map[accId] = { id: accId, display_name: link.accounts?.display_name || "Unknown", username: link.accounts?.username || "", revenue: 0, subscribers: 0, clicks: 0, topCampaign: "", convRate: 0, epc: 0 };
      }
      map[accId].revenue += Number(link.revenue);
      map[accId].subscribers += link.subscribers;
      map[accId].clicks += link.clicks;
      if (Number(link.revenue) > 0) map[accId].topCampaign = link.campaign_name || "";
    });
    return Object.values(map).map((m) => ({
      ...m,
      convRate: m.clicks > 0 ? (m.subscribers / m.clicks) * 100 : 0,
      epc: m.clicks > 0 ? m.revenue / m.clicks : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [links]);

  const maxModelRevenue = useMemo(() => Math.max(...modelSummary.map(m => m.revenue), 1), [modelSummary]);

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    campaigns.forEach((c: any) => { if (c.traffic_source) s.add(c.traffic_source); });
    return Array.from(s);
  }, [campaigns]);

  const top5 = useMemo(() => [...enrichedLinks].sort((a, b) => b.revenue - a.revenue).slice(0, 5), [enrichedLinks]);
  const bottom5 = useMemo(() => {
    return enrichedLinks.filter((l) => l.clicks > 0).sort((a, b) => Number(a.conversion_rate) - Number(b.conversion_rate)).slice(0, 5);
  }, [enrichedLinks]);
  const maxTop5Rev = useMemo(() => Math.max(...top5.map(l => Number(l.revenue)), 1), [top5]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, sortField, align = "left" }: { label: string; sortField: SortKey; align?: string }) => (
    <th
      onClick={() => toggleSort(sortField)}
      className={`px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)}
      </span>
    </th>
  );

  const getStatus = (link: any) => {
    const daysSinceCreated = differenceInDays(new Date(), new Date(link.created_at));
    // DEAD = had clicks before but now 0 for 3+ days
    if (link.clicks === 0 && daysSinceCreated >= 3) {
      // Check if campaign ever had clicks (use daily_metrics or subscribers/spenders as proxy)
      const everHadTraffic = (link.subscribers > 0 || link.spenders > 0 || Number(link.revenue) > 0);
      if (everHadTraffic) return { label: "DEAD", color: "bg-destructive/15 text-destructive", icon: "🔴" };
      return { label: "INACTIVE", color: "bg-muted text-muted-foreground", icon: "⚫" };
    }
    if (link.ad_spend === 0) return { label: "NO DATA", color: "bg-muted text-muted-foreground", icon: "⚪" };
    if (link.roi === null || link.roi < 0) return { label: "KILL", color: "bg-destructive/15 text-destructive", icon: "🔴" };
    if (link.roi <= 50) return { label: "LOW", color: "bg-warning/15 text-warning", icon: "🟠" };
    if (link.roi <= 150) return { label: "WATCH", color: "bg-warning/15 text-warning", icon: "🟡" };
    return { label: "SCALE", color: "bg-primary/15 text-primary", icon: "🟢" };
  };

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const revenueColor = (rev: number) => {
    if (rev >= revenuePercentiles.p80) return "text-primary";
    if (rev <= revenuePercentiles.p20) return "text-destructive";
    return "text-foreground";
  };

  const handleAdSpendSubmit = async (data: any) => {
    try {
      await addAdSpend(data);
      toast.success("Ad spend saved");
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      setAdSpendSlideIn(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const exportCSV = () => {
    const headers = ["Account", "Campaign", "Clicks", "Subscribers", "Spenders", "Revenue", "Ad Spend", "ROI", "EPC", "RPS", "Status", "Created"];
    const rows = sortedLinks.map((l: any) => {
      const status = getStatus(l);
      return [
        l.accounts?.display_name || "", l.campaign_name || "", l.clicks, l.subscribers, l.spenders,
        Number(l.revenue).toFixed(2), l.ad_spend.toFixed(2), l.roi !== null ? l.roi.toFixed(1) + "%" : "—",
        Number(l.revenue_per_click || 0).toFixed(2), Number(l.revenue_per_subscriber || 0).toFixed(2),
        status.label, l.created_at ? format(new Date(l.created_at), "yyyy-MM-dd") : "",
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `campaigns_${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Campaign Report</title><style>
      body{font-family:system-ui,sans-serif;padding:40px;color:#111}h1{font-size:24px}h2{font-size:16px;margin-top:24px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
      th{background:#f5f5f5;font-weight:600}.kpi{display:inline-block;margin-right:32px}.kpi-val{font-size:20px;font-weight:700}.kpi-label{font-size:11px;color:#888}
    </style></head><body>
      <h1>Campaign Tracker Report</h1><p>Generated: ${format(new Date(), "MMMM d, yyyy HH:mm")}</p>
      <div style="margin:20px 0">
        <span class="kpi"><span class="kpi-label">Revenue</span><br><span class="kpi-val">${fmtCurrency(totalRevenue)}</span></span>
        <span class="kpi"><span class="kpi-label">Clicks</span><br><span class="kpi-val">${fmtNum(totalClicks)}</span></span>
        <span class="kpi"><span class="kpi-label">Subscribers</span><br><span class="kpi-val">${fmtNum(totalSubscribers)}</span></span>
        <span class="kpi"><span class="kpi-label">EPC</span><br><span class="kpi-val">${fmtCurrency(epc)}</span></span>
        <span class="kpi"><span class="kpi-label">ROI</span><br><span class="kpi-val">${fmtPct(roi)}</span></span>
      </div>
      <h2>Campaign Performance</h2>
      <table><tr><th>Account</th><th>Campaign</th><th>Clicks</th><th>Subs</th><th>Revenue</th><th>Ad Spend</th><th>ROI</th><th>Status</th></tr>
        ${sortedLinks.map((l: any) => {
          const status = getStatus(l);
          return `<tr><td>${l.accounts?.display_name||""}</td><td>${l.campaign_name||""}</td><td>${fmtNum(l.clicks)}</td><td>${fmtNum(l.subscribers)}</td><td>${fmtCurrency(Number(l.revenue))}</td><td>${l.ad_spend>0?fmtCurrency(l.ad_spend):"—"}</td><td>${l.roi!==null?fmtPct(l.roi):"—"}</td><td>${status.label}</td></tr>`;
        }).join("")}
      </table></body></html>`);
    w.document.close(); w.print();
  };

  const zeroClickAlerts = alerts.filter((a: any) => a.type === "zero_clicks" && !a.resolved);
  // Only count truly DEAD campaigns (had traffic then lost it) for the banner
  const trulyDeadCount = useMemo(() => {
    return filteredLinks.filter((l: any) => {
      const days = differenceInDays(new Date(), new Date(l.created_at));
      return l.clicks === 0 && days >= 3 && (l.subscribers > 0 || l.spenders > 0 || Number(l.revenue) > 0);
    }).length;
  }, [filteredLinks]);

  const selectedModelData = useMemo(() => {
    if (!selectedModel) return null;
    const m = modelSummary.find((m) => m.id === selectedModel);
    if (!m) return null;
    const modelLinks = enrichedLinks.filter((l) => l.account_id === selectedModel);
    const topCampaign = [...modelLinks].sort((a, b) => b.revenue - a.revenue)[0];
    return { ...m, topCampaign: topCampaign?.campaign_name || "—", avgEpc: m.epc, avgConvRate: m.convRate };
  }, [selectedModel, modelSummary, enrichedLinks]);

  const clearAllFilters = useCallback(() => {
    setSelectedModel(null);
    setSearchQuery("");
    setFilters({ account_id: "all", campaign_id: "all", traffic_source: "all", date_preset: "all" });
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Campaign Dashboard</h1>
            <div className="flex items-center gap-2 mt-1">
              {lastSynced && (
                <span className="text-xs text-muted-foreground">
                  Last synced {format(new Date(lastSynced), "MMM d, HH:mm")}
                </span>
              )}
              {nextSyncDays !== null && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  Next sync in {nextSyncDays}d
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns..."
                className="bg-card border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-all w-64"
              />
            </div>
            <button onClick={exportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={exportPDF} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>

        {/* ALERT BANNER */}
        {trulyDeadCount > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                🔴 {trulyDeadCount} campaign{trulyDeadCount > 1 ? "s" : ""} lost all traffic (had clicks before, now 0 for 3+ days)
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                These campaigns previously had subscribers or revenue but are now receiving zero clicks.
              </p>
            </div>
          </div>
        )}

        {/* DAILY DECISION VIEW */}
        <DailyDecisionView links={filteredLinks} />

        {/* KPI CARDS */}
        {linksLoading ? (
          <div className="grid grid-cols-5 lg:grid-cols-10 gap-3">
            <SkeletonCard wide />
            {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-5 lg:grid-cols-10 gap-3">
            {/* Hero card - 2x wide */}
            <div className="col-span-2 bg-card border border-border rounded-lg p-5 card-hover emerald-glow">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Revenue</span>
              </div>
              <p className="text-[36px] font-bold text-primary animate-count-up font-mono leading-tight">{fmtCurrency(totalRevenue)}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="h-3 w-3 text-primary" />
                <span className="text-xs text-muted-foreground">vs last sync</span>
              </div>
            </div>
            {[
              { label: "Total Clicks", value: fmtNum(totalClicks), icon: MousePointerClick },
              { label: "Subscribers", value: fmtNum(totalSubscribers), icon: Users },
              { label: "EPC", value: fmtCurrency(epc), icon: TrendingUp },
              { label: "Conv Rate", value: fmtPct(conversionRate), icon: Percent },
              { label: "Blended CVR", value: fmtPct(blendedCvr), icon: Percent },
              { label: "Blended CPL", value: blendedCpl > 0 ? fmtCurrency(blendedCpl) : "—", icon: DollarSign },
              { label: "Profit", value: fmtCurrency(profit), icon: PiggyBank, colored: true, val: profit },
              { label: "ROI", value: fmtPct(roi), icon: BarChart3, colored: true, val: roi },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-card border border-border rounded-lg p-3 card-hover">
                <div className="flex items-center gap-2 mb-2">
                  <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{kpi.label}</span>
                </div>
                <p className={`text-lg font-bold font-mono animate-count-up ${
                  kpi.colored ? ((kpi.val ?? 0) >= 0 ? "text-primary" : "text-destructive") : "text-foreground"
                }`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* MODEL CARDS */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedModel(null)}
            className={`min-w-[220px] bg-card border rounded-lg p-4 text-left transition-all duration-200 card-hover ${
              selectedModel === null ? "border-primary ring-2 ring-primary/30 emerald-glow" : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <LayoutGrid className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">All Accounts</p>
                <p className="text-xs text-muted-foreground">{accounts.length} models</p>
              </div>
            </div>
            <p className="text-xl font-bold font-mono text-primary mb-1">{fmtCurrency(totalRevenue)}</p>
            <div className="text-xs text-muted-foreground">{fmtNum(totalSubscribers)} subs · {fmtNum(totalClicks)} clicks</div>
          </button>

          {modelSummary.map((model) => {
            const isSelected = selectedModel === model.id;
            const barWidth = (model.revenue / maxModelRevenue) * 100;
            return (
              <button
                key={model.id}
                onClick={() => setSelectedModel(isSelected ? null : model.id)}
                className={`min-w-[220px] bg-card border rounded-lg p-4 text-left transition-all duration-200 card-hover ${
                  isSelected ? "border-primary ring-2 ring-primary/30 emerald-glow" : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                    {model.display_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{model.display_name}</p>
                    <p className="text-xs text-muted-foreground">@{model.username || "—"}</p>
                  </div>
                </div>
                <p className="text-xl font-bold font-mono text-primary mb-2">{fmtCurrency(model.revenue)}</p>
                <div className="w-full bg-secondary rounded-full h-1.5 mb-2">
                  <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${barWidth}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{fmtNum(model.subscribers)} subs</span>
                  <span>EPC {fmtCurrency(model.epc)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* MODEL DETAIL PANEL */}
        {selectedModelData && (
          <div className="animate-slide-down bg-card border border-primary/20 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-foreground">{selectedModelData.display_name} — Detail View</h3>
              <button onClick={() => setSelectedModel(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-6 gap-4">
              {[
                { label: "Revenue", value: fmtCurrency(selectedModelData.revenue), color: "text-primary" },
                { label: "Clicks", value: fmtNum(selectedModelData.clicks), color: "text-foreground" },
                { label: "Subscribers", value: fmtNum(selectedModelData.subscribers), color: "text-foreground" },
                { label: "Top Campaign", value: selectedModelData.topCampaign, color: "text-foreground", noMono: true },
                { label: "Avg EPC", value: fmtCurrency(selectedModelData.avgEpc), color: "text-foreground" },
                { label: "Avg Conv Rate", value: fmtPct(selectedModelData.avgConvRate), color: "text-foreground" },
              ].map((stat) => (
                <div key={stat.label}>
                  <span className="text-xs text-muted-foreground uppercase block mb-1">{stat.label}</span>
                  <span className={`${stat.noMono ? "" : "font-mono"} font-semibold ${stat.color}`}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TOP 5 / BOTTOM 5 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowUpRight className="h-3.5 w-3.5" /> Top 5 by Revenue
            </h3>
            <div className="space-y-3">
              {top5.map((l: any, i) => (
                <button
                  key={l.id}
                  onClick={() => { setSearchQuery(l.campaign_name || ""); }}
                  className="flex items-center gap-3 w-full text-left hover:bg-secondary/50 rounded-lg p-2 -m-2 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{l.campaign_name || "—"}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{l.accounts?.display_name || ""}</span>
                      <div className="flex-1 bg-secondary rounded-full h-1">
                        <div className="bg-primary h-1 rounded-full" style={{ width: `${(Number(l.revenue) / maxTop5Rev) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-sm font-semibold text-primary shrink-0">{fmtCurrency(Number(l.revenue))}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h3 className="text-xs font-bold text-destructive uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowDownRight className="h-3.5 w-3.5" /> Bottom 5 by Conversion
            </h3>
            <div className="space-y-3">
              {bottom5.map((l: any, i) => (
                <button
                  key={l.id}
                  onClick={() => { setSearchQuery(l.campaign_name || ""); }}
                  className="flex items-center gap-3 w-full text-left hover:bg-secondary/50 rounded-lg p-2 -m-2 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-destructive/15 text-destructive flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{l.campaign_name || "—"}</p>
                    <span className="text-xs text-muted-foreground">{l.accounts?.display_name || ""}</span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-destructive shrink-0">{fmtPct(Number(l.conversion_rate))}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* TABLE CONTROLS */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filters.traffic_source} onChange={(e) => setFilters(f => ({ ...f, traffic_source: e.target.value }))}
              className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary">
              <option value="all">All Sources</option>
              {trafficSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {selectedModel && (
              <button onClick={() => setSelectedModel(null)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
                ✕ Clear model filter
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-0.5">
            <button onClick={() => setViewMode("compact")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${viewMode === "compact" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="h-3.5 w-3.5" /> Compact
            </button>
            <button onClick={() => setViewMode("full")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${viewMode === "full" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Columns className="h-3.5 w-3.5" /> Full
            </button>
          </div>
        </div>

        {/* CAMPAIGN TABLE */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {linksLoading ? (
            <div className="p-12 text-center">
              <div className="space-y-3 max-w-lg mx-auto">
                {[...Array(5)].map((_, i) => <div key={i} className="skeleton-shimmer h-10 rounded-lg" />)}
              </div>
            </div>
          ) : !sortedLinks.length ? (
            <div className="p-16 text-center">
              <p className="text-muted-foreground mb-3">No campaigns found</p>
              <button onClick={clearAllFilters} className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Account</th>
                    <SortHeader label="Campaign" sortField="campaign_name" />
                    {viewMode === "full" && <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">Trend</th>}
                    <SortHeader label="Clicks" sortField="clicks" align="right" />
                    <SortHeader label="Subs" sortField="subscribers" align="right" />
                    {viewMode === "full" && <SortHeader label="Spenders" sortField="spenders" align="right" />}
                    <SortHeader label="Revenue" sortField="revenue" align="right" />
                    {viewMode === "full" && <SortHeader label="Ad Spend" sortField="ad_spend" align="right" />}
                    {viewMode === "full" && <SortHeader label="ROI" sortField="roi" align="right" />}
                    {viewMode === "full" && <SortHeader label="EPC" sortField="epc" align="right" />}
                    {viewMode === "full" && <SortHeader label="RPS" sortField="revenue_per_subscriber" align="right" />}
                    <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">Status</th>
                    <SortHeader label="Created" sortField="created_at" />
                    {viewMode === "full" && <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Calculated</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedLinks.map((link: any) => {
                    const status = getStatus(link);
                    const spark = sparklineData[link.id] || [];
                    const sparkTrending = spark.length >= 2 ? spark[spark.length - 1].revenue >= spark[spark.length - 2].revenue : true;

                    return (
                      <tr key={link.id} className="border-b border-border hover-emerald-border hover:bg-secondary/30 transition-all duration-200 cursor-pointer" onClick={() => setSelectedLink(link)}>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                              {(link.accounts?.display_name || "?").charAt(0)}
                            </div>
                            <span className="text-xs text-muted-foreground">@{link.accounts?.username || "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-sm font-medium text-foreground">{link.campaign_name || "—"}</p>
                          <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{link.url || ""}</p>
                        </td>
                        {viewMode === "full" && (
                          <td className="px-3 py-3 w-[80px]">
                            {spark.length > 1 ? (
                              <ResponsiveContainer width={60} height={24}>
                                <LineChart data={spark}>
                                  <Line type="monotone" dataKey="revenue" stroke={sparkTrending ? "hsl(160, 84%, 39%)" : "hsl(0, 84%, 60%)"} strokeWidth={1.5} dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-3 text-right font-mono text-sm">{fmtNum(link.clicks)}</td>
                        <td className="px-3 py-3 text-right font-mono text-sm">{fmtNum(link.subscribers)}</td>
                        {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">{fmtNum(link.spenders)}</td>}
                        <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${revenueColor(Number(link.revenue))}`}>{fmtCurrency(Number(link.revenue))}</td>
                        {viewMode === "full" && (
                          <td className="px-3 py-3 text-right font-mono text-sm">
                            <span
                              onClick={() => setAdSpendSlideIn(link)}
                              className={`cursor-pointer hover:underline transition-colors ${link.ad_spend > 0 ? "text-destructive" : "text-muted-foreground italic"}`}
                            >
                              {link.ad_spend > 0 ? fmtCurrency(link.ad_spend) : "click to add"}
                            </span>
                          </td>
                        )}
                        {viewMode === "full" && (
                          <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${link.roi === null ? "text-muted-foreground" : link.roi >= 0 ? "text-primary" : "text-destructive"}`}>
                            {link.roi !== null ? fmtPct(link.roi) : "—"}
                          </td>
                        )}
                        {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">${Number(link.revenue_per_click || 0).toFixed(2)}</td>}
                        {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">${Number(link.revenue_per_subscriber || 0).toFixed(2)}</td>}
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${status.color}`}>
                            {status.icon} {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <CampaignAgePill
                            createdAt={link.created_at}
                            lastActivityAt={link.calculated_at}
                            clicks={link.clicks}
                            revenue={Number(link.revenue || 0)}
                          />
                        </td>
                        {viewMode === "full" && (
                          <td className="px-3 py-3 text-muted-foreground text-xs font-mono">
                            {link.calculated_at ? format(new Date(link.calculated_at), "MMM d, HH:mm") : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* AD SPEND SLIDE-IN */}
      {adSpendSlideIn && (
        <AdSpendSlideIn
          link={adSpendSlideIn}
          onClose={() => setAdSpendSlideIn(null)}
          onSubmit={handleAdSpendSubmit}
        />
      )}
    </DashboardLayout>
  );
}

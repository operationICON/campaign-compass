import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  Percent, PiggyBank, BarChart3, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  AlertTriangle, Download, FileText, LayoutGrid, Search, X, Columns, List
} from "lucide-react";

type SortKey = "campaign_name" | "clicks" | "subscribers" | "spenders" | "revenue" | "epc" | "revenue_per_subscriber" | "roi" | "ad_spend" | "created_at" | "profit";

const MODEL_CATEGORIES: Record<string, string> = {
  "Jess": "Female",
  "Zoey": "Female",
  "Mia": "Trans",
  "Flor": "Female",
  "Aylin": "Trans",
};

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
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"compact" | "full">("compact");
  const [adSpendSlideIn, setAdSpendSlideIn] = useState<any>(null);
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [dashPerPage, setDashPerPage] = useState(10);
  const [dashPage, setDashPage] = useState(1);

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
      if (ageFilter !== "all" && link.created_at) {
        const days = differenceInDays(new Date(), new Date(link.created_at));
        if (ageFilter === "new" && days > 30) return false;
        if (ageFilter === "active" && (days <= 30 || days > 90)) return false;
        if (ageFilter === "mature" && (days <= 90 || days > 180)) return false;
        if (ageFilter === "old" && days <= 180) return false;
      }
      return true;
    });
  }, [links, filters.traffic_source, selectedModel, searchQuery, ageFilter]);

  const adSpendByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    adSpendData.forEach((a: any) => { map[a.campaign_id] = (map[a.campaign_id] || 0) + Number(a.amount); });
    return map;
  }, [adSpendData]);

  const enrichedLinks = useMemo(() => {
    return filteredLinks.map((link: any) => {
      const spend = adSpendByCampaign[link.campaign_id] || Number(link.cost_total || 0);
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

  // KPIs
  const totalLtv = filteredLinks.reduce((s: number, l: any) => s + Number(l.revenue), 0);
  const totalClicks = filteredLinks.reduce((s: number, l: any) => s + l.clicks, 0);
  const totalSubscribers = filteredLinks.reduce((s: number, l: any) => s + l.subscribers, 0);
  const totalSpend = filteredLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
  const totalProfit = totalLtv - totalSpend;
  const avgCpl = totalSubscribers > 0 && totalSpend > 0 ? totalSpend / totalSubscribers : 0;
  const blendedRoi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;

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

  // LTV last 30 days per model
  const modelLtv30d = useMemo(() => {
    const map: Record<string, number> = {};
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = format(cutoff, "yyyy-MM-dd");
    dailyMetrics.forEach((m: any) => {
      if (m.date >= cutoffStr) {
        const accId = m.account_id;
        if (accId) map[accId] = (map[accId] || 0) + Number(m.revenue || 0);
      }
    });
    return map;
  }, [dailyMetrics]);

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    campaigns.forEach((c: any) => { if (c.traffic_source) s.add(c.traffic_source); });
    return Array.from(s);
  }, [campaigns]);

  const top5Ltv = useMemo(() => [...enrichedLinks].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 5), [enrichedLinks]);
  const top5Profit = useMemo(() => [...enrichedLinks].filter(l => l.ad_spend > 0).sort((a, b) => b.profit - a.profit).slice(0, 5), [enrichedLinks]);
  const bottom5Profit = useMemo(() => [...enrichedLinks].filter(l => l.ad_spend > 0).sort((a, b) => a.profit - b.profit).slice(0, 5), [enrichedLinks]);
  const maxTop5Rev = useMemo(() => Math.max(...top5Ltv.map(l => Number(l.revenue)), 1), [top5Ltv]);

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
    if (link.clicks === 0 && daysSinceCreated >= 3) {
      const everHadTraffic = (link.subscribers > 0 || link.spenders > 0 || Number(link.revenue) > 0);
      if (everHadTraffic) return { label: "DEAD", color: "bg-destructive/15 text-destructive", icon: "🔴" };
      return { label: "INACTIVE", color: "bg-muted text-muted-foreground", icon: "⚫" };
    }
    if (link.ad_spend === 0 && !link.cost_total) return { label: "NO SPEND", color: "bg-muted text-muted-foreground", icon: "⚪" };
    if (link.roi === null || link.roi < 0) return { label: "KILL", color: "bg-destructive/15 text-destructive", icon: "🔴" };
    if (link.roi <= 50) return { label: "LOW", color: "bg-warning/15 text-warning", icon: "🟠" };
    if (link.roi <= 150) return { label: "WATCH", color: "bg-warning/15 text-warning", icon: "🟡" };
    return { label: "SCALE", color: "bg-primary/15 text-primary", icon: "🟢" };
  };

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const handleAdSpendSubmit = async (data: any) => {
    try {
      await addAdSpend(data);
      toast.success("Spend saved");
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      setAdSpendSlideIn(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const exportCSV = () => {
    const headers = ["Account", "Campaign", "Clicks", "Subscribers", "LTV", "Spend", "Profit", "ROI", "Status", "Created"];
    const rows = sortedLinks.map((l: any) => {
      const status = getStatus(l);
      return [
        l.accounts?.display_name || "", l.campaign_name || "", l.clicks, l.subscribers,
        Number(l.revenue).toFixed(2), l.ad_spend.toFixed(2), l.profit.toFixed(2),
        l.roi !== null ? l.roi.toFixed(1) + "%" : "—",
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
        <span class="kpi"><span class="kpi-label">Total LTV</span><br><span class="kpi-val">${fmtCurrency(totalLtv)}</span></span>
        <span class="kpi"><span class="kpi-label">Total Spend</span><br><span class="kpi-val">${fmtCurrency(totalSpend)}</span></span>
        <span class="kpi"><span class="kpi-label">Profit</span><br><span class="kpi-val">${fmtCurrency(totalProfit)}</span></span>
        <span class="kpi"><span class="kpi-label">ROI</span><br><span class="kpi-val">${fmtPct(blendedRoi)}</span></span>
      </div>
      <h2>Campaign Performance</h2>
      <table><tr><th>Account</th><th>Campaign</th><th>Clicks</th><th>Subs</th><th>LTV</th><th>Spend</th><th>Profit</th><th>ROI</th><th>Status</th></tr>
        ${sortedLinks.map((l: any) => {
          const status = getStatus(l);
          return `<tr><td>${l.accounts?.display_name||""}</td><td>${l.campaign_name||""}</td><td>${fmtNum(l.clicks)}</td><td>${fmtNum(l.subscribers)}</td><td>${fmtCurrency(Number(l.revenue))}</td><td>${l.ad_spend>0?fmtCurrency(l.ad_spend):"—"}</td><td>${fmtCurrency(l.profit)}</td><td>${l.roi!==null?fmtPct(l.roi):"—"}</td><td>${status.label}</td></tr>`;
        }).join("")}
      </table></body></html>`);
    w.document.close(); w.print();
  };

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
    const topCampaign = [...modelLinks].sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];
    return { ...m, topCampaign: topCampaign?.campaign_name || "—" };
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
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-1">Campaign Overview</p>
            <h1 className="text-[19px] font-bold text-foreground">Campaign <span className="gradient-text">Performance</span></h1>
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
                className="bg-card border border-border rounded-[10px] pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-all duration-200 w-64"
              />
            </div>
            <div className="flex items-center bg-card border border-border rounded-[10px] overflow-hidden">
              {(["all", "new", "active", "mature", "old"] as const).map((f) => {
                const count = f === "all" ? links.length : links.filter((l: any) => {
                  if (!l.created_at) return false;
                  const days = differenceInDays(new Date(), new Date(l.created_at));
                  if (f === "new") return days <= 30;
                  if (f === "active") return days > 30 && days <= 90;
                  if (f === "mature") return days > 90 && days <= 180;
                  return days > 180;
                }).length;
                return (
                  <button
                    key={f}
                    onClick={() => setAgeFilter(f)}
                    className={`px-3 py-2 text-xs font-medium transition-colors duration-200 inline-flex items-center gap-1.5 ${
                      ageFilter === f ? "gradient-bg text-white" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === "all" ? "All Ages" : f === "new" ? "🟢 New" : f === "active" ? "🔵 Active" : f === "mature" ? "🟡 Mature" : "⚪ Old"}
                    <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      ageFilter === f ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                    }`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={exportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all duration-200">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={exportPDF} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all duration-200">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 hero-glow ${
                syncMutation.isPending ? "gradient-bg" : "gradient-bg hover:opacity-90"
              }`}
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
                {trulyDeadCount} campaign{trulyDeadCount > 1 ? "s" : ""} lost all traffic
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                These campaigns previously had subscribers or revenue but are now receiving zero clicks.
              </p>
            </div>
          </div>
        )}

        {/* DAILY DECISION VIEW */}
        <DailyDecisionView links={enrichedLinks.map(l => ({ ...l, status: getStatus(l).label }))} />

        {/* KPI CARDS — 5 cards only */}
        {linksLoading ? (
          <div className="grid grid-cols-5 gap-3">
            <SkeletonCard wide />
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {/* Hero card - Total LTV */}
            <div className="hero-gradient rounded-lg p-5 card-hover hero-glow text-white">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-white/80" />
                <span className="text-xs text-white/70 font-medium uppercase tracking-wider">Total LTV</span>
              </div>
              <p className="text-[36px] font-bold animate-count-up font-mono leading-tight">{fmtCurrency(totalLtv)}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="h-3 w-3 text-white/70" />
                <span className="text-xs text-white/70">vs last sync</span>
              </div>
            </div>
            {/* Total Spend */}
            <div className="bg-card border border-border rounded-lg p-3 card-hover">
              <div className="flex items-center gap-2 mb-2">
                <PiggyBank className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total Spend</span>
              </div>
              <p className={`text-lg font-bold font-mono ${totalSpend > 0 ? "text-foreground" : "text-destructive"}`}>
                {fmtCurrency(totalSpend)}
              </p>
            </div>
            {/* Total Profit */}
            <div className="bg-card border border-border rounded-lg p-3 card-hover">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total Profit</span>
              </div>
              {totalSpend > 0 ? (
                <p className={`text-lg font-bold font-mono ${totalProfit >= 0 ? "gradient-text" : "text-destructive"}`}>
                  {fmtCurrency(totalProfit)}
                </p>
              ) : (
                <>
                  <p className="text-lg font-bold font-mono text-muted-foreground">—</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Enter spend to see profit</p>
                </>
              )}
            </div>
            {/* Avg CPL */}
            <div className="bg-card border border-border rounded-lg p-3 card-hover">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Avg CPL</span>
              </div>
              <p className="text-lg font-bold font-mono text-foreground">
                {avgCpl > 0 ? fmtCurrency(avgCpl) : "—"}
              </p>
            </div>
            {/* Blended ROI */}
            <div className="bg-card border border-border rounded-lg p-3 card-hover">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Blended ROI</span>
              </div>
              <p className={`text-lg font-bold font-mono ${totalSpend > 0 ? (blendedRoi >= 0 ? "gradient-text" : "text-destructive") : "text-muted-foreground"}`}>
                {totalSpend > 0 ? fmtPct(blendedRoi) : "—"}
              </p>
            </div>
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
            <p className="text-xl font-bold font-mono gradient-text mb-1">{fmtCurrency(totalLtv)}</p>
            <div className="text-xs text-muted-foreground">{fmtNum(totalSubscribers)} subs</div>
          </button>

          {modelSummary.map((model) => {
            const isSelected = selectedModel === model.id;
            const barWidth = (model.revenue / maxModelRevenue) * 100;
            const category = MODEL_CATEGORIES[model.display_name] || "—";
            const ltv30d = modelLtv30d[model.id];
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
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{model.display_name}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${category === "Trans" ? "bg-purple-500/15 text-purple-400" : "bg-pink-500/15 text-pink-400"}`}>
                        {category}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">@{model.username || "—"}</p>
                  </div>
                </div>
                <p className="text-xl font-bold font-mono gradient-text mb-1">{fmtCurrency(model.revenue)}</p>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Last 30d: {ltv30d !== undefined ? <span className="text-primary font-semibold">{fmtCurrency(ltv30d)}</span> : <span className="text-muted-foreground/60 italic">Syncing...</span>}
                </p>
                <div className="w-full bg-secondary rounded-full h-1.5 mb-2">
                  <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${barWidth}%` }} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtNum(model.subscribers)} subs
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
            <div className="grid grid-cols-5 gap-4">
              {[
                { label: "Total LTV", value: fmtCurrency(selectedModelData.revenue), color: "text-primary" },
                { label: "Clicks", value: fmtNum(selectedModelData.clicks), color: "text-foreground" },
                { label: "Subscribers", value: fmtNum(selectedModelData.subscribers), color: "text-foreground" },
                { label: "Top Campaign", value: selectedModelData.topCampaign, color: "text-foreground", noMono: true },
                { label: "Category", value: MODEL_CATEGORIES[selectedModelData.display_name] || "—", color: "text-foreground", noMono: true },
              ].map((stat) => (
                <div key={stat.label}>
                  <span className="text-xs text-muted-foreground uppercase block mb-1">{stat.label}</span>
                  <span className={`${stat.noMono ? "" : "font-mono"} font-semibold ${stat.color}`}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TOP 5 by LTV / TOP 5 by Profit / BOTTOM 5 by Profit */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowUpRight className="h-3.5 w-3.5" /> Top 5 by LTV
            </h3>
            <div className="space-y-3">
              {top5Ltv.map((l: any, i) => (
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
                  <span className="font-mono text-sm font-semibold gradient-text shrink-0">{fmtCurrency(Number(l.revenue))}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowUpRight className="h-3.5 w-3.5" /> Top 5 by Profit
            </h3>
            <div className="space-y-3">
              {top5Profit.length === 0 ? (
                <p className="text-xs text-muted-foreground">Set spend on campaigns to see profit rankings</p>
              ) : top5Profit.map((l: any, i) => (
                <button
                  key={l.id}
                  onClick={() => { setSearchQuery(l.campaign_name || ""); }}
                  className="flex items-center gap-3 w-full text-left hover:bg-secondary/50 rounded-lg p-2 -m-2 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{l.campaign_name || "—"}</p>
                    <span className="text-xs text-muted-foreground">{l.accounts?.display_name || ""}</span>
                  </div>
                  <span className={`font-mono text-sm font-semibold shrink-0 ${l.profit >= 0 ? "gradient-text" : "text-destructive"}`}>
                    {l.profit >= 0 ? "+" : ""}{fmtCurrency(l.profit)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 card-hover">
            <h3 className="text-xs font-bold text-destructive uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowDownRight className="h-3.5 w-3.5" /> Bottom 5 by Profit
            </h3>
            <div className="space-y-3">
              {bottom5Profit.length === 0 ? (
                <p className="text-xs text-muted-foreground">Set spend on campaigns to see profit rankings</p>
              ) : bottom5Profit.map((l: any, i) => (
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
                  <span className="font-mono text-sm font-semibold text-destructive shrink-0">
                    {fmtCurrency(l.profit)}
                  </span>
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
              <button onClick={() => setSelectedModel(null)} className="px-3 py-1.5 text-xs font-medium rounded-[10px] bg-primary/15 text-primary hover:bg-primary/25 transition-colors duration-200">
                ✕ Clear model filter
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-[10px] p-0.5">
            <button onClick={() => setViewMode("compact")} className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors duration-200 flex items-center gap-1.5 ${viewMode === "compact" ? "gradient-bg text-white" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="h-3.5 w-3.5" /> Compact
            </button>
            <button onClick={() => setViewMode("full")} className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors duration-200 flex items-center gap-1.5 ${viewMode === "full" ? "gradient-bg text-white" : "text-muted-foreground hover:text-foreground"}`}>
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
          ) : (() => {
            const dashTotalPages = Math.max(1, Math.ceil(sortedLinks.length / dashPerPage));
            const dashSafePage = Math.min(dashPage, dashTotalPages);
            const dashStart = (dashSafePage - 1) * dashPerPage;
            const dashEnd = Math.min(dashSafePage * dashPerPage, sortedLinks.length);
            const paginatedLinks = sortedLinks.slice(dashStart, dashEnd);
            return (
              <>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">
                    Showing {dashStart + 1}–{dashEnd} of {sortedLinks.length} campaigns
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-card">
                        <SortHeader label="Campaign" sortField="campaign_name" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Account</th>
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Source</th>
                        {viewMode === "full" && <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">Trend</th>}
                        {viewMode === "full" && <SortHeader label="Clicks" sortField="clicks" align="right" />}
                        {viewMode === "full" && <SortHeader label="Subs" sortField="subscribers" align="right" />}
                        <SortHeader label="LTV" sortField="revenue" align="right" />
                        <SortHeader label="Spend" sortField="ad_spend" align="right" />
                        <SortHeader label="Profit" sortField="profit" align="right" />
                        <SortHeader label="ROI" sortField="roi" align="right" />
                        {viewMode === "full" && <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">CPL</th>}
                        {viewMode === "full" && <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">LTV/Sub</th>}
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">Status</th>
                        {viewMode === "full" && <SortHeader label="Created" sortField="created_at" />}
                        {viewMode === "full" && <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Active</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedLinks.map((link: any) => {
                        const status = getStatus(link);
                        const spark = sparklineData[link.id] || [];
                        const sparkTrending = spark.length >= 2 ? spark[spark.length - 1].revenue >= spark[spark.length - 2].revenue : true;
                        const ltvPerSub = link.subscribers > 0 ? Number(link.revenue) / link.subscribers : 0;
                        const cplReal = Number(link.cpl_real || 0);
                        const mediaBuyer = link.source || null;

                        return (
                          <tr key={link.id} className="border-b border-border hover-emerald-border hover:bg-secondary/30 transition-all duration-200 cursor-pointer" onClick={() => setSelectedLink(link)}>
                            <td className="px-3 py-3">
                              <p className="text-sm font-medium text-foreground">{link.campaign_name || "—"}</p>
                              <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{link.url || ""}</p>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                  {(link.accounts?.display_name || "?").charAt(0)}
                                </div>
                                <span className="text-xs text-muted-foreground">@{link.accounts?.username || "—"}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {mediaBuyer ? (
                                <span className="text-xs text-foreground">{mediaBuyer}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">— Untagged</span>
                              )}
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
                            {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">{fmtNum(link.clicks)}</td>}
                            {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">{fmtNum(link.subscribers)}</td>}
                            <td className={`px-3 py-3 text-right font-mono text-sm font-semibold`}><span className="gradient-text">{fmtCurrency(Number(link.revenue))}</span></td>
                            <td className="px-3 py-3 text-right font-mono text-sm">
                              {link.ad_spend > 0 ? (
                                <span className="text-foreground">{fmtCurrency(link.ad_spend)}</span>
                              ) : (
                                <span
                                  onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }}
                                  className="text-muted-foreground italic cursor-pointer hover:text-primary transition-colors"
                                >Set Spend</span>
                              )}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${link.ad_spend > 0 ? (link.profit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                              {link.ad_spend > 0 ? fmtCurrency(link.profit) : "—"}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${link.roi === null ? "text-muted-foreground" : link.roi >= 0 ? "text-primary" : "text-destructive"}`}>
                              {link.roi !== null ? fmtPct(link.roi) : "—"}
                            </td>
                            {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">{cplReal > 0 ? fmtCurrency(cplReal) : "—"}</td>}
                            {viewMode === "full" && <td className="px-3 py-3 text-right font-mono text-sm">{ltvPerSub > 0 ? fmtCurrency(ltvPerSub) : "—"}</td>}
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${status.color}`}>
                                {status.icon} {status.label}
                              </span>
                            </td>
                            {viewMode === "full" && (
                              <td className="px-3 py-3">
                                <CampaignAgePill
                                  createdAt={link.created_at}
                                  lastActivityAt={link.calculated_at}
                                  clicks={link.clicks}
                                  revenue={Number(link.revenue || 0)}
                                />
                              </td>
                            )}
                            {viewMode === "full" && (
                              <td className="px-3 py-3 text-muted-foreground text-xs">
                                {link.calculated_at ? format(new Date(link.calculated_at), "MMM d, HH:mm") : "—"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <div className="flex items-center gap-3">
                    {dashPerPage === 10 && sortedLinks.length > 10 && (
                      <button
                        onClick={() => { setDashPerPage(25); setDashPage(1); }}
                        className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        Show more (25 rows)
                      </button>
                    )}
                  </div>
                  {dashTotalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setDashPage(Math.max(1, dashSafePage - 1))} disabled={dashSafePage <= 1} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
                        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                      </button>
                      {Array.from({ length: Math.min(dashTotalPages, 7) }, (_, i) => {
                        let pageNum: number;
                        if (dashTotalPages <= 7) pageNum = i + 1;
                        else if (dashSafePage <= 4) pageNum = i + 1;
                        else if (dashSafePage >= dashTotalPages - 3) pageNum = dashTotalPages - 6 + i;
                        else pageNum = dashSafePage - 3 + i;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setDashPage(pageNum)}
                            className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                              pageNum === dashSafePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      <button onClick={() => setDashPage(Math.min(dashTotalPages, dashSafePage + 1))} disabled={dashSafePage >= dashTotalPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
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

      {selectedLink && (
        <CampaignDetailSlideIn
          link={selectedLink}
          cost={Number(selectedLink.cost_total || 0)}
          onClose={() => setSelectedLink(null)}
          onSetCost={() => {
            setCostSlideIn(selectedLink);
            setSelectedLink(null);
          }}
        />
      )}

      {costSlideIn && (
        <CostSettingSlideIn
          link={costSlideIn}
          onClose={() => setCostSlideIn(null)}
          onSaved={() => {
            setCostSlideIn(null);
            queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
            toast.success("Spend saved & metrics recalculated");
          }}
        />
      )}
    </DashboardLayout>
  );
}

import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendSlideIn } from "@/components/dashboard/AdSpendSlideIn";
import { DailyDecisionView } from "@/components/dashboard/DailyDecisionView";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { CampaignDetailSlideIn } from "@/components/dashboard/CampaignDetailSlideIn";
import { CostSettingSlideIn } from "@/components/dashboard/CostSettingSlideIn";
import { fetchAccounts, fetchCampaigns, fetchTrackingLinks, fetchAdSpend, fetchDailyMetrics, fetchAlerts, fetchSyncSettings, triggerSync, addAdSpend } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  RefreshCw, DollarSign, TrendingUp,
  PiggyBank, BarChart3, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  AlertTriangle, Download, FileText, Search, Users, Target
} from "lucide-react";

type SortKey = "campaign_name" | "clicks" | "subscribers" | "spenders" | "revenue" | "epc" | "revenue_per_subscriber" | "roi" | "ad_spend" | "created_at" | "profit";

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ account_id: "all", traffic_source: "all" });
  const [ageFilter, setAgeFilter] = useState<"all" | "new" | "active" | "mature" | "old">("all");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [adSpendSlideIn, setAdSpendSlideIn] = useState<any>(null);
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [costSlideIn, setCostSlideIn] = useState<any>(null);
  const [dashPerPage, setDashPerPage] = useState(25);
  const [dashPage, setDashPage] = useState(1);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links", filters.account_id],
    queryFn: () => fetchTrackingLinks({
      account_id: filters.account_id !== "all" ? filters.account_id : undefined,
    }),
  });
  const { data: adSpendData = [] } = useQuery({ queryKey: ["ad_spend"], queryFn: () => fetchAdSpend() });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: syncSettings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });

  const syncFrequency = useMemo(() => {
    const s = syncSettings.find((s: any) => s.key === "sync_frequency_days");
    return s ? parseInt(s.value) : 3;
  }, [syncSettings]);

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(filters.account_id !== "all" ? filters.account_id : undefined, true, (msg) => {
      toast.info(msg, { id: 'sync-progress' });
    }),
    onSuccess: (data) => {
      const count = data?.accounts_synced ?? 0;
      toast.success(`Sync complete — ${count} accounts synced`, { id: 'sync-progress' });
      ["tracking_links", "accounts", "campaigns", "ad_spend", "sync_logs", "alerts", "daily_metrics"].forEach(k =>
        queryClient.invalidateQueries({ queryKey: [k] })
      );
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`, { id: 'sync-progress' }),
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
      if (filters.traffic_source !== "all" && (link.source_tag || "Untagged") !== filters.traffic_source) return false;
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
  }, [links, filters.traffic_source, searchQuery, ageFilter]);

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
  const totalSubscribers = filteredLinks.reduce((s: number, l: any) => s + l.subscribers, 0);
  const totalSpend = filteredLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
  const totalProfit = totalLtv - totalSpend;
  const avgCostPerSub = totalSubscribers > 0 && totalSpend > 0 ? totalSpend / totalSubscribers : 0;
  const blendedRoi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;

  // Agency benchmark CVR
  const agencyAvgCvr = useMemo(() => {
    const qualified = links.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const totalS = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalC = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return totalC > 0 ? (totalS / totalC) * 100 : null;
  }, [links]);

  // Model summary for CVR insights
  const modelSummary = useMemo(() => {
    const map: Record<string, { id: string; display_name: string; username: string; avatar_thumb_url: string | null; revenue: number; subscribers: number; clicks: number }> = {};
    links.forEach((link: any) => {
      const accId = link.account_id;
      if (!map[accId]) {
        map[accId] = { id: accId, display_name: link.accounts?.display_name || "Unknown", username: link.accounts?.username || "", avatar_thumb_url: link.accounts?.avatar_thumb_url || null, revenue: 0, subscribers: 0, clicks: 0 };
      }
      map[accId].revenue += Number(link.revenue);
      map[accId].subscribers += link.subscribers;
      map[accId].clicks += link.clicks;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [links]);

  const modelCvrInsights = useMemo(() => {
    return modelSummary.map(m => {
      const accLinks = links.filter((l: any) => l.account_id === m.id && l.clicks > 100);
      const totalS = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const totalC = accLinks.reduce((s: number, l: any) => s + l.clicks, 0);
      const cvr = totalC > 0 ? (totalS / totalC) * 100 : null;
      const diff = cvr !== null && agencyAvgCvr !== null ? cvr - agencyAvgCvr : null;
      return { ...m, cvr, cvrDiff: diff };
    });
  }, [modelSummary, links, agencyAvgCvr]);

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

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    campaigns.forEach((c: any) => { if (c.traffic_source) s.add(c.traffic_source); });
    return Array.from(s);
  }, [campaigns]);

  const top5Ltv = useMemo(() => [...enrichedLinks].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 5), [enrichedLinks]);
  const top5Profit = useMemo(() => [...enrichedLinks].filter(l => l.ad_spend > 0).sort((a, b) => b.profit - a.profit).slice(0, 5), [enrichedLinks]);
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
      if (everHadTraffic) return { label: "Dead", color: "bg-destructive/10 text-destructive", icon: "🔴" };
      return { label: "Inactive", color: "bg-muted text-muted-foreground", icon: "⚫" };
    }
    if (link.ad_spend === 0 && !link.cost_total) return { label: "No Spend", color: "bg-muted text-muted-foreground", icon: "⚪" };
    if (link.roi === null || link.roi < 0) return { label: "Kill", color: "bg-destructive/10 text-destructive", icon: "🔴" };
    if (link.roi <= 50) return { label: "Low", color: "bg-warning/10 text-warning", icon: "🟠" };
    if (link.roi <= 150) return { label: "Watch", color: "bg-warning/10 text-warning", icon: "🟡" };
    return { label: "Scale", color: "bg-primary/10 text-primary", icon: "🟢" };
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

  const trulyDeadNames = useMemo(() => {
    return filteredLinks
      .filter((l: any) => {
        const days = differenceInDays(new Date(), new Date(l.created_at));
        return l.clicks === 0 && days >= 3 && (l.subscribers > 0 || l.spenders > 0 || Number(l.revenue) > 0);
      })
      .slice(0, 5)
      .map((l: any) => l.campaign_name || "Unknown");
  }, [filteredLinks]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setFilters({ account_id: "all", traffic_source: "all" });
    setAgeFilter("all");
  }, []);

  // Subs/Day calculation helper
  const getSubsPerDay = (link: any) => {
    if (!link.created_at) return null;
    const days = differenceInDays(new Date(), new Date(link.created_at));
    if (days < 1) return null;
    return link.subscribers / days;
  };

  // CVR helpers
  const getCvrColor = (cvr: number) => {
    if (agencyAvgCvr === null) return "text-foreground";
    const threshold = agencyAvgCvr * 0.2;
    if (cvr > agencyAvgCvr + threshold) return "text-primary";
    if (cvr < agencyAvgCvr - threshold) return "text-destructive";
    return "text-muted-foreground";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-bold text-foreground">Campaign Dashboard</h1>
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
                className="bg-card border border-border rounded-[10px] pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-all duration-200 w-56"
              />
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50 hover:opacity-90"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>

        {/* ALERT BANNER — amber, only when dead campaigns exist */}
        {trulyDeadCount > 0 && (
          <div className="bg-warning/10 border border-warning/30 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-warning">
                {trulyDeadCount} campaign{trulyDeadCount > 1 ? "s" : ""} lost all traffic
              </p>
              <p className="text-xs text-warning/80 mt-1">
                {trulyDeadNames.join(", ")}{trulyDeadCount > 5 ? ` and ${trulyDeadCount - 5} more` : ""}
              </p>
            </div>
          </div>
        )}

        {/* DAILY DECISION VIEW — collapsed by default */}
        <DailyDecisionView links={enrichedLinks.map(l => ({ ...l, status: getStatus(l).label }))} />

        {/* KPI CARDS — 5 only */}
        {linksLoading ? (
          <div className="grid grid-cols-5 gap-3.5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-5">
                <div className="skeleton-shimmer h-3 w-20 rounded mb-3" />
                <div className="skeleton-shimmer h-8 w-28 rounded mb-2" />
                <div className="skeleton-shimmer h-3 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-3.5">
            {/* Hero — Total LTV */}
            <div className="bg-primary rounded-2xl p-5 text-primary-foreground shadow-md">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 opacity-80" />
                <span className="text-xs opacity-70 font-medium uppercase tracking-wider">Total LTV</span>
              </div>
              <p className="text-[28px] font-bold font-mono leading-tight">{fmtCurrency(totalLtv)}</p>
            </div>
            {/* Total Spend */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <PiggyBank className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Spend</span>
              </div>
              <p className={`text-xl font-bold font-mono ${totalSpend > 0 ? "text-foreground" : "text-destructive"}`}>
                {fmtCurrency(totalSpend)}
              </p>
            </div>
            {/* Total Profit */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Profit</span>
              </div>
              {totalSpend > 0 ? (
                <p className={`text-xl font-bold font-mono ${totalProfit >= 0 ? "text-primary" : "text-destructive"}`}>
                  {fmtCurrency(totalProfit)}
                </p>
              ) : (
                <>
                  <p className="text-xl font-bold font-mono text-muted-foreground">—</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Enter spend to see profit</p>
                </>
              )}
            </div>
            {/* Blended ROI */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Blended ROI</span>
              </div>
              <p className={`text-xl font-bold font-mono ${totalSpend > 0 ? (blendedRoi >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                {totalSpend > 0 ? fmtPct(blendedRoi) : "—"}
              </p>
            </div>
            {/* Avg Cost/Sub */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Avg Cost/Sub</span>
              </div>
              <p className="text-xl font-bold font-mono text-foreground">
                {avgCostPerSub > 0 ? fmtCurrency(avgCostPerSub) : "—"}
              </p>
            </div>
          </div>
        )}

        {/* CVR INSIGHTS */}
        {agencyAvgCvr !== null && modelCvrInsights.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-bold text-primary uppercase tracking-wider">CVR Performance vs Agency Average</h3>
              <span className="text-[11px] text-muted-foreground ml-2">Agency avg: {agencyAvgCvr.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              {modelCvrInsights.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  {m.avatar_thumb_url ? (
                    <img src={m.avatar_thumb_url} alt={m.display_name} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">{m.display_name.charAt(0)}</div>
                  )}
                  <span className="text-sm font-medium text-foreground">{m.display_name}</span>
                  <span className="font-mono text-sm font-semibold">
                    {m.cvr !== null ? `${m.cvr.toFixed(1)}%` : "—"}
                  </span>
                  {m.cvrDiff !== null && (
                    <span className={`text-[11px] font-semibold ${m.cvrDiff >= 0 ? "text-primary" : "text-destructive"}`}>
                      {m.cvrDiff >= 0 ? "+" : ""}{m.cvrDiff.toFixed(1)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TOP 5 PANELS — side by side */}
        <div className="grid grid-cols-2 gap-3.5">
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowUpRight className="h-3.5 w-3.5" /> Top 5 by LTV
            </h3>
            <div className="space-y-3">
              {top5Ltv.map((l: any, i) => (
                <button
                  key={l.id}
                  onClick={() => setSearchQuery(l.campaign_name || "")}
                  className="flex items-center gap-3 w-full text-left hover:bg-secondary/50 rounded-lg p-2 -m-2 transition-colors"
                >
                  <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{l.campaign_name || "—"}</p>
                    <span className="text-xs text-muted-foreground">{l.accounts?.display_name || ""}</span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-primary shrink-0">{fmtCurrency(Number(l.revenue))}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowUpRight className="h-3.5 w-3.5" /> Top 5 by Profit
            </h3>
            <div className="space-y-3">
              {top5Profit.length === 0 ? (
                <p className="text-xs text-muted-foreground">Set spend on campaigns to see profit rankings</p>
              ) : top5Profit.map((l: any, i) => (
                <button
                  key={l.id}
                  onClick={() => setSearchQuery(l.campaign_name || "")}
                  className="flex items-center gap-3 w-full text-left hover:bg-secondary/50 rounded-lg p-2 -m-2 transition-colors"
                >
                  <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{l.campaign_name || "—"}</p>
                    <span className="text-xs text-muted-foreground">{l.accounts?.display_name || ""}</span>
                  </div>
                  <span className={`font-mono text-sm font-semibold shrink-0 ${l.profit >= 0 ? "text-primary" : "text-destructive"}`}>
                    {l.profit >= 0 ? "+" : ""}{fmtCurrency(l.profit)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* TABLE FILTERS */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filters.account_id}
            onChange={(e) => { setFilters(f => ({ ...f, account_id: e.target.value })); setDashPage(1); }}
            className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Accounts</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
          <select
            value={filters.traffic_source}
            onChange={(e) => { setFilters(f => ({ ...f, traffic_source: e.target.value })); setDashPage(1); }}
            className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Sources</option>
            {trafficSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
            {(["all", "new", "active", "mature", "old"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setAgeFilter(f); setDashPage(1); }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
                  ageFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "All Ages" : f === "new" ? "🟢 New" : f === "active" ? "🔵 Active" : f === "mature" ? "🟡 Mature" : "⚪ Old"}
              </button>
            ))}
          </div>
        </div>

        {/* CAMPAIGN TABLE — full view always */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Rows:</span>
                    {[10, 25, 50, 100].map(n => (
                      <button key={n} onClick={() => { setDashPerPage(n); setDashPage(1); }}
                        className={`px-2 py-0.5 text-xs rounded ${dashPerPage === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >{n}</button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-border bg-muted/30">
                        <SortHeader label="Campaign" sortField="campaign_name" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Account</th>
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Source</th>
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Subs/Day</th>
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">CVR</th>
                        <SortHeader label="LTV" sortField="revenue" align="right" />
                        <SortHeader label="Spend" sortField="ad_spend" align="right" />
                        <SortHeader label="Profit" sortField="profit" align="right" />
                        <SortHeader label="ROI" sortField="roi" align="right" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">Cost/Sub</th>
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-center">Status</th>
                        <SortHeader label="Created" sortField="created_at" />
                        <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-left">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedLinks.map((link: any) => {
                        const status = getStatus(link);
                        const ltvPerSub = link.subscribers > 0 ? Number(link.revenue) / link.subscribers : 0;
                        const cplReal = Number(link.cpl_real || 0);
                        const mediaBuyer = link.source || null;
                        const subsPerDay = getSubsPerDay(link);
                        const cvr = link.clicks > 0 ? (link.subscribers / link.clicks) * 100 : null;

                        return (
                          <tr key={link.id} className="border-b border-border hover:bg-muted/20 transition-all duration-200 cursor-pointer group" onClick={() => setSelectedLink(link)}>
                            <td className="px-3 py-3">
                              <div className="group-hover:border-l-2 group-hover:border-primary group-hover:pl-2 transition-all">
                                <p className="text-[13px] font-medium text-foreground">{link.campaign_name || "—"}</p>
                                <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{link.url || ""}</p>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                                  {(link.accounts?.display_name || "?").charAt(0)}
                                </div>
                                <span className="text-xs text-muted-foreground">@{link.accounts?.username || "—"}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {mediaBuyer ? (
                                <span className="text-xs text-foreground">{mediaBuyer}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Untagged</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs">
                              {subsPerDay !== null ? `${subsPerDay.toFixed(1)}/day` : "—"}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-xs ${cvr !== null ? getCvrColor(cvr) : "text-muted-foreground"}`}>
                              {cvr !== null ? `${cvr.toFixed(1)}%` : "—"}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-[13px] font-semibold text-primary">{fmtCurrency(Number(link.revenue))}</td>
                            <td className="px-3 py-3 text-right font-mono text-xs">
                              {link.ad_spend > 0 ? (
                                <span className="text-foreground">{fmtCurrency(link.ad_spend)}</span>
                              ) : (
                                <span
                                  onClick={(e) => { e.stopPropagation(); setCostSlideIn(link); }}
                                  className="text-muted-foreground italic cursor-pointer hover:text-primary transition-colors"
                                >Set Spend</span>
                              )}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-xs font-semibold ${link.ad_spend > 0 ? (link.profit >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                              {link.ad_spend > 0 ? fmtCurrency(link.profit) : "—"}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono text-xs font-semibold ${link.roi === null ? "text-muted-foreground" : link.roi >= 0 ? "text-primary" : "text-destructive"}`}>
                              {link.roi !== null ? fmtPct(link.roi) : "—"}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs">
                              {cplReal > 0 ? <span className="font-semibold text-primary">{fmtCurrency(cplReal)}</span> : "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-block min-w-[70px] px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${status.color}`}>
                                {status.label}
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
                            <td className="px-3 py-3 text-muted-foreground text-xs">
                              {link.calculated_at ? format(new Date(link.calculated_at), "MMM d, HH:mm") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-end px-4 py-3 border-t border-border">
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
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
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

      {/* SLIDE-INS */}
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

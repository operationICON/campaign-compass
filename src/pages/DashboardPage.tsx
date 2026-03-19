import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAccounts, fetchCampaigns, fetchTrackingLinks, fetchAdSpend, fetchDailyMetrics, fetchAlerts, fetchSyncSettings, triggerSync, addAdSpend } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  RefreshCw, DollarSign, MousePointerClick, Users, TrendingUp,
  Percent, PiggyBank, BarChart3, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown,
  AlertTriangle, Download, FileText, LayoutGrid, Search
} from "lucide-react";

type SortKey = "campaign_name" | "clicks" | "subscribers" | "spenders" | "revenue" | "epc" | "revenue_per_subscriber" | "roi" | "ad_spend";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    account_id: "all",
    campaign_id: "all",
    traffic_source: "all",
    date_preset: "all",
  });
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [editingAdSpend, setEditingAdSpend] = useState<string | null>(null);
  const [adSpendValue, setAdSpendValue] = useState("");
  const adSpendInputRef = useRef<HTMLInputElement>(null);

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
    mutationFn: () => triggerSync(filters.account_id !== "all" ? filters.account_id : undefined),
    onSuccess: (data) => {
      const results = data?.results ?? [];
      const errors = results.filter((r: any) => r.status === "error");
      if (errors.length > 0) toast.warning(`Sync completed with ${errors.length} error(s)`);
      else toast.success(`Sync completed — ${results.length} account(s) processed`);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["daily_metrics"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  // Build sparkline data per tracking_link_id
  const sparklineData = useMemo(() => {
    const map: Record<string, { date: string; revenue: number }[]> = {};
    dailyMetrics.forEach((m: any) => {
      if (!map[m.tracking_link_id]) map[m.tracking_link_id] = [];
      map[m.tracking_link_id].push({ date: m.date, revenue: Number(m.revenue) });
    });
    // Keep only last 7 days per link
    Object.keys(map).forEach((k) => {
      map[k] = map[k].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
    });
    return map;
  }, [dailyMetrics]);

  const filteredLinks = useMemo(() => {
    return links.filter((link: any) => {
      if (filters.traffic_source !== "all" && link.source !== filters.traffic_source) return false;
      if (selectedModel && link.account_id !== selectedModel) return false;
      return true;
    });
  }, [links, filters.traffic_source, selectedModel]);

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
    const sorted = [...enrichedLinks].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortAsc ? av - bv : bv - av;
    });
    const top3Ids = [...enrichedLinks].sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((l: any) => l.id);
    const pinned = sorted.filter((l: any) => top3Ids.includes(l.id));
    const rest = sorted.filter((l: any) => !top3Ids.includes(l.id));
    return [...pinned, ...rest];
  }, [enrichedLinks, sortKey, sortAsc]);

  const top3Ids = useMemo(() => {
    return [...enrichedLinks].sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((l: any) => l.id);
  }, [enrichedLinks]);

  // KPIs
  const totalRevenue = filteredLinks.reduce((s: number, l: any) => s + Number(l.revenue), 0);
  const totalClicks = filteredLinks.reduce((s: number, l: any) => s + l.clicks, 0);
  const totalSubscribers = filteredLinks.reduce((s: number, l: any) => s + l.subscribers, 0);
  const totalAdSpend = adSpendData.reduce((s: number, a: any) => s + Number(a.amount), 0);
  const epc = totalClicks > 0 ? totalRevenue / totalClicks : 0;
  const conversionRate = totalClicks > 0 ? (totalSubscribers / totalClicks) * 100 : 0;
  const profit = totalRevenue - totalAdSpend;
  const roi = totalAdSpend > 0 ? (profit / totalAdSpend) * 100 : 0;

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

  // Per-model summary
  const modelSummary = useMemo(() => {
    const map: Record<string, { id: string; display_name: string; username: string; revenue: number; subscribers: number; clicks: number; topCampaign: string; convRate: number }> = {};
    links.forEach((link: any) => {
      const accId = link.account_id;
      if (!map[accId]) {
        map[accId] = {
          id: accId,
          display_name: link.accounts?.display_name || "Unknown",
          username: link.accounts?.username || "",
          revenue: 0, subscribers: 0, clicks: 0, topCampaign: "", convRate: 0,
        };
      }
      map[accId].revenue += Number(link.revenue);
      map[accId].subscribers += link.subscribers;
      map[accId].clicks += link.clicks;
      if (Number(link.revenue) > 0 && (!map[accId].topCampaign || Number(link.revenue) > 0)) {
        map[accId].topCampaign = link.campaign_name || "";
      }
    });
    return Object.values(map).map((m) => ({
      ...m,
      convRate: m.clicks > 0 ? (m.subscribers / m.clicks) * 100 : 0,
      epc: m.clicks > 0 ? m.revenue / m.clicks : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [links]);

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    campaigns.forEach((c: any) => { if (c.traffic_source) s.add(c.traffic_source); });
    return Array.from(s);
  }, [campaigns]);

  // Top 5 / Bottom 5
  const top5 = useMemo(() => enrichedLinks.sort((a, b) => b.revenue - a.revenue).slice(0, 5), [enrichedLinks]);
  const bottom5 = useMemo(() => {
    return enrichedLinks
      .filter((l) => l.clicks > 0)
      .sort((a, b) => Number(a.conversion_rate) - Number(b.conversion_rate))
      .slice(0, 5);
  }, [enrichedLinks]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, sortField, align = "left" }: { label: string; sortField: SortKey; align?: string }) => (
    <th
      onClick={() => toggleSort(sortField)}
      className={`px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  const getStatus = (link: any) => {
    const daysSinceCreated = differenceInDays(new Date(), new Date(link.created_at));
    // DEAD: 0 clicks for 3+ days
    if (link.clicks === 0 && daysSinceCreated >= 3) return { label: "DEAD", color: "bg-destructive/15 text-destructive", emoji: "🔴" };
    // No ad spend
    if (link.ad_spend === 0) return { label: "NO DATA", color: "bg-muted-foreground/20 text-muted-foreground", emoji: "⚪" };
    // ROI-based
    if (link.roi === null || link.roi < 0) return { label: "KILL", color: "bg-destructive/15 text-destructive", emoji: "🔴" };
    if (link.roi <= 50) return { label: "LOW", color: "bg-[hsl(25,95%,53%)]/15 text-[hsl(25,95%,53%)]", emoji: "🟠" };
    if (link.roi <= 150) return { label: "WATCH", color: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]", emoji: "🟡" };
    return { label: "SCALE", color: "bg-primary/15 text-primary", emoji: "🟢" };
  };

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  // Inline ad spend save
  const handleInlineAdSpend = async (link: any) => {
    const amount = parseFloat(adSpendValue);
    if (isNaN(amount) || amount <= 0) { setEditingAdSpend(null); return; }
    try {
      await addAdSpend({
        campaign_id: link.campaign_id,
        traffic_source: link.source || "direct",
        amount,
        date: new Date().toISOString().split("T")[0],
      });
      toast.success("Ad spend saved");
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    } catch (err: any) {
      toast.error(err.message);
    }
    setEditingAdSpend(null);
    setAdSpendValue("");
  };

  // CSV export
  const exportCSV = () => {
    const headers = ["Account", "Campaign", "Clicks", "Subscribers", "Spenders", "Revenue", "Ad Spend", "ROI", "EPC", "RPS", "Status"];
    const rows = sortedLinks.map((l: any) => {
      const status = getStatus(l);
      return [
        l.accounts?.display_name || "",
        l.campaign_name || "",
        l.clicks, l.subscribers, l.spenders,
        Number(l.revenue).toFixed(2),
        l.ad_spend.toFixed(2),
        l.roi !== null ? l.roi.toFixed(1) + "%" : "—",
        Number(l.revenue_per_click || 0).toFixed(2),
        Number(l.revenue_per_subscriber || 0).toFixed(2),
        status.label,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaigns_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // PDF export (simple printable report)
  const exportPDF = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Campaign Report</title><style>
      body { font-family: system-ui, sans-serif; padding: 40px; color: #111; }
      h1 { font-size: 24px; } h2 { font-size: 16px; margin-top: 24px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f5f5f5; font-weight: 600; }
      .kpi { display: inline-block; margin-right: 32px; }
      .kpi-val { font-size: 20px; font-weight: 700; }
      .kpi-label { font-size: 11px; color: #888; }
    </style></head><body>
      <h1>Campaign Tracker Report</h1>
      <p>Generated: ${format(new Date(), "MMMM d, yyyy HH:mm")}</p>
      <div style="margin: 20px 0;">
        <span class="kpi"><span class="kpi-label">Revenue</span><br><span class="kpi-val">${fmtCurrency(totalRevenue)}</span></span>
        <span class="kpi"><span class="kpi-label">Clicks</span><br><span class="kpi-val">${fmtNum(totalClicks)}</span></span>
        <span class="kpi"><span class="kpi-label">Subscribers</span><br><span class="kpi-val">${fmtNum(totalSubscribers)}</span></span>
        <span class="kpi"><span class="kpi-label">EPC</span><br><span class="kpi-val">${fmtCurrency(epc)}</span></span>
        <span class="kpi"><span class="kpi-label">ROI</span><br><span class="kpi-val">${fmtPct(roi)}</span></span>
      </div>
      <h2>Campaign Performance</h2>
      <table>
        <tr><th>Account</th><th>Campaign</th><th>Clicks</th><th>Subs</th><th>Revenue</th><th>Ad Spend</th><th>ROI</th><th>Status</th></tr>
        ${sortedLinks.map((l: any) => {
          const status = getStatus(l);
          return `<tr><td>${l.accounts?.display_name || ""}</td><td>${l.campaign_name || ""}</td><td>${fmtNum(l.clicks)}</td><td>${fmtNum(l.subscribers)}</td><td>${fmtCurrency(Number(l.revenue))}</td><td>${l.ad_spend > 0 ? fmtCurrency(l.ad_spend) : "—"}</td><td>${l.roi !== null ? fmtPct(l.roi) : "—"}</td><td>${status.label}</td></tr>`;
        }).join("")}
      </table>
    </body></html>`);
    w.document.close();
    w.print();
  };

  // Zero-click alerts
  const zeroClickAlerts = alerts.filter((a: any) => a.type === "zero_clicks" && !a.resolved);

  // Model detail panel
  const selectedModelData = useMemo(() => {
    if (!selectedModel) return null;
    const m = modelSummary.find((m) => m.id === selectedModel);
    if (!m) return null;
    const modelLinks = enrichedLinks.filter((l) => l.account_id === selectedModel);
    const topCampaign = modelLinks.sort((a, b) => b.revenue - a.revenue)[0];
    return { ...m, topCampaign: topCampaign?.campaign_name || "—", avgEpc: m.epc, avgConvRate: m.convRate };
  }, [selectedModel, modelSummary, enrichedLinks]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* ZERO-CLICK ALERT BANNER */}
        {zeroClickAlerts.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-[10px] p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                ⚠️ {zeroClickAlerts.length} campaign{zeroClickAlerts.length > 1 ? "s" : ""} had 0 clicks for 3+ days
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                {zeroClickAlerts.slice(0, 5).map((a: any) => `${a.campaign_name} (${a.account_name})`).join(" · ")}
                {zeroClickAlerts.length > 5 && ` +${zeroClickAlerts.length - 5} more`}
              </p>
            </div>
          </div>
        )}

        {/* TOP BAR */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-foreground">Campaign Dashboard</h1>
            <div className="flex items-center gap-2">
              {lastSynced && (
                <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-md">
                  Last synced: {format(new Date(lastSynced), "MMM d, HH:mm")}
                </span>
              )}
              {nextSyncDays !== null && (
                <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-md">
                  Next sync in: {nextSyncDays} day{nextSyncDays !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[6px] border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={exportPDF} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[6px] border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
            <AdSpendDialog campaigns={campaigns} onAdded={() => queryClient.invalidateQueries({ queryKey: ["ad_spend"] })} />
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-7 gap-3">
          {[
            { label: "Total Revenue", value: fmtCurrency(totalRevenue), icon: DollarSign, accent: true },
            { label: "Total Clicks", value: fmtNum(totalClicks), icon: MousePointerClick },
            { label: "Total Subscribers", value: fmtNum(totalSubscribers), icon: Users },
            { label: "EPC", value: fmtCurrency(epc), icon: TrendingUp },
            { label: "Conversion Rate", value: fmtPct(conversionRate), icon: Percent },
            { label: "Profit", value: fmtCurrency(profit), icon: PiggyBank, colorBySign: true, numVal: profit },
            { label: "ROI", value: fmtPct(roi), icon: BarChart3, colorBySign: true, numVal: roi },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-card border border-border rounded-[10px] p-4">
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{kpi.label}</span>
              </div>
              <p className={`text-lg font-semibold font-mono ${
                kpi.colorBySign
                  ? (kpi.numVal! >= 0 ? "text-accent" : "text-destructive")
                  : kpi.accent ? "text-accent" : "text-foreground"
              }`}>
                {kpi.value}
              </p>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="h-3 w-3 text-accent" />
                <span className="text-[10px] text-muted-foreground">vs last sync</span>
              </div>
            </div>
          ))}
        </div>

        {/* TOP 5 / BOTTOM 5 PANELS */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-[10px] p-4">
            <h3 className="text-xs font-semibold text-accent uppercase tracking-wider mb-3">🔥 Top 5 by Revenue</h3>
            <div className="space-y-2">
              {top5.map((l: any, i) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{i + 1}. {l.campaign_name || "—"}</span>
                  <span className="font-mono text-accent">{fmtCurrency(Number(l.revenue))}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-[10px] p-4">
            <h3 className="text-xs font-semibold text-destructive uppercase tracking-wider mb-3">⚠️ Bottom 5 by Conversion</h3>
            <div className="space-y-2">
              {bottom5.map((l: any, i) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{i + 1}. {l.campaign_name || "—"}</span>
                  <span className="font-mono text-destructive">{fmtPct(Number(l.conversion_rate))}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* PER MODEL STRIP — clickable */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {modelSummary.map((model) => {
            const isSelected = selectedModel === model.id;
            return (
              <button
                key={model.id}
                onClick={() => setSelectedModel(isSelected ? null : model.id)}
                className={`min-w-[200px] bg-card border rounded-[10px] p-3 flex items-center gap-3 text-left transition-all ${
                  isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40"
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                  {model.display_name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{model.display_name}</p>
                  <p className="text-[10px] text-muted-foreground">@{model.username || "—"}</p>
                  <div className="flex gap-3 mt-1 text-[11px]">
                    <span className="text-accent font-mono">{fmtCurrency(model.revenue)}</span>
                    <span className="text-muted-foreground">{fmtNum(model.subscribers)} subs</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* MODEL DETAIL PANEL */}
        {selectedModelData && (
          <div className="bg-card border border-primary/30 rounded-[10px] p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">{selectedModelData.display_name} — Detail View</h3>
            <div className="grid grid-cols-6 gap-4 text-sm">
              <div><span className="text-[10px] text-muted-foreground uppercase block">Revenue</span><span className="font-mono text-accent">{fmtCurrency(selectedModelData.revenue)}</span></div>
              <div><span className="text-[10px] text-muted-foreground uppercase block">Clicks</span><span className="font-mono">{fmtNum(selectedModelData.clicks)}</span></div>
              <div><span className="text-[10px] text-muted-foreground uppercase block">Subscribers</span><span className="font-mono">{fmtNum(selectedModelData.subscribers)}</span></div>
              <div><span className="text-[10px] text-muted-foreground uppercase block">Top Campaign</span><span className="text-foreground">{selectedModelData.topCampaign}</span></div>
              <div><span className="text-[10px] text-muted-foreground uppercase block">Avg EPC</span><span className="font-mono">{fmtCurrency(selectedModelData.avgEpc)}</span></div>
              <div><span className="text-[10px] text-muted-foreground uppercase block">Avg Conv Rate</span><span className="font-mono">{fmtPct(selectedModelData.avgConvRate)}</span></div>
            </div>
          </div>
        )}

        {/* FILTER BAR */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filters.account_id}
            onChange={(e) => setFilters((f) => ({ ...f, account_id: e.target.value }))}
            className="bg-secondary border border-border text-foreground text-sm rounded-[6px] px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Accounts</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
          <select
            value={filters.campaign_id}
            onChange={(e) => setFilters((f) => ({ ...f, campaign_id: e.target.value }))}
            className="bg-secondary border border-border text-foreground text-sm rounded-[6px] px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Campaigns</option>
            {campaigns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={filters.traffic_source}
            onChange={(e) => setFilters((f) => ({ ...f, traffic_source: e.target.value }))}
            className="bg-secondary border border-border text-foreground text-sm rounded-[6px] px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Sources</option>
            {trafficSources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex gap-1 ml-2">
            {["Today", "This Week", "This Month", "All Time"].map((preset) => (
              <button
                key={preset}
                onClick={() => setFilters((f) => ({ ...f, date_preset: preset === "All Time" ? "all" : preset.toLowerCase().replace(" ", "_") }))}
                className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors ${
                  (filters.date_preset === "all" && preset === "All Time") ||
                  filters.date_preset === preset.toLowerCase().replace(" ", "_")
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          {selectedModel && (
            <button onClick={() => setSelectedModel(null)} className="px-3 py-1.5 text-xs font-medium rounded-[6px] bg-primary/15 text-primary">
              ✕ Clear model filter
            </button>
          )}
        </div>

        {/* CAMPAIGN TABLE */}
        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {linksLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading tracking data...</div>
          ) : !sortedLinks.length ? (
            <div className="p-12 text-center text-muted-foreground">No tracking links found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-left">Account</th>
                    <SortHeader label="Campaign" sortField="campaign_name" />
                    <th className="px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-center">Trend</th>
                    <SortHeader label="Clicks" sortField="clicks" align="right" />
                    <SortHeader label="Subs" sortField="subscribers" align="right" />
                    <SortHeader label="Spenders" sortField="spenders" align="right" />
                    <SortHeader label="Revenue" sortField="revenue" align="right" />
                    <SortHeader label="Ad Spend" sortField="ad_spend" align="right" />
                    <SortHeader label="ROI" sortField="roi" align="right" />
                    <SortHeader label="EPC" sortField="epc" align="right" />
                    <SortHeader label="RPS" sortField="revenue_per_subscriber" align="right" />
                    <th className="px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-center">Status</th>
                    <th className="px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-left">Calculated</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLinks.map((link: any) => {
                    const isPinned = top3Ids.includes(link.id);
                    const status = getStatus(link);
                    const spark = sparklineData[link.id] || [];
                    const sparkTrending = spark.length >= 2 ? spark[spark.length - 1].revenue >= spark[spark.length - 2].revenue : true;
                    const isEditing = editingAdSpend === link.id;

                    return (
                      <tr
                        key={link.id}
                        className={`border-b border-border hover:bg-white/[0.02] transition-colors ${isPinned ? "border-l-2 border-l-primary" : ""}`}
                      >
                        <td className="px-3 py-2.5 text-muted-foreground text-xs">
                          {link.accounts?.username ? `@${link.accounts.username}` : link.accounts?.display_name || "—"}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-foreground text-xs">{link.campaign_name || "—"}</td>
                        <td className="px-3 py-2.5 w-[80px]">
                          {spark.length > 1 ? (
                            <ResponsiveContainer width={60} height={24}>
                              <LineChart data={spark}>
                                <Line type="monotone" dataKey="revenue" stroke={sparkTrending ? "#34d399" : "#ef4444"} strokeWidth={1.5} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtNum(link.clicks)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtNum(link.subscribers)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtNum(link.spenders)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-accent">{fmtCurrency(Number(link.revenue))}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">
                          {isEditing ? (
                            <input
                              ref={adSpendInputRef}
                              type="number"
                              step="0.01"
                              value={adSpendValue}
                              onChange={(e) => setAdSpendValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleInlineAdSpend(link); if (e.key === "Escape") setEditingAdSpend(null); }}
                              onBlur={() => handleInlineAdSpend(link)}
                              autoFocus
                              className="w-20 bg-secondary border border-primary rounded px-1.5 py-0.5 text-xs text-foreground outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => { setEditingAdSpend(link.id); setAdSpendValue(link.ad_spend > 0 ? String(link.ad_spend) : ""); }}
                              className={`cursor-pointer hover:underline ${link.ad_spend > 0 ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {link.ad_spend > 0 ? fmtCurrency(link.ad_spend) : "click to add"}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono text-xs ${link.roi === null ? "text-muted-foreground" : link.roi >= 0 ? "text-accent" : "text-destructive"}`}>
                          {link.roi !== null ? fmtPct(link.roi) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">${Number(link.revenue_per_click || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">${Number(link.revenue_per_subscriber || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase tracking-wide ${status.color}`}>
                            {status.emoji} {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-[10px]">
                          {link.calculated_at ? format(new Date(link.calculated_at), "MMM d, HH:mm") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

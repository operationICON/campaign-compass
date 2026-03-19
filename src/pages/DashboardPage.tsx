import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAccounts, fetchCampaigns, fetchTrackingLinks, fetchAdSpend, triggerSync } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RefreshCw, DollarSign, MousePointerClick, Users, TrendingUp,
  Percent, PiggyBank, BarChart3, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown
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

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links", filters.account_id, filters.campaign_id],
    queryFn: () => fetchTrackingLinks({
      account_id: filters.account_id !== "all" ? filters.account_id : undefined,
      campaign_id: filters.campaign_id !== "all" ? filters.campaign_id : undefined,
    }),
  });
  const { data: adSpendData = [] } = useQuery({
    queryKey: ["ad_spend"],
    queryFn: () => fetchAdSpend(),
  });

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
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  const filteredLinks = useMemo(() => {
    return links.filter((link: any) => {
      if (filters.traffic_source !== "all" && link.source !== filters.traffic_source) return false;
      return true;
    });
  }, [links, filters.traffic_source]);

  // Build ad spend lookup by campaign_id
  const adSpendByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    adSpendData.forEach((a: any) => {
      map[a.campaign_id] = (map[a.campaign_id] || 0) + Number(a.amount);
    });
    return map;
  }, [adSpendData]);

  // Enrich links with ad spend and ROI
  const enrichedLinks = useMemo(() => {
    return filteredLinks.map((link: any) => {
      const spend = adSpendByCampaign[link.campaign_id] || 0;
      const profit = Number(link.revenue) - spend;
      const roi = spend > 0 ? (profit / spend) * 100 : null;
      return { ...link, ad_spend: spend, profit, roi };
    });
  }, [filteredLinks, adSpendByCampaign]);

  // Sort
  const sortedLinks = useMemo(() => {
    const sorted = [...enrichedLinks].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortAsc ? av - bv : bv - av;
    });
    // Pin top 3 by revenue
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

  // Per-model summary
  const modelSummary = useMemo(() => {
    const map: Record<string, { display_name: string; username: string; revenue: number; subscribers: number; clicks: number }> = {};
    filteredLinks.forEach((link: any) => {
      const accId = link.account_id;
      if (!map[accId]) {
        map[accId] = {
          display_name: link.accounts?.display_name || "Unknown",
          username: link.accounts?.username || "",
          revenue: 0,
          subscribers: 0,
          clicks: 0,
        };
      }
      map[accId].revenue += Number(link.revenue);
      map[accId].subscribers += link.subscribers;
      map[accId].clicks += link.clicks;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filteredLinks]);

  const trafficSources = useMemo(() => {
    const s = new Set<string>();
    campaigns.forEach((c: any) => { if (c.traffic_source) s.add(c.traffic_source); });
    return Array.from(s);
  }, [campaigns]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, sortField, align = "left" }: { label: string; sortField: SortKey; align?: string }) => (
    <th
      onClick={() => toggleSort(sortField)}
      className={`px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  const getStatus = (link: any) => {
    if (link.ad_spend === 0 && Number(link.revenue) > 0) return { label: "NO SPEND DATA", color: "bg-muted-foreground/20 text-muted-foreground" };
    if (link.ad_spend === 0 && Number(link.revenue) === 0) return { label: "NO DATA", color: "bg-muted-foreground/20 text-muted-foreground" };
    if (link.roi === null || link.roi < 0 || Number(link.revenue) === 0) return { label: "KILL", color: "bg-destructive/15 text-destructive" };
    if (link.roi <= 100) return { label: "WATCH", color: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]" };
    return { label: "SCALE", color: "bg-primary/15 text-primary" };
  };

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* TOP BAR */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-foreground">Campaign Dashboard</h1>
            {lastSynced && (
              <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-md">
                Last synced: {format(new Date(lastSynced), "MMM d, HH:mm")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{kpi.label}</span>
              </div>
              <p className={`text-xl font-semibold font-mono ${
                kpi.colorBySign
                  ? (kpi.numVal! >= 0 ? "text-accent" : "text-destructive")
                  : kpi.accent
                    ? "text-accent"
                    : "text-foreground"
              }`}>
                {kpi.value}
              </p>
              <div className="flex items-center gap-1 mt-1.5">
                <ArrowUpRight className="h-3 w-3 text-accent" />
                <span className="text-[10px] text-muted-foreground">vs last sync</span>
              </div>
            </div>
          ))}
        </div>

        {/* PER MODEL STRIP */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {modelSummary.map((model) => {
            const modelEpc = model.clicks > 0 ? model.revenue / model.clicks : 0;
            return (
              <div key={model.username || model.display_name} className="min-w-[200px] bg-card border border-border rounded-[10px] p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                  {model.display_name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{model.display_name}</p>
                  <p className="text-[10px] text-muted-foreground">@{model.username || "—"}</p>
                  <div className="flex gap-3 mt-1 text-[11px]">
                    <span className="text-accent font-mono">{fmtCurrency(model.revenue)}</span>
                    <span className="text-muted-foreground">{fmtNum(model.subscribers)} subs</span>
                    <span className="text-muted-foreground">${modelEpc.toFixed(2)} EPC</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* FILTER BAR */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filters.account_id}
            onChange={(e) => setFilters((f) => ({ ...f, account_id: e.target.value }))}
            className="bg-secondary border border-border text-foreground text-sm rounded-[6px] px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Accounts</option>
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
          <select
            value={filters.campaign_id}
            onChange={(e) => setFilters((f) => ({ ...f, campaign_id: e.target.value }))}
            className="bg-secondary border border-border text-foreground text-sm rounded-[6px] px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Campaigns</option>
            {campaigns.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={filters.traffic_source}
            onChange={(e) => setFilters((f) => ({ ...f, traffic_source: e.target.value }))}
            className="bg-secondary border border-border text-foreground text-sm rounded-[6px] px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Sources</option>
            {trafficSources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
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
        </div>

        {/* CAMPAIGN TABLE */}
        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {linksLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading tracking data...</div>
          ) : !sortedLinks.length ? (
            <div className="p-12 text-center text-muted-foreground">No tracking links found. Add accounts and run a sync to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Account</th>
                    <SortHeader label="Campaign" sortField="campaign_name" />
                    <SortHeader label="Clicks" sortField="clicks" align="right" />
                    <SortHeader label="Subs" sortField="subscribers" align="right" />
                    <SortHeader label="Spenders" sortField="spenders" align="right" />
                    <SortHeader label="Revenue" sortField="revenue" align="right" />
                    <SortHeader label="Ad Spend" sortField="ad_spend" align="right" />
                    <SortHeader label="ROI" sortField="roi" align="right" />
                    <SortHeader label="EPC" sortField="epc" align="right" />
                    <SortHeader label="RPS" sortField="revenue_per_subscriber" align="right" />
                    <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-center">Status</th>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Calculated</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLinks.map((link: any) => {
                    const isPinned = top3Ids.includes(link.id);
                    const status = getStatus(link);
                    return (
                      <tr
                        key={link.id}
                        className={`border-b border-border hover:bg-white/[0.02] transition-colors ${isPinned ? "border-l-2 border-l-primary" : ""}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {link.accounts?.username ? `@${link.accounts.username}` : link.accounts?.display_name || "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{link.campaign_name || "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmtNum(link.clicks)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmtNum(link.subscribers)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmtNum(link.spenders)}</td>
                        <td className="px-4 py-3 text-right font-mono text-accent">{fmtCurrency(Number(link.revenue))}</td>
                        <td className="px-4 py-3 text-right font-mono text-destructive">
                          {link.ad_spend > 0 ? fmtCurrency(link.ad_spend) : "—"}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${link.roi === null ? "text-muted-foreground" : link.roi >= 0 ? "text-accent" : "text-destructive"}`}>
                          {link.roi !== null ? fmtPct(link.roi) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">${Number(link.revenue_per_click || link.epc || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono">${Number(link.revenue_per_subscriber || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase tracking-wide ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
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

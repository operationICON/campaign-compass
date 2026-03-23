import { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays, subDays } from "date-fns";
import { ArrowLeft, Camera, ExternalLink, ChevronUp, ChevronDown } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const MODEL_CATEGORIES: Record<string, string> = {
  "jessie_ca_xo": "Female",
  "zoey.skyy": "Female",
  "miakitty.ts": "Trans",
  "ella_cherryy": "Female",
  "aylin_bigts": "Trans",
};

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
  const queryClient = useQueryClient();
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | "Female" | "Trans">("all");
  const [activeTab, setActiveTab] = useState<"campaigns" | "sources" | "performance">("campaigns");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });
  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: avatarUrls = {}, refetch: refetchAvatars } = useQuery({
    queryKey: ["model-avatars"],
    queryFn: async () => {
      const { data } = await supabase.storage.from("model-avatars").list();
      if (!data) return {};
      const urls: Record<string, string> = {};
      for (const file of data) {
        const accountId = file.name.split(".")[0];
        const { data: urlData } = supabase.storage.from("model-avatars").getPublicUrl(file.name);
        urls[accountId] = urlData.publicUrl + "?t=" + Date.now();
      }
      return urls;
    },
  });

  const fmtCurrency = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const getCategory = (account: any) => MODEL_CATEGORIES[account.username] || "Female";

  const accountStats = useMemo(() => {
    const stats: Record<string, any> = {};
    for (const acc of accounts) {
      const accLinks = links.filter((l: any) => l.account_id === acc.id);
      const totalLtv = accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
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

      stats[acc.id] = {
        totalLtv,
        totalSpend,
        totalProfit: totalLtv - totalSpend,
        totalCampaigns: accLinks.length,
        activeCampaigns: activeLinks.length,
        avgSubsDay: accLinks.length > 1 ? (totalSubs / Math.max(1, accLinks.length)).toFixed(0) : "—",
        ltv30d: accMetrics.length > 0 ? ltv30d : null,
        totalClicks,
        totalSubs,
        blendedRoi: totalSpend > 0 ? ((totalLtv - totalSpend) / totalSpend) * 100 : null,
      };
    }
    return stats;
  }, [accounts, links, dailyMetrics]);

  const filteredAccounts = useMemo(() => {
    if (categoryFilter === "all") return accounts;
    return accounts.filter((a: any) => getCategory(a) === categoryFilter);
  }, [accounts, categoryFilter]);

  const handleUpload = async (accountId: string, file: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Only JPG, PNG, and WebP are allowed");
      return;
    }
    setUploadingFor(accountId);
    try {
      const ext = file.name.split(".").pop();
      const path = `${accountId}.${ext}`;
      // Delete existing
      await supabase.storage.from("model-avatars").remove([path]);
      // Also try other extensions
      await supabase.storage.from("model-avatars").remove([`${accountId}.jpg`, `${accountId}.png`, `${accountId}.webp`]);
      const { error } = await supabase.storage.from("model-avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      toast.success("Photo uploaded");
      refetchAvatars();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploadingFor(null);
    }
  };

  const AvatarCircle = ({ account, size = 80, showCamera = false }: { account: any; size?: number; showCamera?: boolean }) => {
    const colorIdx = accounts.indexOf(account) % AVATAR_COLORS.length;
    const avatarUrl = avatarUrls[account.id];
    return (
      <div className="relative group" style={{ width: size, height: size }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={account.display_name} className="rounded-full object-cover border-[3px] border-white shadow-md" style={{ width: size, height: size }} />
        ) : (
          <div className={`rounded-full bg-gradient-to-br ${AVATAR_COLORS[colorIdx]} flex items-center justify-center text-white font-bold border-[3px] border-white shadow-md`} style={{ width: size, height: size, fontSize: size * 0.35 }}>
            {account.display_name.charAt(0)}
          </div>
        )}
        {showCamera && (
          <button
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); setUploadingFor(account.id); }}
            className="absolute bottom-0 right-0 w-7 h-7 bg-primary rounded-full flex items-center justify-center text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
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
    if (link.status === "DEAD") return { label: "Dead", cls: "bg-[#fef2f2] text-[#dc2626] dark:bg-[rgba(239,68,68,0.15)] dark:text-[#EF4444]" };
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
      const src = l.source || "Untagged";
      if (!groups[src]) groups[src] = { source: src, links: 0, spend: 0, ltv: 0, profit: 0, roi: null };
      groups[src].links++;
      groups[src].spend += Number(l.cost_total || 0);
      groups[src].ltv += Number(l.revenue || 0);
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
    }, [accLinks, dailyMetrics]);

    return (
      <DashboardLayout>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && uploadingFor) handleUpload(uploadingFor, file);
            e.target.value = "";
          }}
        />
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
                <AvatarCircle account={acc} size={120} showCamera />
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
                    { label: "Total LTV", value: fmtCurrency(stats.totalLtv || 0), accent: true },
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
                    { label: "Total Campaigns", value: String(stats.totalCampaigns || 0) },
                    { label: "Active Campaigns", value: String(stats.activeCampaigns || 0) },
                    { label: "Avg Subs/Day", value: stats.avgSubsDay },
                    { label: "Blended ROI", value: stats.blendedRoi != null ? fmtPct(stats.blendedRoi) : "—" },
                  ].map((s) => (
                    <div key={s.label} className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                      <p className="text-lg font-bold font-mono text-foreground">{s.value}</p>
                    </div>
                  ))}
                </div>

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
                        {tab === "campaigns" ? "Campaigns" : tab === "sources" ? "Traffic Sources" : "Performance"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab content */}
                {activeTab === "campaigns" && (
                  <div className="overflow-x-auto">
                    {sortedLinks.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">No campaigns found for this model</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("campaign_name")}>Campaign <SortIcon col="campaign_name" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("clicks")}>Clicks <SortIcon col="clicks" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("subscribers")}>Subs <SortIcon col="subscribers" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("revenue")}>LTV <SortIcon col="revenue" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("profit")}>Profit <SortIcon col="profit" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("roi")}>ROI <SortIcon col="roi" /></th>
                            <th className="text-center py-2 px-3">Status</th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("created_at")}>Created <SortIcon col="created_at" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedLinks.map((l: any) => {
                            const status = getStatus(l);
                            const profit = Number(l.revenue || 0) - Number(l.cost_total || 0);
                            return (
                              <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                <td className="py-3 px-3">
                                  <p className="font-medium text-foreground text-[12px] truncate max-w-[200px]">{l.campaign_name || "—"}</p>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{l.url}</p>
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(l.clicks)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(l.subscribers)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] font-semibold text-primary">{fmtCurrency(Number(l.revenue))}</td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${l.cost_total > 0 ? (profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {l.cost_total > 0 ? fmtCurrency(profit) : "—"}
                                </td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${l.roi != null ? (l.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {l.roi != null ? fmtPct(l.roi) : "—"}
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
                              <td className="py-3 px-3 font-medium text-foreground text-[12px]">{g.source}</td>
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadingFor) handleUpload(uploadingFor, file);
          e.target.value = "";
        }}
      />
      <div className="space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-foreground">Models</h1>
          <p className="text-sm text-muted-foreground">All accounts connected to Campaign Tracker</p>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2">
          {(["all", "Female", "Trans"] as const).map((cat) => {
            const count = cat === "all" ? accounts.length : accounts.filter((a: any) => getCategory(a) === cat).length;
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
                {cat === "all" ? "All" : cat}
                <span className="ml-1.5 text-xs opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Model cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAccounts.map((acc: any) => {
            const stats = accountStats[acc.id] || {};
            const category = getCategory(acc);
            return (
              <div key={acc.id} className="bg-card border border-border rounded-2xl p-5 card-hover transition-all duration-200 hover:border-primary/40">
                <div className="flex items-start gap-4 mb-4">
                  <AvatarCircle account={acc} size={72} showCamera />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">{acc.display_name}</h3>
                    <p className="text-[13px] text-muted-foreground">@{acc.username || "—"}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${category === "Trans" ? "bg-[#ede9fe] text-[#7c3aed] dark:bg-purple-500/15 dark:text-purple-400" : "bg-[#dbeafe] text-[#1d4ed8] dark:bg-blue-500/15 dark:text-blue-400"}`}>
                        {category}
                      </span>
                      {acc.performer_top != null && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                          Top {acc.performer_top}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mb-3">
                  <p className="text-2xl font-bold font-mono text-primary">{fmtCurrency(stats.totalLtv || 0)}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Last 30d: {stats.ltv30d != null ? <span className="text-primary font-semibold">{fmtCurrency(stats.ltv30d)}</span> : <span className="italic opacity-60">Syncing...</span>}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-[12px] text-muted-foreground mb-4">
                  <span>{stats.totalCampaigns || 0} campaigns</span>
                  <span className="text-border">·</span>
                  <span>{stats.activeCampaigns || 0} active</span>
                  <span className="text-border">·</span>
                  <span>{stats.avgSubsDay} subs/day</span>
                </div>

                <button
                  onClick={() => { setSelectedAccount(acc); setActiveTab("campaigns"); setSortKey("revenue"); setSortAsc(false); }}
                  className="w-full py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
                >
                  View Profile
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}

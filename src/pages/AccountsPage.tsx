import { useState, useMemo, useEffect } from "react";
import { usePageFilters } from "@/hooks/usePageFilters";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { PageFilterBar } from "@/components/PageFilterBar";
import { RevenueModeBadge } from "@/components/RevenueModeBadge";
import { getEffectiveSource } from "@/lib/source-helpers";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchTrackingLinkLtv } from "@/lib/supabase-helpers";
import { TagBadge } from "@/components/TagBadge";
import { supabase } from "@/integrations/supabase/client";

import { format, differenceInDays, subDays } from "date-fns";
import { ArrowLeft, ChevronUp, ChevronDown, Pencil, X } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { RefreshButton } from "@/components/RefreshButton";
import { toast } from "sonner";

const GENDER_OPTIONS = ["Female", "Trans", "Male", "Uncategorized"] as const;
type GenderIdentity = typeof GENDER_OPTIONS[number];

const GENDER_BADGE_STYLES: Record<string, string> = {
  Female: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400",
  Trans: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
  Male: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  "Non-binary": "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400",
  Uncategorized: "bg-muted text-muted-foreground",
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
type CardSortKey = "spend" | "ltv_per_sub" | "subscribers" | "active_links" | "alpha";

const CARD_SORT_OPTIONS: { key: CardSortKey; label: string }[] = [
  { key: "spend", label: "Top Spenders" },
  { key: "ltv_per_sub", label: "Highest LTV/Sub" },
  { key: "subscribers", label: "Most Subscribers" },
  { key: "active_links", label: "Most Active Links" },
  { key: "alpha", label: "Alphabetical" },
];

export default function AccountsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { timePeriod, setTimePeriod, modelFilter: pageModelFilter, setModelFilter: setPageModelFilter, customRange, setCustomRange, dateFilter, revenueMode, setRevenueMode, revMultiplier } = usePageFilters();
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"campaigns" | "sources" | "performance">("campaigns");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [editingGenderFor, setEditingGenderFor] = useState<string | null>(null);
  const [cardSort, setCardSort] = useState<CardSortKey>("ltv_per_sub");
  const [expandedBreakdown, setExpandedBreakdown] = useState<Set<string>>(new Set());

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const { snapshotLookup, isLoading: snapshotLoading } = useSnapshotMetrics(timePeriod, customRange);
  const isAllTime = timePeriod === "all" && !customRange;

  const { data: allLinks = [] } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_links")
        .select("*, accounts(display_name, username, avatar_thumb_url)")
        .is("deleted_at", null)
        .order("revenue", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const links = useMemo(() => applySnapshotToLinks(allLinks, snapshotLookup), [allLinks, snapshotLookup]);

  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: trackingLinkLtv = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });

  // Fetch transaction breakdowns per account for revenue breakdown
  const { data: txBreakdowns = {} } = useQuery({
    queryKey: ["tx_breakdowns_by_account"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("account_id, type, revenue");
      if (error) throw error;
      const map: Record<string, { messages: number; tips: number; subscriptions: number; posts: number }> = {};
      for (const tx of (data || [])) {
        if (!tx.account_id) continue;
        if (!map[tx.account_id]) map[tx.account_id] = { messages: 0, tips: 0, subscriptions: 0, posts: 0 };
        const rev = Number(tx.revenue || 0);
        const t = (tx.type || "").toLowerCase();
        if (t === "message") map[tx.account_id].messages += rev;
        else if (t === "tip") map[tx.account_id].tips += rev;
        else if (t.includes("subscription")) map[tx.account_id].subscriptions += rev;
        else if (t === "post") map[tx.account_id].posts += rev;
      }
      return map;
    },
  });

  const ltvLookup = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trackingLinkLtv) {
      const key = String(r.tracking_link_id ?? "").trim().toLowerCase();
      if (key) map[key] = r;
    }
    return map;
  }, [trackingLinkLtv]);

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

  const getGender = (account: any): string => account.gender_identity || "Uncategorized";
  const getGenderBadgeStyle = (gender: string) => GENDER_BADGE_STYLES[gender] || GENDER_BADGE_STYLES.Uncategorized;

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    accounts.forEach((a: any) => cats.add(getGender(a)));
    return Array.from(cats).sort();
  }, [accounts]);

  const handleSaveGender = async (accountId: string, gender: string | null) => {
    const { error } = await supabase
      .from("accounts")
      .update({ gender_identity: gender } as any)
      .eq("id", accountId);
    if (error) {
      toast.error("Failed to save gender");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    setEditingGenderFor(null);
    toast.success(gender ? `Set to "${gender}"` : "Gender removed");
  };

  const agencyAvgCvr = useMemo(() => {
    const qualified = links.filter((l: any) => l.clicks > 100);
    if (qualified.length === 0) return null;
    const totalS = qualified.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalC = qualified.reduce((s: number, l: any) => s + l.clicks, 0);
    return totalC > 0 ? (totalS / totalC) * 100 : null;
  }, [links]);

  // FIX 6 — helper for safe username display
  const displayUsername = (acc: any) => {
    const u = acc.username;
    if (!u || u === "—" || u.trim() === "") return null;
    return `@${u.replace("@", "")}`;
  };

  const accountStats = useMemo(() => {
    const stats: Record<string, any> = {};
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);

    for (const acc of accounts) {
      const accLinks = allLinks.filter((l: any) => l.account_id === acc.id);
      const accLinksFiltered = links.filter((l: any) => l.account_id === acc.id);

      // Revenue from filtered links (period-aware via snapshots)
      const totalRevenue = accLinksFiltered.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

      // LTV from tracking_link_ltv table (always all-time source)
      const accLtvRecords = trackingLinkLtv.filter((r: any) => r.account_id === acc.id);
      const totalLtvAllTime = accLtvRecords.reduce((s: number, r: any) => s + Number(r.total_ltv || 0), 0);
      const crossPollAllTime = accLtvRecords.reduce((s: number, r: any) => s + Number(r.cross_poll_revenue || 0), 0);
      const hasLtvData = accLtvRecords.length > 0;

      // FIX 1 — Tracked Subs from tracking_link_ltv.new_subs_total
      const trackedSubs = hasLtvData
        ? accLtvRecords.reduce((s: number, r: any) => s + Number(r.new_subs_total || 0), 0)
        : null;

      // Total spend (always all-time)
      const totalSpendAllTime = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);

      // Period-aware values
      let periodLtv: number | null = null;
      let periodSpend: number | null = null;
      let periodSubs: number | null = null;

      if (isAllTime) {
        periodLtv = totalLtvAllTime + crossPollAllTime;
        periodSpend = totalSpendAllTime;
        // Period subs = tracked subs for all time
        periodSubs = trackedSubs;
      } else {
        // Period LTV = sum of snapshot revenue
        const snapshotRev = accLinksFiltered.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
        const snapshotSubs = accLinksFiltered.reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
        const hasSnapData = snapshotRev > 0 || snapshotSubs > 0;
        periodLtv = hasSnapData ? snapshotRev : null;
        periodSubs = hasSnapData ? snapshotSubs : null;
        // Proportional spend
        if (hasSnapData) {
          const snapshotDays = (snapshotLookup ? Object.values(snapshotLookup).reduce((m, v) => Math.max(m, v.days), 0) : 0) || 1;
          periodSpend = accLinks.reduce((s: number, l: any) => {
            const cost = Number(l.cost_total || 0);
            if (cost <= 0) return s;
            const daysRunning = Math.max(1, l.created_at ? differenceInDays(now, new Date(l.created_at)) : 1);
            return s + (cost / daysRunning) * snapshotDays;
          }, 0);
        } else {
          periodSpend = null;
        }
      }

      const totalClicks = accLinksFiltered.reduce((s: number, l: any) => s + (l.clicks || 0), 0);
      const totalSubs = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);

      // FIX 9 — Active links = clicks > 0 in last 30 days AND deleted_at IS NULL
      const activeLinks = accLinks.filter((l: any) => {
        if (l.deleted_at) return false;
        // Check if link had clicks recently (use created_at as proxy, or clicks > 0)
        const created = l.created_at ? new Date(l.created_at) : null;
        const daysSinceCreated = created ? differenceInDays(now, created) : 999;
        return l.clicks > 0 && daysSinceCreated <= 30 || (snapshotLookup && snapshotLookup[String(l.id).toLowerCase()]?.clicks > 0);
      });

      // FIX 3 — Subs/Day = total subs across links / days since earliest link created_at
      const earliestCreated = accLinks.reduce((earliest: Date | null, l: any) => {
        if (!l.created_at) return earliest;
        const d = new Date(l.created_at);
        return !earliest || d < earliest ? d : earliest;
      }, null as Date | null);
      const daysSinceEarliest = earliestCreated ? Math.max(1, differenceInDays(now, earliestCreated)) : 0;
      const subsPerDay = daysSinceEarliest > 0 && totalSubs > 0 ? totalSubs / daysSinceEarliest : null;

      // FIX 2 — Untracked %
      const apiSubs = acc.subscribers_count || 0;
      const untrackedPct = apiSubs > 0 && trackedSubs !== null
        ? Math.max(0, ((apiSubs - trackedSubs) / apiSubs) * 100)
        : null;

      // LTV/Sub
      const ltvPerSub = isAllTime
        ? (trackedSubs && trackedSubs > 0 && totalLtvAllTime > 0 ? totalLtvAllTime / trackedSubs : null)
        : (periodSubs && periodSubs > 0 && periodLtv !== null && periodLtv > 0 ? periodLtv / periodSubs : null);

      // Profit/Sub
      const profit = periodLtv !== null && periodSpend !== null ? periodLtv - periodSpend : null;
      const profitPerSub = profit !== null && ((isAllTime ? trackedSubs : periodSubs) || 0) > 0
        ? profit / ((isAllTime ? trackedSubs : periodSubs) || 1)
        : null;

      // Model CVR
      const qualifiedLinks = accLinksFiltered.filter((l: any) => l.clicks > 100);
      const qSubs = qualifiedLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const qClicks = qualifiedLinks.reduce((s: number, l: any) => s + l.clicks, 0);
      const avgCvr = qClicks > 0 ? (qSubs / qClicks) * 100 : null;
      const cvrDiff = avgCvr !== null && agencyAvgCvr !== null ? avgCvr - agencyAvgCvr : null;

      const blendedRoi = periodSpend && periodSpend > 0 && periodLtv !== null ? ((periodLtv - periodSpend) / periodSpend) * 100 : null;

      // Last 30d LTV
      const thirtyAgo = format(subDays(now, 30), "yyyy-MM-dd");
      const accMetrics30d = dailyMetrics.filter((m: any) => m.account_id === acc.id && m.date >= thirtyAgo);
      const ltv30d = accLtvRecords.reduce((s: number, r: any) => s + Number(r.ltv_last_30d || 0), 0) || (accMetrics30d.length > 0 ? accMetrics30d.reduce((s: number, m: any) => s + Number(m.revenue || 0), 0) : null);

      stats[acc.id] = {
        totalRevenue,
        totalLtv: periodLtv,
        totalLtvAllTime,
        totalSpend: periodSpend,
        totalSpendAllTime,
        totalProfit: profit,
        totalCampaigns: accLinks.length,
        activeCampaigns: activeLinks.length,
        subsPerDay,
        ltv30d,
        totalClicks,
        totalSubs,
        trackedSubs,
        apiSubs,
        blendedRoi,
        avgCvr,
        cvrDiff,
        untrackedPct,
        profitPerSub,
        ltvPerSub,
        hasLtvData,
      };
    }
    return stats;
  }, [accounts, links, allLinks, dailyMetrics, agencyAvgCvr, trackingLinkLtv, snapshotLookup, isAllTime]);

  // FIX 8 — Account filter
  const afterAccountFilter = useMemo(() => {
    if (pageModelFilter === "all") return accounts;
    return accounts.filter((a: any) => a.id === pageModelFilter);
  }, [accounts, pageModelFilter]);

  const filteredAccounts = useMemo(() => {
    let list = afterAccountFilter;
    if (categoryFilter !== "all") {
      list = list.filter((a: any) => getGender(a) === categoryFilter);
    }
    return list;
  }, [afterAccountFilter, categoryFilter]);

  // FIX 4 — Sort model cards
  const sortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a: any, b: any) => {
      const sa = accountStats[a.id] || {};
      const sb = accountStats[b.id] || {};
      switch (cardSort) {
        case "spend":
          // Primary: spend DESC, secondary: ltvPerSub DESC
          if ((sb.totalSpendAllTime || 0) !== (sa.totalSpendAllTime || 0))
            return (sb.totalSpendAllTime || 0) - (sa.totalSpendAllTime || 0);
          return (sb.ltvPerSub || 0) - (sa.ltvPerSub || 0);
        case "ltv_per_sub":
          return ((Number(b.ltv_total || 0) / Math.max(Number(b.subscribers_count || 0), 1))) - ((Number(a.ltv_total || 0) / Math.max(Number(a.subscribers_count || 0), 1)));
        case "subscribers":
          return (sb.apiSubs || 0) - (sa.apiSubs || 0);
        case "active_links":
          return (sb.activeCampaigns || 0) - (sa.activeCampaigns || 0);
        case "alpha":
          return (a.display_name || "").localeCompare(b.display_name || "");
        default:
          return 0;
      }
    });
  }, [filteredAccounts, accountStats, cardSort]);

  // Account options for dropdown — FIX 8: no @unknown
  const accountOptions = useMemo(() => {
    const accountIdsWithLinks = new Set(allLinks.map((l: any) => l.account_id));
    return accounts
      .filter((a: any) => accountIdsWithLinks.has(a.id) && a.username && a.username.trim() !== "" && a.username !== "—")
      .map((a: any) => ({ id: a.id, username: a.username || "", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))
      .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));
  }, [accounts, allLinks]);

  const AvatarCircle = ({ account, size = 80 }: { account: any; size?: number }) => {
    const colorIdx = accounts.indexOf(account) % AVATAR_COLORS.length;
    const thumbUrl = account.avatar_thumb_url;
    const initial = (account.display_name || "?").charAt(0).toUpperCase();
    return (
      <div style={{ width: size, height: size }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt={account.display_name} className="rounded-full object-cover border-[3px] border-white shadow-md" style={{ width: size, height: size }} />
        ) : (
          <div className={`rounded-full bg-gradient-to-br ${AVATAR_COLORS[colorIdx]} flex items-center justify-center text-white font-bold border-[3px] border-white shadow-md`} style={{ width: size, height: size, fontSize: size * 0.35 }}>
            {initial}
          </div>
        )}
      </div>
    );
  };

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

  const selectedAccLinks = useMemo(() => {
    if (!selectedAccount) return [];
    return links.filter((l: any) => l.account_id === selectedAccount.id);
  }, [selectedAccount, links]);

  const sourceGroups = useMemo(() => {
    const groups: Record<string, { source: string; links: number; spend: number; ltv: number; profit: number; roi: number | null }> = {};
    for (const l of selectedAccLinks) {
      const src = getEffectiveSource(l) || "Untagged";
      if (!groups[src]) groups[src] = { source: src, links: 0, spend: 0, ltv: 0, profit: 0, roi: null };
      groups[src].links++;
      groups[src].spend += Number(l.cost_total || 0);
      const ltvRecord = ltvLookup[String(l.id).toLowerCase()];
      const ltvVal = ltvRecord ? Number(ltvRecord.total_ltv || 0) : 0;
      groups[src].ltv += ltvVal;
    }
    for (const g of Object.values(groups)) {
      g.profit = g.ltv - g.spend;
      g.roi = g.spend > 0 ? (g.profit / g.spend) * 100 : null;
    }
    return Object.values(groups).sort((a, b) => b.profit - a.profit);
  }, [selectedAccLinks, ltvLookup]);

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
    const category = getGender(acc);

    const sortedLinks = [...accLinks].sort((a: any, b: any) => {
      const av = sortKey === "campaign_name" ? (a.campaign_name || "") : Number(a[sortKey] || 0);
      const bv = sortKey === "campaign_name" ? (b.campaign_name || "") : Number(b[sortKey] || 0);
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return (
      <DashboardLayout>
        <div className="space-y-5">
          <button onClick={() => { setSelectedAccount(null); setActiveTab("campaigns"); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> All Models
          </button>

          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-col md:flex-row">
              <div className="md:w-[30%] p-6 border-b md:border-b-0 md:border-r border-border flex flex-col items-center text-center">
                <AvatarCircle account={acc} size={120} />
                <p className="text-[10px] text-muted-foreground mt-1.5">Synced from OnlyFans</p>
                <h2 className="text-xl font-bold text-foreground mt-4">{acc.display_name}</h2>
                {displayUsername(acc) && (
                  <p className="text-sm text-primary font-medium">{displayUsername(acc)}</p>
                )}
                <span className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${getGenderBadgeStyle(category)}`}>
                  {category}
                </span>
                {acc.performer_top != null && (
                  <span className="mt-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                    Top {acc.performer_top}%
                  </span>
                )}

                <div className="w-full border-t border-border mt-5 pt-4 space-y-3 text-left text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Gender</span><span className="text-foreground font-medium">{category}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className={`font-medium ${acc.is_active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{acc.is_active ? "Active" : "Inactive"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Date added</span><span className="text-foreground">{format(new Date(acc.created_at), "MMM d, yyyy")}</span></div>
                  {acc.subscribe_price != null && acc.subscribe_price > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Sub price</span><span className="text-foreground">${Number(acc.subscribe_price).toFixed(2)}</span></div>
                  )}
                </div>
              </div>

              <div className="md:w-[70%] p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Total Revenue", value: fmtCurrency(Number(acc.ltv_total || 0) * revMultiplier) },
                    { label: "Campaign Rev", value: fmtCurrency(stats.totalRevenue * revMultiplier || 0) },
                    
                    { label: "Total Spend", value: fmtCurrency(stats.totalSpendAllTime || 0) },
                    { label: "Total Profit", value: (() => { const p = Number(acc.ltv_total || 0) * revMultiplier - (stats.totalSpendAllTime || 0); return fmtCurrency(p); })(), positive: (Number(acc.ltv_total || 0) * revMultiplier - (stats.totalSpendAllTime || 0)) >= 0 },
                  ].map((s) => (
                    <div key={s.label} className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                      <p className={`text-lg font-bold font-mono ${(s as any).accent ? "text-primary" : s.positive === false ? "text-destructive" : "text-foreground"}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  {[
                    { label: "Total Tracking Links", value: String(stats.totalCampaigns || 0) },
                    { label: "Active Tracking Links", value: String(stats.activeCampaigns || 0) },
                    { label: "Subs/Day", value: stats.subsPerDay != null ? `${stats.subsPerDay.toFixed(1)}/day` : "—" },
                    { label: "ROI %", value: stats.blendedRoi != null ? fmtPct(stats.blendedRoi) : "—" },
                    { label: "Untracked %", value: stats.untrackedPct != null ? fmtPct(stats.untrackedPct) : "—",
                      colored: true, pctVal: stats.untrackedPct },
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
                            const ltvRecord = ltvLookup[String(l.id).toLowerCase()] || null;
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

        {/* ═══ TIME + MODEL FILTER BAR ═══ */}
        <PageFilterBar
          timePeriod={timePeriod}
          onTimePeriodChange={setTimePeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          modelFilter={pageModelFilter}
          onModelFilterChange={setPageModelFilter}
          accounts={accountOptions}
          revenueMode={revenueMode}
          onRevenueModeChange={setRevenueMode}
        />

        {/* Filter pills + sort dropdown */}
        <div className="flex items-center justify-between flex-wrap gap-2">
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
              const count = accounts.filter((a: any) => getGender(a) === cat).length;
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

          {/* FIX 4 — Sort dropdown */}
          <select
            value={cardSort}
            onChange={(e) => setCardSort(e.target.value as CardSortKey)}
            className="h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
          >
            {CARD_SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Model cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedAccounts.map((acc: any) => {
            const stats = accountStats[acc.id] || {};
            const category = getGender(acc);
            const isEditing = editingGenderFor === acc.id;
            return (
              <div
                key={acc.id}
                className="bg-card border border-border rounded-2xl p-5 transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
                onClick={() => { setSelectedAccount(acc); setActiveTab("campaigns"); setSortKey("created_at"); setSortAsc(false); }}
              >
                <div className="flex items-start gap-4 mb-4">
                  <AvatarCircle account={acc} size={72} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">{acc.display_name}</h3>
                    {/* FIX 6 — No @— */}
                    {displayUsername(acc) && (
                      <p className="text-[13px] text-muted-foreground">{displayUsername(acc)}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 relative">
                      {isEditing ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getGenderBadgeStyle(category)}`}>
                            {category}
                          </span>
                          <button onClick={() => setEditingGenderFor(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                          <div className="flex flex-col bg-card border border-border rounded-lg shadow-lg overflow-hidden absolute top-6 left-0 z-10 min-w-[120px]">
                            {GENDER_OPTIONS.map((g) => (
                              <button
                                key={g}
                                onClick={() => handleSaveGender(acc.id, g === "Uncategorized" ? null : g)}
                                className={`px-4 py-1.5 text-[11px] text-left hover:bg-secondary transition-colors ${category === g ? "font-bold text-primary" : "text-foreground"}`}
                              >
                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${g === "Female" ? "bg-pink-400" : g === "Trans" ? "bg-purple-400" : g === "Male" ? "bg-blue-400" : "bg-muted-foreground"}`} />
                                {g}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getGenderBadgeStyle(category)}`}>
                            {category}
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); setEditingGenderFor(acc.id); }} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
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

                {/* KPI grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] mb-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Revenue</span>
                    <span className="font-mono font-semibold text-foreground">{fmtCurrency((Number(acc.ltv_total || 0)) * revMultiplier)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">LTV/Sub <RevenueModeBadge mode={revenueMode} /></span>
                    <span className="font-mono font-semibold text-primary">
                      {(() => {
                        const ltvTotal = Number(acc.ltv_total || 0) * revMultiplier;
                        const subsCount = Number(acc.subscribers_count || 0);
                        const val = subsCount > 0 ? ltvTotal / subsCount : null;
                        return val != null ? fmtCurrency(val) : "—";
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Campaign Rev</span>
                    <span className="font-mono font-semibold text-foreground">
                      {(() => {
                        const accLinksAll = allLinks.filter((l: any) => l.account_id === acc.id);
                        return fmtCurrency(accLinksAll.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0) * revMultiplier);
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Spend</span>
                    <span className="font-mono font-semibold text-foreground">{fmtCurrency(stats.totalSpendAllTime || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unattributed</span>
                    <span className={`font-mono font-semibold ${
                      (() => {
                        const ltvT = Number(acc.ltv_total || 0);
                        const accLinksAll = allLinks.filter((l: any) => l.account_id === acc.id);
                        const campRev = accLinksAll.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
                        const pct = ltvT > 0 ? ((ltvT - campRev) / ltvT) * 100 : null;
                        return pct == null ? "text-muted-foreground"
                          : pct > 50 ? "text-destructive"
                          : pct >= 30 ? "text-[hsl(38_92%_50%)]"
                          : "text-primary";
                      })()
                    }`}>
                      {(() => {
                        const ltvT = Number(acc.ltv_total || 0);
                        const accLinksAll = allLinks.filter((l: any) => l.account_id === acc.id);
                        const campRev = accLinksAll.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
                        const pct = ltvT > 0 ? ((ltvT - campRev) / ltvT) * 100 : null;
                        return pct != null ? fmtPct(pct) : "—";
                      })()}
                    </span>
                  </div>
                </div>

                {/* Revenue breakdown expandable */}
                {Number(acc.ltv_total || 0) > 0 && (() => {
                  const ltvT = Number(acc.ltv_total || 0);
                  const isExp = expandedBreakdown.has(acc.id);
                  const rows = [
                    { label: "Messages / PPV", value: Number(acc.ltv_messages || 0), color: "hsl(var(--primary))" },
                    { label: "Tips", value: Number(acc.ltv_tips || 0), color: "hsl(38 92% 50%)" },
                    { label: "Subscriptions", value: Number(acc.ltv_subscriptions || 0), color: "hsl(280 60% 55%)" },
                    { label: "Posts", value: Number(acc.ltv_posts || 0), color: "hsl(210 80% 55%)" },
                  ].filter(r => r.value > 0);
                  return (
                    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setExpandedBreakdown(prev => {
                            const next = new Set(prev);
                            if (next.has(acc.id)) next.delete(acc.id); else next.add(acc.id);
                            return next;
                          });
                        }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isExp ? "rotate-180" : ""}`} />
                        {isExp ? "Hide breakdown" : "Revenue breakdown"}
                      </button>
                      {isExp && (
                        <div className="mt-1.5 space-y-1 text-[12px]">
                          {rows.map(r => (
                            <div key={r.label} className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                                <span className="text-muted-foreground">{r.label}</span>
                              </div>
                              <span className="font-mono text-foreground/80">
                                {fmtCurrency(r.value * revMultiplier)} · {ltvT > 0 ? ((r.value / ltvT) * 100).toFixed(1) : "0"}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t border-border">
                  <span>{stats.activeCampaigns || 0} active links</span>
                  <span className="text-border">·</span>
                  <span>{stats.totalCampaigns || 0} total</span>
                  <span className="text-border">·</span>
                  <span>{stats.subsPerDay != null ? `${stats.subsPerDay.toFixed(1)}/day` : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}

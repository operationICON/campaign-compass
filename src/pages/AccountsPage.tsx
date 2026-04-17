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
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { SubsTab } from "@/components/accounts/SubsTab";

import { format, differenceInDays, subDays, isValid } from "date-fns";

function safeFormat(dateStr: string | null | undefined, fmt: string, fallback = "—"): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  return isValid(d) ? format(d, fmt) : fallback;
}
import { ArrowLeft, ChevronUp, ChevronDown, Pencil, X, UserPlus, Loader2, Info } from "lucide-react";
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

type PerfRange = "7d" | "30d" | "90d" | "all";

export default function AccountsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { timePeriod, setTimePeriod, modelFilter: pageModelFilter, setModelFilter: setPageModelFilter, customRange, setCustomRange, dateFilter, revenueMode, setRevenueMode, revMultiplier } = usePageFilters();
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"campaigns" | "sources" | "performance" | "subs">("campaigns");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [editingGenderFor, setEditingGenderFor] = useState<string | null>(null);
  const [cardSort, setCardSort] = useState<CardSortKey>("ltv_per_sub");
  const [expandedBreakdown, setExpandedBreakdown] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);
  const [perfRange, setPerfRange] = useState<PerfRange>("30d");

  const handleDiscoverAccounts = async () => {
    setDiscovering(true);
    try {
      const { data, error } = await supabase.functions.invoke("discover-accounts", { method: "POST" });
      if (error) throw error;
      const created = data?.created ?? 0;
      const total = data?.total_api_accounts ?? 0;
      if (created > 0) {
        const newNames = (data.accounts ?? []).filter((a: any) => a.status === "created").map((a: any) => a.name).join(", ");
        toast.success(`Found ${created} new account${created > 1 ? "s" : ""}: ${newNames}`);
        queryClient.invalidateQueries({ queryKey: ["accounts"] });
      } else {
        toast.info(`All ${total} accounts already synced — no new accounts found`);
      }
    } catch (err: any) {
      toast.error(`Discovery failed: ${err.message}`);
    } finally {
      setDiscovering(false);
    }
  };

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

  // Fetch daily_snapshots for performance charts
  const { data: dailySnapshots = [] } = useQuery({
    queryKey: ["daily_snapshots_perf", selectedAccount?.id, perfRange],
    queryFn: async () => {
      if (!selectedAccount) return [];
      let fromDate: string | null = null;
      const now = new Date();
      if (perfRange === "7d") fromDate = subDays(now, 7).toISOString().slice(0, 10);
      else if (perfRange === "30d") fromDate = subDays(now, 30).toISOString().slice(0, 10);
      else if (perfRange === "90d") fromDate = subDays(now, 90).toISOString().slice(0, 10);

      let query = supabase
        .from("daily_snapshots")
        .select("tracking_link_id, snapshot_date, clicks, subscribers, revenue")
        .eq("account_id", selectedAccount.id)
        .order("snapshot_date", { ascending: true });
      if (fromDate) query = query.gte("snapshot_date", fromDate);

      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await query.range(rangeFrom, rangeFrom + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        rangeFrom += batchSize;
        // Re-create query for next batch
        query = supabase
          .from("daily_snapshots")
          .select("tracking_link_id, snapshot_date, clicks, subscribers, revenue")
          .eq("account_id", selectedAccount.id)
          .order("snapshot_date", { ascending: true });
        if (fromDate) query = query.gte("snapshot_date", fromDate);
      }
      return allRows;
    },
    enabled: !!selectedAccount,
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

  const displayUsername = (acc: any) => {
    const u = acc.username;
    if (!u || u === "—" || u.trim() === "") return null;
    return `@${u.replace("@", "")}`;
  };

  // Unattributed % calculation used on OVERVIEW cards — reuse everywhere
  const calcUnattributedPct = (acc: any) => {
    const ltvT = Number(acc.ltv_total || 0);
    const accLinksAll = allLinks.filter((l: any) => l.account_id === acc.id);
    const campRev = accLinksAll.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    if (ltvT <= 0) return { pct: null, totalRev: ltvT, campRev, unattributed: 0 };
    const unattributed = Math.max(0, ltvT - campRev);
    const pct = (unattributed / ltvT) * 100;
    return { pct, totalRev: ltvT, campRev, unattributed };
  };

  const accountStats = useMemo(() => {
    const stats: Record<string, any> = {};
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);

    for (const acc of accounts) {
      const accLinks = allLinks.filter((l: any) => l.account_id === acc.id);
      const accLinksFiltered = links.filter((l: any) => l.account_id === acc.id);

      const campaignRevAllTime = accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
      const campaignRevFiltered = accLinksFiltered.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

      const accLtvRecords = trackingLinkLtv.filter((r: any) => r.account_id === acc.id);
      const totalLtvAllTime = accLtvRecords.reduce((s: number, r: any) => s + Number(r.total_ltv || 0), 0);
      const hasLtvData = accLtvRecords.length > 0;

      const trackedSubsLtv = hasLtvData
        ? accLtvRecords.reduce((s: number, r: any) => s + Number(r.new_subs_total || 0), 0)
        : null;

      const totalSpendAllTime = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
      const totalSubs = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const totalClicks = accLinks.reduce((s: number, l: any) => s + (l.clicks || 0), 0);

      const activeLinks = accLinks.filter((l: any) => {
        if (l.deleted_at) return false;
        if (l.clicks <= 0) return false;
        const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
        if (calcDate && calcDate >= thirtyDaysAgo) return true;
        if (snapshotLookup && snapshotLookup[String(l.id).toLowerCase()]?.clicks > 0) return true;
        const created = l.created_at ? new Date(l.created_at) : null;
        return created ? created >= thirtyDaysAgo : false;
      });

      const earliestCreated = accLinks.reduce((earliest: Date | null, l: any) => {
        if (!l.created_at) return earliest;
        const d = new Date(l.created_at);
        return !earliest || d < earliest ? d : earliest;
      }, null as Date | null);
      const daysSinceEarliest = earliestCreated ? Math.max(1, differenceInDays(now, earliestCreated)) : 0;
      const subsPerDay = daysSinceEarliest > 0 && totalSubs > 0 ? totalSubs / daysSinceEarliest : null;

      const apiSubs = acc.subscribers_count || 0;
      const ua = calcUnattributedPct(acc);
      const unattributedPct = ua.pct;

      const blendedRoi = totalSpendAllTime > 0
        ? ((campaignRevAllTime - totalSpendAllTime) / totalSpendAllTime) * 100
        : null;

      const qualifiedLinks = accLinksFiltered.filter((l: any) => l.clicks > 100);
      const qSubs = qualifiedLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const qClicks = qualifiedLinks.reduce((s: number, l: any) => s + l.clicks, 0);
      const avgCvr = qClicks > 0 ? (qSubs / qClicks) * 100 : null;
      const cvrDiff = avgCvr !== null && agencyAvgCvr !== null ? avgCvr - agencyAvgCvr : null;

      // CVR for KPI (all links, not just qualified)
      const allCvr = totalClicks > 0 ? (totalSubs / totalClicks) * 100 : null;

      const ltvPerSub = totalSubs > 0 && campaignRevAllTime > 0
        ? campaignRevAllTime / totalSubs
        : null;

      stats[acc.id] = {
        totalRevenue: isAllTime ? campaignRevAllTime : campaignRevFiltered,
        campaignRevAllTime,
        totalLtvAllTime,
        totalSpendAllTime,
        totalProfit: campaignRevAllTime - totalSpendAllTime,
        totalCampaigns: accLinks.length,
        activeCampaigns: activeLinks.length,
        subsPerDay,
        totalClicks,
        totalSubs,
        trackedSubs: trackedSubsLtv,
        apiSubs,
        blendedRoi,
        avgCvr,
        allCvr,
        cvrDiff,
        unattributedPct,
        unattributedBreakdown: ua,
        ltvPerSub,
        hasLtvData,
      };
    }
    return stats;
  }, [accounts, links, allLinks, dailyMetrics, agencyAvgCvr, trackingLinkLtv, snapshotLookup, isAllTime]);

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

  const sortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a: any, b: any) => {
      const sa = accountStats[a.id] || {};
      const sb = accountStats[b.id] || {};
      switch (cardSort) {
        case "spend":
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

  // PART 4 — Source groups with 10 columns
  const sourceGroups = useMemo(() => {
    const groups: Record<string, { source: string; links: any[]; activeLinks: number; subs: number; clicks: number; spend: number; revenue: number; profit: number; roi: number | null; costTypes: Record<string, number> }> = {};
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);
    for (const l of selectedAccLinks) {
      const src = getEffectiveSource(l) || "Untagged";
      if (!groups[src]) groups[src] = { source: src, links: [], activeLinks: 0, subs: 0, clicks: 0, spend: 0, revenue: 0, profit: 0, roi: null, costTypes: {} };
      groups[src].links.push(l);
      groups[src].subs += (l.subscribers || 0);
      groups[src].clicks += (l.clicks || 0);
      groups[src].spend += Number(l.cost_total || 0);
      groups[src].revenue += Number(l.revenue || 0);
      // Count cost types
      const ct = l.cost_type || l.payment_type;
      if (ct) groups[src].costTypes[ct] = (groups[src].costTypes[ct] || 0) + 1;
      // Active check
      const isActive = !l.deleted_at && l.clicks > 0 && (() => {
        const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
        if (calcDate && calcDate >= thirtyDaysAgo) return true;
        const created = l.created_at ? new Date(l.created_at) : null;
        return created ? created >= thirtyDaysAgo : false;
      })();
      if (isActive) groups[src].activeLinks++;
    }
    for (const g of Object.values(groups)) {
      g.profit = g.revenue - g.spend;
      g.roi = g.spend > 0 ? (g.profit / g.spend) * 100 : null;
    }
    // Sort by profit desc, Untagged at bottom
    return Object.values(groups).sort((a, b) => {
      if (a.source === "Untagged" && b.source !== "Untagged") return 1;
      if (b.source === "Untagged" && a.source !== "Untagged") return -1;
      return b.profit - a.profit;
    });
  }, [selectedAccLinks]);

  // Subs/Day per source from daily_snapshots
  const sourceSubsPerDay = useMemo(() => {
    if (!selectedAccount || dailySnapshots.length === 0) return {};
    // Map link IDs to their source
    const linkSourceMap: Record<string, string> = {};
    for (const l of selectedAccLinks) {
      linkSourceMap[String(l.id).toLowerCase()] = getEffectiveSource(l) || "Untagged";
    }
    // Sum subs per source per day
    const sourceByDate: Record<string, Record<string, number>> = {};
    for (const row of dailySnapshots) {
      const lid = String(row.tracking_link_id ?? "").toLowerCase();
      const src = linkSourceMap[lid];
      if (!src) continue;
      if (!sourceByDate[src]) sourceByDate[src] = {};
      const dt = row.snapshot_date || "";
      sourceByDate[src][dt] = (sourceByDate[src][dt] || 0) + Number(row.subscribers || 0);
    }
    const result: Record<string, number> = {};
    for (const [src, dates] of Object.entries(sourceByDate)) {
      const days = Object.keys(dates).length;
      const totalSubs = Object.values(dates).reduce((s, v) => s + v, 0);
      result[src] = days > 0 ? totalSubs / days : 0;
    }
    return result;
  }, [selectedAccount, dailySnapshots, selectedAccLinks]);

  // PART 5 — Performance data from daily_snapshots (daily deltas)
  const perfData = useMemo(() => {
    if (!selectedAccount || dailySnapshots.length === 0) return [];
    const byDate: Record<string, { date: string; revenue: number; subs: number }> = {};
    for (const row of dailySnapshots) {
      const dt = row.snapshot_date || "";
      if (!dt) continue;
      if (!byDate[dt]) byDate[dt] = { date: dt, revenue: 0, subs: 0 };
      byDate[dt].revenue += Number(row.revenue || 0);
      byDate[dt].subs += Number(row.subscribers || 0);
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedAccount, dailySnapshots]);

  // CPL/CPC label for a source
  const getCplCpcLabel = (costTypes: Record<string, number>) => {
    const entries = Object.entries(costTypes);
    if (entries.length === 0) return "—";
    const total = entries.reduce((s, [, c]) => s + c, 0);
    const cplCount = (costTypes["CPL"] || 0);
    const cpcCount = (costTypes["CPC"] || 0);
    if (cplCount > 0 && cpcCount === 0) return "CPL";
    if (cpcCount > 0 && cplCount === 0) return "CPC";
    if (cplCount > 0 && cpcCount > 0) return "Mixed";
    // Fixed or other
    const fixedCount = (costTypes["Fixed"] || 0) + (costTypes["fixed"] || 0);
    if (fixedCount > 0) return "Fixed";
    return "—";
  };

  // ============ VIEW 2 — Individual Model Profile ============
  if (selectedAccount) {
    const acc = selectedAccount;
    const stats = accountStats[acc.id] || {};
    const accLinks = selectedAccLinks;
    const category = getGender(acc);
    const ua = calcUnattributedPct(acc);

    const sortedLinks = [...accLinks].sort((a: any, b: any) => {
      const av = sortKey === "campaign_name" ? (a.campaign_name || "") : Number(a[sortKey] || 0);
      const bv = sortKey === "campaign_name" ? (b.campaign_name || "") : Number(b[sortKey] || 0);
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    // KPI card component
    const KpiCard = ({ label, value, colored, positive }: { label: string; value: string; colored?: boolean; positive?: boolean }) => (
      <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-lg font-bold font-mono ${
          colored ? (positive ? "text-primary" : "text-destructive") : "text-foreground"
        }`}>{value}</p>
      </div>
    );

    const totalRevenue = Number(acc.ltv_total || 0) * revMultiplier;
    const campaignRev = (stats.campaignRevAllTime || 0) * revMultiplier;
    const totalSpend = stats.totalSpendAllTime || 0;
    const totalProfit = totalRevenue - totalSpend;
    const roi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : null;
    const cpl = totalSpend > 0 && stats.totalSubs > 0 ? totalSpend / stats.totalSubs : null;
    const cpc = totalSpend > 0 && stats.totalClicks > 0 ? totalSpend / stats.totalClicks : null;

    return (
      <DashboardLayout>
        <div className="space-y-5">
          <button onClick={() => { setSelectedAccount(null); setActiveTab("campaigns"); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> All Models
          </button>

          {/* Row 1: Profile sidebar + KPI grid */}
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
                  <div className="flex justify-between"><span className="text-muted-foreground">Date added</span><span className="text-foreground">{safeFormat(acc.created_at, "MMM d, yyyy")}</span></div>
                  {acc.subscribe_price != null && acc.subscribe_price > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Sub price</span><span className="text-foreground">${Number(acc.subscribe_price).toFixed(2)}</span></div>
                  )}
                </div>
              </div>

              <div className="md:w-[70%] p-6">
                {/* PART 2 — 5×5 KPI Grid (13 cards, rows 4-5 empty) */}
                <div className="grid grid-cols-5 gap-3 mb-4">
                  {/* Row 1: Primary financials */}
                  <KpiCard label="Total Revenue" value={fmtCurrency(totalRevenue)} />
                  <KpiCard label="Campaign Rev" value={fmtCurrency(campaignRev)} />
                  <KpiCard label="Total Spend" value={fmtCurrency(totalSpend)} />
                  <KpiCard label="Total Profit" value={fmtCurrency(totalProfit)} colored positive={totalProfit >= 0} />
                  <KpiCard label="ROI %" value={roi != null ? fmtPct(roi) : "—"} colored positive={roi != null && roi >= 0} />

                  {/* Row 2: Scale/subs */}
                  <KpiCard label="Subscribers" value={fmtNum(stats.apiSubs || stats.totalSubs || 0)} />
                  <KpiCard label="Subs/Day" value={stats.subsPerDay != null ? `${stats.subsPerDay.toFixed(1)}/day` : "—"} />
                  <KpiCard label="CVR" value={stats.allCvr != null ? fmtPct(stats.allCvr) : "—"} />
                  <KpiCard label="CPL" value={cpl != null ? fmtCurrency(cpl) : "—"} />
                  <KpiCard label="CPC" value={cpc != null ? `$${cpc.toFixed(4)}` : "—"} />

                  {/* Row 3: Traffic health */}
                  <KpiCard label="Total Tracking Links" value={String(stats.totalCampaigns || 0)} />
                  <KpiCard label="Active Tracking Links" value={String(stats.activeCampaigns || 0)} />
                  {/* Unattributed % — clicks scroll to breakdown section below */}
                  <div
                    className="bg-secondary/50 dark:bg-secondary rounded-xl p-4 cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all"
                    onClick={() => document.getElementById("revenue-breakdown-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                      Unattributed % <Info className="h-3 w-3" />
                    </p>
                    <p className={`text-lg font-bold font-mono ${
                      ua.pct == null ? "text-foreground"
                        : ua.pct > 50 ? "text-destructive"
                        : ua.pct >= 30 ? "text-[hsl(38_92%_50%)]"
                        : "text-primary"
                    }`}>{ua.pct != null ? fmtPct(ua.pct) : "—"}</p>
                  </div>
                  {/* 2 empty slots in row 3 */}
                  <div />
                  <div />
                </div>

                {/* PART 6 — Revenue Breakdown (compact, borderless, inside KPI area) */}
                {Number(acc.ltv_total || 0) > 0 && (() => {
                  const ltvT = Number(acc.ltv_total || 0);
                  const accLinksAll = allLinks.filter((l: any) => l.account_id === acc.id);
                  const campRevRaw = accLinksAll.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
                  const unattributed = Math.max(0, ltvT - campRevRaw);

                  const accMsg = Number(acc.ltv_messages || 0);
                  const accTips = Number(acc.ltv_tips || 0);
                  const accSubsLtv = Number(acc.ltv_subscriptions || 0);
                  const accPosts = Number(acc.ltv_posts || 0);
                  const hasAccBreakdown = accMsg > 0 || accTips > 0 || accSubsLtv > 0 || accPosts > 0;
                  const txB = (txBreakdowns as Record<string, any>)[acc.id];
                  const typeRows = hasAccBreakdown
                    ? [
                        { label: "Messages / PPV", value: accMsg, color: "hsl(var(--primary))" },
                        { label: "Tips", value: accTips, color: "hsl(38 92% 50%)" },
                        { label: "Subscriptions", value: accSubsLtv, color: "hsl(280 60% 55%)" },
                        { label: "Posts", value: accPosts, color: "hsl(210 80% 55%)" },
                      ].filter(r => r.value > 0)
                    : txB
                      ? [
                          { label: "Messages / PPV", value: txB.messages, color: "hsl(var(--primary))" },
                          { label: "Tips", value: txB.tips, color: "hsl(38 92% 50%)" },
                          { label: "Subscriptions", value: txB.subscriptions, color: "hsl(280 60% 55%)" },
                          { label: "Posts", value: txB.posts, color: "hsl(210 80% 55%)" },
                        ].filter(r => r.value > 0)
                      : [];

                  return (
                    <div id="revenue-breakdown-detail" className="mt-3 pt-3 border-t border-border/50">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Revenue Breakdown</p>
                      <div className="space-y-2 text-[12px]">
                        <div className="space-y-1.5 pb-2 border-b border-border/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0 bg-primary" />
                              <span className="text-muted-foreground">Via Campaigns</span>
                            </div>
                            <span className="font-mono text-foreground/80">
                              {fmtCurrency(campRevRaw * revMultiplier)} · {ltvT > 0 ? ((campRevRaw / ltvT) * 100).toFixed(1) : "0"}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/50" />
                              <span className="text-muted-foreground">Unattributed</span>
                            </div>
                            <span className="font-mono text-foreground/80">
                              {fmtCurrency(unattributed * revMultiplier)} · {ltvT > 0 ? ((unattributed / ltvT) * 100).toFixed(1) : "0"}%
                            </span>
                          </div>
                        </div>
                        {typeRows.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">By Type</span>
                            {typeRows.map(r => (
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
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

                {/* Tabs */}
                <div className="border-b border-border mb-4">
                  <div className="flex gap-6">
                    {(["campaigns", "sources", "performance", "subs"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
                          activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "campaigns"
                          ? "Tracking Links"
                          : tab === "sources"
                            ? "Traffic Sources"
                            : tab === "performance"
                              ? "Performance"
                              : "Subs"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PART 3 — Tracking Links tab with clickable rows */}
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
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("revenue")}>Revenue <SortIcon col="revenue" /></th>
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
                            const crossPoll = ltvRecord ? Number(ltvRecord.cross_poll_revenue || 0) : null;
                            const revVal = Number(l.revenue || 0);
                            const profit = revVal - Number(l.cost_total || 0);
                            const daysActive = l.created_at ? differenceInDays(new Date(), new Date(l.created_at)) : null;
                            const subsPerDay = daysActive && daysActive > 0 && l.subscribers > 0 ? (l.subscribers / daysActive).toFixed(0) : null;
                            return (
                              <tr
                                key={l.id}
                                className="border-b border-border/50 hover:bg-muted/30 hover:border-l-2 hover:border-l-primary transition-colors cursor-pointer"
                                onClick={() => setDrawerCampaign({ ...l, avatarUrl: acc.avatar_thumb_url, modelName: acc.display_name })}
                              >
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
                                  <span className="font-semibold text-foreground">
                                    {fmtCurrency(revVal)}
                                  </span>
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
                                  {safeFormat(l.created_at, "MMM d, yyyy")}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* PART 4 — Traffic Sources tab with 10 columns */}
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
                            <th className="text-right py-2 px-3">Subs</th>
                            <th className="text-right py-2 px-3">Subs/Day</th>
                            <th className="text-right py-2 px-3">Total Spend</th>
                            <th className="text-right py-2 px-3">Revenue</th>
                            <th className="text-right py-2 px-3">CPL/CPC</th>
                            <th className="text-right py-2 px-3">CVR</th>
                            <th className="text-right py-2 px-3">Profit</th>
                            <th className="text-right py-2 px-3">ROI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sourceGroups.map((g) => {
                            const cvr = g.clicks > 0 ? (g.subs / g.clicks) * 100 : null;
                            const cplCpcType = getCplCpcLabel(g.costTypes);
                            let cplCpcValue = "—";
                            if (cplCpcType === "CPL" && g.subs > 0 && g.spend > 0) {
                              cplCpcValue = `$${(g.spend / g.subs).toFixed(2)} CPL`;
                            } else if (cplCpcType === "CPC" && g.clicks > 0 && g.spend > 0) {
                              cplCpcValue = `$${(g.spend / g.clicks).toFixed(2)} CPC`;
                            } else if (cplCpcType === "Mixed") {
                              cplCpcValue = "Mixed";
                            } else if (cplCpcType === "Fixed" && g.spend > 0) {
                              cplCpcValue = `$${g.spend.toFixed(2)} Fixed`;
                            }
                            const spd = sourceSubsPerDay[g.source];
                            return (
                              <tr key={g.source} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                <td className="py-3 px-3 font-medium text-[12px]"><TagBadge tagName={g.source} /></td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{g.activeLinks}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(g.subs)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">{spd != null && spd > 0 ? `${spd.toFixed(1)}/day` : "—"}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtCurrency(g.spend)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] font-semibold text-primary">{fmtCurrency(g.revenue)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">{cplCpcValue}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{cvr != null ? fmtPct(cvr) : "—"}</td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${g.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{fmtCurrency(g.profit)}</td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${g.roi != null ? (g.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>{g.roi != null ? fmtPct(g.roi) : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* PART 5 — Performance tab with fixed charts */}
                {activeTab === "performance" && (
                  <div className="space-y-6">
                    {/* Date range selector */}
                    <div className="flex gap-2">
                      {([
                        { key: "7d", label: "Last 7 Days" },
                        { key: "30d", label: "Last 30 Days" },
                        { key: "90d", label: "Last 90 Days" },
                        { key: "all", label: "All Time" },
                      ] as { key: PerfRange; label: string }[]).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setPerfRange(key)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            perfRange === key
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {perfData.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">Performance data builds after multiple syncs</p>
                    ) : (
                      <>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-3">Revenue Over Time</p>
                          <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={perfData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(d) => safeFormat(d, "MMM d")} />
                                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `$${v}`} />
                                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} labelFormatter={(l) => safeFormat(String(l), "MMM d, yyyy")} />
                                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
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
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(d) => safeFormat(d, "MMM d")} />
                                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                                <Tooltip formatter={(v: number) => [v, "Subs"]} labelFormatter={(l) => safeFormat(String(l), "MMM d, yyyy")} />
                                <Bar dataKey="subs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === "subs" && (
                  <SubsTab
                    accountId={acc.id}
                    accLinks={accLinks}
                    modelName={acc.display_name}
                    avatarUrl={acc.avatar_thumb_url}
                    onRowClick={(link) => setDrawerCampaign(link)}
                  />
                )}
        </div>

        {/* Campaign drawer for clickable rows */}
        <CampaignDetailDrawer campaign={drawerCampaign} onClose={() => setDrawerCampaign(null)} onCampaignUpdated={setDrawerCampaign} />
      </DashboardLayout>
    );
  }

  // ============ VIEW 1 — All Models Overview ============
  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground">Models</h1>
            <p className="text-sm text-muted-foreground">All accounts connected to Campaign Tracker</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscoverAccounts}
              disabled={discovering}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
            >
              {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              {discovering ? "Discovering…" : "Discover New Accounts"}
            </button>
            <RefreshButton queryKeys={["accounts", "tracking_links", "daily_metrics"]} />
          </div>
        </div>

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

        {/* Model cards grid — PART 1: added total subs */}
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
                        const accLinks = allLinks.filter((l: any) => l.account_id === acc.id);
                        const totalRev = accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
                        const totalSubs = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
                        return totalSubs > 0 && totalRev > 0 ? fmtCurrency((totalRev / totalSubs) * revMultiplier) : "—";
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Campaign Rev</span>
                    <span className="font-mono font-semibold text-foreground">
                      {fmtCurrency((stats.totalRevenue || 0) * revMultiplier)}
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
                        const ua = calcUnattributedPct(acc);
                        return ua.pct == null ? "text-muted-foreground"
                          : ua.pct > 50 ? "text-destructive"
                          : ua.pct >= 30 ? "text-[hsl(38_92%_50%)]"
                          : "text-primary";
                      })()
                    }`}>
                      {(() => {
                        const ua = calcUnattributedPct(acc);
                        return ua.pct != null ? fmtPct(ua.pct) : "—";
                      })()}
                    </span>
                  </div>
                </div>

                {/* Revenue breakdown expandable */}
                {Number(acc.ltv_total || 0) > 0 && (() => {
                  const ltvT = Number(acc.ltv_total || 0);
                  const isExp = expandedBreakdown.has(acc.id);
                  const accLinksAll = allLinks.filter((l: any) => l.account_id === acc.id);
                  const campRev = accLinksAll.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
                  const unattributed = Math.max(0, ltvT - campRev);

                  const accMsg = Number(acc.ltv_messages || 0);
                  const accTips = Number(acc.ltv_tips || 0);
                  const accSubs = Number(acc.ltv_subscriptions || 0);
                  const accPosts = Number(acc.ltv_posts || 0);
                  const hasAccBreakdown = accMsg > 0 || accTips > 0 || accSubs > 0 || accPosts > 0;
                  const txB = (txBreakdowns as Record<string, any>)[acc.id];
                  const typeRows = hasAccBreakdown
                    ? [
                        { label: "Messages / PPV", value: accMsg, color: "hsl(var(--primary))" },
                        { label: "Tips", value: accTips, color: "hsl(38 92% 50%)" },
                        { label: "Subscriptions", value: accSubs, color: "hsl(280 60% 55%)" },
                        { label: "Posts", value: accPosts, color: "hsl(210 80% 55%)" },
                      ].filter(r => r.value > 0)
                    : txB
                      ? [
                          { label: "Messages / PPV", value: txB.messages, color: "hsl(var(--primary))" },
                          { label: "Tips", value: txB.tips, color: "hsl(38 92% 50%)" },
                          { label: "Subscriptions", value: txB.subscriptions, color: "hsl(280 60% 55%)" },
                          { label: "Posts", value: txB.posts, color: "hsl(210 80% 55%)" },
                        ].filter(r => r.value > 0)
                      : [];

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
                        <div className="mt-1.5 space-y-1.5 text-[12px]">
                          <div className="space-y-1 pb-1.5 border-b border-border/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0 bg-primary" />
                                <span className="text-muted-foreground">Via Campaigns</span>
                              </div>
                              <span className="font-mono text-foreground/80">
                                {fmtCurrency(campRev * revMultiplier)} · {ltvT > 0 ? ((campRev / ltvT) * 100).toFixed(1) : "0"}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/50" />
                                <span className="text-muted-foreground">Unattributed</span>
                              </div>
                              <span className="font-mono text-foreground/80">
                                {fmtCurrency(unattributed * revMultiplier)} · {ltvT > 0 ? ((unattributed / ltvT) * 100).toFixed(1) : "0"}%
                              </span>
                            </div>
                          </div>
                          {typeRows.length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">By Type</span>
                              {typeRows.map(r => (
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
                      )}
                    </div>
                  );
                })()}

                {/* PART 1: Added total subs count */}
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t border-border">
                  <span>{fmtNum(stats.totalSubs || 0)} subs</span>
                  <span className="text-border">·</span>
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
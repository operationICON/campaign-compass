import { useState, useMemo, useEffect } from "react";

import { usePageFilters } from "@/hooks/usePageFilters";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { useDateScopedMetrics } from "@/hooks/useDateScopedMetrics";
import { useSnapshotDeltaMetrics, getDelta } from "@/hooks/useSnapshotDeltaMetrics";
import { useActiveLinkStatus, getActiveInfo } from "@/hooks/useActiveLinkStatus";
import { PageFilterBar } from "@/components/PageFilterBar";

import { RevenueModeBadge } from "@/components/RevenueModeBadge";
import { getEffectiveSource } from "@/lib/source-helpers";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchTrackingLinkLtv } from "@/lib/supabase-helpers";
import { isActiveAccount, buildActiveLinkIdSet, filterLtvByActiveLinks } from "@/lib/calc-helpers";
import { TagBadge } from "@/components/TagBadge";
import { streamSync } from "@/lib/api";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useAccountLinkDeltas, pctChange } from "@/hooks/useAccountLinkDeltas";
import { TrendChip } from "@/components/TrendChip";

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
import { usePersistedState } from "@/hooks/usePersistedState";

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

type SortKey = "campaign_name" | "source_tag" | "marketer" | "revenue" | "clicks" | "subscribers" | "subs_day" | "cvr" | "spend" | "cross_poll" | "profit" | "profit_sub" | "ltv_sub" | "cpl" | "cpc" | "roi" | "status" | "created_at";
type SourceSortKey = "source" | "activeLinks" | "subs" | "subsDay" | "spend" | "revenue" | "cpl" | "cpc" | "cvr" | "profit" | "roi";
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
  const [activeTab, setActiveTab] = useState<"campaigns" | "sources" | "performance">("campaigns");
  // Persisted table prefs — model detail tracking links + traffic sources tabs
  const A_PREFS = "ct_table_prefs_accounts_campaigns";
  const S_PREFS = "ct_table_prefs_accounts_sources";
  const [sortKey, setSortKey] = usePersistedState<SortKey>(`${A_PREFS}_sortKey`, "created_at");
  const [sortAsc, setSortAsc] = usePersistedState<boolean>(`${A_PREFS}_sortAsc`, false);
  const [srcSortKey, setSrcSortKey] = usePersistedState<SourceSortKey>(`${S_PREFS}_sortKey`, "profit");
  const [srcSortAsc, setSrcSortAsc] = usePersistedState<boolean>(`${S_PREFS}_sortAsc`, false);
  const toggleSrcSort = (k: SourceSortKey) => {
    if (k === srcSortKey) setSrcSortAsc(!srcSortAsc);
    else { setSrcSortKey(k); setSrcSortAsc(false); }
  };
  const [editingGenderFor, setEditingGenderFor] = useState<string | null>(null);
  const [cardSort, setCardSort] = useState<CardSortKey>("ltv_per_sub");
  const [expandedBreakdown, setExpandedBreakdown] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);
  const [perfRange, setPerfRange] = useState<PerfRange>("30d");
  const [activityFilter, setActivityFilter] = usePersistedState<"all" | "active" | "inactive">(`${A_PREFS}_activityFilter`, "all");

  const handleDiscoverAccounts = async () => {
    setDiscovering(true);
    try {
      const data = await streamSync("/sync/orchestrate", { triggered_by: "discover" }, () => {}).catch(() => ({}));
      const created = (data as any)?.accounts_synced ?? 0;
      const total = (data as any)?.total ?? 0;
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
  // Shared date-scoped aggregator (subs/clicks/revenue/spend/profit/roi/cpl/cvr/ltvSub/subsPerDay).
  // Available for KPI cards on this page; tables continue to use applySnapshotToLinks.
  const dateScoped = useDateScopedMetrics(timePeriod, customRange, pageModelFilter !== "all" ? [pageModelFilter] : null);
  void dateScoped;
  const isAllTime = timePeriod === "all" && !customRange;

  const { data: allLinks = [] } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: async () => {
      const allRows: any[] = [];
      let rangeFrom = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("tracking_links")
          .select("*, accounts(display_name, username, avatar_thumb_url)")
          .is("deleted_at", null)
          .order("revenue", { ascending: false })
          .range(rangeFrom, rangeFrom + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        rangeFrom += batchSize;
      }
      return allRows;
    },
  });
  const links = useMemo(() => applySnapshotToLinks(allLinks, snapshotLookup), [allLinks, snapshotLookup]);

  // Active = link delivered >= 1 sub/day over last 5 days (snapshot-derived).
  // Used for the Tracking Links activity filter and the model overview "active links" footer count.
  const { activeLookup } = useActiveLinkStatus();

  // Per-link delta metrics for the selected date window (cumulative-snapshot deltas).
  // When All Time / no data → fall back to lifetime tracking_links.subscribers / age.
  const { deltaLookup, isAllTime: isDeltaAllTime } = useSnapshotDeltaMetrics(timePeriod, customRange);

  // Per-link cur/prev period aggregates for THIS account (model detail page).
  // Powers period-scoped table cells, "Gained" column, trend chips, and KPI cards.
  // Returns isAllTime=true when "All Time" selected → callers fall back to lifetime values.
  const selectedAccountLinkIds = useMemo(
    () => (selectedAccount ? allLinks.filter((l: any) => l.account_id === selectedAccount.id).map((l: any) => l.id) : []),
    [selectedAccount, allLinks]
  );
  const accountDeltas = useAccountLinkDeltas(
    selectedAccount?.id ?? null,
    selectedAccountLinkIds,
    timePeriod,
    customRange
  );

  const { data: dailyMetrics = [] } = useQuery({ queryKey: ["daily_metrics"], queryFn: () => fetchDailyMetrics() });
  const { data: trackingLinkLtvRaw = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });
  // RULE: exclude tracking_link_ltv rows whose tracking link has deleted_at IS NOT NULL.
  // Shared helper — see src/lib/calc-helpers.ts.
  const activeLinkIdSet = useMemo(() => buildActiveLinkIdSet(allLinks), [allLinks]);
  const trackingLinkLtv = useMemo(
    () => filterLtvByActiveLinks(trackingLinkLtvRaw, activeLinkIdSet),
    [trackingLinkLtvRaw, activeLinkIdSet]
  );

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

      // Active links — snapshot-derived: >= 1 sub/day over last 5 days.
      const activeLinks = accLinks.filter((l: any) => {
        if (l.deleted_at) return false;
        return getActiveInfo(l.id, activeLookup).isActive;
      });

      const earliestCreated = accLinks.reduce((earliest: Date | null, l: any) => {
        if (!l.created_at) return earliest;
        const d = new Date(l.created_at);
        return !earliest || d < earliest ? d : earliest;
      }, null as Date | null);
      const daysSinceEarliest = earliestCreated ? Math.max(1, differenceInDays(now, earliestCreated)) : 0;
      const subsPerDayLifetime = daysSinceEarliest > 0 && totalSubs > 0 ? totalSubs / daysSinceEarliest : null;

      // Delta-based subs/day for the current date filter window — sum each link's
      // (subsGained / daysBetween) when available, else 0. If All Time selected,
      // fall back to lifetime average (subs / days_since_earliest_link).
      let subsPerDay: number | null = subsPerDayLifetime;
      if (!isDeltaAllTime) {
        let totalSpd = 0;
        let anySpd = false;
        for (const l of accLinks) {
          const d = getDelta(l.id, deltaLookup);
          if (d?.subsPerDay != null) {
            totalSpd += d.subsPerDay;
            anySpd = true;
          }
        }
        subsPerDay = anySpd ? totalSpd : null;
      }

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
  }, [accounts, links, allLinks, dailyMetrics, agencyAvgCvr, trackingLinkLtv, snapshotLookup, isAllTime, activeLookup, deltaLookup, isDeltaAllTime]);

  const afterAccountFilter = useMemo(() => {
    // Rule 4: exclude inactive/test accounts (ltv_total=0 OR subscribers_count=0)
    const active = accounts.filter(isActiveAccount);
    if (pageModelFilter === "all") return active;
    return active.filter((a: any) => a.id === pageModelFilter);
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
    // Sort by selected key, Untagged stays at bottom
    const dir = srcSortAsc ? 1 : -1;
    return Object.values(groups).sort((a, b) => {
      if (a.source === "Untagged" && b.source !== "Untagged") return 1;
      if (b.source === "Untagged" && a.source !== "Untagged") return -1;
      const getVal = (g: typeof a): number | string => {
        switch (srcSortKey) {
          case "source": return g.source.toLowerCase();
          case "activeLinks": return g.activeLinks;
          case "subs": return g.subs;
          case "subsDay": return g.subs; // proxy: subs/day correlates with raw subs in same period
          case "cvr": return g.clicks > 0 ? (g.subs / g.clicks) : -Infinity;
          case "cpl": return g.subs > 0 && g.spend > 0 ? g.spend / g.subs : -Infinity;
          case "cpc": return g.clicks > 0 && g.spend > 0 ? g.spend / g.clicks : -Infinity;
          case "spend": return g.spend;
          case "revenue": return g.revenue;
          case "profit": return g.profit;
          case "roi": return g.roi ?? -Infinity;
          default: return g.profit;
        }
      };
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
  }, [selectedAccLinks, srcSortKey, srcSortAsc]);

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
      const dir = sortAsc ? 1 : -1;
      const getVal = (l: any): number | string => {
        switch (sortKey) {
          case "campaign_name": return (l.campaign_name || "").toLowerCase();
          case "source_tag": return (getEffectiveSource(l) || "zzz").toLowerCase();
          case "marketer": return (l.onlytraffic_marketer || "zzz").toLowerCase();
          case "status": return (l.status || "zzz").toLowerCase();
          case "created_at": return l.created_at ? new Date(l.created_at).getTime() : 0;
          case "subs_day": {
            const days = l.created_at ? Math.max(1, differenceInDays(new Date(), new Date(l.created_at))) : 1;
            return Number(l.subscribers || 0) / days;
          }
          case "cvr": {
            const c = Number(l.clicks || 0);
            return c > 0 ? (Number(l.subscribers || 0) / c) * 100 : -Infinity;
          }
          case "spend": return Number(l.cost_total || 0);
          case "cross_poll": {
            const ltvR = ltvLookup[String(l.id).toLowerCase()];
            return ltvR ? Number(ltvR.cross_poll_revenue || 0) : -1;
          }
          case "profit": {
            const sp = Number(l.cost_total || 0);
            return sp > 0 ? Number(l.revenue || 0) - sp : -Infinity;
          }
          case "profit_sub": {
            const sp = Number(l.cost_total || 0);
            const subs = Number(l.subscribers || 0);
            return sp > 0 && subs > 0 ? (Number(l.revenue || 0) - sp) / subs : -Infinity;
          }
          case "ltv_sub": {
            const subs = Number(l.subscribers || 0);
            return subs > 0 ? Number(l.revenue || 0) / subs : -Infinity;
          }
          case "cpl": {
            const sp = Number(l.cost_total || 0);
            const subs = Number(l.subscribers || 0);
            const pt = (l.payment_type || "").toUpperCase();
            return pt === "CPL" && sp > 0 && subs > 0 ? sp / subs : -Infinity;
          }
          case "cpc": {
            const sp = Number(l.cost_total || 0);
            const c = Number(l.clicks || 0);
            const pt = (l.payment_type || "").toUpperCase();
            return pt === "CPC" && sp > 0 && c > 0 ? sp / c : -Infinity;
          }
          case "roi": {
            const sp = Number(l.cost_total || 0);
            return sp > 0 ? ((Number(l.revenue || 0) - sp) / sp) * 100 : -Infinity;
          }
          default: return Number(l[sortKey] || 0);
        }
      };
      const av = getVal(a), bv = getVal(b);
      if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
      return dir * ((av as number) - (bv as number));
    });

    // Activity filter (snapshot-derived: >= 1 sub/day over last 5 days)
    const accLinksActiveCount = accLinks.filter((l: any) => getActiveInfo(l.id, activeLookup).isActive).length;
    const accLinksInactiveCount = accLinks.length - accLinksActiveCount;

    // Apply activity filter on top of the user-sorted list so column-header
    // sorting always controls row order regardless of which activity tab is active.
    let displayLinks = sortedLinks;
    if (activityFilter === "active") {
      displayLinks = sortedLinks.filter((l: any) => getActiveInfo(l.id, activeLookup).isActive);
    } else if (activityFilter === "inactive") {
      displayLinks = sortedLinks.filter((l: any) => !getActiveInfo(l.id, activeLookup).isActive);
    }

    // KPI card component (with optional trend chip when date filter is active)
    const KpiCard = ({
      label, value, colored, positive, trend, reverseTrend = false,
    }: {
      label: string;
      value: string;
      colored?: boolean;
      positive?: boolean;
      trend?: number | null;
      reverseTrend?: boolean;
    }) => (
      <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-lg font-bold font-mono ${
          colored ? (positive ? "text-primary" : "text-destructive") : "text-foreground"
        }`}>{value}</p>
        {trend !== undefined && (
          <div className="mt-1"><TrendChip value={trend ?? null} reverse={reverseTrend} /></div>
        )}
      </div>
    );


    // ── Period-aware mode (shared by table cells, KPI cards, headers) ──────────
    // When ANY date filter is active (not "All Time"), every numeric column re-scopes
    // to the selected window using `accountDeltas`. Trend chips compare to the
    // previous-period delta. When "All Time" is selected, lifetime values from
    // tracking_links + accounts are used (current behavior, preserved exactly).
    const periodActive = !accountDeltas.isAllTime;
    const periodSuffix = !periodActive
      ? ""
      : customRange
        ? "(custom)"
        : timePeriod === "day"
          ? "(sync)"
          : timePeriod === "week"
            ? "(7d)"
            : timePeriod === "month"
              ? "(30d)"
              : timePeriod === "prev_month"
                ? "(prev mo)"
                : "";
    const headerLabel = (base: string) => (periodActive ? `${base} ${periodSuffix}` : base);
    const gainedSuffix = periodActive ? periodSuffix : "(all)";

    // Lifetime KPI values (used when "All Time" or as fallback)
    const lifetimeRevenue = Number(acc.ltv_total || 0) * revMultiplier;
    const lifetimeCampaignRev = (stats.campaignRevAllTime || 0) * revMultiplier;
    const lifetimeSpend = stats.totalSpendAllTime || 0;
    const lifetimeProfit = lifetimeRevenue - lifetimeSpend;
    const lifetimeRoi = lifetimeSpend > 0 ? (lifetimeProfit / lifetimeSpend) * 100 : null;
    const lifetimeCpl = lifetimeSpend > 0 && stats.totalSubs > 0 ? lifetimeSpend / stats.totalSubs : null;
    const lifetimeCpc = lifetimeSpend > 0 && stats.totalClicks > 0 ? lifetimeSpend / stats.totalClicks : null;

    // Period-scoped KPI values (when filter active)
    const aCur = accountDeltas.accountTotals.cur;
    const aPrev = accountDeltas.accountTotals.prev;
    const periodRevenue = aCur.rev * revMultiplier;
    const periodPrevRevenue = aPrev.rev * revMultiplier;
    const periodCampaignRev = periodRevenue; // same source: cumulative-snapshot revenue delta
    const periodSpend = aCur.spend;
    const periodProfit = periodRevenue - periodSpend;
    const periodPrevProfit = periodPrevRevenue - aPrev.spend;
    const periodRoi = periodSpend > 0 ? (periodProfit / periodSpend) * 100 : null;
    const periodPrevRoi = aPrev.spend > 0 ? (periodPrevProfit / aPrev.spend) * 100 : null;
    const periodCpl = periodSpend > 0 && aCur.subs > 0 ? periodSpend / aCur.subs : null;
    const periodPrevCpl = aPrev.spend > 0 && aPrev.subs > 0 ? aPrev.spend / aPrev.subs : null;
    const periodCpc = periodSpend > 0 && aCur.clicks > 0 ? periodSpend / aCur.clicks : null;
    const periodPrevCpc = aPrev.spend > 0 && aPrev.clicks > 0 ? aPrev.spend / aPrev.clicks : null;
    const periodCvr = aCur.clicks > 0 ? (aCur.subs / aCur.clicks) * 100 : null;
    const periodPrevCvr = aPrev.clicks > 0 ? (aPrev.subs / aPrev.clicks) * 100 : null;
    const periodSubsPerDay = aCur.days > 0 ? aCur.subs / aCur.days : null;
    const periodPrevSubsPerDay = aPrev.days > 0 ? aPrev.subs / aPrev.days : null;

    // Active KPI values + trend deltas (consumed by KPI grid and table totals)
    const totalRevenue = periodActive ? periodRevenue : lifetimeRevenue;
    const totalRevenueTrend = periodActive ? pctChange(periodRevenue, periodPrevRevenue) : null;
    const campaignRev = periodActive ? periodCampaignRev : lifetimeCampaignRev;
    const campaignRevTrend = periodActive ? pctChange(periodCampaignRev, periodPrevRevenue) : null;
    const totalSpend = periodActive ? periodSpend : lifetimeSpend;
    const totalSpendTrend = periodActive ? pctChange(periodSpend, aPrev.spend) : null;
    const totalProfit = periodActive ? periodProfit : lifetimeProfit;
    const totalProfitTrend = periodActive ? pctChange(periodProfit, periodPrevProfit) : null;
    const roi = periodActive ? periodRoi : lifetimeRoi;
    const roiTrend = periodActive ? pctChange(periodRoi ?? 0, periodPrevRoi ?? 0) : null;
    const cpl = periodActive ? periodCpl : lifetimeCpl;
    const cplTrend = periodActive ? pctChange(periodCpl ?? 0, periodPrevCpl ?? 0) : null;
    const cpc = periodActive ? periodCpc : lifetimeCpc;
    const cpcTrend = periodActive ? pctChange(periodCpc ?? 0, periodPrevCpc ?? 0) : null;
    const subsKpiValue = periodActive ? aCur.subs : (stats.apiSubs || stats.totalSubs || 0);
    const subsKpiTrend = periodActive ? pctChange(aCur.subs, aPrev.subs) : null;
    const subsPerDayKpiValue = periodActive ? periodSubsPerDay : stats.subsPerDay;
    const subsPerDayKpiTrend = periodActive ? pctChange(periodSubsPerDay ?? 0, periodPrevSubsPerDay ?? 0) : null;
    const cvrKpiValue = periodActive ? periodCvr : stats.allCvr;
    const cvrKpiTrend = periodActive ? pctChange(periodCvr ?? 0, periodPrevCvr ?? 0) : null;


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
                  {/* Row 1: Primary financials — period-aware when filter active */}
                  <KpiCard label={headerLabel("Total Revenue")} value={fmtCurrency(totalRevenue)} trend={periodActive ? totalRevenueTrend : undefined} />
                  <KpiCard label={headerLabel("Campaign Rev")} value={fmtCurrency(campaignRev)} trend={periodActive ? campaignRevTrend : undefined} />
                  <KpiCard label={headerLabel("Total Spend")} value={fmtCurrency(totalSpend)} trend={periodActive ? totalSpendTrend : undefined} reverseTrend />
                  <KpiCard label={headerLabel("Total Profit")} value={fmtCurrency(totalProfit)} colored positive={totalProfit >= 0} trend={periodActive ? totalProfitTrend : undefined} />
                  <KpiCard label={headerLabel("ROI %")} value={roi != null ? fmtPct(roi) : "—"} colored positive={roi != null && roi >= 0} trend={periodActive ? roiTrend : undefined} />

                  {/* Row 2: Scale/subs — period-aware when filter active */}
                  <KpiCard label={headerLabel("Subscribers")} value={fmtNum(subsKpiValue)} trend={periodActive ? subsKpiTrend : undefined} />
                  <KpiCard label={headerLabel("Subs/Day")} value={subsPerDayKpiValue != null ? `${subsPerDayKpiValue.toFixed(1)}/day` : "—"} trend={periodActive ? subsPerDayKpiTrend : undefined} />
                  <KpiCard label={headerLabel("CVR")} value={cvrKpiValue != null ? fmtPct(cvrKpiValue) : "—"} trend={periodActive ? cvrKpiTrend : undefined} />
                  <KpiCard label={headerLabel("CPL")} value={cpl != null ? fmtCurrency(cpl) : "—"} trend={periodActive ? cplTrend : undefined} reverseTrend />
                  <KpiCard label={headerLabel("CPC")} value={cpc != null ? `$${cpc.toFixed(4)}` : "—"} trend={periodActive ? cpcTrend : undefined} reverseTrend />

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
                    {(["campaigns", "sources", "performance"] as const).map((tab) => (
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
                            : "Performance"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PART 3 — Tracking Links tab with clickable rows */}
                {activeTab === "campaigns" && (
                  <div className="overflow-x-auto">
                    {/* Date period pills — drives useAccountLinkDeltas window for ALL numeric columns.
                        Maps to global usePageFilters so KPI cards stay in sync. "2 weeks" uses customRange. */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {([
                        { key: "all", label: "All time", isActive: !customRange && timePeriod === "all", apply: () => { setCustomRange(null); setTimePeriod("all"); } },
                        { key: "sync", label: "Since last sync", isActive: !customRange && timePeriod === "day", apply: () => { setCustomRange(null); setTimePeriod("day"); } },
                        { key: "7d", label: "7 days", isActive: !customRange && timePeriod === "week", apply: () => { setCustomRange(null); setTimePeriod("week"); } },
                        { key: "14d", label: "2 weeks", isActive: !!customRange && Math.round((customRange.to.getTime() - customRange.from.getTime()) / 86400000) === 14, apply: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 14); setCustomRange({ from, to }); } },
                        { key: "30d", label: "30 days", isActive: !customRange && timePeriod === "month", apply: () => { setCustomRange(null); setTimePeriod("month"); } },
                      ]).map((p) => (
                        <button
                          key={p.key}
                          onClick={p.apply}
                          className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
                            p.isActive
                              ? "bg-transparent text-primary border-primary"
                              : "bg-secondary/50 dark:bg-secondary text-foreground/80 border-border hover:bg-secondary"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {/* Activity filter bar */}
                    <div className="flex items-center gap-2 mb-3">
                      {([
                        { key: "all" as const, label: `All links (${accLinks.length})` },
                        { key: "active" as const, label: `Active (${accLinksActiveCount})` },
                        { key: "inactive" as const, label: `Inactive (${accLinksInactiveCount})` },
                      ]).map((b) => {
                        const selected = activityFilter === b.key;
                        return (
                          <button
                            key={b.key}
                            onClick={() => setActivityFilter(b.key)}
                            className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
                              selected
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-secondary/50 dark:bg-secondary text-foreground/80 border-border hover:bg-secondary"
                            }`}
                          >
                            {b.label}
                          </button>
                        );
                      })}
                    </div>
                    {displayLinks.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">No tracking links match this filter</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("campaign_name")}>Tracking Link <SortIcon col="campaign_name" /></th>
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("source_tag")}>Source <SortIcon col="source_tag" /></th>
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("marketer")}>Marketer <SortIcon col="marketer" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("clicks")}>{headerLabel("Clicks")} <SortIcon col="clicks" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("subscribers")}>{headerLabel("Subs")} <SortIcon col="subscribers" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("subscribers")}>Gained {gainedSuffix}</th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("subs_day")}>{headerLabel("Subs/Day")} <SortIcon col="subs_day" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("cvr")}>{headerLabel("CVR")} <SortIcon col="cvr" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("spend")}>{headerLabel("Spend")} <SortIcon col="spend" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("revenue")}>{headerLabel("Revenue")} <SortIcon col="revenue" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("cross_poll")}>Cross-Poll <SortIcon col="cross_poll" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("profit")}>{headerLabel("Profit")} <SortIcon col="profit" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("profit_sub")}>{headerLabel("Profit/Sub")} <SortIcon col="profit_sub" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("ltv_sub")}>{headerLabel("LTV/Sub")} <SortIcon col="ltv_sub" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("cpl")}>{headerLabel("CPL")} <SortIcon col="cpl" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("cpc")}>{headerLabel("CPC")} <SortIcon col="cpc" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("roi")}>{headerLabel("ROI")} <SortIcon col="roi" /></th>
                            <th className="text-center py-2 px-3 cursor-pointer" onClick={() => toggleSort("status")}>Status <SortIcon col="status" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("created_at")}>Created <SortIcon col="created_at" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayLinks.map((l: any) => {
                            const status = getStatus(l);
                            // ── Lifetime values from tracking_links ──
                            const lifetimeSpend = Number(l.cost_total || 0);
                            const lifetimeRev = Number(l.revenue || 0);
                            const lifetimeSubs = Number(l.subscribers || 0);
                            const lifetimeClicks = Number(l.clicks || 0);
                            const ltvRecord = ltvLookup[String(l.id).toLowerCase()] || null;
                            const crossPoll = ltvRecord ? Number(ltvRecord.cross_poll_revenue || 0) : null;
                            const paymentType = (l.payment_type || "").toUpperCase();
                            const activeInfo = getActiveInfo(l.id, activeLookup);

                            // ── Period vs lifetime resolution ──
                            // When date filter is active, every numeric column shows the
                            // delta in that window from useAccountLinkDeltas (snapshots).
                            // Spend comes from onlytraffic_orders within the window.
                            const linkD = periodActive ? accountDeltas.deltas[l.id] : null;
                            const periodHas = !!linkD && linkD.hasCurrent;
                            const subsVal = periodActive ? (linkD?.cur.subs ?? 0) : lifetimeSubs;
                            const subsPrev = linkD?.prev.subs ?? 0;
                            const clicksVal = periodActive ? (linkD?.cur.clicks ?? 0) : lifetimeClicks;
                            const clicksPrev = linkD?.prev.clicks ?? 0;
                            const revVal = periodActive ? (linkD?.cur.rev ?? 0) : lifetimeRev;
                            const revPrev = linkD?.prev.rev ?? 0;
                            const spend = periodActive ? (linkD?.cur.spend ?? 0) : lifetimeSpend;
                            const spendPrev = linkD?.prev.spend ?? 0;
                            const hasSpend = spend > 0;
                            const profit = revVal - spend;
                            const profitPrev = revPrev - spendPrev;
                            const profitSub = hasSpend && subsVal > 0 ? profit / subsVal : null;
                            const ltvSub = subsVal > 0 ? revVal / subsVal : null;
                            const ltvSubPrev = subsPrev > 0 ? revPrev / subsPrev : null;
                            const cvr = clicksVal > 0 ? (subsVal / clicksVal) * 100 : null;
                            const cvrPrev = clicksPrev > 0 ? (subsPrev / clicksPrev) * 100 : null;
                            // CPL/CPC: lifetime gates by payment_type; period-mode shows whenever spend exists.
                            const cplVal = periodActive
                              ? (hasSpend && subsVal > 0 ? spend / subsVal : null)
                              : (paymentType === "CPL" && hasSpend && subsVal > 0 ? spend / subsVal : null);
                            const cplPrev = spendPrev > 0 && subsPrev > 0 ? spendPrev / subsPrev : null;
                            const cpcVal = periodActive
                              ? (hasSpend && clicksVal > 0 ? spend / clicksVal : null)
                              : (paymentType === "CPC" && hasSpend && clicksVal > 0 ? spend / clicksVal : null);
                            const cpcPrev = spendPrev > 0 && clicksPrev > 0 ? spendPrev / clicksPrev : null;
                            const roiVal = hasSpend ? (profit / spend) * 100 : null;
                            const roiPrev = spendPrev > 0 ? (profitPrev / spendPrev) * 100 : null;

                            // Subs/Day priority:
                            //  - Activity filter engaged → 5-day snapshot-derived (always)
                            //  - Date filter active → period delta from useAccountLinkDeltas
                            //  - All Time → lifetime average (subs / days_since_created)
                            let subsPerDay: number | null;
                            let subsPerDayPrev: number | null = null;
                            if (activityFilter !== "all") {
                              subsPerDay = activeInfo.subsPerDay > 0 ? activeInfo.subsPerDay : null;
                            } else if (periodActive) {
                              subsPerDay = linkD && linkD.cur.days > 0 ? linkD.cur.subs / linkD.cur.days : null;
                              subsPerDayPrev = linkD && linkD.prev.days > 0 ? linkD.prev.subs / linkD.prev.days : null;
                            } else {
                              const daysActive = l.created_at ? differenceInDays(new Date(), new Date(l.created_at)) : null;
                              subsPerDay = daysActive && daysActive > 0 && lifetimeSubs > 0 ? lifetimeSubs / daysActive : null;
                            }
                            const rowBorder =
                              activityFilter === "active"
                                ? "border-l-2 border-l-primary/70"
                                : activityFilter === "inactive"
                                ? "border-l-2 border-l-muted-foreground/40"
                                : "";

                            // Gained column: lifetime in All Time mode, delta otherwise
                            const gainedValue = periodActive
                              ? (periodHas ? linkD!.cur.subs : null)
                              : lifetimeSubs;
                            const gainedTrend = periodActive ? pctChange(linkD?.cur.subs ?? 0, subsPrev) : null;

                            return (
                              <tr
                                key={l.id}
                                className={`border-b border-border/50 hover:bg-muted/30 hover:border-l-2 hover:border-l-primary transition-colors cursor-pointer ${rowBorder}`}
                                onClick={() => setDrawerCampaign({ ...l, avatarUrl: acc.avatar_thumb_url, modelName: acc.display_name })}
                              >
                                <td className="py-3 px-3">
                                  <p className="font-bold text-foreground text-[12px] truncate max-w-[220px]">{l.campaign_name || "—"}</p>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[220px]">{l.url}</p>
                                </td>
                                <td className="py-3 px-3 text-[12px]">
                                  <TagBadge tagName={getEffectiveSource(l)} />
                                </td>
                                <td className="py-3 px-3 text-[12px] text-foreground/80">
                                  {l.onlytraffic_marketer || <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {fmtNum(clicksVal)}
                                  {periodActive && <div><TrendChip value={pctChange(clicksVal, clicksPrev)} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {fmtNum(subsVal)}
                                  {periodActive && <div><TrendChip value={pctChange(subsVal, subsPrev)} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {gainedValue == null ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <span className="text-emerald-500 font-bold">
                                      {periodActive ? (gainedValue > 0 ? `+${fmtNum(gainedValue)}` : fmtNum(gainedValue)) : fmtNum(gainedValue)}
                                    </span>
                                  )}
                                  {periodActive && <div><TrendChip value={gainedTrend} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">
                                  {subsPerDay != null ? `${subsPerDay.toFixed(1)}/day` : "—"}
                                  {periodActive && subsPerDayPrev !== null && <div><TrendChip value={pctChange(subsPerDay ?? 0, subsPerDayPrev)} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {cvr != null ? fmtPct(cvr) : <span className="text-muted-foreground">—</span>}
                                  {periodActive && <div><TrendChip value={pctChange(cvr ?? 0, cvrPrev ?? 0)} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {hasSpend ? fmtCurrency(spend) : <span className="text-muted-foreground">—</span>}
                                  {periodActive && <div><TrendChip value={pctChange(spend, spendPrev)} reverse /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  <span className="font-semibold text-primary">{fmtCurrency(revVal)}</span>
                                  {periodActive && <div><TrendChip value={pctChange(revVal, revPrev)} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {crossPoll !== null && crossPoll > 0 ? (
                                    <span className="text-[#7c3aed] font-semibold">{fmtCurrency(crossPoll)}</span>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${hasSpend ? (profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {hasSpend ? fmtCurrency(profit) : "—"}
                                  {periodActive && <div><TrendChip value={pctChange(profit, profitPrev)} /></div>}
                                </td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${profitSub != null ? (profitSub >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {profitSub != null ? fmtCurrency(profitSub) : "—"}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {ltvSub != null ? <span className="text-primary font-semibold">{fmtCurrency(ltvSub)}</span> : <span className="text-muted-foreground">—</span>}
                                  {periodActive && <div><TrendChip value={pctChange(ltvSub ?? 0, ltvSubPrev ?? 0)} /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {cplVal != null ? fmtCurrency(cplVal) : <span className="text-muted-foreground">—</span>}
                                  {periodActive && <div><TrendChip value={pctChange(cplVal ?? 0, cplPrev ?? 0)} reverse /></div>}
                                </td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">
                                  {cpcVal != null ? `$${cpcVal.toFixed(4)}` : <span className="text-muted-foreground">—</span>}
                                  {periodActive && <div><TrendChip value={pctChange(cpcVal ?? 0, cpcPrev ?? 0)} reverse /></div>}
                                </td>
                                <td className={`text-right py-3 px-3 font-mono text-[12px] font-semibold ${roiVal != null ? (roiVal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                                  {roiVal != null ? fmtPct(roiVal) : "—"}
                                  {periodActive && <div><TrendChip value={pctChange(roiVal ?? 0, roiPrev ?? 0)} /></div>}
                                </td>
                                <td className="text-center py-3 px-3">
                                  <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${status.cls}`}>{status.label}</span>
                                </td>
                                <td className="text-right py-3 px-3">
                                  <CampaignAgePill createdAt={l.created_at} clicks={lifetimeClicks} revenue={lifetimeRev} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {activityFilter !== "all" && displayLinks.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-3 px-1">
                        {activityFilter === "active"
                          ? `Showing ${displayLinks.length} active link${displayLinks.length === 1 ? "" : "s"} (delivering ≥ 1 sub/day)`
                          : `Showing ${displayLinks.length} inactive link${displayLinks.length === 1 ? "" : "s"} (< 1 sub/day last 5 days)`}
                      </p>
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
                            {([
                              { k: "source", l: "Source", a: "left" },
                              { k: "activeLinks", l: "Active Links", a: "right" },
                              { k: "subs", l: "Subs", a: "right" },
                              { k: "subsDay", l: "Subs/Day", a: "right" },
                              { k: "spend", l: "Total Spend", a: "right" },
                              { k: "revenue", l: "Revenue", a: "right" },
                              { k: "cpl", l: "CPL", a: "right" },
                              { k: "cpc", l: "CPC", a: "right" },
                              { k: "cvr", l: "CVR", a: "right" },
                              { k: "profit", l: "Profit", a: "right" },
                              { k: "roi", l: "ROI", a: "right" },
                            ] as { k: SourceSortKey; l: string; a: "left" | "right" }[]).map(({ k, l, a }) => (
                              <th key={k} className={`${a === "right" ? "text-right" : "text-left"} py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors`} onClick={() => toggleSrcSort(k)}>
                                <span className={`inline-flex items-center gap-1 ${a === "right" ? "justify-end" : ""}`}>
                                  {l}
                                  {srcSortKey === k ? (srcSortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sourceGroups.map((g) => {
                            const cvr = g.clicks > 0 ? (g.subs / g.clicks) * 100 : null;
                            const cplCpcType = getCplCpcLabel(g.costTypes);
                            // CPL = spend per sub; shown when source primarily uses CPL/Fixed pricing
                            const cplShow = (cplCpcType === "CPL" || cplCpcType === "Fixed" || cplCpcType === "Mixed") && g.subs > 0 && g.spend > 0;
                            const cplValue = cplShow ? `$${(g.spend / g.subs).toFixed(2)}` : "—";
                            // CPC = spend per click; shown when source primarily uses CPC/Fixed pricing
                            const cpcShow = (cplCpcType === "CPC" || cplCpcType === "Fixed" || cplCpcType === "Mixed") && g.clicks > 0 && g.spend > 0;
                            const cpcValue = cpcShow ? `$${(g.spend / g.clicks).toFixed(2)}` : "—";
                            const spd = sourceSubsPerDay[g.source];
                            return (
                              <tr key={g.source} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                <td className="py-3 px-3 font-medium text-[12px]"><TagBadge tagName={g.source} /></td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{g.activeLinks}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtNum(g.subs)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">{spd != null && spd > 0 ? `${spd.toFixed(1)}/day` : "—"}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px]">{fmtCurrency(g.spend)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] font-semibold text-primary">{fmtCurrency(g.revenue)}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">{cplValue}</td>
                                <td className="text-right py-3 px-3 font-mono text-[12px] text-muted-foreground">{cpcValue}</td>
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
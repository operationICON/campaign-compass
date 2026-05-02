import { useState, useMemo, useEffect } from "react";

import { usePageFilters, TIME_PERIODS } from "@/hooks/usePageFilters";
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
import { fetchAccounts, fetchTrackingLinks, fetchDailyMetrics, fetchTrackingLinkLtv, fetchAllTrackingLinksNormalized, fetchTransactionTypeTotalsByAccount, patchAccount } from "@/lib/supabase-helpers";
import { isActiveAccount, buildActiveLinkIdSet, filterLtvByActiveLinks } from "@/lib/calc-helpers";
import { TagBadge } from "@/components/TagBadge";
import { streamSync, getSnapshotsByDateRange } from "@/lib/api";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { CampaignAgePill } from "@/components/dashboard/CampaignAgePill";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useAccountLinkDeltas, pctChange } from "@/hooks/useAccountLinkDeltas";
import { useMultiWindowRates, getWindowRates } from "@/hooks/useMultiWindowRates";
import { TrendChip } from "@/components/TrendChip";

import { format, differenceInDays, subDays, isValid } from "date-fns";

function safeFormat(dateStr: string | null | undefined, fmt: string, fallback = "—"): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  return isValid(d) ? format(d, fmt) : fallback;
}
import { ArrowLeft, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Pencil, X, UserPlus, Loader2, Info, LayoutGrid, Rows3 } from "lucide-react";
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
  const [linksPage, setLinksPage] = useState(1);
  const [linksPerPage, setLinksPerPage] = usePersistedState<number>(`${A_PREFS}_perPage`, 25);
  const [viewMode, setViewMode] = usePersistedState<"grid" | "slide">("accounts_view_mode", "grid");
  const [carouselIndex, setCarouselIndex] = useState(0);

  // Reset to page 1 whenever account, filter, or sort changes
  useEffect(() => { setLinksPage(1); }, [selectedAccount?.id, activityFilter, sortKey, sortAsc]);

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
    queryFn: () => fetchAllTrackingLinksNormalized(),
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
  const multiWindowRates = useMultiWindowRates(selectedAccount?.id ?? null);

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

      const rows = await getSnapshotsByDateRange({
        account_ids: [selectedAccount.id],
        ...(fromDate ? { date_from: fromDate } : {}),
      });
      return (rows as any[]).sort((a, b) =>
        (a.snapshot_date ?? "") > (b.snapshot_date ?? "") ? 1 : -1
      );
    },
    enabled: !!selectedAccount,
  });

  // Fetch transaction breakdowns per account for revenue breakdown
  const { data: txBreakdowns = {} } = useQuery({
    queryKey: ["transaction_type_totals_by_account"],
    queryFn: fetchTransactionTypeTotalsByAccount,
    staleTime: 5 * 60 * 1000,
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
    try {
      await patchAccount(accountId, { gender_identity: gender });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setEditingGenderFor(null);
      toast.success(gender ? `Set to "${gender}"` : "Gender removed");
    } catch {
      toast.error("Failed to save gender");
    }
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

      // Period revenue + subs from snapshot deltas — only valid when NOT All Time.
      // Guard: only set when at least one link has delta data in the window.
      let periodRevenue: number | null = null;
      let periodSubs: number | null = null;
      if (!isDeltaAllTime) {
        let rev = 0, subs = 0, anyData = false;
        for (const l of accLinks) {
          const d = getDelta(l.id, deltaLookup);
          if (d) { rev += d.revenueGained; subs += d.subsGained; anyData = true; }
        }
        if (anyData) { periodRevenue = rev; periodSubs = subs; }
      }

      const apiSubs = acc.subscribers_count || 0;
      const unattributedPct: number | null = null;

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
        unattributedBreakdown: null,
        ltvPerSub,
        hasLtvData,
        periodRevenue,
        periodSubs,
      };
    }
    return stats;
  }, [accounts, links, allLinks, dailyMetrics, agencyAvgCvr, trackingLinkLtv, snapshotLookup, isAllTime, activeLookup, deltaLookup, isDeltaAllTime]);

  const afterAccountFilter = useMemo(() => {
    // Rule 4: exclude inactive/test accounts (subscribers_count=0)
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
          return ((accountStats[b.id]?.campaignRevAllTime || 0) / Math.max(Number(b.subscribers_count || 0), 1)) - ((accountStats[a.id]?.campaignRevAllTime || 0) / Math.max(Number(a.subscribers_count || 0), 1));
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

    // Active = created < 5 days ago (always active, hasn't had time to get traffic)
    //       OR has any subs/clicks recorded in snapshot window (last 5 days)
    const isLinkActive = (l: any): boolean => {
      const ageDays = l.created_at ? differenceInDays(new Date(), new Date(l.created_at)) : 999;
      if (ageDays < 5) return true;
      return activeLookup.get(String(l.id).toLowerCase())?.isActive ?? false;
    };

    const accLinksActiveCount = accLinks.filter((l: any) => isLinkActive(l)).length;
    const accLinksInactiveCount = accLinks.length - accLinksActiveCount;

    let displayLinks = sortedLinks;
    if (activityFilter === "active") {
      displayLinks = sortedLinks.filter((l: any) => isLinkActive(l));
    } else if (activityFilter === "inactive") {
      displayLinks = sortedLinks.filter((l: any) => !isLinkActive(l));
    }
    const totalLinkPages = Math.max(1, Math.ceil(displayLinks.length / linksPerPage));
    const safeLinkPage = Math.min(linksPage, totalLinkPages);
    const paginatedLinks = displayLinks.slice((safeLinkPage - 1) * linksPerPage, safeLinkPage * linksPerPage);
    const showStart = displayLinks.length > 0 ? (safeLinkPage - 1) * linksPerPage + 1 : 0;
    const showEnd = Math.min(safeLinkPage * linksPerPage, displayLinks.length);

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

    // Lifetime KPI values (used when "All Time" or as fallback)
    const lifetimeUnattrib = Number(acc.ltv_total || 0) * revMultiplier;
    const lifetimeCampaignRev = (stats.campaignRevAllTime || 0) * revMultiplier;
    const lifetimeRevenue = lifetimeCampaignRev + lifetimeUnattrib;
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

                  {/* Row 3: Traffic health + Unattributed */}
                  <KpiCard label="Total Tracking Links" value={String(stats.totalCampaigns || 0)} />
                  <KpiCard label="Active Tracking Links" value={String(stats.activeCampaigns || 0)} />
                  <div className="bg-secondary/50 dark:bg-secondary rounded-xl p-4">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Unattributed Rev</p>
                    <p className="text-lg font-bold font-mono text-foreground">
                      {lifetimeUnattrib > 0 ? `$${lifetimeUnattrib.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                    </p>
                    {lifetimeRevenue > 0 && lifetimeUnattrib > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {((lifetimeUnattrib / lifetimeRevenue) * 100).toFixed(1)}% of total
                      </p>
                    )}
                  </div>
                  <div />
                  <div />
                </div>

                {/* Revenue Breakdown — compact, under KPI cards */}
                {(() => {
                  const campRevRaw = stats.campaignRevAllTime || 0;
                  const tx = (txBreakdowns as any)[acc.id] as any;
                  const accMsg  = Number(acc.ltv_messages || 0);
                  const accTips = Number(acc.ltv_tips || 0);
                  const accSubs = Number(acc.ltv_subscriptions || 0);
                  const accPost = Number(acc.ltv_posts || 0);
                  const hasLtv  = Number(acc.ltv_total || 0) > 0;
                  const unattribRaw = Number(acc.ltv_total || 0);

                  const campaignsVal   = campRevRaw * revMultiplier;
                  const unattribVal    = unattribRaw * revMultiplier;
                  const totalForPct    = campaignsVal + unattribVal;

                  const messages      = (hasLtv ? accMsg  : (tx?.messages      ?? 0)) * revMultiplier;
                  const tips          = (hasLtv ? accTips : (tx?.tips          ?? 0)) * revMultiplier;
                  const subscriptions = (hasLtv ? accSubs : (tx?.subscriptions ?? 0)) * revMultiplier;
                  const posts         = (hasLtv ? accPost : (tx?.posts         ?? 0)) * revMultiplier;
                  const hasTypeBreakdown = messages > 0 || tips > 0 || subscriptions > 0 || posts > 0;

                  const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  const pct = (v: number) => totalForPct > 0 ? `${((v / totalForPct) * 100).toFixed(1)}%` : null;

                  const Row = ({ dot, label, value, pctVal }: { dot: string; label: string; value: string; pctVal: string | null }) => (
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                        <span className="text-[11px] text-muted-foreground truncate">{label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono flex-shrink-0 ml-2">
                        <span className="text-[15px] text-foreground font-bold">{value}</span>
                        {pctVal && <span className="text-[11px] text-muted-foreground/60">{pctVal}</span>}
                      </div>
                    </div>
                  );

                  const SubRow = ({ dot, label, value, pctVal }: { dot: string; label: string; value: string; pctVal: string | null }) => (
                    <div className="flex items-center justify-between py-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`inline-block w-1 h-1 rounded-full flex-shrink-0 ${dot}`} />
                        <span className="text-[10px] text-muted-foreground/75 truncate">{label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono flex-shrink-0 ml-2">
                        <span className="text-[13px] text-foreground/90 font-semibold">{value}</span>
                        {pctVal && <span className="text-[10px] text-muted-foreground/50">{pctVal}</span>}
                      </div>
                    </div>
                  );

                  const accLtvSubs = trackingLinkLtv.filter((r: any) => r.account_id === acc.id).reduce((s: number, r: any) => s + Number(r.new_subs_total || 0), 0);
                  const accLtvTotal = trackingLinkLtv.filter((r: any) => r.account_id === acc.id).reduce((s: number, r: any) => s + Number(r.total_ltv || 0), 0);
                  const ltvPerSubVal = accLtvSubs > 0 ? accLtvTotal / accLtvSubs : null;

                  return (
                    <div className="mt-4 pt-3 border-t border-border">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Revenue Breakdown</p>
                      <div className="space-y-0.5">
                        <Row dot="bg-emerald-400" label="Campaigns" value={fmt(campaignsVal)} pctVal={pct(campaignsVal)} />
                        <Row dot="bg-muted-foreground/40" label="Unattributed" value={fmt(unattribVal)} pctVal={pct(unattribVal)} />
                        {hasTypeBreakdown && (
                          <div className="ml-3 pl-2.5 border-l-2 border-border/60 space-y-0.5">
                            {messages > 0 && <SubRow dot="bg-primary/70" label="Messages / PPV" value={fmt(messages)} pctVal={pct(messages)} />}
                            {tips > 0 && <SubRow dot="bg-amber-400/70" label="Tips" value={fmt(tips)} pctVal={pct(tips)} />}
                            {subscriptions > 0 && <SubRow dot="bg-purple-400/70" label="Subscriptions" value={fmt(subscriptions)} pctVal={pct(subscriptions)} />}
                            {posts > 0 && <SubRow dot="bg-blue-400/70" label="Posts" value={fmt(posts)} pctVal={pct(posts)} />}
                          </div>
                        )}
                        {ltvPerSubVal !== null && (
                          <div className="flex items-center justify-between py-1 pt-2 mt-0.5 border-t border-border/50">
                            <span className="text-[11px] text-muted-foreground">Rev / Sub</span>
                            <span className="font-mono font-bold text-[15px] text-foreground">{fmt(ltvPerSubVal)}</span>
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
                      <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("campaign_name")}>Tracking Link <SortIcon col="campaign_name" /></th>
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("source_tag")}>Source <SortIcon col="source_tag" /></th>
                            <th className="text-left py-2 px-3 cursor-pointer" onClick={() => toggleSort("marketer")}>Marketer <SortIcon col="marketer" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("clicks")}>{headerLabel("Clicks")} <SortIcon col="clicks" /></th>
                            <th className="text-right py-2 px-3 cursor-pointer" onClick={() => toggleSort("subscribers")}>{headerLabel("Subs")} <SortIcon col="subscribers" /></th>
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
                          {paginatedLinks.map((l: any) => {
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
                            //  - Date filter active → period delta from useAccountLinkDeltas
                            //  - All Time (default) → 5-day snapshot-derived rate
                            //  Lifetime average (subs / days_since_created) was intentionally removed:
                            //  it made old inactive links appear active with misleading historical rates.
                            let subsPerDay: number | null;
                            let subsPerDayPrev: number | null = null;
                            if (periodActive) {
                              subsPerDay = linkD && linkD.cur.days > 0 ? linkD.cur.subs / linkD.cur.days : null;
                              subsPerDayPrev = linkD && linkD.prev.days > 0 ? linkD.prev.subs / linkD.prev.days : null;
                            } else {
                              subsPerDay = activeInfo.subsPerDay > 0 ? activeInfo.subsPerDay : null;
                            }
                            const rowBorder =
                              activityFilter === "active"
                                ? "border-l-2 border-l-primary/70"
                                : activityFilter === "inactive"
                                ? "border-l-2 border-l-muted-foreground/40"
                                : "";



                            return (
                              <tr
                                key={l.id}
                                className={`border-b border-border/50 hover:bg-muted/30 hover:border-l-2 hover:border-l-primary transition-colors cursor-pointer ${rowBorder}`}
                                onClick={() => setDrawerCampaign({ ...l, avatarUrl: acc.avatar_thumb_url, modelName: acc.display_name })}
                              >
                                <td className="py-3 px-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: isLinkActive(l) ? "#16a34a" : "#94a3b8" }} title={isLinkActive(l) ? "Active" : "Inactive"} />
                                    <p className="font-bold text-foreground text-[12px] truncate max-w-[220px]">{l.campaign_name || "—"}</p>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[220px]" style={{ paddingLeft: "14px" }}>{l.url}</p>
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
                                <td className="text-right py-3 px-3">
                                  {(() => {
                                    if (periodActive) {
                                      return (
                                        <div className="font-mono text-[12px] text-muted-foreground text-right">
                                          {subsPerDay != null ? `${subsPerDay < 1 ? subsPerDay.toFixed(2) : subsPerDay.toFixed(1)}/day` : "—"}
                                          {subsPerDayPrev !== null && <div><TrendChip value={pctChange(subsPerDay ?? 0, subsPerDayPrev)} /></div>}
                                        </div>
                                      );
                                    }
                                    const ageDays = l.created_at ? Math.max(1, differenceInDays(new Date(), new Date(l.created_at))) : 1;
                                    const totalSubs = l.subscribers || 0;
                                    const lifetimeRate = totalSubs > 0 ? totalSubs / ageDays : null;
                                    return lifetimeRate !== null ? (
                                      <div className="flex items-baseline gap-1 justify-end">
                                        <span className={`font-mono font-semibold text-[12px] ${lifetimeRate >= 1 ? "text-emerald-400" : lifetimeRate >= 0.3 ? "text-amber-400" : "text-muted-foreground"}`}>
                                          {lifetimeRate < 1 ? lifetimeRate.toFixed(2) : lifetimeRate.toFixed(1)}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground font-mono">{ageDays}d</span>
                                      </div>
                                    ) : <span className="text-muted-foreground text-[12px]">—</span>;
                                  })()}
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
                      {/* Bottom pagination bar */}
                      <div className="flex items-center justify-between px-1 py-2 border-t border-border">
                        <span className="text-xs text-muted-foreground">Showing {showStart}–{showEnd} of {displayLinks.length} tracking links</span>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Rows:</span>
                            {[10, 25, 50, 100].map(n => (
                              <button key={n} onClick={() => { setLinksPerPage(n); setLinksPage(1); }}
                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${linksPerPage === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>{n}</button>
                            ))}
                          </div>
                          {totalLinkPages > 1 && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => setLinksPage(p => Math.max(1, p - 1))} disabled={safeLinkPage <= 1} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30">
                                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                              </button>
                              {Array.from({ length: Math.min(totalLinkPages, 7) }, (_, i) => {
                                let pageNum: number;
                                if (totalLinkPages <= 7) pageNum = i + 1;
                                else if (safeLinkPage <= 4) pageNum = i + 1;
                                else if (safeLinkPage >= totalLinkPages - 3) pageNum = totalLinkPages - 6 + i;
                                else pageNum = safeLinkPage - 3 + i;
                                return (
                                  <button key={pageNum} onClick={() => setLinksPage(pageNum)}
                                    className={`w-8 h-8 rounded text-xs font-medium transition-colors ${pageNum === safeLinkPage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                                    {pageNum}
                                  </button>
                                );
                              })}
                              <button onClick={() => setLinksPage(p => Math.min(totalLinkPages, p + 1))} disabled={safeLinkPage >= totalLinkPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30">
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      </>
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

  // Clamp carousel index
  const safeIndex = sortedAccounts.length > 0 ? Math.min(carouselIndex, sortedAccounts.length - 1) : 0;
  const slideAcc = sortedAccounts[safeIndex] as any;
  const slideStats = slideAcc ? (accountStats[slideAcc.id] || {}) : {};

  const ModelCard = ({ acc }: { acc: any }) => {
    const stats = accountStats[acc.id] || {};
    const category = getGender(acc);
    const isEditing = editingGenderFor === acc.id;
    const totalRev = ((stats.hasLtvData && stats.totalLtvAllTime > 0 ? stats.totalLtvAllTime : stats.campaignRevAllTime) || 0) * revMultiplier;
    const spend = stats.totalSpendAllTime || 0;
    const profit = (stats.totalProfit || 0) * revMultiplier;
    const profitPositive = profit >= 0;

    return (
      <div
        className="bg-card border border-border rounded-2xl overflow-hidden transition-all duration-200 hover:border-primary/35 hover:shadow-2xl hover:-translate-y-1 cursor-pointer group"
        onClick={() => { setSelectedAccount(acc); setActiveTab("campaigns"); setSortKey("created_at"); setSortAsc(false); }}
      >
        {/* Avatar header strip */}
        <div className="relative h-20 overflow-hidden"
          style={{ background: "linear-gradient(135deg, hsl(220 18% 13%), hsl(220 16% 9%))" }}
        >
          <div className="absolute inset-0 opacity-30"
            style={{ background: "radial-gradient(ellipse 120% 100% at 80% 50%, hsl(168 65% 52% / 0.25), transparent 70%)" }}
          />
          {acc.avatar_thumb_url && (
            <img
              src={acc.avatar_thumb_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-15 blur-sm scale-110"
            />
          )}
          {/* Subscriber badge top-right */}
          <div className="absolute top-3 right-4 text-right">
            <div className="text-[11px] text-white/50 font-medium">OF Subs</div>
            <div className="text-sm font-bold text-white">{fmtNum(acc.subscribers_count || 0)}</div>
          </div>
          {/* Avatar bottom-left overlapping */}
          <div className="absolute -bottom-7 left-5">
            <AvatarCircle account={acc} size={56} />
          </div>
        </div>

        {/* Body */}
        <div className="pt-9 px-5 pb-4">
          {/* Name + category + gender edit */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-foreground leading-tight truncate">{acc.display_name}</h3>
              {displayUsername(acc) && (
                <p className="text-[12px] text-muted-foreground mt-0.5">{displayUsername(acc)}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 relative" onClick={(e) => e.stopPropagation()}>
              {isEditing ? (
                <>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getGenderBadgeStyle(category)}`}>{category}</span>
                  <button onClick={() => setEditingGenderFor(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                  <div className="flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden absolute top-6 right-0 z-20 min-w-[130px]">
                    {GENDER_OPTIONS.map((g) => (
                      <button key={g} onClick={() => handleSaveGender(acc.id, g === "Uncategorized" ? null : g)}
                        className={`px-4 py-2 text-[11px] text-left hover:bg-muted/40 transition-colors ${category === g ? "font-bold text-primary" : "text-foreground"}`}>
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${g === "Female" ? "bg-pink-400" : g === "Trans" ? "bg-purple-400" : g === "Male" ? "bg-blue-400" : "bg-muted-foreground/40"}`} />
                        {g}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getGenderBadgeStyle(category)}`}>{category}</span>
                  <button onClick={() => setEditingGenderFor(acc.id)} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    <Pencil className="h-3 w-3" />
                  </button>
                </>
              )}
              {acc.performer_top != null && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">Top {acc.performer_top}%</span>
              )}
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-background/60 rounded-xl p-3 border border-border/60">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Total Revenue</div>
              <div className="text-[14px] font-bold text-foreground font-mono">{fmtCurrency(totalRev)}</div>
            </div>
            <div className="bg-background/60 rounded-xl p-3 border border-border/60">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">LTV/Sub</div>
              <div className="text-[14px] font-bold text-primary font-mono">{stats.ltvPerSub != null ? fmtCurrency(stats.ltvPerSub * revMultiplier) : "—"}</div>
            </div>
            <div className="bg-background/60 rounded-xl p-3 border border-border/60">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Spend</div>
              <div className="text-[14px] font-bold text-foreground font-mono">{spend > 0 ? fmtCurrency(spend) : "—"}</div>
            </div>
            <div className="bg-background/60 rounded-xl p-3 border border-border/60">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Profit</div>
              <div className={`text-[14px] font-bold font-mono ${spend > 0 ? (profitPositive ? "text-emerald-400" : "text-destructive") : "text-muted-foreground/40"}`}>
                {spend > 0 ? fmtCurrency(profit) : "—"}
              </div>
            </div>
          </div>

          {/* CVR row */}
          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-background/40 border border-border/50 mb-3">
            <span className="text-[11px] text-muted-foreground">CVR</span>
            <span className="text-[12px] font-semibold text-foreground font-mono">{stats.allCvr != null ? `${stats.allCvr.toFixed(1)}%` : "—"}</span>
            <span className="text-border/50 text-xs">·</span>
            <span className="text-[11px] text-muted-foreground">Subs/Day</span>
            <span className="text-[12px] font-semibold text-foreground font-mono">{stats.subsPerDay != null ? `${stats.subsPerDay.toFixed(1)}` : "—"}</span>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 pt-3 border-t border-border/60 text-[11px] text-muted-foreground">
            <span><span className="font-semibold text-foreground">{fmtNum(stats.totalSubs || 0)}</span> subs</span>
            <span className="opacity-30">·</span>
            <span><span className="font-semibold text-emerald-400">{stats.activeCampaigns || 0}</span> active</span>
            <span className="opacity-30">·</span>
            <span><span className="font-semibold text-foreground">{stats.totalCampaigns || 0}</span> links</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Models</h1>
            <p className="text-sm text-muted-foreground">All accounts connected to Campaign Tracker</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscoverAccounts}
              disabled={discovering}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
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

        {/* Controls row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          {/* Category pills */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setCategoryFilter("all")}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                categoryFilter === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              All <span className="ml-1 text-xs opacity-70">{accounts.length}</span>
            </button>
            {allCategories.map((cat) => {
              const count = accounts.filter((a: any) => getGender(a) === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    categoryFilter === cat
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  {cat} <span className="ml-1 text-xs opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Right: sort + view toggle */}
          <div className="flex items-center gap-2">
            <select
              value={cardSort}
              onChange={(e) => setCardSort(e.target.value as CardSortKey)}
              className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {CARD_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>

            {/* View mode toggle */}
            <div className="flex items-center rounded-xl border border-border overflow-hidden bg-card">
              <button
                onClick={() => setViewMode("grid")}
                title="Grid view"
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${
                  viewMode === "grid"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Grid
              </button>
              <div className="w-px h-5 bg-border" />
              <button
                onClick={() => { setViewMode("slide"); setCarouselIndex(0); }}
                title="Slide view"
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${
                  viewMode === "slide"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" />
                Slide
              </button>
            </div>
          </div>
        </div>

        {/* GRID VIEW */}
        {viewMode === "grid" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedAccounts.map((acc: any) => <ModelCard key={acc.id} acc={acc} />)}
          </div>
        )}

        {/* SLIDE / CAROUSEL VIEW */}
        {viewMode === "slide" && sortedAccounts.length > 0 && (() => {
          const acc = slideAcc;
          const stats = slideStats;
          const category = getGender(acc);
          const totalRev = ((stats.hasLtvData && stats.totalLtvAllTime > 0 ? stats.totalLtvAllTime : stats.campaignRevAllTime) || 0) * revMultiplier;
          const spend = stats.totalSpendAllTime || 0;
          const profit = (stats.totalProfit || 0) * revMultiplier;
          const profitPositive = profit >= 0;

          return (
            <div className="space-y-4">
              {/* Navigation bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCarouselIndex(i => Math.max(0, i - 1))}
                    disabled={safeIndex === 0}
                    className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setCarouselIndex(i => Math.min(sortedAccounts.length - 1, i + 1))}
                    disabled={safeIndex === sortedAccounts.length - 1}
                    className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-muted-foreground ml-1">
                    <span className="font-bold text-foreground">{safeIndex + 1}</span> / {sortedAccounts.length}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">Click any thumbnail to jump</span>
              </div>

              {/* Featured card */}
              <div
                className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer"
                onClick={() => { setSelectedAccount(acc); setActiveTab("campaigns"); setSortKey("created_at"); setSortAsc(false); }}
              >
                <div className="flex flex-col lg:flex-row">
                  {/* Left — profile */}
                  <div className="lg:w-[320px] shrink-0 relative flex flex-col items-center justify-center p-8 border-b lg:border-b-0 lg:border-r border-border overflow-hidden">
                    {/* Blurred bg */}
                    {acc.avatar_thumb_url && (
                      <img src={acc.avatar_thumb_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 blur-xl scale-110 pointer-events-none" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-b from-card/20 via-card/60 to-card pointer-events-none" />
                    <div className="relative z-10 flex flex-col items-center text-center">
                      <AvatarCircle account={acc} size={110} />
                      <h2 className="text-xl font-bold text-foreground mt-4 leading-tight">{acc.display_name}</h2>
                      {displayUsername(acc) && <p className="text-[13px] text-primary mt-0.5">{displayUsername(acc)}</p>}
                      <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${getGenderBadgeStyle(category)}`}>{category}</span>
                        {acc.performer_top != null && (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/10 text-primary">Top {acc.performer_top}%</span>
                        )}
                      </div>
                      <div className="mt-5 pt-4 border-t border-border/50 w-full grid grid-cols-2 gap-4 text-center">
                        <div>
                          <div className="text-xl font-bold text-foreground">{fmtNum(acc.subscribers_count || 0)}</div>
                          <div className="text-[11px] text-muted-foreground">OF Subscribers</div>
                        </div>
                        <div>
                          <div className="text-xl font-bold text-emerald-400">{stats.activeCampaigns || 0}</div>
                          <div className="text-[11px] text-muted-foreground">Active Links</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-foreground">{stats.subsPerDay != null ? `${stats.subsPerDay.toFixed(1)}` : "—"}</div>
                          <div className="text-[11px] text-muted-foreground">Subs/Day</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-foreground">{stats.allCvr != null ? `${stats.allCvr.toFixed(1)}%` : "—"}</div>
                          <div className="text-[11px] text-muted-foreground">CVR</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right — stats */}
                  <div className="flex-1 p-8">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-[0.12em] font-semibold mb-5">Performance Overview — All Time</div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                      {[
                        { label: "Total Revenue", value: fmtCurrency(totalRev), color: "text-foreground" },
                        { label: "LTV/Sub", value: stats.ltvPerSub != null ? fmtCurrency(stats.ltvPerSub * revMultiplier) : "—", color: "text-primary" },
                        { label: "Total Spend", value: spend > 0 ? fmtCurrency(spend) : "—", color: "text-foreground" },
                        { label: "Profit", value: spend > 0 ? fmtCurrency(profit) : "—", color: spend > 0 ? (profitPositive ? "text-emerald-400" : "text-destructive") : "text-muted-foreground/40" },
                        { label: "Total Links", value: String(stats.totalCampaigns || 0), color: "text-foreground" },
                        { label: "Total Subs", value: fmtNum(stats.totalSubs || 0), color: "text-foreground" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-background/60 rounded-xl border border-border/60 p-4">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">{label}</div>
                          <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Subs/day + CVR bar */}
                    <div className="mt-4 grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-3 bg-background/40 rounded-xl border border-border/50 px-4 py-3">
                        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Subs / Day</div>
                          <div className="text-base font-bold text-foreground font-mono">{stats.subsPerDay != null ? `${stats.subsPerDay.toFixed(2)}/day` : "—"}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-background/40 rounded-xl border border-border/50 px-4 py-3">
                        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Conversion Rate</div>
                          <div className="text-base font-bold text-foreground font-mono">{stats.allCvr != null ? `${stats.allCvr.toFixed(2)}%` : "—"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Thumbnail strip */}
              <div className="flex gap-2 overflow-x-auto pb-1 pt-1">
                {sortedAccounts.map((a: any, i: number) => (
                  <button
                    key={a.id}
                    onClick={() => setCarouselIndex(i)}
                    className={`shrink-0 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
                      i === safeIndex
                        ? "bg-primary/15 ring-1 ring-primary/40"
                        : "bg-card border border-border hover:border-primary/30"
                    }`}
                  >
                    <AvatarCircle account={a} size={36} />
                    <span className="text-[10px] text-muted-foreground truncate max-w-[56px]">{a.display_name?.split(" ")[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </DashboardLayout>
  );
}
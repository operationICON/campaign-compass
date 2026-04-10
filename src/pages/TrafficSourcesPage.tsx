import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePageFilters } from "@/hooks/usePageFilters";
import { TrafficCategoryNav } from "@/components/traffic/TrafficCategoryNav";
import { useSnapshotMetrics, applySnapshotToLinks } from "@/hooks/useSnapshotMetrics";
import { PageFilterBar } from "@/components/PageFilterBar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { TagBadge } from "@/components/TagBadge";
import { getEffectiveSource, getTrafficCategoryLabel } from "@/lib/source-helpers";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { TrafficSourceDropdown } from "@/components/TrafficSourceDropdown";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { clearTrackingLinkSpend, setTrackingLinkSourceTag, fetchTrackingLinkLtv } from "@/lib/supabase-helpers";
import { useColumnOrder, type ColumnDef } from "@/hooks/useColumnOrder";
import { DraggableColumnSelector } from "@/components/DraggableColumnSelector";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { RefreshButton } from "@/components/RefreshButton";
import {
  Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X,
  AlertTriangle, BarChart3, Settings2, Lock, Info,
  Hash, Tag, HelpCircle, DollarSign, TrendingUp, Percent, Users, Activity, MousePointerClick, Award,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, differenceInDays, subDays, startOfMonth, endOfMonth, subMonths, startOfDay } from "date-fns";
import { ModelAvatar } from "@/components/ModelAvatar";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const COLUMNS_KEY = "ct_traffic_sources_columns";
const KPI_KEY = "ct_traffic_sources_kpis";
const SOURCE_ANALYSIS_KEY = "ct_traffic_sources_analysis";
const COLOR_CYCLE = ["#0891b2", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#ec4899", "#f97316", "#64748b"];

type SourceAnalysisId = "subs_day_source" | "distribution" | "growth_trend" | "contribution";

interface SourceAnalysisDef { id: SourceAnalysisId; label: string; defaultOn: boolean }

const SOURCE_ANALYSIS_CARDS: SourceAnalysisDef[] = [
  { id: "subs_day_source", label: "Subs/Day per Source", defaultOn: true },
  { id: "distribution", label: "Distribution %", defaultOn: true },
  { id: "growth_trend", label: "Growth Trend", defaultOn: true },
  { id: "contribution", label: "Source Contribution", defaultOn: true },
];

function loadAnalysisVisibility(): Set<SourceAnalysisId> {
  try {
    const s = localStorage.getItem(SOURCE_ANALYSIS_KEY);
    if (s) return new Set(JSON.parse(s) as SourceAnalysisId[]);
  } catch {}
  return new Set(SOURCE_ANALYSIS_CARDS.filter(k => k.defaultOn).map(k => k.id));
}

type ColumnId = "model" | "source" | "category" | "clicks" | "subscribers" | "cvr" | "revenue" | "ltv" | "ltv_per_sub" | "ltv_sub_all" | "expenses" | "profit" | "profit_per_sub" | "roi" | "status" | "subs_day" | "created" | "notes";
type SortKey = "campaign_name" | "source_tag" | "clicks" | "subscribers" | "revenue" | "created_at" | "cvr" | "ltv" | "cost_total" | "profit" | "roi";

type KpiId = "total_sources" | "tagged" | "untagged" | "total_spend" | "total_revenue" | "blended_roi"
  | "total_profit" | "avg_cpl" | "total_subscribers" | "active_sources" | "total_clicks" | "avg_profit_sub" | "top_source";

interface KpiDef { id: KpiId; label: string; defaultOn: boolean; alwaysOn?: boolean }

const KPI_CARDS: KpiDef[] = [
  { id: "total_sources", label: "Total Sources", defaultOn: true },
  { id: "tagged", label: "Tagged Campaigns", defaultOn: true },
  { id: "untagged", label: "Untagged", defaultOn: true },
  { id: "total_spend", label: "Total Spend", defaultOn: true },
  { id: "total_revenue", label: "Total Revenue", defaultOn: true },
  { id: "blended_roi", label: "ROI %", defaultOn: true },
  { id: "total_profit", label: "Total Profit", defaultOn: false },
  { id: "avg_cpl", label: "Avg CPL", defaultOn: false },
  { id: "total_subscribers", label: "Total Subscribers", defaultOn: false },
  { id: "active_sources", label: "Active Sources", defaultOn: false },
  { id: "total_clicks", label: "Total Clicks", defaultOn: false },
  { id: "avg_profit_sub", label: "Avg Profit/Sub", defaultOn: false },
  { id: "top_source", label: "Top Source", defaultOn: false },
];

function loadKpiVisibility(): Set<KpiId> {
  try {
    const s = localStorage.getItem(KPI_KEY);
    if (s) return new Set(JSON.parse(s) as KpiId[]);
  } catch {}
  return new Set(KPI_CARDS.filter(k => k.defaultOn).map(k => k.id));
}

const TS_COLUMNS: ColumnDef[] = [
  { id: "model", label: "Model", defaultOn: true },
  { id: "source", label: "Source", defaultOn: true },
  { id: "category", label: "Category", defaultOn: true },
  { id: "clicks", label: "Clicks", defaultOn: true },
  { id: "subscribers", label: "Subs", defaultOn: true },
  { id: "cvr", label: "CVR", defaultOn: true },
  { id: "revenue", label: "Revenue", defaultOn: true },
  { id: "ltv", label: "LTV", defaultOn: true },
  { id: "ltv_per_sub", label: "LTV/New Sub", defaultOn: true },
  { id: "ltv_sub_all", label: "LTV/Sub", defaultOn: true },
  { id: "expenses", label: "Spend", defaultOn: true },
  { id: "profit", label: "Profit", defaultOn: true },
  { id: "profit_per_sub", label: "Profit/Sub", defaultOn: true },
  { id: "roi", label: "ROI", defaultOn: true },
  { id: "status", label: "Status", defaultOn: true },
  { id: "subs_day", label: "Subs/Day", defaultOn: true },
  { id: "created", label: "Created", defaultOn: true },
  { id: "notes", label: "Notes", defaultOn: false },
];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

import { STATUS_STYLES, calcStatusFromRoi, calcAgencyTotals, getEffectiveRevenue, calcCvr, calcStatus, STATUS_LABELS } from "@/lib/calc-helpers";
import { EstBadge } from "@/components/EstBadge";

function getAgeDays(createdAt: string) { return differenceInDays(new Date(), new Date(createdAt)); }

// ── KPI Card ──
function KpiCard({ label, value, sub, icon, color }: { label: string; value: React.ReactNode; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card border border-border px-4 py-3 rounded-xl" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-muted-foreground" style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <p className="font-mono font-bold text-foreground" style={{ fontSize: "20px", lineHeight: 1.2 }}>{value}</p>
      {sub && <p className="text-muted-foreground" style={{ fontSize: "11px", marginTop: "2px" }}>{sub}</p>}
    </div>
  );
}

export default function TrafficSourcesPage() {
  const queryClient = useQueryClient();
  const { timePeriod, setTimePeriod, modelFilter: pageModelFilter, setModelFilter: setPageModelFilter, customRange, setCustomRange, dateFilter } = usePageFilters();

  // KPI visibility
  const [visibleKpis, setVisibleKpis] = useState<Set<KpiId>>(loadKpiVisibility);
  const [kpiDropdownOpen, setKpiDropdownOpen] = useState(false);
  const toggleKpi = (id: KpiId) => {
    setVisibleKpis(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(KPI_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Source Analysis visibility
  const [visibleAnalysis, setVisibleAnalysis] = useState<Set<SourceAnalysisId>>(loadAnalysisVisibility);
  const toggleAnalysis = (id: SourceAnalysisId) => {
    setVisibleAnalysis(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(SOURCE_ANALYSIS_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Column order (drag-and-drop)
  const columnOrder = useColumnOrder("ct_traffic_sources_columns", TS_COLUMNS);
  const col = (id: string) => columnOrder.isVisible(id);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "OnlyTraffic" | "Manual">("all");

  // Sort/page
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // Selection
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // Expanded row state
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [spendType, setSpendType] = useState<"CPL" | "CPC" | "FIXED">("CPL");
  const [spendValue, setSpendValue] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [sourceInputValue, setSourceInputValue] = useState("");

  // Source card state
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<"OnlyTraffic" | "Manual">("Manual");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // New source form
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<"OnlyTraffic" | "Manual">("Manual");

  // Source search
  const [sourceSearchOpen, setSourceSearchOpen] = useState(false);
  const [sourceSearchQuery, setSourceSearchQuery] = useState("");
  const sourceSearchRef = useRef<HTMLDivElement>(null);

  // Data
  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase.from("traffic_sources").select("*").order("name");
      return (data || []).filter((s: any) => !s.is_archived);
    },
  });

  // Snapshot-based time filtering
  const { snapshotLookup, isLoading: snapshotLoading } = useSnapshotMetrics(timePeriod, customRange);

  const { data: allLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links_ts"],
    queryFn: async () => {
      let allLinks: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data } = await supabase
          .from("tracking_links")
          .select("*, accounts(display_name, username, avatar_thumb_url)")
          .is("deleted_at", null)
          .order("revenue", { ascending: false })
          .range(from, from + batchSize - 1);
        if (!data || data.length === 0) break;
        allLinks = allLinks.concat(data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return allLinks;
    },
  });
  const isLoading = linksLoading || snapshotLoading;
  const isAllTime = timePeriod === "all" && !customRange;
  const links = useMemo(() => {
    const snapped = applySnapshotToLinks(allLinks, snapshotLookup);
    if (!snapshotLookup) return snapped; // All Time — no prorating needed
    // Prorate cost_total for time-filtered views:
    // daily_spend = cost_total / age_days, then × snapshotDays
    return snapped.map(l => {
      const costTotal = Number(l.cost_total || 0);
      if (costTotal <= 0) return l;
      const ageDays = Math.max(1, differenceInDays(new Date(), new Date(l.created_at)));
      const snapshotDays = Number(l.snapshotDays || 0);
      if (snapshotDays <= 0) return { ...l, cost_total: 0 };
      const proratedCost = (costTotal / ageDays) * snapshotDays;
      return { ...l, cost_total: proratedCost };
    });
  }, [allLinks, snapshotLookup]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").order("display_name");
      return data || [];
    },
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["manual_notes_ts"],
    queryFn: async () => {
      const { data } = await supabase.from("manual_notes").select("*").order("updated_at", { ascending: false });
      return data || [];
    },
  });

  const { data: dailyMetrics = [] } = useQuery({
    queryKey: ["daily_metrics_ts"],
    queryFn: async () => {
      const { data } = await supabase.from("daily_metrics").select("*").order("date", { ascending: false });
      return data || [];
    },
  });

  const { data: trackingLinkLtv = [] } = useQuery({
    queryKey: ["tracking_link_ltv"],
    queryFn: fetchTrackingLinkLtv,
  });

  // LTV lookup map — normalize keys for UUID↔TEXT matching
  const ltvLookup = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trackingLinkLtv) {
      const key = String(r.tracking_link_id ?? "").trim().toLowerCase();
      if (key) map[key] = r;
    }
    return map;
  }, [trackingLinkLtv]);

  // Migrate source_tag_rules → traffic_sources on load if empty
  useEffect(() => {
    if (sources.length > 0) return;
    (async () => {
      const { data: rules } = await supabase.from("source_tag_rules").select("*");
      if (!rules || rules.length === 0) return;
      const { data: existingSources } = await supabase.from("traffic_sources").select("name");
      const existingNames = new Set((existingSources || []).map((s: any) => s.name));
      const toInsert = rules.filter((r: any) => !existingNames.has(r.tag_name)).map((r: any) => ({
        name: r.tag_name, color: r.color, keywords: r.keywords || [], category: "Manual",
      }));
      if (toInsert.length > 0) {
        await supabase.from("traffic_sources").insert(toInsert);
        queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      }
    })();
  }, [sources.length]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links_ts"] });
    queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
    queryClient.invalidateQueries({ queryKey: ["manual_notes_ts"] });
  };

  // ── KPI calculations ──
  const kpis = useMemo(() => {
    const totalSources = sources.length;
    const tagged = allLinks.filter((l: any) => !!getEffectiveSource(l)).length;
    const untagged = allLinks.filter((l: any) => !getEffectiveSource(l) && (l.clicks > 0 || l.subscribers > 0)).length;
    const totalRevenue = allLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const totalSubscribers = allLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const totalClicks = allLinks.reduce((s: number, l: any) => s + (l.clicks || 0), 0);

    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const activeSourceIds = new Set<string>();
    allLinks.forEach((l: any) => {
      if (l.traffic_source_id && l.clicks > 0 && l.updated_at >= thirtyDaysAgo) {
        activeSourceIds.add(l.traffic_source_id);
      }
    });
    const activeSources = activeSourceIds.size;

    // Total Spend = SUM(cost_total) WHERE cost_total > 0
    const totalSpend = allLinks
      .filter((l: any) => Number(l.cost_total || 0) > 0)
      .reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);

    // Total Profit = SUM(revenue) - SUM(cost_total WHERE cost_total > 0)
    const totalProfit = totalRevenue - totalSpend;
    const blendedRoi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;

    // Avg CPL = SUM(cost_total WHERE payment_type='CPL' AND cost_total > 0) / SUM(subscribers WHERE same)
    const cplLinks = allLinks.filter((l: any) => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
    const cplSpend = cplLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const cplSubs = cplLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : 0;

    const paidLinks = allLinks.filter((l: any) => Number(l.cost_total || 0) > 0);
    const paidSubs = paidLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const avgProfitSub = paidSubs > 0 ? totalProfit / paidSubs : 0;

    const revenueBySource: Record<string, number> = {};
    allLinks.forEach((l: any) => {
      const es = getEffectiveSource(l);
      if (es) {
        revenueBySource[es] = (revenueBySource[es] || 0) + Number(l.revenue || 0);
      }
    });
    const topSource = Object.entries(revenueBySource).sort((a, b) => b[1] - a[1])[0];

    return {
      totalSources, tagged, untagged,
      totalSpend, totalRevenue, blendedRoi,
      totalProfit, avgCpl, totalSubscribers,
      activeSources, totalClicks, avgProfitSub, topSource,
    };
  }, [sources, allLinks]);

  // ── Source Analysis calculations ──
  const sourceAnalysis = useMemo(() => {
    // Group links by source
    const bySource: Record<string, any[]> = {};
    allLinks.forEach((l: any) => {
      const tag = getEffectiveSource(l) || "Untagged";
      if (!bySource[tag]) bySource[tag] = [];
      bySource[tag].push(l);
    });

    // Filter by sourceFilter
    const relevantSources = sourceFilter !== "all" && sourceFilter !== "untagged"
      ? { [sourceFilter]: bySource[sourceFilter] || [] }
      : sourceFilter === "untagged"
        ? { Untagged: bySource["Untagged"] || [] }
        : bySource;

    // Subs/Day per Source
    const subsPerDay: { name: string; value: number; color: string }[] = [];
    const totalSubs = Object.values(relevantSources).reduce((sum, arr) => sum + arr.reduce((s: number, l: any) => s + (l.subscribers || 0), 0), 0);

    // Distribution
    const distribution: { name: string; pct: number; color: string }[] = [];

    // Source contribution
    let topContrib = { name: "—", pct: 0, subs: 0 };

    Object.entries(relevantSources).forEach(([name, arr]) => {
      if (name === "Untagged" && sourceFilter !== "untagged") return;
      const subs = arr.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const src = sources.find((s: any) => s.name === name);
      const color = src ? (src as any).color : "#64748b";

      // Calculate days active (from oldest created_at)
      const oldest = arr.reduce((min: string, l: any) => l.created_at < min ? l.created_at : min, arr[0]?.created_at || new Date().toISOString());
      const days = Math.max(1, differenceInDays(new Date(), new Date(oldest)));
      const sd = subs / days;
      subsPerDay.push({ name, value: parseFloat(sd.toFixed(2)), color });

      const pct = totalSubs > 0 ? (subs / totalSubs) * 100 : 0;
      distribution.push({ name, pct: parseFloat(pct.toFixed(1)), color });

      if (subs > topContrib.subs) topContrib = { name, pct: parseFloat(pct.toFixed(1)), subs };
    });

    subsPerDay.sort((a, b) => b.value - a.value);
    distribution.sort((a, b) => b.pct - a.pct);

    // Growth Trend — last 30 days vs 30 before
    const now = new Date();
    const period1Start = subDays(now, 30);
    const period2Start = subDays(now, 60);
    const period2End = subDays(now, 30);

    const growthTrend: { name: string; current: number; previous: number; change: number; color: string }[] = [];

    Object.entries(relevantSources).forEach(([name, arr]) => {
      if (name === "Untagged" && sourceFilter !== "untagged") return;
      const linkIds = new Set(arr.map((l: any) => l.id));
      const src = sources.find((s: any) => s.name === name);
      const color = src ? (src as any).color : "#64748b";

      let current = 0, previous = 0;
      dailyMetrics.forEach((m: any) => {
        if (!linkIds.has(m.tracking_link_id)) return;
        const d = new Date(m.date);
        if (d >= period1Start && d <= now) current += (m.new_subscribers || 0);
        else if (d >= period2Start && d < period2End) previous += (m.new_subscribers || 0);
      });

      const change = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
      growthTrend.push({ name, current, previous, change: parseFloat(change.toFixed(1)), color });
    });

    growthTrend.sort((a, b) => b.change - a.change);

    return { subsPerDay, distribution, growthTrend, topContrib };
  }, [links, sources, sourceFilter, dailyMetrics]);


  const selectedSource = useMemo(() => sources.find((s: any) => s.id === editSourceId), [sources, editSourceId]);

  const selectSourceForEdit = (source: any) => {
    setEditSourceId(source.id);
    setFormName(source.name);
    setFormCategory(source.category === "OnlyTraffic" ? "OnlyTraffic" : "Manual");
    setConfirmDelete(false);
    setSourceSearchOpen(false);
    setSourceSearchQuery("");
  };

  const clearSourceEdit = () => {
    setEditSourceId(null);
    setFormName("");
    setFormCategory("Manual");
    setConfirmDelete(false);
  };

  const nextColor = useMemo(() => {
    const usedColors = sources.map((s: any) => s.color);
    for (const c of COLOR_CYCLE) { if (!usedColors.includes(c)) return c; }
    return COLOR_CYCLE[sources.length % COLOR_CYCLE.length];
  }, [sources]);

  const newNameWarning = useMemo(() => {
    if (!newName.trim()) return null;
    const q = newName.trim().toLowerCase();
    for (const s of sources) {
      if ((s as any).name.toLowerCase() === q) return (s as any).name;
      if (levenshtein((s as any).name.toLowerCase(), q) <= 2) return (s as any).name;
    }
    return null;
  }, [newName, sources]);

  const handleSaveChanges = async () => {
    if (!editSourceId || !formName.trim()) return;
    setSaving(true);
    try {
      const oldName = (selectedSource as any)?.name;
      const { error } = await supabase.from("traffic_sources").update({
        name: formName.trim(), category: formCategory,
      } as any).eq("id", editSourceId);
      if (error) throw error;
      if (oldName && oldName !== formName.trim()) {
        await supabase.from("tracking_links").update({ source_tag: formName.trim() } as any).eq("source_tag", oldName);
      }
      toast.success("Source updated");
      invalidateAll();
    } catch { toast.error("Failed to save changes"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!editSourceId) return;
    setSaving(true);
    try {
      const name = (selectedSource as any)?.name;
      const count = links.filter((l: any) => l.traffic_source_id === editSourceId).length;
      await supabase.from("tracking_links").update({ source_tag: null, traffic_source_id: null } as any).eq("traffic_source_id", editSourceId);
      const { error } = await supabase.from("traffic_sources").delete().eq("id", editSourceId);
      if (error) throw error;
      toast.success(`Deleted ${name} — ${count} campaigns untagged`);
      clearSourceEdit();
      invalidateAll();
    } catch { toast.error("Failed to delete source"); }
    finally { setSaving(false); }
  };

  const handleNewSource = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("traffic_sources").insert({
        name: newName.trim(), category: newCategory, color: nextColor,
      });
      if (error) throw error;
      toast.success("Source created");
      setNewName(""); setNewCategory("Manual");
      invalidateAll();
    } catch (err: any) { toast.error(err.message || "Failed to create source"); }
    finally { setSaving(false); }
  };

  // ── Filtering ──
  const accountOptions = useMemo(() =>
    accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))
      .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name)),
  [accounts]);

  const sourceOptions = useMemo(() => {
    const tags = new Set<string>();
    links.forEach((l: any) => { const es = getEffectiveSource(l); if (es) tags.add(es); });
    return [...tags].sort();
  }, [links]);

  const filtered = useMemo(() => {
    let result = links as any[];
    if (pageModelFilter !== "all") result = result.filter(l => l.account_id === pageModelFilter);
    if (accountFilter !== "all") result = result.filter(l => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter(l => !getEffectiveSource(l));
    else if (sourceFilter !== "all") result = result.filter(l => getEffectiveSource(l) === sourceFilter);
    if (categoryFilter !== "all") {
      const sourceIds = sources.filter((s: any) => s.category === categoryFilter).map((s: any) => s.id);
      result = result.filter(l => sourceIds.includes(l.traffic_source_id));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        (l.campaign_name || "").toLowerCase().includes(q) ||
        (l.url || "").toLowerCase().includes(q) ||
        (l.accounts?.username || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [links, pageModelFilter, accountFilter, sourceFilter, categoryFilter, searchQuery, sources]);

  // Sorting
  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "campaign_name": aVal = (a.campaign_name || "").toLowerCase(); bVal = (b.campaign_name || "").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "source_tag": aVal = (a.source_tag || "zzz").toLowerCase(); bVal = (b.source_tag || "zzz").toLowerCase(); return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case "clicks": aVal = a.clicks || 0; bVal = b.clicks || 0; break;
        case "subscribers": aVal = a.subscribers || 0; bVal = b.subscribers || 0; break;
        case "revenue": aVal = Number(a.revenue || 0); bVal = Number(b.revenue || 0); break;
        case "cvr": aVal = Number(a.cvr || 0); bVal = Number(b.cvr || 0); break;
        case "ltv": aVal = (ltvLookup[String(a.id).toLowerCase()] ? Number(ltvLookup[String(a.id).toLowerCase()].total_ltv || 0) : 0); bVal = (ltvLookup[String(b.id).toLowerCase()] ? Number(ltvLookup[String(b.id).toLowerCase()].total_ltv || 0) : 0); break;
        case "cost_total": aVal = Number(a.cost_total || 0); bVal = Number(b.cost_total || 0); break;
        case "profit": aVal = Number(a.profit || 0); bVal = Number(b.profit || 0); break;
        case "roi": aVal = Number(a.roi || 0); bVal = Number(b.roi || 0); break;
        case "created_at": aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
        default: aVal = 0; bVal = 0;
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
  }, [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * perPage, safePage * perPage);
  const showFrom = sorted.length > 0 ? (safePage - 1) * perPage + 1 : 0;
  const showTo = Math.min(safePage * perPage, sorted.length);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRows(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);
  const toggleSelectAll = useCallback(() => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((l: any) => l.id)));
  }, [paginated, selectedRows]);

  const handleRowClick = (link: any) => {
    if (expandedRow === link.id) {
      setExpandedRow(null);
    } else {
      setExpandedRow(link.id);
      setSpendType(link.cost_type || "CPL");
      setSpendValue(link.cost_value ? String(link.cost_value) : "");
      setSourceInputValue(link.source_tag || "");
      // Load existing note
      const existingNote = notes.find((n: any) => n.campaign_id === link.campaign_id && n.account_id === link.account_id);
      setNoteText(existingNote?.note || existingNote?.content || "");
    }
  };

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: string }) => (
    <th
      className="cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
      style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", padding: "10px 12px", textTransform: "uppercase", textAlign: (align || "left") as any }}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === k ? (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />) : <ChevronDown className="h-3 w-3 opacity-20" />}
      </span>
    </th>
  );

  const getCategory = (link: any) => {
    if (!link.traffic_source_id) return null;
    const src = sources.find((s: any) => s.id === link.traffic_source_id);
    return src ? (src as any).category : null;
  };

  // Source search dropdown — close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sourceSearchRef.current && !sourceSearchRef.current.contains(e.target as Node)) {
        setSourceSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredSources = useMemo(() => {
    if (!sourceSearchQuery.trim()) return sources;
    const q = sourceSearchQuery.toLowerCase();
    return sources.filter((s: any) => s.name.toLowerCase().includes(q));
  }, [sources, sourceSearchQuery]);

  const getSourceCampaignCount = (sourceId: string) => links.filter((l: any) => l.traffic_source_id === sourceId).length;

  // Pagination helpers
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [];
    if (safePage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push("...", totalPages);
    } else if (safePage >= totalPages - 3) {
      pages.push(1, "...");
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1, "...", safePage - 1, safePage, safePage + 1, "...", totalPages);
    }
    return pages;
  }, [totalPages, safePage]);

  // ── KPI rendering map ──
  const kpiRenderMap: Record<KpiId, { label: string; value: React.ReactNode; sub?: string; icon: React.ReactNode; color: string }> = {
    total_sources: { label: "Total Sources", value: fmtN(kpis.totalSources), icon: <Hash className="h-4 w-4" />, color: "#0891b2" },
    tagged: { label: "Tagged Campaigns", value: fmtN(kpis.tagged), sub: `${links.length > 0 ? ((kpis.tagged / links.length) * 100).toFixed(0) : 0}% of total`, icon: <Tag className="h-4 w-4" />, color: "#16a34a" },
    untagged: { label: "Untagged", value: fmtN(kpis.untagged), sub: kpis.untagged > 0 ? "Need tagging" : "All tagged", icon: <HelpCircle className="h-4 w-4" />, color: kpis.untagged > 0 ? "#d97706" : "#16a34a" },
    total_spend: { label: "Total Spend", value: fmtC(kpis.totalSpend), icon: <DollarSign className="h-4 w-4" />, color: "#dc2626" },
    total_revenue: { label: "Total Revenue", value: fmtC(kpis.totalRevenue), icon: <TrendingUp className="h-4 w-4" />, color: "#16a34a" },
    blended_roi: { label: "ROI %", value: kpis.totalSpend > 0 ? fmtPct(kpis.blendedRoi) : "—", sub: kpis.totalSpend > 0 ? (kpis.blendedRoi > 0 ? "Profitable" : "Negative") : "No spend data", icon: <Percent className="h-4 w-4" />, color: kpis.blendedRoi > 0 ? "#16a34a" : kpis.totalSpend > 0 ? "#dc2626" : "#94a3b8" },
    total_profit: { label: "Total Profit", value: kpis.totalSpend > 0 ? fmtC(kpis.totalProfit) : "—", icon: <TrendingUp className="h-4 w-4" />, color: kpis.totalProfit > 0 ? "#16a34a" : "#dc2626" },
    avg_cpl: { label: "Avg CPL", value: kpis.avgCpl > 0 ? fmtC(kpis.avgCpl) : "—", icon: <DollarSign className="h-4 w-4" />, color: "#0891b2" },
    total_subscribers: { label: "Total Subscribers", value: fmtN(kpis.totalSubscribers), icon: <Users className="h-4 w-4" />, color: "#7c3aed" },
    active_sources: { label: "Active Sources", value: fmtN(kpis.activeSources), sub: "Last 30 days", icon: <Activity className="h-4 w-4" />, color: "#0891b2" },
    total_clicks: { label: "Total Clicks", value: fmtN(kpis.totalClicks), icon: <MousePointerClick className="h-4 w-4" />, color: "#64748b" },
    avg_profit_sub: { label: "Avg Profit/Sub", value: kpis.avgProfitSub !== 0 ? fmtC(kpis.avgProfitSub) : "—", icon: <TrendingUp className="h-4 w-4" />, color: kpis.avgProfitSub > 0 ? "#16a34a" : "#dc2626" },
    top_source: { label: "Top Source", value: kpis.topSource ? kpis.topSource[0] : "—", sub: kpis.topSource ? fmtC(kpis.topSource[1]) : undefined, icon: <Award className="h-4 w-4" />, color: "#d97706" },
  };

  const visibleKpiList = KPI_CARDS.filter(k => visibleKpis.has(k.id));

  return (
    <DashboardLayout>
      <div className="bg-background min-h-screen p-4 space-y-4">
        {/* ═══ TIME + MODEL FILTER BAR ═══ */}
        <PageFilterBar
          timePeriod={timePeriod}
          onTimePeriodChange={setTimePeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          modelFilter={pageModelFilter}
          onModelFilterChange={setPageModelFilter}
          accounts={accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
        />

        {/* TOP SECTION — KPIs left + Source Card right */}
        <div className="flex gap-4 items-start mb-4">
          {/* Left 60% — KPI Cards */}
          <div style={{ flex: "0 0 60%" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-xl font-bold text-foreground">Traffic Sources</h1>
                <p className="text-muted-foreground" style={{ fontSize: "13px" }}>Manage sources and view tracking link performance by source</p>
              </div>
              <div className="flex items-center gap-2">
                <RefreshButton queryKeys={["tracking_links_ts", "traffic_sources", "manual_notes_ts", "accounts"]} />
                <div className="relative">
                  <button onClick={() => setKpiDropdownOpen(!kpiDropdownOpen)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border text-xs font-medium text-muted-foreground rounded-lg">
                    <Settings2 className="h-3.5 w-3.5" /> Columns
                  </button>
                  {kpiDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setKpiDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-popover border border-border shadow-lg py-1.5 max-h-80 overflow-y-auto" style={{ borderRadius: "12px" }}>
                        <p className="text-muted-foreground px-3 py-1" style={{ fontSize: "10px",  textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>KPI Cards</p>
                        {KPI_CARDS.map(k => (
                          <label key={k.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary cursor-pointer" style={{ fontSize: "12px" }}>
                            <input type="checkbox" checked={visibleKpis.has(k.id)} onChange={() => toggleKpi(k.id)} className="h-3.5 w-3.5 rounded cursor-pointer accent-primary" />
                            <span className="text-foreground">{k.label}</span>
                          </label>
                        ))}
                        <div className="border-t mx-2 my-1 border-border" />
                        <p className="text-muted-foreground px-3 py-1 mt-1" style={{ fontSize: "10px",  textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Source Analysis</p>
                        {SOURCE_ANALYSIS_CARDS.map(k => (
                          <label key={k.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary cursor-pointer" style={{ fontSize: "12px" }}>
                            <input type="checkbox" checked={visibleAnalysis.has(k.id)} onChange={() => toggleAnalysis(k.id)} className="h-3.5 w-3.5 rounded cursor-pointer accent-primary" />
                            <span className="text-foreground">{k.label}</span>
                          </label>
                        ))}
                        <div className="border-t mx-2 my-1 border-border" />
                        <button onClick={() => { const def = new Set(KPI_CARDS.filter(k => k.defaultOn).map(k => k.id)); setVisibleKpis(def); localStorage.removeItem(KPI_KEY); const aDef = new Set(SOURCE_ANALYSIS_CARDS.filter(k => k.defaultOn).map(k => k.id)); setVisibleAnalysis(aDef); localStorage.removeItem(SOURCE_ANALYSIS_KEY); }} className="w-full px-3 py-1.5 text-left text-primary" style={{ fontSize: "11px" }}>
                          Reset to defaults
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>


            <div className="grid grid-cols-3 gap-3">
              {visibleKpiList.map(k => {
                const r = kpiRenderMap[k.id];
                return <KpiCard key={k.id} label={r.label} value={r.value} sub={r.sub} icon={r.icon} color={r.color} />;
              })}
            </div>
          </div>

          {/* Right 40% — Source Card */}
          <div style={{ flex: "0 0 38%" }}>
            <div className="bg-card border border-border px-5 py-4 space-y-4" style={{ borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p style={{ fontSize: "13px", fontWeight: 700 }}>Traffic Source</p>

              {/* SOURCE LIST */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Source List</label>
                <div className="relative mt-1" ref={sourceSearchRef}>
                  <input
                    type="text"
                    value={sourceSearchQuery}
                    onChange={(e) => { setSourceSearchQuery(e.target.value); setSourceSearchOpen(true); }}
                    onFocus={() => setSourceSearchOpen(true)}
                    placeholder="Select source..."
                    className="w-full px-3 py-2 bg-background border border-border text-sm outline-none"
                    style={{ borderRadius: "8px", fontSize: "13px" }}
                  />
                  {sourceSearchOpen && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-full bg-popover border border-border shadow-lg py-1 max-h-52 overflow-y-auto" style={{ borderRadius: "12px" }}>
                      {filteredSources.map((s: any) => (
                        <button key={s.id} onClick={() => selectSourceForEdit(s)}
                          className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-secondary transition-colors" style={{ fontSize: "13px" }}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#0891b2" }} />
                          <span className="flex-1 font-medium text-foreground">{s.name}</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{
                            background: s.category === "OnlyTraffic" ? "hsl(263 70% 50% / 0.15)" : "hsl(192 91% 36% / 0.15)",
                            color: s.category === "OnlyTraffic" ? "hsl(263 70% 50%)" : "hsl(192 91% 36%)" }}>{s.category}</span>
                          <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{getSourceCampaignCount(s.id)}</span>
                        </button>
                      ))}
                      {filteredSources.length === 0 && (
                        <p className="px-3 py-2 text-muted-foreground" style={{ fontSize: "12px" }}>No sources found</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {editSourceId && selectedSource && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Source Name</label>
                    <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border text-sm outline-none mt-1"
                      style={{ borderRadius: "8px", fontSize: "13px" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Category</label>
                    <div className="flex gap-2 mt-1">
                      {(["OnlyTraffic", "Manual"] as const).map(cat => (
                        <button key={cat} onClick={() => setFormCategory(cat)}
                          className="flex-1 px-3 py-1.5 text-xs font-bold transition-colors" style={{ borderRadius: "8px" }}>
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {confirmDelete ? (
                    <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg">
                      <p className="text-destructive font-semibold" style={{ fontSize: "12px" }}>
                        Delete {(selectedSource as any)?.name}? {getSourceCampaignCount(editSourceId)} campaigns will be untagged.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={handleDelete} disabled={saving} className="px-3 py-1 text-xs font-bold text-white disabled:opacity-50 bg-destructive rounded-md">Confirm Delete</button>
                        <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button onClick={handleSaveChanges} disabled={!formName.trim() || saving} className="w-full py-2 text-sm font-bold text-primary-foreground disabled:opacity-50 bg-primary rounded-lg">
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                      <button onClick={() => setConfirmDelete(true)} className="w-full py-2 text-sm font-medium border border-destructive/30 text-destructive rounded-lg">
                        Delete
                      </button>
                    </div>
                  )}

                  <button onClick={clearSourceEdit} className="text-xs text-muted-foreground">Clear selection</button>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-border" />

              {/* ADD NEW SOURCE */}
              <div className="space-y-3">
                <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Add New Source</label>
                <div>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Source name..."
                    className="w-full px-3 py-2 bg-background border border-border text-sm outline-none"
                    style={{ borderRadius: "8px", fontSize: "13px" }} />
                  {newNameWarning && (
                    <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: "11px", color: "#d97706" }}>
                      <AlertTriangle className="h-3 w-3" />
                      <span>Similar to <strong>{newNameWarning}</strong> — did you mean that?</span>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Category</label>
                  <div className="flex gap-2 mt-1">
                    {(["OnlyTraffic", "Manual"] as const).map(cat => (
                      <button key={cat} onClick={() => setNewCategory(cat)}
                        className="flex-1 px-3 py-1.5 text-xs font-bold transition-colors"
                        style={{ borderRadius: "8px" }}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleNewSource} disabled={!newName.trim() || saving} className="w-full py-2 text-sm font-bold text-primary-foreground bg-primary disabled:opacity-50 rounded-lg">
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* TRAFFIC CATEGORY NAVIGATION */}
        <TrafficCategoryNav links={allLinks} allLinks={allLinks} onTagLink={() => queryClient.invalidateQueries({ queryKey: ["tracking_links_ts"] })} />
      </div>
    </DashboardLayout>
  );
}

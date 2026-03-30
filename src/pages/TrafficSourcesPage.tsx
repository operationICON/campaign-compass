import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { TagBadge } from "@/components/TagBadge";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { TrafficSourceDropdown } from "@/components/TrafficSourceDropdown";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { clearTrackingLinkSpend, setTrackingLinkSourceTag } from "@/lib/supabase-helpers";
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
import { format, differenceInDays, subDays } from "date-fns";

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

type ColumnId = "model" | "source" | "category" | "clicks" | "subscribers" | "cvr" | "revenue" | "ltv" | "ltv_per_sub" | "expenses" | "profit" | "profit_per_sub" | "roi" | "status" | "subs_day" | "created" | "notes";
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
  { id: "blended_roi", label: "Blended ROI", defaultOn: true },
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
  { id: "ltv_per_sub", label: "LTV/Sub", defaultOn: true },
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

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  SCALE: { bg: "#dcfce7", text: "#16a34a" }, WATCH: { bg: "#dbeafe", text: "#0891b2" },
  LOW: { bg: "#fef9c3", text: "#854d0e" }, KILL: { bg: "#fee2e2", text: "#dc2626" },
  DEAD: { bg: "#f3f4f6", text: "#6b7280" }, "NO SPEND": { bg: "#f9fafb", text: "#94a3b8" },
  NO_DATA: { bg: "#f9fafb", text: "#94a3b8" },
};

function getAgeDays(createdAt: string) { return differenceInDays(new Date(), new Date(createdAt)); }

// ── KPI Card ──
function KpiCard({ label, value, sub, icon, color }: { label: string; value: React.ReactNode; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white border px-4 py-3" style={{ borderColor: "#e8edf2", borderRadius: "12px", borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <p className="font-mono font-bold" style={{ fontSize: "20px", color: "#1a2332", lineHeight: 1.2 }}>{value}</p>
      {sub && <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>{sub}</p>}
    </div>
  );
}

export default function TrafficSourcesPage() {
  const queryClient = useQueryClient();

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
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
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

  const { data: links = [], isLoading } = useQuery({
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
    const tagged = links.filter((l: any) => l.source_tag && l.source_tag !== "Untagged").length;
    const untagged = links.filter((l: any) => (!l.source_tag || l.source_tag === "Untagged") && (l.clicks > 0 || l.subscribers > 0)).length;
    const totalSpend = links.reduce((s: number, l: any) => s + (Number(l.cost_total) > 0 ? Number(l.cost_total) : 0), 0);
    const totalRevenue = links.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const blendedRoi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0;
    const totalProfit = totalRevenue - totalSpend;
    const totalSubscribers = links.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const avgCpl = totalSubscribers > 0 ? totalSpend / totalSubscribers : 0;
    const totalClicks = links.reduce((s: number, l: any) => s + (l.clicks || 0), 0);
    const avgProfitSub = totalSubscribers > 0 ? totalProfit / totalSubscribers : 0;

    // Active sources: sources with linked tracking_links that had clicks in last 30 days
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const activeSourceIds = new Set<string>();
    links.forEach((l: any) => {
      if (l.traffic_source_id && l.clicks > 0 && l.updated_at >= thirtyDaysAgo) {
        activeSourceIds.add(l.traffic_source_id);
      }
    });
    const activeSources = activeSourceIds.size;

    // Top source by revenue
    const revenueBySource: Record<string, number> = {};
    links.forEach((l: any) => {
      if (l.source_tag && l.source_tag !== "Untagged") {
        revenueBySource[l.source_tag] = (revenueBySource[l.source_tag] || 0) + Number(l.revenue || 0);
      }
    });
    const topSource = Object.entries(revenueBySource).sort((a, b) => b[1] - a[1])[0];

    return { totalSources, tagged, untagged, totalSpend, totalRevenue, blendedRoi, totalProfit, avgCpl, totalSubscribers, activeSources, totalClicks, avgProfitSub, topSource };
  }, [sources, links]);

  // ── Source Analysis calculations ──
  const sourceAnalysis = useMemo(() => {
    // Group links by source
    const bySource: Record<string, any[]> = {};
    links.forEach((l: any) => {
      const tag = l.source_tag || "Untagged";
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
    links.forEach((l: any) => { if (l.source_tag) tags.add(l.source_tag); });
    return [...tags].sort();
  }, [links]);

  const filtered = useMemo(() => {
    let result = links as any[];
    if (accountFilter !== "all") result = result.filter(l => l.account_id === accountFilter);
    if (sourceFilter === "untagged") result = result.filter(l => !l.source_tag || l.source_tag === "Untagged");
    else if (sourceFilter !== "all") result = result.filter(l => l.source_tag === sourceFilter);
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
  }, [links, accountFilter, sourceFilter, categoryFilter, searchQuery, sources]);

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
        case "ltv": aVal = Number(a.ltv || 0); bVal = Number(b.ltv || 0); break;
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
      className="cursor-pointer select-none hover:text-[#1a2332] transition-colors whitespace-nowrap"
      style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", letterSpacing: "0.04em", padding: "10px 12px", textTransform: "uppercase", textAlign: (align || "left") as any }}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === k ? (sortAsc ? <ChevronUp className="h-3 w-3" style={{ color: "#0891b2" }} /> : <ChevronDown className="h-3 w-3" style={{ color: "#0891b2" }} />) : <ChevronDown className="h-3 w-3 opacity-20" />}
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
    blended_roi: { label: "Blended ROI", value: kpis.totalSpend > 0 ? fmtPct(kpis.blendedRoi) : "—", sub: kpis.totalSpend > 0 ? (kpis.blendedRoi > 0 ? "Profitable" : "Negative") : "No spend data", icon: <Percent className="h-4 w-4" />, color: kpis.blendedRoi > 0 ? "#16a34a" : kpis.totalSpend > 0 ? "#dc2626" : "#94a3b8" },
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
      <div style={{ background: "#f0f4f8", minHeight: "100vh" }} className="p-4 space-y-0">
        {/* TOP SECTION — KPIs left + Source Card right */}
        <div className="flex gap-4 items-start mb-4">
          {/* Left 60% — KPI Cards */}
          <div style={{ flex: "0 0 60%" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-xl font-bold" style={{ color: "#1a2332" }}>Traffic Sources</h1>
                <p style={{ color: "#64748b", fontSize: "13px" }}>Manage sources and view tracking link performance by source</p>
              </div>
              <div className="flex items-center gap-2">
                <RefreshButton queryKeys={["tracking_links_ts", "traffic_sources", "manual_notes_ts", "accounts"]} />
                <div className="relative">
                  <button onClick={() => setKpiDropdownOpen(!kpiDropdownOpen)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-medium" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#64748b" }}>
                    <Settings2 className="h-3.5 w-3.5" /> Columns
                  </button>
                  {kpiDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setKpiDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white border shadow-lg py-1.5 max-h-80 overflow-y-auto" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                        <p className="px-3 py-1" style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>KPI Cards</p>
                        {KPI_CARDS.map(k => (
                          <label key={k.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer" style={{ fontSize: "12px" }}>
                            <input type="checkbox" checked={visibleKpis.has(k.id)} onChange={() => toggleKpi(k.id)} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                            <span style={{ color: "#1a2332" }}>{k.label}</span>
                          </label>
                        ))}
                        <div className="border-t mx-2 my-1" style={{ borderColor: "#e8edf2" }} />
                        <p className="px-3 py-1 mt-1" style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Source Analysis</p>
                        {SOURCE_ANALYSIS_CARDS.map(k => (
                          <label key={k.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer" style={{ fontSize: "12px" }}>
                            <input type="checkbox" checked={visibleAnalysis.has(k.id)} onChange={() => toggleAnalysis(k.id)} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                            <span style={{ color: "#1a2332" }}>{k.label}</span>
                          </label>
                        ))}
                        <div className="border-t mx-2 my-1" style={{ borderColor: "#e8edf2" }} />
                        <button onClick={() => { const def = new Set(KPI_CARDS.filter(k => k.defaultOn).map(k => k.id)); setVisibleKpis(def); localStorage.removeItem(KPI_KEY); const aDef = new Set(SOURCE_ANALYSIS_CARDS.filter(k => k.defaultOn).map(k => k.id)); setVisibleAnalysis(aDef); localStorage.removeItem(SOURCE_ANALYSIS_KEY); }} className="w-full px-3 py-1.5 text-left" style={{ fontSize: "11px", color: "#0891b2" }}>
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
            <div className="bg-white border px-5 py-4 space-y-4" style={{ borderColor: "#e8edf2", borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p style={{ fontSize: "13px", fontWeight: 700, color: "#1a2332" }}>Traffic Source</p>

              {/* SOURCE LIST */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Source List</label>
                <div className="relative mt-1" ref={sourceSearchRef}>
                  <input
                    type="text"
                    value={sourceSearchQuery}
                    onChange={(e) => { setSourceSearchQuery(e.target.value); setSourceSearchOpen(true); }}
                    onFocus={() => setSourceSearchOpen(true)}
                    placeholder="Select source..."
                    className="w-full px-3 py-2 bg-white border text-sm outline-none"
                    style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }}
                  />
                  {sourceSearchOpen && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-full bg-white border shadow-lg py-1 max-h-52 overflow-y-auto" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                      {filteredSources.map((s: any) => (
                        <button key={s.id} onClick={() => selectSourceForEdit(s)}
                          className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50 transition-colors" style={{ fontSize: "13px" }}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#0891b2" }} />
                          <span className="flex-1 font-medium" style={{ color: "#1a2332" }}>{s.name}</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold" style={{
                            borderRadius: "4px",
                            background: s.category === "OnlyTraffic" ? "#ede9fe" : "#e0f2fe",
                            color: s.category === "OnlyTraffic" ? "#7c3aed" : "#0891b2",
                          }}>{s.category}</span>
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>{getSourceCampaignCount(s.id)}</span>
                        </button>
                      ))}
                      {filteredSources.length === 0 && (
                        <p className="px-3 py-2" style={{ fontSize: "12px", color: "#94a3b8" }}>No sources found</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {editSourceId && selectedSource && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Source Name</label>
                    <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
                      style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Category</label>
                    <div className="flex gap-2 mt-1">
                      {(["OnlyTraffic", "Manual"] as const).map(cat => (
                        <button key={cat} onClick={() => setFormCategory(cat)}
                          className="flex-1 px-3 py-1.5 text-xs font-bold transition-colors"
                          style={{ borderRadius: "8px", background: formCategory === cat ? "#0891b2" : "#f1f5f9", color: formCategory === cat ? "white" : "#64748b" }}>
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {confirmDelete ? (
                    <div className="px-3 py-2" style={{ background: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca" }}>
                      <p style={{ fontSize: "12px", color: "#dc2626", fontWeight: 600 }}>
                        Delete {(selectedSource as any)?.name}? {getSourceCampaignCount(editSourceId)} campaigns will be untagged.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={handleDelete} disabled={saving} className="px-3 py-1 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#dc2626", borderRadius: "6px" }}>Confirm Delete</button>
                        <button onClick={() => setConfirmDelete(false)} className="text-xs" style={{ color: "#64748b" }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button onClick={handleSaveChanges} disabled={!formName.trim() || saving} className="w-full py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#0891b2", borderRadius: "8px" }}>
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                      <button onClick={() => setConfirmDelete(true)} className="w-full py-2 text-sm font-medium border" style={{ borderColor: "#fecaca", borderRadius: "8px", color: "#dc2626" }}>
                        Delete
                      </button>
                    </div>
                  )}

                  <button onClick={clearSourceEdit} className="text-xs" style={{ color: "#94a3b8" }}>Clear selection</button>
                </div>
              )}

              {/* Divider */}
              <div style={{ borderTop: "1px solid #e8edf2" }} />

              {/* ADD NEW SOURCE */}
              <div className="space-y-3">
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Add New Source</label>
                <div>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Source name..."
                    className="w-full px-3 py-2 bg-white border text-sm outline-none"
                    style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }} />
                  {newNameWarning && (
                    <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: "11px", color: "#d97706" }}>
                      <AlertTriangle className="h-3 w-3" />
                      <span>Similar to <strong>{newNameWarning}</strong> — did you mean that?</span>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Category</label>
                  <div className="flex gap-2 mt-1">
                    {(["OnlyTraffic", "Manual"] as const).map(cat => (
                      <button key={cat} onClick={() => setNewCategory(cat)}
                        className="flex-1 px-3 py-1.5 text-xs font-bold transition-colors"
                        style={{ borderRadius: "8px", background: newCategory === cat ? "#0891b2" : "#f1f5f9", color: newCategory === cat ? "white" : "#64748b" }}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleNewSource} disabled={!newName.trim() || saving} className="w-full py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#0891b2", borderRadius: "8px" }}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SOURCE ANALYSIS SECTION */}
        {(visibleAnalysis.has("subs_day_source") || visibleAnalysis.has("distribution") || visibleAnalysis.has("growth_trend") || visibleAnalysis.has("contribution")) && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            {visibleAnalysis.has("subs_day_source") && (
              <div className="bg-white border px-4 py-3" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Subs/Day per Source</p>
                <div className="space-y-2">
                  {sourceAnalysis.subsPerDay.slice(0, 6).map(s => (
                    <div key={s.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span style={{ fontSize: "12px", color: "#1a2332", fontWeight: 500 }}>{s.name}</span>
                      </div>
                      <span className="font-mono font-bold" style={{ fontSize: "13px", color: "#1a2332" }}>{s.value}</span>
                    </div>
                  ))}
                  {sourceAnalysis.subsPerDay.length === 0 && <p style={{ fontSize: "12px", color: "#94a3b8" }}>No data</p>}
                </div>
              </div>
            )}

            {visibleAnalysis.has("distribution") && (
              <div className="bg-white border px-4 py-3" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Distribution %</p>
                <div className="space-y-2">
                  {sourceAnalysis.distribution.slice(0, 6).map(s => (
                    <div key={s.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                          <span style={{ fontSize: "12px", color: "#1a2332", fontWeight: 500 }}>{s.name}</span>
                        </div>
                        <span className="font-mono font-bold" style={{ fontSize: "12px", color: "#1a2332" }}>{s.pct}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full" style={{ background: "#f1f5f9" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(s.pct, 100)}%`, background: s.color }} />
                      </div>
                    </div>
                  ))}
                  {sourceAnalysis.distribution.length === 0 && <p style={{ fontSize: "12px", color: "#94a3b8" }}>No data</p>}
                </div>
              </div>
            )}

            {visibleAnalysis.has("growth_trend") && (
              <div className="bg-white border px-4 py-3" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>Growth Trend</p>
                <p style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "8px" }}>Last 30d vs previous 30d</p>
                <div className="space-y-2">
                  {sourceAnalysis.growthTrend.slice(0, 6).map(s => (
                    <div key={s.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span style={{ fontSize: "12px", color: "#1a2332", fontWeight: 500 }}>{s.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span style={{ fontSize: "12px", color: s.change > 0 ? "#16a34a" : s.change < 0 ? "#dc2626" : "#94a3b8", fontWeight: 700 }}>
                          {s.change > 0 ? "↑" : s.change < 0 ? "↓" : "–"} {Math.abs(s.change)}%
                        </span>
                      </div>
                    </div>
                  ))}
                  {sourceAnalysis.growthTrend.length === 0 && <p style={{ fontSize: "12px", color: "#94a3b8" }}>No data</p>}
                </div>
              </div>
            )}

            {visibleAnalysis.has("contribution") && (
              <div className="bg-white border px-4 py-3" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                <p style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Source Contribution</p>
                <div className="flex flex-col items-center justify-center" style={{ minHeight: "80px" }}>
                  <p className="font-bold" style={{ fontSize: "22px", color: "#1a2332" }}>{sourceAnalysis.topContrib.name}</p>
                  <p className="font-mono" style={{ fontSize: "28px", color: "#0891b2", fontWeight: 800, lineHeight: 1.1 }}>{sourceAnalysis.topContrib.pct}%</p>
                  <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>of total subscribers</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white border flex items-center gap-3 px-4 py-2.5 flex-wrap" style={{ borderColor: "#e8edf2", borderRadius: "16px 16px 0 0", borderBottom: "none" }}>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "#94a3b8" }} />
            <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-1.5 bg-white border text-sm outline-none" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }} />
          </div>

          <AccountFilterDropdown value={accountFilter} onChange={(v) => { setAccountFilter(v); setPage(1); }} accounts={accountOptions} />

          <div className="relative">
            <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="px-3 py-1.5 border text-sm outline-none appearance-none pr-7 cursor-pointer" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px", background: "white" }}>
              <option value="all">All Sources</option>
              <option value="untagged">Untagged</option>
              {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as any); setPage(1); }}
            className="px-3 py-1.5 border text-sm outline-none appearance-none pr-7 cursor-pointer" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px", background: "white" }}>
            <option value="all">All Categories</option>
            <option value="OnlyTraffic">OnlyTraffic</option>
            <option value="Manual">Manual</option>
          </select>

          {/* Columns button */}
          <div className="relative ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="px-3 py-1.5 border text-sm font-medium flex items-center gap-1.5" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#64748b" }}>
                  <BarChart3 className="h-3.5 w-3.5" /> Columns
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DraggableColumnSelector
                  columns={columnOrder.orderedColumns}
                  isVisible={columnOrder.isVisible}
                  onToggle={columnOrder.toggleColumn}
                  onReorder={columnOrder.reorder}
                  onReset={columnOrder.reset}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <span style={{ fontSize: "12px", color: "#64748b" }}>{filtered.length} campaigns</span>
        </div>

        {/* Campaign list */}
        <div className="bg-white border overflow-hidden" style={{ borderColor: "#e8edf2", borderRadius: "0 0 16px 16px" }}>
          <BulkActionToolbar
            selectedIds={selectedRows}
            onClear={() => setSelectedRows(new Set())}
            totalFiltered={filtered.length}
            onSelectAll={() => setSelectedRows(new Set(filtered.map((l: any) => l.id)))}
            actions={["assign_source", "remove_source", "delete"]}
            onComplete={invalidateAll}
          />

          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e8edf2" }}>
                  <th style={{ padding: "10px 12px", width: "36px" }}>
                    <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                  </th>
                  <SortHeader label="Tracking Link" k="campaign_name" />
                  {columnOrder.visibleOrderedColumns.map(c => {
                    const rightAligned = ["clicks","subscribers","cvr","revenue","ltv","ltv_per_sub","expenses","profit","profit_per_sub","roi","subs_day"].includes(c.id);
                    const sortMap: Record<string, SortKey> = { clicks: "clicks", subscribers: "subscribers", cvr: "cvr", revenue: "revenue", ltv: "ltv", expenses: "cost_total", profit: "profit", roi: "roi", source: "source_tag", created: "created_at" };
                    const sk = sortMap[c.id];
                    if (sk) return <SortHeader key={c.id} label={c.label} k={sk} align={rightAligned ? "right" : undefined} />;
                    return <th key={c.id} style={{ padding: "10px 12px", fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: rightAligned ? "right" : undefined }}>{c.label}</th>;
                  })}
                  <th style={{ width: "28px" }} />
                </tr>
              </thead>
              <tbody>
                {paginated.map((link: any) => {
                  const username = link.accounts?.username || link.accounts?.display_name || "—";
                  const cat = getCategory(link);
                  const status = link.status || "NO_DATA";
                  const st = STATUS_STYLES[status] || STATUS_STYLES.NO_DATA;
                  const ltv = Number(link.ltv || 0);
                  const ltvPerSub = Number(link.ltv_per_sub || 0);
                  const costTotal = Number(link.cost_total || 0);
                  const profit = Number(link.profit || 0);
                  const roi = Number(link.roi || 0);
                  const subs = link.subscribers || 0;
                  const profitPerSub = subs > 0 ? profit / subs : 0;
                  const ageDays = getAgeDays(link.created_at);
                  const subsDay = ageDays > 0 ? Math.max(0, subs / ageDays) : 0;
                  const isExpanded = expandedRow === link.id;

                  return (
                    <React.Fragment key={link.id}>
                    <tr onClick={() => handleRowClick(link)} className="transition-colors cursor-pointer" style={{ borderBottom: "1px solid #e8edf2", height: "44px", background: isExpanded ? "rgba(8,145,178,0.06)" : "#fafbfd" }}
                      onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "#f1f5f9"; }} onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "#fafbfd"; }}>
                      <td style={{ padding: "8px 12px" }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                      </td>
                      <td style={{ padding: "8px 12px", maxWidth: "220px" }}>
                        <p style={{ fontSize: "12px", fontWeight: 700, color: "#1a2332" }} className="truncate">{link.campaign_name || "—"}</p>
                        <p style={{ fontSize: "10px", color: "#94a3b8" }} className="truncate">{link.url}</p>
                      </td>
                      {columnOrder.visibleOrderedColumns.map(c => {
                        switch (c.id) {
                          case "model": return <td key={c.id} style={{ padding: "8px 12px", fontSize: "11px", color: "#64748b" }}>@{username}</td>;
                          case "source": return <td key={c.id} style={{ padding: "8px 12px" }}><TagBadge tagName={link.source_tag} size="sm" /></td>;
                          case "category": return (
                            <td key={c.id} style={{ padding: "8px 12px" }}>
                              {cat ? (
                                <span className="inline-block px-2 py-0.5" style={{ fontSize: "10px", fontWeight: 600, borderRadius: "4px", background: cat === "OnlyTraffic" ? "#ede9fe" : "#e0f2fe", color: cat === "OnlyTraffic" ? "#7c3aed" : "#0891b2" }}>{cat}</span>
                              ) : (
                                <span style={{ fontSize: "10px", color: "#94a3b8" }}>—</span>
                              )}
                            </td>
                          );
                          case "clicks": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#1a2332" }}>{fmtN(link.clicks || 0)}</td>;
                          case "subscribers": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#1a2332" }}>{fmtN(subs)}</td>;
                          case "cvr": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: Number(link.cvr || 0) > 15 ? "#0891b2" : "#1a2332" }}>{Number(link.cvr || 0) > 0 ? fmtPct(Number(link.cvr)) : "—"}</td>;
                          case "revenue": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#1a2332" }}>{fmtC(Number(link.revenue || 0))}</td>;
                          case "ltv": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: ltv > 0 ? "#0891b2" : "#94a3b8" }}>{ltv > 0 ? fmtC(ltv) : "—"}</td>;
                          case "ltv_per_sub": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: ltvPerSub > 0 ? "#0891b2" : "#94a3b8" }}>{ltvPerSub > 0 ? fmtC(ltvPerSub) : "—"}</td>;
                          case "expenses": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: costTotal > 0 ? "#dc2626" : "#94a3b8" }}>{costTotal > 0 ? fmtC(costTotal) : "—"}</td>;
                          case "profit": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: profit > 0 ? "#16a34a" : profit < 0 ? "#dc2626" : "#94a3b8" }}>{costTotal > 0 ? fmtC(profit) : "—"}</td>;
                          case "profit_per_sub": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: profitPerSub > 0 ? "#16a34a" : profitPerSub < 0 ? "#dc2626" : "#94a3b8" }}>{costTotal > 0 && subs > 0 ? fmtC(profitPerSub) : "—"}</td>;
                          case "roi": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: roi > 0 ? "#16a34a" : roi < 0 ? "#dc2626" : "#94a3b8" }}>{costTotal > 0 ? fmtPct(roi) : "—"}</td>;
                          case "status": return (
                            <td key={c.id} style={{ padding: "8px 12px" }}>
                              <span className="inline-block px-2 py-0.5" style={{ fontSize: "10px", fontWeight: 700, borderRadius: "4px", background: st.bg, color: st.text }}>
                                {status === "NO_DATA" ? "NO SPEND" : status}
                              </span>
                            </td>
                          );
                          case "subs_day": return <td key={c.id} className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#64748b" }}>{ageDays > 1 ? `${subsDay.toFixed(0)}/day` : "—"}</td>;
                          case "created": {
                            const pill = ageDays <= 30 ? { label: `${ageDays}d New`, bg: "#dcfce7", text: "#16a34a" }
                              : ageDays <= 90 ? { label: `${ageDays}d Active`, bg: "#dbeafe", text: "#2563eb" }
                              : ageDays <= 180 ? { label: `${ageDays}d Mature`, bg: "#fef9c3", text: "#854d0e" }
                              : { label: `${ageDays}d Old`, bg: "#f3f4f6", text: "#6b7280" };
                            return (
                              <td key={c.id} style={{ padding: "8px 12px" }}>
                                <p className="text-foreground" style={{ fontSize: "12px" }}>{format(new Date(link.created_at), "MMM d, yyyy")}</p>
                                <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold mt-0.5" style={{ backgroundColor: pill.bg, color: pill.text }}>{pill.label}</span>
                              </td>
                            );
                          }
                          case "notes": {
                            const n = notes.find((nt: any) => nt.campaign_id === link.campaign_id && nt.account_id === link.account_id);
                            return <td key={c.id} style={{ padding: "8px 12px", fontSize: "11px", color: n?.note ? "#1a2332" : "#94a3b8", maxWidth: "120px" }} className="truncate">{n?.note || "—"}</td>;
                          }
                          default: return null;
                        }
                      })}
                      <td className="w-7 text-center" style={{ padding: "8px 4px" }}>
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} style={{ color: isExpanded ? "#0891b2" : "#94a3b8" }} />
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {isExpanded && (() => {
                      const el = link;
                      const subsEl = el.subscribers || 0;
                      const clicksEl = el.clicks || 0;
                      const revEl = Number(el.ltv || 0) > 0 ? Number(el.ltv) : Number(el.revenue || 0);
                      const hasCostEl = Number(el.cost_total || 0) > 0;
                      const numVal = parseFloat(spendValue);
                      const validVal = !isNaN(numVal) && numVal > 0;
                      let previewCost = 0, previewProfit = 0, previewRoi = 0;
                      if (validVal) {
                        if (spendType === "CPL") previewCost = subsEl * numVal;
                        else if (spendType === "CPC") previewCost = clicksEl * numVal;
                        else previewCost = numVal;
                        previewProfit = revEl - previewCost;
                        previewRoi = previewCost > 0 ? (previewProfit / previewCost) * 100 : 0;
                      }
                      const saveSpendInline = async () => {
                        if (!validVal) return;
                        try {
                          const cvr = clicksEl > 0 ? subsEl / clicksEl : 0;
                          const cpcReal = spendType === "CPC" ? numVal : (cvr > 0 ? (spendType === "CPL" ? numVal * cvr : (clicksEl > 0 ? previewCost / clicksEl : 0)) : 0);
                          const cplReal = spendType === "CPL" ? numVal : (subsEl > 0 ? previewCost / subsEl : 0);
                          const arpu = subsEl > 0 ? revEl / subsEl : 0;
                          const newStatus = previewRoi > 150 ? "SCALE" : previewRoi >= 50 ? "WATCH" : previewRoi >= 0 ? "LOW" : "KILL";
                          await supabase.from("tracking_links").update({
                            cost_type: spendType, cost_value: numVal, cost_total: previewCost,
                            cvr, cpc_real: cpcReal, cpl_real: cplReal, arpu,
                            profit: previewProfit, roi: previewRoi, status: newStatus,
                          } as any).eq("id", el.id);
                          const { data: existing } = await supabase.from("ad_spend").select("id").eq("tracking_link_id", el.id).maybeSingle();
                          if (existing) {
                            await supabase.from("ad_spend").update({
                              spend_type: spendType, amount: previewCost,
                              date: new Date().toISOString().split("T")[0],
                            } as any).eq("id", existing.id);
                          } else {
                            await supabase.from("ad_spend").insert({
                              campaign_id: el.campaign_id, tracking_link_id: el.id,
                              traffic_source: el.source || "direct", spend_type: spendType,
                              amount: previewCost, date: new Date().toISOString().split("T")[0],
                              notes: `${spendType} @ $${numVal.toFixed(2)}`, account_id: el.account_id,
                            });
                          }
                          invalidateAll();
                          toast.success("Spend saved");
                        } catch { toast.error("Save failed"); }
                      };
                      const clearSpendInline = async () => {
                        try {
                          await clearTrackingLinkSpend(el.id, el.campaign_id);
                          setSpendValue("");
                          setSpendType("CPL");
                          invalidateAll();
                          toast.success("Spend cleared");
                        } catch { toast.error("Clear failed"); }
                      };
                      const saveNoteInline = async () => {
                        if (!noteText.trim()) return;
                        setNoteLoading(true);
                        try {
                          const { data: existingNote } = await supabase.from("manual_notes")
                            .select("id").eq("campaign_id", el.campaign_id).eq("account_id", el.account_id).maybeSingle();
                          if (existingNote) {
                            await supabase.from("manual_notes").update({
                              note: noteText.trim(), content: noteText.trim(), updated_at: new Date().toISOString(),
                            } as any).eq("id", existingNote.id);
                          } else {
                            await supabase.from("manual_notes").insert({
                              campaign_id: el.campaign_id, campaign_name: el.campaign_name,
                              account_id: el.account_id, content: noteText.trim(), note: noteText.trim(),
                            });
                          }
                          invalidateAll();
                          toast.success("Note saved");
                        } catch { toast.error("Save failed"); }
                        finally { setNoteLoading(false); }
                      };
                      const clearNoteInline = async () => {
                        setNoteLoading(true);
                        try {
                          await supabase.from("manual_notes").delete()
                            .eq("campaign_id", el.campaign_id).eq("account_id", el.account_id);
                          setNoteText("");
                          invalidateAll();
                          toast.success("Note cleared");
                        } catch { toast.error("Clear failed"); }
                        finally { setNoteLoading(false); }
                      };
                      const ltvVal = Number(el.ltv || 0);
                      const ltvSubVal = Number(el.ltv_per_sub || 0);
                      const spenderRateVal = Number(el.spender_rate || 0);
                      const subsDayVal = ageDays > 0 ? Math.max(0, subs / ageDays) : 0;
                      const subsDayDisplay = subsDayVal > 0 ? { v: `${Math.round(subsDayVal)}/day`, c: "#0891b2" } : { v: "0/day", c: "#94a3b8" };
                      const currentSource = sources.find((s: any) => s.id === el.traffic_source_id || s.name === el.source_tag);

                      return (
                        <tr>
                          <td colSpan={99} className="p-0">
                            <div style={{ background: "#e8eef4", borderLeft: "3px solid #0891b2", padding: "14px 20px" }}>
                              <div className="flex gap-5">
                                {/* Performance */}
                                <div style={{ width: "280px", flexShrink: 0 }}>
                                  <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: "10px", fontWeight: 600 }}>Performance</p>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0px" }}>
                                    {[
                                      { l: "Clicks", v: clicksEl.toLocaleString(), c: "#1a2332" },
                                      { l: "Revenue", v: fmtC(Number(el.revenue || 0)), c: "#1a2332" },
                                      { l: "Subs", v: subsEl.toLocaleString(), c: "#1a2332" },
                                      { l: "LTV", v: ltvVal > 0 ? fmtC(ltvVal) : (el.fans_last_synced_at ? "$0.00" : "—"), c: ltvVal > 0 ? "#0891b2" : "#94a3b8" },
                                      { l: "CVR", v: clicksEl > 100 ? `${((subsEl / clicksEl) * 100).toFixed(1)}%` : "—", c: clicksEl > 100 && (subsEl / clicksEl) > 0.15 ? "#0891b2" : "#94a3b8" },
                                      { l: "LTV/Sub", v: ltvSubVal > 0 ? fmtC(ltvSubVal) : "—", c: ltvSubVal > 0 ? "#1a2332" : "#94a3b8" },
                                      { l: "Subs/Day", v: subsDayDisplay.v, c: subsDayDisplay.c },
                                      { l: "Spender%", v: spenderRateVal > 0 ? `${spenderRateVal.toFixed(1)}%` : "—", c: spenderRateVal > 10 ? "#16a34a" : spenderRateVal >= 5 ? "#d97706" : spenderRateVal > 0 ? "#dc2626" : "#94a3b8" },
                                    ].map(r => (
                                      <div key={r.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "26px", padding: "0 8px" }}>
                                        <span style={{ fontSize: "13px", color: "#1a2332", fontWeight: 700 }}>{r.l}</span>
                                        <span style={{ fontSize: "12px", fontWeight: 500, color: r.c, fontFamily: "monospace" }}>{r.v}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex-1 grid grid-cols-3 gap-5">
                                {/* Spend */}
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", fontWeight: 600 }}>Spend</p>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Info className="h-3 w-3 cursor-help" style={{ color: "#94a3b8" }} />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                                          <p><strong>CPL</strong> = I pay per subscriber gained</p>
                                          <p><strong>CPC</strong> = I pay per click ⚠️</p>
                                          <p><strong>FIXED</strong> = Fixed amount (pin, promo, deal)</p>
                                        </TooltipContent>
                                      </Tooltip>
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: hasCostEl ? "#0891b2" : "#d97706" }} />
                                      <span style={{ fontSize: "10px", color: "#94a3b8" }}>{hasCostEl ? "Set" : "Not set"}</span>
                                    </div>
                                    <div className="flex gap-1 mb-2">
                                      {(["CPL", "CPC", "FIXED"] as const).map(t => (
                                        <button key={t} onClick={(e) => { e.stopPropagation(); setSpendType(t); }}
                                          className="px-2 py-1 text-[10px] font-bold transition-colors"
                                          style={{ borderRadius: "4px", background: spendType === t ? "#0891b2" : "#f1f5f9", color: spendType === t ? "white" : "#64748b" }}>{t}</button>
                                      ))}
                                    </div>
                                    {/* CPC warning */}
                                    {spendType === "CPC" && (
                                      <div className="flex items-start gap-1.5 mb-2 px-2 py-1.5" style={{ background: "#fffbeb", borderRadius: "6px", border: "1px solid #fde68a" }}>
                                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" style={{ color: "#d97706" }} />
                                        <span style={{ fontSize: "10px", color: "#92400e", lineHeight: "1.3" }}>Per Click may be unreliable — bot traffic can inflate click counts</span>
                                      </div>
                                    )}
                                    <input type="number" step="0.01" value={spendValue} onChange={(e) => setSpendValue(e.target.value)}
                                      placeholder="Cost value..." onClick={(e) => e.stopPropagation()}
                                      className="w-full px-2.5 py-1.5 bg-white border text-sm font-mono outline-none mb-2"
                                      style={{ borderColor: "#e8edf2", borderRadius: "6px", color: "#1a2332", fontSize: "12px" }} />
                                    {validVal && (
                                      <div className="text-[11px] font-mono mb-2 space-y-0.5" style={{ color: "#64748b", background: "#f8fafc", padding: "6px 8px", borderRadius: "6px" }}>
                                        <div className="flex justify-between"><span>Cost/Sub</span><span style={{ color: "#1a2332" }}>{subsEl > 0 ? fmtC(previewCost / subsEl) : "—"}</span></div>
                                        <div className="flex justify-between"><span>Total Spend</span><span style={{ color: "#dc2626", fontWeight: 600 }}>{fmtC(previewCost)}</span></div>
                                        <div className="flex justify-between"><span>Profit</span><span style={{ color: previewProfit >= 0 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{fmtC(previewProfit)}</span></div>
                                        <div className="flex justify-between"><span>ROI</span><span style={{ color: previewRoi >= 0 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{fmtPct(previewRoi)}</span></div>
                                        <div className="flex justify-between"><span>Profit/Sub</span><span style={{ color: previewProfit >= 0 ? "#16a34a" : "#dc2626" }}>{subsEl > 0 ? fmtC(previewProfit / subsEl) : "—"}</span></div>
                                      </div>
                                    )}
                                    <div className="flex gap-1.5">
                                      <button onClick={(e) => { e.stopPropagation(); saveSpendInline(); }} disabled={!validVal}
                                        className="flex-1 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                        style={{ borderRadius: "6px", background: "#0891b2", color: "white" }}>Save</button>
                                      <button onClick={(e) => { e.stopPropagation(); clearSpendInline(); }}
                                        className="px-2.5 py-1.5 text-[11px] font-medium border"
                                        style={{ borderRadius: "6px", borderColor: "#e8edf2", color: "#64748b" }}>Clear</button>
                                    </div>
                                  </div>
                                  {/* Source */}
                                  <div>
                                    <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: "6px", fontWeight: 600 }}>Source</p>
                                    <div onClick={(e) => e.stopPropagation()}>
                                      {/* Current source display */}
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: currentSource?.color || "#94a3b8" }} />
                                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#1a2332" }}>{currentSource?.name || "Untagged"}</span>
                                      </div>
                                      <TrafficSourceDropdown
                                        value={el.source_tag}
                                        trafficSourceId={el.traffic_source_id}
                                        onSave={async (tag, tsId) => {
                                          try {
                                            await supabase.from("tracking_links").update({
                                              source_tag: tag, traffic_source_id: tsId, manually_tagged: true,
                                            } as any).eq("id", el.id);
                                            invalidateAll();
                                            toast.success("Source saved ✓", { duration: 1500 });
                                          } catch { toast.error("Save failed"); }
                                        }}
                                      />
                                      <div className="flex gap-1.5 mt-2">
                                        <button onClick={(e) => { e.stopPropagation(); const inp = (e.currentTarget.parentElement?.parentElement?.querySelector('input[type="text"]') as HTMLInputElement); if (inp) { inp.focus(); inp.click(); } }}
                                          className="px-2.5 py-1.5 text-[11px] font-medium border"
                                          style={{ borderRadius: "6px", borderColor: "#e8edf2", color: "#1a2332", background: "white" }}>✏ Edit</button>
                                        {el.source_tag && (
                                          <button onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                              await supabase.from("tracking_links").update({ source_tag: null, traffic_source_id: null, manually_tagged: false } as any).eq("id", el.id);
                                              invalidateAll();
                                              toast.success("Source removed");
                                            } catch { toast.error("Failed"); }
                                          }}
                                            className="px-2.5 py-1.5 text-[11px] font-medium border"
                                            style={{ borderRadius: "6px", borderColor: "#fecaca", color: "#dc2626" }}>🗑 Delete</button>
                                        )}
                                        <button onClick={async (e) => {
                                          e.stopPropagation();
                                          // Save triggers via the dropdown's onSave, this is a visual confirmation
                                          toast.info("Use the dropdown to select a source — it saves automatically", { duration: 2000 });
                                        }}
                                          className="px-2.5 py-1.5 text-[11px] font-semibold"
                                          style={{ borderRadius: "6px", background: "#0891b2", color: "white" }}>Save</button>
                                      </div>
                                    </div>
                                  </div>
                                  {/* Notes */}
                                  <div>
                                    <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: "6px", fontWeight: 600 }}>Notes</p>
                                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
                                      placeholder="Add a note..." onClick={(e) => e.stopPropagation()}
                                      className="w-full h-16 px-2.5 py-1.5 bg-white border text-[11px] outline-none resize-none mb-1.5"
                                      style={{ borderColor: "#e8edf2", borderRadius: "6px", color: "#1a2332" }} />
                                    <div className="flex gap-1.5">
                                      <button onClick={(e) => { e.stopPropagation(); saveNoteInline(); }} disabled={noteLoading}
                                        className="flex-1 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                        style={{ borderRadius: "6px", background: "#0891b2", color: "white" }}>{noteLoading ? "..." : "Save note"}</button>
                                      <button onClick={(e) => { e.stopPropagation(); setNoteText(""); }} disabled={noteLoading}
                                        className="px-2.5 py-1.5 text-[11px] font-medium border disabled:opacity-50"
                                        style={{ borderRadius: "6px", borderColor: "#e8edf2", color: "#64748b" }}>Clear</button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    </React.Fragment>
                  );
                })}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={20} className="text-center py-10" style={{ color: "#94a3b8", fontSize: "13px" }}>
                      {isLoading ? "Loading campaigns..." : "No campaigns found"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid #e8edf2" }}>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              Showing {showFrom}-{showTo} of {sorted.length}
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: "12px", color: "#64748b" }}>Rows:</span>
                {[10, 25, 50, 100].map(n => (
                  <button key={n} onClick={() => { setPerPage(n); setPage(1); }}
                    className="px-2 py-0.5 text-xs font-medium transition-colors"
                    style={{ borderRadius: "4px", background: perPage === n ? "#0891b2" : "transparent", color: perPage === n ? "white" : "#64748b" }}>
                    {n}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-0.5">
                <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" style={{ color: "#64748b" }} />
                </button>
                {pageNumbers.map((p, i) =>
                  p === "..." ? (
                    <span key={`e${i}`} className="px-1" style={{ fontSize: "12px", color: "#94a3b8" }}>…</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p as number)}
                      className="w-7 h-7 flex items-center justify-center text-xs font-medium transition-colors"
                      style={{ borderRadius: "6px", background: safePage === p ? "#0891b2" : "transparent", color: safePage === p ? "white" : "#64748b" }}>
                      {p}
                    </button>
                  )
                )}
                <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" style={{ color: "#64748b" }} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

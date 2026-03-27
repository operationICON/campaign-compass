import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { TagBadge } from "@/components/TagBadge";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, Tag,
  AlertTriangle, Layers, DollarSign, TrendingUp, BarChart3,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLUMNS_KEY = "ct_traffic_sources_columns";
const COLOR_CYCLE = ["#0891b2", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#ec4899", "#f97316", "#64748b"];

type ColumnId = "model" | "source" | "category" | "clicks" | "subscribers" | "revenue" | "status" | "created";
type SortKey = "campaign_name" | "source_tag" | "clicks" | "subscribers" | "revenue" | "created_at";

const ALL_COLUMNS: { id: ColumnId; label: string; defaultOn: boolean }[] = [
  { id: "model", label: "Model", defaultOn: true },
  { id: "source", label: "Source", defaultOn: true },
  { id: "category", label: "Category", defaultOn: true },
  { id: "clicks", label: "Clicks", defaultOn: true },
  { id: "subscribers", label: "Subs", defaultOn: true },
  { id: "revenue", label: "Revenue", defaultOn: true },
  { id: "status", label: "Status", defaultOn: true },
  { id: "created", label: "Created", defaultOn: true },
];

function getDefaultColumns(): Record<ColumnId, boolean> {
  const d: Record<string, boolean> = {};
  ALL_COLUMNS.forEach(c => { d[c.id] = c.defaultOn; });
  return d as Record<ColumnId, boolean>;
}
function loadColumns(): Record<ColumnId, boolean> {
  try { const s = localStorage.getItem(COLUMNS_KEY); if (s) return { ...getDefaultColumns(), ...JSON.parse(s) }; } catch {}
  return getDefaultColumns();
}

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

export default function TrafficSourcesPage() {
  const queryClient = useQueryClient();

  // Column visibility
  const [visibleCols, setVisibleCols] = useState<Record<ColumnId, boolean>>(loadColumns);
  const [colDropdownOpen, setColDropdownOpen] = useState(false);
  const toggleColumn = (id: ColumnId) => {
    setVisibleCols(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const col = (id: ColumnId) => visibleCols[id];

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "Direct" | "OnlyTraffic">("all");

  // Sort/page
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 25;

  // Selection
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // Source card state
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<"Direct" | "OnlyTraffic">("Direct");
  const [formKeywords, setFormKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [bulkAssignMode, setBulkAssignMode] = useState(false);

  // Data
  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase.from("traffic_sources").select("*").order("name");
      return data || [];
    },
  });

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["tracking_links_ts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tracking_links")
        .select("*, accounts(display_name, username, avatar_thumb_url)")
        .is("deleted_at", null)
        .order("revenue", { ascending: false });
      return data || [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").order("display_name");
      return data || [];
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links_ts"] });
    queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
  };

  // KPI calculations
  const kpis = useMemo(() => {
    const totalSources = sources.length;
    const tagged = links.filter((l: any) => l.traffic_source_id).length;
    const untagged = links.filter((l: any) => !l.traffic_source_id && (l.clicks > 0 || l.subscribers > 0)).length;
    const taggedLinks = links.filter((l: any) => l.traffic_source_id);
    const totalSpend = taggedLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const totalRevenue = taggedLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    return { totalSources, tagged, untagged, totalSpend, totalRevenue };
  }, [sources, links]);

  // Source card: find similar name warning
  const similarWarning = useMemo(() => {
    if (!formName.trim()) return null;
    const q = formName.trim().toLowerCase();
    for (const s of sources) {
      if ((s as any).id === editSourceId) continue;
      if ((s as any).name.toLowerCase() === q) return (s as any).name;
      if (levenshtein((s as any).name.toLowerCase(), q) <= 2) return (s as any).name;
    }
    return null;
  }, [formName, sources, editSourceId]);

  const selectedSource = useMemo(() => sources.find((s: any) => s.id === editSourceId), [sources, editSourceId]);

  const selectSourceForEdit = (source: any) => {
    setEditSourceId(source.id);
    setFormName(source.name);
    setFormCategory(source.category || "Direct");
    setFormKeywords((source.keywords || []).join(", "));
    setConfirmDelete(false);
    setRenaming(false);
    setBulkAssignMode(false);
  };

  const clearSourceForm = () => {
    setEditSourceId(null);
    setFormName("");
    setFormCategory("Direct");
    setFormKeywords("");
    setConfirmDelete(false);
    setRenaming(false);
    setBulkAssignMode(false);
  };

  // Next color from cycle
  const nextColor = useMemo(() => {
    const usedColors = sources.map((s: any) => s.color);
    for (const c of COLOR_CYCLE) {
      if (!usedColors.includes(c)) return c;
    }
    return COLOR_CYCLE[sources.length % COLOR_CYCLE.length];
  }, [sources]);

  const handleNewSource = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const keywords = formKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      const { error } = await supabase.from("traffic_sources").insert({
        name: formName.trim(),
        category: formCategory,
        keywords,
        color: nextColor,
      });
      if (error) throw error;
      toast.success("Source created");
      invalidateAll();
      clearSourceForm();
    } catch (err: any) {
      toast.error(err.message || "Failed to create source");
    } finally { setSaving(false); }
  };

  const handleSaveChanges = async () => {
    if (!editSourceId || !formName.trim()) return;
    setSaving(true);
    try {
      const keywords = formKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      const { error } = await supabase.from("traffic_sources").update({
        name: formName.trim(),
        category: formCategory,
        keywords,
      } as any).eq("id", editSourceId);
      if (error) throw error;
      // Also update source_tag on tracking_links if name changed
      const oldName = (selectedSource as any)?.name;
      if (oldName && oldName !== formName.trim()) {
        await supabase.from("tracking_links").update({ source_tag: formName.trim() } as any).eq("source_tag", oldName);
      }
      toast.success("Source updated");
      invalidateAll();
    } catch (err: any) {
      toast.error("Failed to save changes");
    } finally { setSaving(false); }
  };

  const handleRename = async () => {
    if (!editSourceId || !renameName.trim()) return;
    setSaving(true);
    try {
      const oldName = (selectedSource as any)?.name;
      const { error } = await supabase.from("traffic_sources").update({ name: renameName.trim() } as any).eq("id", editSourceId);
      if (error) throw error;
      if (oldName) {
        await supabase.from("tracking_links").update({ source_tag: renameName.trim() } as any).eq("source_tag", oldName);
      }
      toast.success("Source renamed");
      setRenaming(false);
      setFormName(renameName.trim());
      invalidateAll();
    } catch { toast.error("Failed to rename"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!editSourceId) return;
    setSaving(true);
    try {
      const campaignCount = links.filter((l: any) => l.traffic_source_id === editSourceId).length;
      // Untag campaigns
      await supabase.from("tracking_links").update({ source_tag: null, traffic_source_id: null } as any).eq("traffic_source_id", editSourceId);
      // Delete source
      const { error } = await supabase.from("traffic_sources").delete().eq("id", editSourceId);
      if (error) throw error;
      toast.success(`Source deleted — ${campaignCount} campaigns untagged`);
      clearSourceForm();
      invalidateAll();
    } catch { toast.error("Failed to delete source"); }
    finally { setSaving(false); }
  };

  const handleBulkAssignFromCard = async () => {
    if (!editSourceId || selectedRows.size === 0) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tracking_links")
        .update({
          source_tag: (selectedSource as any)?.name,
          traffic_source_id: editSourceId,
          manually_tagged: true,
        } as any)
        .in("id", Array.from(selectedRows));
      if (error) throw error;
      toast.success(`Source assigned to ${selectedRows.size} campaigns`);
      setSelectedRows(new Set());
      setBulkAssignMode(false);
      invalidateAll();
    } catch { toast.error("Failed to assign"); }
    finally { setSaving(false); }
  };

  // Filtering
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
    if (sourceFilter === "untagged") result = result.filter(l => !l.source_tag);
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
        case "created_at": aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
        default: aVal = 0; bVal = 0;
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
  }, [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * perPage, safePage * perPage);

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

  // Get source category for a link
  const getCategory = (link: any) => {
    if (!link.traffic_source_id) return null;
    const src = sources.find((s: any) => s.id === link.traffic_source_id);
    return src ? (src as any).category : null;
  };

  return (
    <DashboardLayout>
      <div style={{ background: "#f0f4f8", minHeight: "100vh" }} className="p-4 space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: "#1a2332" }}>Traffic Sources</h1>
          <p style={{ color: "#64748b", fontSize: "13px" }}>Manage sources and view campaign performance by source</p>
        </div>

        {/* ═══ TOP SECTION — KPIs + Source Card ═══ */}
        <div className="flex gap-4">
          {/* Left: KPI cards */}
          <div style={{ width: "60%" }} className="flex gap-3">
            {[
              { label: "Total Sources", value: String(kpis.totalSources), icon: <Layers className="h-4 w-4" style={{ color: "#0891b2" }} /> },
              { label: "Tagged", value: kpis.tagged.toLocaleString(), icon: <Tag className="h-4 w-4" style={{ color: "#16a34a" }} /> },
              { label: "Untagged", value: kpis.untagged.toLocaleString(), icon: <AlertTriangle className="h-4 w-4" style={{ color: "#d97706" }} /> },
              { label: "Total Spend", value: fmtC(kpis.totalSpend), icon: <DollarSign className="h-4 w-4" style={{ color: "#dc2626" }} /> },
              { label: "Total Revenue", value: fmtC(kpis.totalRevenue), icon: <TrendingUp className="h-4 w-4" style={{ color: "#0891b2" }} /> },
            ].map((kpi, i) => (
              <div key={i} className="flex-1 bg-white border flex flex-col justify-center px-4 py-3" style={{ borderColor: "#e8edf2", borderRadius: "16px" }}>
                <div className="flex items-center gap-1.5 mb-1">
                  {kpi.icon}
                  <span style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.04em" }}>{kpi.label}</span>
                </div>
                <span style={{ fontSize: "20px", fontWeight: 700, color: "#1a2332" }}>{kpi.value}</span>
              </div>
            ))}
          </div>

          {/* Right: Source Card */}
          <div style={{ width: "40%" }} className="bg-white border px-5 py-4 space-y-3" style2="" >
            <style>{`.source-card { border-color: #e8edf2; border-radius: 16px; border-width: 1px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }`}</style>
            <div className="bg-white border px-5 py-4 space-y-3" style={{ borderColor: "#e8edf2", borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", width: "100%" }}>
              <p style={{ fontSize: "13px", fontWeight: 700, color: "#1a2332" }}>Traffic Source</p>

              {/* Source selector dropdown */}
              <select
                value={editSourceId || ""}
                onChange={(e) => {
                  if (e.target.value === "") clearSourceForm();
                  else {
                    const src = sources.find((s: any) => s.id === e.target.value);
                    if (src) selectSourceForEdit(src);
                  }
                }}
                className="w-full px-3 py-2 bg-white border text-sm outline-none"
                style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }}
              >
                <option value="">Select source to edit...</option>
                {sources.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.category} ({links.filter((l: any) => l.traffic_source_id === s.id).length} campaigns)
                  </option>
                ))}
              </select>

              {/* Bulk assign message */}
              {bulkAssignMode && selectedRows.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2" style={{ background: "#f0fdfa", borderRadius: "8px", border: "1px solid #99f6e4" }}>
                  <Tag className="h-3.5 w-3.5" style={{ color: "#0891b2" }} />
                  <span style={{ fontSize: "12px", color: "#0891b2", fontWeight: 600 }}>Assign to {selectedRows.size} campaigns</span>
                </div>
              )}

              {/* Name */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Source name..."
                  className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
                  style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }}
                />
                {similarWarning && (
                  <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: "11px", color: "#d97706" }}>
                    <AlertTriangle className="h-3 w-3" />
                    <span>Similar to <strong>{similarWarning}</strong> — did you mean that?</span>
                  </div>
                )}
              </div>

              {/* Category toggle */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Category</label>
                <div className="flex gap-2 mt-1">
                  {(["Direct", "OnlyTraffic"] as const).map(cat => (
                    <button key={cat} onClick={() => setFormCategory(cat)}
                      className="flex-1 px-3 py-1.5 text-xs font-bold transition-colors"
                      style={{
                        borderRadius: "8px",
                        background: formCategory === cat ? "#0891b2" : "#f1f5f9",
                        color: formCategory === cat ? "white" : "#64748b",
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keywords */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Keywords</label>
                <input
                  type="text"
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                  placeholder="onlyfinder, finder, findeross"
                  className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
                  style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }}
                />
              </div>

              {/* Rename inline */}
              {renaming && (
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "12px", color: "#1a2332" }}>New Source:</span>
                  <input type="text" value={renameName} onChange={(e) => setRenameName(e.target.value)} autoFocus
                    className="flex-1 px-2 py-1 border text-sm outline-none" style={{ borderColor: "#e8edf2", borderRadius: "6px", fontSize: "13px" }} />
                  <button onClick={handleRename} disabled={saving || !renameName.trim()} className="px-3 py-1 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#0891b2", borderRadius: "6px" }}>
                    Confirm
                  </button>
                  <button onClick={() => setRenaming(false)} className="text-xs" style={{ color: "#64748b" }}>Cancel</button>
                </div>
              )}

              {/* Delete confirmation */}
              {confirmDelete && (
                <div className="px-3 py-2" style={{ background: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca" }}>
                  <p style={{ fontSize: "12px", color: "#dc2626", fontWeight: 600 }}>
                    Delete {(selectedSource as any)?.name}? {links.filter((l: any) => l.traffic_source_id === editSourceId).length} campaigns will be untagged.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={handleDelete} disabled={saving} className="px-3 py-1 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#dc2626", borderRadius: "6px" }}>
                      Confirm Delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="text-xs" style={{ color: "#64748b" }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                {!editSourceId ? (
                  <button onClick={handleNewSource} disabled={!formName.trim() || saving} className="w-full py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#0891b2", borderRadius: "8px" }}>
                    {saving ? "Saving..." : "New Source"}
                  </button>
                ) : bulkAssignMode && selectedRows.size > 0 ? (
                  <button onClick={handleBulkAssignFromCard} disabled={saving} className="w-full py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#0891b2", borderRadius: "8px" }}>
                    {saving ? "Assigning..." : `Assign to ${selectedRows.size} Campaigns`}
                  </button>
                ) : (
                  <>
                    <button onClick={handleSaveChanges} disabled={!formName.trim() || saving} className="flex-1 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#0891b2", borderRadius: "8px" }}>
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button onClick={() => { setRenaming(true); setRenameName(formName); }} className="px-3 py-2 text-sm font-medium border" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#64748b" }}>
                      Edit
                    </button>
                    <button onClick={() => setConfirmDelete(true)} className="px-3 py-2 text-sm font-medium border" style={{ borderColor: "#fecaca", borderRadius: "8px", color: "#dc2626" }}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ MIDDLE SECTION — Filter bar ═══ */}
        <div className="bg-white border flex items-center gap-3 px-4 py-2.5" style={{ borderColor: "#e8edf2", borderRadius: "16px" }}>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "#94a3b8" }} />
            <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-1.5 bg-white border text-sm outline-none" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" }} />
          </div>

          <AccountFilterDropdown value={accountFilter} onChange={(v) => { setAccountFilter(v); setPage(1); }} accounts={accountOptions} />

          {/* Source filter */}
          <div className="relative">
            <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="px-3 py-1.5 border text-sm outline-none appearance-none pr-7 cursor-pointer" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px", background: "white" }}>
              <option value="all">All Sources</option>
              <option value="untagged">Untagged</option>
              {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Category filter */}
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as any); setPage(1); }}
            className="px-3 py-1.5 border text-sm outline-none appearance-none pr-7 cursor-pointer" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px", background: "white" }}>
            <option value="all">All Categories</option>
            <option value="Direct">Direct</option>
            <option value="OnlyTraffic">OnlyTraffic</option>
          </select>

          {/* Columns button */}
          <div className="relative ml-auto">
            <button onClick={() => setColDropdownOpen(!colDropdownOpen)} className="px-3 py-1.5 border text-sm font-medium flex items-center gap-1.5" style={{ borderColor: "#e8edf2", borderRadius: "8px", color: "#64748b" }}>
              <BarChart3 className="h-3.5 w-3.5" /> Columns
            </button>
            {colDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-white border shadow-lg py-1" style={{ borderColor: "#e8edf2", borderRadius: "12px" }}>
                  {ALL_COLUMNS.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer" style={{ fontSize: "12px" }}>
                      <input type="checkbox" checked={visibleCols[c.id]} onChange={() => toggleColumn(c.id)} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                      <span style={{ color: "#1a2332" }}>{c.label}</span>
                    </label>
                  ))}
                  <div className="border-t mx-2 my-1" style={{ borderColor: "#e8edf2" }} />
                  <button onClick={() => { setVisibleCols(getDefaultColumns()); localStorage.removeItem(COLUMNS_KEY); }} className="w-full px-3 py-1.5 text-left" style={{ fontSize: "11px", color: "#0891b2" }}>
                    Reset to defaults
                  </button>
                </div>
              </>
            )}
          </div>

          <span style={{ fontSize: "12px", color: "#64748b" }}>{filtered.length} campaigns</span>
        </div>

        {/* ═══ BOTTOM SECTION — Campaign list ═══ */}
        <div className="bg-white border overflow-hidden" style={{ borderColor: "#e8edf2", borderRadius: "16px" }}>
          {/* Bulk toolbar */}
          <BulkActionToolbar
            selectedIds={selectedRows}
            onClear={() => { setSelectedRows(new Set()); setBulkAssignMode(false); }}
            totalFiltered={filtered.length}
            onSelectAll={() => setSelectedRows(new Set(filtered.map((l: any) => l.id)))}
            actions={["assign_source", "remove_source", "delete"]}
            onComplete={invalidateAll}
          />

          {/* Extra bulk action: Assign via card */}
          {selectedRows.size > 0 && !bulkAssignMode && (
            <div className="px-4 py-1.5 border-b flex items-center gap-2" style={{ borderColor: "#e8edf2", background: "#f8fffe" }}>
              <button onClick={() => setBulkAssignMode(true)} className="text-xs font-semibold" style={{ color: "#0891b2" }}>
                Or use Source Card to assign →
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e8edf2" }}>
                  <th style={{ padding: "10px 12px", width: "36px" }}>
                    <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                  </th>
                  <SortHeader label="Campaign" k="campaign_name" />
                  {col("model") && <th style={{ padding: "10px 12px", fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Model</th>}
                  {col("source") && <SortHeader label="Source" k="source_tag" />}
                  {col("category") && <th style={{ padding: "10px 12px", fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Category</th>}
                  {col("clicks") && <SortHeader label="Clicks" k="clicks" align="right" />}
                  {col("subscribers") && <SortHeader label="Subs" k="subscribers" align="right" />}
                  {col("revenue") && <SortHeader label="Revenue" k="revenue" align="right" />}
                  {col("status") && <th style={{ padding: "10px 12px", fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>}
                  {col("created") && <SortHeader label="Created" k="created_at" align="right" />}
                </tr>
              </thead>
              <tbody>
                {paginated.map((link: any) => {
                  const username = link.accounts?.username || link.accounts?.display_name || "—";
                  const cat = getCategory(link);
                  const status = link.status || "NO_DATA";
                  const st = STATUS_STYLES[status] || STATUS_STYLES.NO_DATA;
                  return (
                    <tr key={link.id} className="transition-colors" style={{ borderBottom: "1px solid #f1f5f9", height: "44px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={(e) => (e.currentTarget.style.background = "white")}>
                      <td style={{ padding: "8px 12px" }}>
                        <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded cursor-pointer" style={{ accentColor: "#0891b2" }} />
                      </td>
                      <td style={{ padding: "8px 12px", maxWidth: "220px" }}>
                        <p style={{ fontSize: "12px", fontWeight: 700, color: "#1a2332" }} className="truncate">{link.campaign_name || "—"}</p>
                        <p style={{ fontSize: "10px", color: "#94a3b8" }} className="truncate">{link.url}</p>
                      </td>
                      {col("model") && <td style={{ padding: "8px 12px", fontSize: "11px", color: "#64748b" }}>@{username}</td>}
                      {col("source") && <td style={{ padding: "8px 12px" }}><TagBadge tagName={link.source_tag} size="sm" /></td>}
                      {col("category") && (
                        <td style={{ padding: "8px 12px" }}>
                          {cat ? (
                            <span className="inline-block px-2 py-0.5" style={{
                              fontSize: "10px", fontWeight: 600, borderRadius: "4px",
                              background: cat === "OnlyTraffic" ? "#f3e8ff" : "#e0f2fe",
                              color: cat === "OnlyTraffic" ? "#7c3aed" : "#0891b2",
                            }}>{cat}</span>
                          ) : (
                            <span style={{ fontSize: "10px", color: "#94a3b8" }}>—</span>
                          )}
                        </td>
                      )}
                      {col("clicks") && <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#1a2332" }}>{(link.clicks || 0).toLocaleString()}</td>}
                      {col("subscribers") && <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#1a2332" }}>{(link.subscribers || 0).toLocaleString()}</td>}
                      {col("revenue") && <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px", color: "#1a2332" }}>{fmtC(Number(link.revenue || 0))}</td>}
                      {col("status") && (
                        <td style={{ padding: "8px 12px" }}>
                          <span className="inline-block px-2 py-0.5" style={{ fontSize: "10px", fontWeight: 700, borderRadius: "4px", background: st.bg, color: st.text }}>
                            {status === "NO_DATA" ? "NO SPEND" : status}
                          </span>
                        </td>
                      )}
                      {col("created") && <td className="text-right" style={{ padding: "8px 12px", fontSize: "11px", color: "#64748b" }}>{format(new Date(link.created_at), "MMM d, yyyy")}</td>}
                    </tr>
                  );
                })}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-10" style={{ color: "#94a3b8", fontSize: "13px" }}>
                      {isLoading ? "Loading campaigns..." : "No campaigns found"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid #e8edf2" }}>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Page {safePage} of {totalPages} · {filtered.length} total</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" style={{ color: "#64748b" }} />
                </button>
                <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" style={{ color: "#64748b" }} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

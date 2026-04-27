import { useState, useMemo, useEffect } from "react";
import { getEffectiveSource } from "@/lib/source-helpers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinkLtv, fetchAllTrackingLinksNormalized } from "@/lib/supabase-helpers";
import { updateTrackingLink, restoreTrackingLink, setTrackingLinkSourceTag } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { exportCampaignsCsv } from "@/components/audit/ExportCampaignsCsv";
import { ImportAuditCsvModal } from "@/components/audit/ImportAuditCsvModal";
import {
  ShieldCheck, Upload, Trash2, RotateCcw, Download, Columns3,
  AlertCircle, Skull, Tag, DollarSign, CheckCircle2, Copy,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUp, ArrowDown, ArrowUpDown, Search, X,
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { RefreshButton } from "@/components/RefreshButton";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { LinkActivityFilter, type LinkActivityFilterValue } from "@/components/LinkActivityFilter";
import { useColumnOrder, type ColumnDef } from "@/hooks/useColumnOrder";
import { DraggableColumnSelector } from "@/components/DraggableColumnSelector";
import { STATUS_STYLES as SHARED_STATUS_STYLES, calcStatus as calcStatusFn } from "@/lib/calc-helpers";
import { ModelAvatar } from "@/components/ModelAvatar";
import { useActiveLinkStatus } from "@/hooks/useActiveLinkStatus";

const LS_KEY = "ct_audit_filters";
const PAGE_SIZE = 25;

type IssueFilter = "all" | "zero" | "inactive" | "source" | "spend" | "dupes" | "deleted";

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { model: p.model ?? "all", search: p.search ?? "" };
    }
  } catch {}
  return { model: "all", search: "" };
}
function saveFilters(f: any) { localStorage.setItem(LS_KEY, JSON.stringify(f)); }

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  ...SHARED_STATUS_STYLES,
  DELETED: { bg: "#f3f4f6", text: "#9ca3af" },
};

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (v: number) => `${v.toFixed(1)}%`;

function getStatus(l: any) {
  if (l.deleted_at) return "DELETED";
  return calcStatusFn(l);
}

const AUDIT_COLUMNS: ColumnDef[] = [
  { id: "model",        label: "Model",        defaultOn: true },
  { id: "source",       label: "Source",       defaultOn: true },
  { id: "clicks",       label: "Clicks",       defaultOn: false },
  { id: "subscribers",  label: "Subscribers",  defaultOn: false },
  { id: "cvr",          label: "CVR",          defaultOn: false },
  { id: "revenue",      label: "Revenue",      defaultOn: true },
  { id: "ltv_sub",      label: "LTV/Sub",      defaultOn: true },
  { id: "spender_rate", label: "Spender %",    defaultOn: false },
  { id: "expenses",     label: "Expenses",     defaultOn: true },
  { id: "profit",       label: "Profit",       defaultOn: true },
  { id: "profit_sub",   label: "Profit/Sub",   defaultOn: true, alwaysOn: true },
  { id: "roi",          label: "ROI",          defaultOn: true },
  { id: "status",       label: "Status",       defaultOn: true },
  { id: "subs_day",     label: "Subs/Day",     defaultOn: true },
  { id: "last_sync",    label: "Last Sync",    defaultOn: true },
  { id: "created",      label: "Created",      defaultOn: true },
  { id: "media_buyer",  label: "Media Buyer",  defaultOn: false },
  { id: "avg_expenses", label: "Avg Expenses", defaultOn: false },
];

const ISSUE_META: Record<string, { label: string; bg: string; text: string }> = {
  zero:     { label: "No Activity", bg: "#f3f4f6", text: "#6b7280" },
  inactive: { label: "Inactive",    bg: "#fee2e2", text: "#dc2626" },
  source:   { label: "No Source",   bg: "#fef9c3", text: "#854d0e" },
  spend:    { label: "No Spend",    bg: "#dbeafe", text: "#1d4ed8" },
  dupes:    { label: "Duplicate",   bg: "#ffedd5", text: "#c2410c" },
};

function TablePagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (total === 0 || totalPages <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const btn = "flex items-center justify-center w-7 h-7 rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors";
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground bg-muted/20">
      <span>{start}–{end} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <button className={btn} disabled={page === 0} onClick={() => onChange(0)}><ChevronsLeft className="h-3.5 w-3.5" /></button>
        <button className={btn} disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
        <span className="px-3 py-1 rounded border border-border bg-card font-medium text-foreground">{page + 1} / {totalPages}</span>
        <button className={btn} disabled={page >= totalPages - 1} onClick={() => onChange(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></button>
        <button className={btn} disabled={page >= totalPages - 1} onClick={() => onChange(totalPages - 1)}><ChevronsRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

export default function AuditPage() {
  const queryClient = useQueryClient();

  const { data: rawLinks = [], isLoading } = useQuery({
    queryKey: ["audit_all_links"],
    queryFn: () => fetchAllTrackingLinksNormalized({ includeDeleted: true }),
  });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: trackingLinkLtv = [] } = useQuery({ queryKey: ["tracking_link_ltv"], queryFn: fetchTrackingLinkLtv });

  const ltvLookup = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trackingLinkLtv) {
      const key = String(r.tracking_link_id ?? "").trim().toLowerCase();
      if (key) map[key] = r;
    }
    return map;
  }, [trackingLinkLtv]);

  const { activeLookup } = useActiveLinkStatus();

  const now = new Date();

  const isLinkActive = (l: any): boolean => {
    const ageDays = l.created_at ? differenceInDays(now, new Date(l.created_at)) : 999;
    if (ageDays < 5) return true;
    return activeLookup.get(String(l.id).toLowerCase())?.isActive ?? false;
  };

  const [importAuditOpen, setImportAuditOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState(loadFilters);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [activityFilter, setActivityFilter] = useState<LinkActivityFilterValue>("all");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "created", dir: "desc" });
  const columnOrder = useColumnOrder("ct_audit_columns", AUDIT_COLUMNS);

  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { setPage(0); }, [issueFilter, activityFilter, filters]);

  const toggleSort = (col: string) => {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" });
    setPage(0);
  };

  const activeLinks = useMemo(() => (rawLinks as any[]).filter((l: any) => !l.deleted_at), [rawLinks]);
  const deletedLinks = useMemo(() => (rawLinks as any[]).filter((l: any) => !!l.deleted_at), [rawLinks]);

  const duplicateIds = useMemo(() => {
    const byExtId: Record<string, any[]> = {};
    const byUrl: Record<string, any[]> = {};
    for (const l of activeLinks) {
      if (l.external_tracking_link_id) {
        if (!byExtId[l.external_tracking_link_id]) byExtId[l.external_tracking_link_id] = [];
        byExtId[l.external_tracking_link_id].push(l);
      }
      if (l.url) {
        const key = l.url.trim().toLowerCase();
        if (!byUrl[key]) byUrl[key] = [];
        byUrl[key].push(l);
      }
    }
    const ids = new Set<string>();
    for (const links of Object.values(byExtId)) if (links.length > 1) links.forEach(l => ids.add(l.id));
    for (const links of Object.values(byUrl)) if (links.length > 1) links.forEach(l => ids.add(l.id));
    return ids;
  }, [activeLinks]);

  const getIssues = (l: any): string[] => {
    if (l.deleted_at) return [];
    const issues: string[] = [];
    const ad = l.created_at ? differenceInDays(now, new Date(l.created_at)) : 999;
    if (l.clicks === 0 && l.subscribers === 0 && ad > 30) issues.push("zero");
    if ((l.clicks > 0 || l.subscribers > 0) && !isLinkActive(l)) issues.push("inactive");
    if (!getEffectiveSource(l) && (l.clicks > 0 || l.subscribers > 0)) issues.push("source");
    if (Number(l.cost_total || 0) === 0 && (l.clicks > 0 || l.subscribers > 0)) issues.push("spend");
    if (duplicateIds.has(l.id)) issues.push("dupes");
    return issues;
  };

  const issueCounts = useMemo(() => ({
    zero:     activeLinks.filter(l => { const a = differenceInDays(now, new Date(l.created_at)); return l.clicks === 0 && l.subscribers === 0 && a > 30; }).length,
    inactive: activeLinks.filter(l => (l.clicks > 0 || l.subscribers > 0) && !isLinkActive(l)).length,
    source:   activeLinks.filter(l => !getEffectiveSource(l) && (l.clicks > 0 || l.subscribers > 0)).length,
    spend:    activeLinks.filter(l => Number(l.cost_total || 0) === 0 && (l.clicks > 0 || l.subscribers > 0)).length,
    dupes:    duplicateIds.size,
    deleted:  deletedLinks.length,
  }), [activeLinks, deletedLinks, duplicateIds, activeLookup]);

  // Count unique links that have at least one issue (a link with 3 issues is still 1 link)
  const totalIssues = useMemo(
    () => activeLinks.filter(l => getIssues(l).length > 0).length,
    [activeLinks, duplicateIds, activeLookup]
  );

  const setFilter = (key: string, val: string) => setFilters((p: any) => ({ ...p, [key]: val }));
  const anyFilterActive = filters.model !== "all" || filters.search !== "";
  const clearFilters = () => setFilters({ model: "all", search: "" });

  const isDeleted = issueFilter === "deleted";

  const baseFiltered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const pool = isDeleted ? deletedLinks : activeLinks;
    return pool.filter((l: any) => {
      if (filters.model !== "all" && l.account_id !== filters.model) return false;
      if (q && !(l.campaign_name || "").toLowerCase().includes(q) && !(l.url || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeLinks, deletedLinks, filters, isDeleted, activeLookup]);

  const issueFiltered = useMemo(() => {
    if (issueFilter === "all" || isDeleted) return baseFiltered;
    return baseFiltered.filter(l => getIssues(l).includes(issueFilter));
  }, [baseFiltered, issueFilter, duplicateIds, activeLookup]);

  const activityCounts = useMemo(() => {
    const active = issueFiltered.filter(l => isLinkActive(l)).length;
    return { total: issueFiltered.length, active };
  }, [issueFiltered, activeLookup]);

  const displayLinks = useMemo(() => {
    if (isDeleted || activityFilter === "all") return issueFiltered;
    if (activityFilter === "active") return issueFiltered.filter(l => isLinkActive(l));
    return issueFiltered.filter(l => !isLinkActive(l));
  }, [issueFiltered, activityFilter, activeLookup, isDeleted]);

  const getSortVal = (l: any, col: string): number | string => {
    const id = String(l.id).toLowerCase();
    const ltvRec = ltvLookup[id] || null;
    const costTotal = Number(l.cost_total || 0);
    const ltvVal = ltvRec ? Number(ltvRec.total_ltv || 0) : null;
    const effectiveRev = ltvVal !== null && ltvVal > 0 ? ltvVal : Number(l.revenue || 0);
    const ad = l.created_at ? Math.max(1, differenceInDays(now, new Date(l.created_at))) : 1;
    switch (col) {
      case "name":         return (l.campaign_name || "").toLowerCase();
      case "model":        return (l.account_username || l.accounts?.username || l.account_display_name || l.accounts?.display_name || "").toLowerCase();
      case "source":       return (getEffectiveSource(l) || "").toLowerCase();
      case "clicks":       return l.clicks || 0;
      case "subscribers":  return l.subscribers || 0;
      case "cvr":          return l.clicks > 100 ? (l.subscribers / l.clicks) : -1;
      case "revenue":      return effectiveRev;
      case "ltv_sub":      return ltvRec ? Number(ltvRec.ltv_per_sub || 0) : -1;
      case "spender_rate": return ltvRec ? Number(ltvRec.spender_pct || 0) : -1;
      case "expenses":     return costTotal;
      case "profit":       return costTotal > 0 ? effectiveRev - costTotal : -Infinity;
      case "profit_sub":   return (l.subscribers > 0 && costTotal > 0) ? (effectiveRev - costTotal) / l.subscribers : -Infinity;
      case "roi":          return costTotal > 0 ? ((effectiveRev - costTotal) / costTotal) * 100 : -Infinity;
      case "status":       return calcStatusFn(l);
      case "subs_day":     return l.subscribers > 0 ? l.subscribers / ad : -1;
      case "last_sync":    return l.calculated_at ? new Date(l.calculated_at).getTime() : -1;
      case "created":      return new Date(l.created_at).getTime();
      case "media_buyer":  return (l.media_buyer || "").toLowerCase();
      case "avg_expenses": return costTotal;
      default:             return 0;
    }
  };

  const sortedLinks = useMemo(() =>
    [...displayLinks].sort((a, b) => {
      const av = getSortVal(a, sort.col);
      const bv = getSortVal(b, sort.col);
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    }),
  [displayLinks, sort]);

  const paginatedLinks = useMemo(() =>
    sortedLinks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
  [sortedLinks, page]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["audit_all_links"] });
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
  };

  const softDelete = async (ids: string[]) => {
    for (const id of ids) await updateTrackingLink(id, { deleted_at: new Date().toISOString() });
    toast.success(`Deleted ${ids.length} tracking link(s)`);
    setSelected(new Set());
    refreshAll();
  };

  const restore = async (id: string) => {
    await restoreTrackingLink(id);
    toast.success("Tracking link restored");
    refreshAll();
  };

  const saveSourceTag = async (id: string, tag: string) => {
    await setTrackingLinkSourceTag(id, tag, true);
    toast.success("Source tag saved");
    refreshAll();
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const selectAll = () => {
    const ids = paginatedLinks.map(l => l.id);
    setSelected(prev => {
      const allSel = ids.every(id => prev.has(id));
      const next = new Set(prev);
      ids.forEach(id => allSel ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const modelName = (l: any) => l.account_username || l.accounts?.username || l.account_display_name || l.accounts?.display_name || "—";

  // ── Inline components ───────────────────────────────────────────────────────

  const InlineDeleteBtn = ({ id }: { id: string }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-destructive hover:text-destructive/80 p-1 rounded transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this tracking link?</AlertDialogTitle>
          <AlertDialogDescription>Soft-deleted — can be restored from the Deleted filter.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => softDelete([id])} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const DeleteConfirmBtn = ({ ids }: { ids: string[] }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={ids.length === 0}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete selected ({ids.length})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {ids.length} tracking link(s)?</AlertDialogTitle>
          <AlertDialogDescription>Soft-deleted — restorable from the Deleted filter.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => softDelete(ids)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const SourceInline = ({ link }: { link: any }) => {
    const [val, setVal] = useState(link.source_tag || "");
    const sources = ["Reddit", "Twitter", "TikTok", "Instagram", "Google", "Telegram", "SFS", "Other"];
    if (getEffectiveSource(link)) return <span>{getEffectiveSource(link)}</span>;
    return (
      <div className="flex items-center gap-1">
        <select value={val} onChange={e => setVal(e.target.value)} className="h-7 text-xs border border-border rounded px-1 bg-background">
          <option value="">Pick…</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {val && (
          <button onClick={() => saveSourceTag(link.id, val)} className="text-primary hover:text-primary/80 p-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const COL_WIDTHS: Record<string, string> = {
    name: "min-w-[220px]",
    model: "min-w-[130px]", source: "min-w-[90px]", clicks: "min-w-[70px]",
    subscribers: "min-w-[90px]", cvr: "min-w-[55px]", revenue: "min-w-[90px]",
    ltv_sub: "min-w-[75px]", spender_rate: "min-w-[75px]", expenses: "min-w-[90px]",
    profit: "min-w-[90px]", profit_sub: "min-w-[85px]", roi: "min-w-[60px]",
    status: "min-w-[80px]", subs_day: "min-w-[80px]", last_sync: "min-w-[100px]",
    created: "min-w-[100px]", media_buyer: "min-w-[100px]", avg_expenses: "min-w-[100px]",
  };

  const SortTh = ({ colId, label, align = "text-left" }: { colId: string; label: string; align?: string }) => (
    <th className={`p-2 font-medium ${align} cursor-pointer select-none whitespace-nowrap ${COL_WIDTHS[colId] ?? ""}`} onClick={() => toggleSort(colId)}>
      <span className={`inline-flex items-center gap-0.5 ${align === "text-right" ? "flex-row-reverse" : ""}`}>
        {label}
        {sort.col === colId
          ? sort.dir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
          : <ArrowUpDown className="h-3 w-3 opacity-25 hover:opacity-60 transition-opacity" />}
      </span>
    </th>
  );

  const renderRow = (l: any) => {
    const ad = l.created_at ? differenceInDays(now, new Date(l.created_at)) : 0;
    const ltvRecord = ltvLookup[String(l.id).toLowerCase()] || null;
    const ltvPerSub = ltvRecord && l.subscribers > 0 ? Number(ltvRecord.ltv_per_sub || 0).toFixed(2) : "—";
    const spenderRate = ltvRecord
      ? `${Number(ltvRecord.spender_pct || 0).toFixed(1)}%`
      : l.subscribers > 0 ? `${(((l.spenders_count || l.spenders || 0) / l.subscribers) * 100).toFixed(1)}%` : "—";
    const costTotal = Number(l.cost_total || 0);
    const hasCost = costTotal > 0;
    const ltvVal = ltvRecord ? Number(ltvRecord.total_ltv || 0) : null;
    const effectiveRev = ltvVal !== null && ltvVal > 0 ? ltvVal : Number(l.revenue || 0);
    const profit = hasCost ? effectiveRev - costTotal : null;
    const profitPerSub = l.subscribers > 0 && hasCost && profit !== null ? profit / l.subscribers : null;
    const status = getStatus(l);
    const ss = STATUS_STYLES[status] || STATUS_STYLES.NO_DATA;
    const issues = isDeleted ? [] : getIssues(l);
    const active = isLinkActive(l);

    return (
      <tr key={l.id} className={`border-t border-border ${isDeleted ? "opacity-50 bg-muted/20" : "hover:bg-muted/30"}`}>
        {!isDeleted && (
          <td className="p-2 w-8">
            <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} />
          </td>
        )}
        <td className="p-2">
          <div className="flex items-start gap-1.5">
            {!isDeleted && (
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
            )}
            <div>
              <div className={`font-medium truncate max-w-[210px] text-xs ${isDeleted ? "line-through text-muted-foreground" : ""}`}>{l.campaign_name}</div>
              <div className="text-muted-foreground truncate max-w-[210px] text-[10px]">{l.url}</div>
              {issues.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {issues.map(iss => {
                    const m = ISSUE_META[iss];
                    return m ? (
                      <span key={iss} className="inline-block px-1.5 py-0 rounded-full text-[9px] font-semibold"
                        style={{ backgroundColor: m.bg, color: m.text }}>{m.label}</span>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </div>
        </td>
        {columnOrder.visibleOrderedColumns.map(c => {
          switch (c.id) {
            case "model": return (
              <td key={c.id} className="p-2">
                <div className="flex items-center gap-1.5">
                  <ModelAvatar avatarUrl={l.account_avatar_thumb_url || l.accounts?.avatar_thumb_url} name={l.account_username || l.accounts?.username || l.account_display_name || l.accounts?.display_name || "?"} size={22} />
                  <span className="text-muted-foreground text-xs">@{modelName(l)}</span>
                </div>
              </td>
            );
            case "source": return (
              <td key={c.id} className="p-2 text-xs">
                {issueFilter === "source" ? <SourceInline link={l} /> : (getEffectiveSource(l) || "—")}
              </td>
            );
            case "clicks":       return <td key={c.id} className="p-2 text-right font-mono text-xs">{(l.clicks || 0).toLocaleString()}</td>;
            case "subscribers":  return <td key={c.id} className="p-2 text-right font-mono text-xs">{(l.subscribers || 0).toLocaleString()}</td>;
            case "cvr":          return <td key={c.id} className="p-2 text-right font-mono text-xs">{l.clicks > 100 ? `${((l.subscribers / l.clicks) * 100).toFixed(1)}%` : "—"}</td>;
            case "revenue":      return <td key={c.id} className="p-2 text-right font-mono text-xs">{fmtC(l.revenue || 0)}</td>;
            case "ltv_sub":      return <td key={c.id} className="p-2 text-right font-mono text-xs">${ltvPerSub}</td>;
            case "spender_rate": return <td key={c.id} className="p-2 text-right text-xs">{spenderRate}</td>;
            case "expenses":     return <td key={c.id} className="p-2 text-right font-mono text-xs">{fmtC(costTotal)}</td>;
            case "profit":       return (
              <td key={c.id} className="p-2 text-right font-mono text-xs" style={{ color: (profit || 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                {profit !== null ? fmtC(profit) : "—"}
              </td>
            );
            case "profit_sub":   return (
              <td key={c.id} className="p-2 text-right">
                {profitPerSub !== null
                  ? <span className={`font-mono font-bold text-xs ${profitPerSub >= 0 ? "text-primary" : "text-destructive"}`}>
                      {profitPerSub >= 0 ? "" : "-"}${Math.abs(profitPerSub).toFixed(2)}
                    </span>
                  : <span className="text-muted-foreground font-bold text-xs">—</span>}
              </td>
            );
            case "roi": {
              const roi = hasCost ? ((effectiveRev - costTotal) / costTotal) * 100 : null;
              return (
                <td key={c.id} className="p-2 text-right font-mono text-xs" style={{ color: (roi ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                  {roi !== null ? fmtP(roi) : "—"}
                </td>
              );
            }
            case "status": return (
              <td key={c.id} className="p-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: ss.bg, color: ss.text }}>{status}</span>
              </td>
            );
            case "subs_day": {
              const rate = ad > 0 && l.subscribers > 0 ? l.subscribers / ad : null;
              return (
                <td key={c.id} className="p-2 text-right">
                  {rate !== null ? (
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className={`font-mono font-semibold text-[12px] ${rate >= 1 ? "text-emerald-400" : rate >= 0.3 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {rate < 1 ? rate.toFixed(2) : rate.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">{ad}d</span>
                    </div>
                  ) : <span className="text-muted-foreground text-[12px]">—</span>}
                </td>
              );
            }
            case "last_sync": {
              if (!l.calculated_at) return <td key={c.id} className="p-2 text-xs text-muted-foreground">—</td>;
              const syncDate = new Date(l.calculated_at);
              const syncAgo = differenceInDays(now, syncDate);
              const syncColor = syncAgo === 0 ? "#16a34a" : syncAgo <= 3 ? "#2563eb" : syncAgo <= 7 ? "#854d0e" : "#dc2626";
              return (
                <td key={c.id} className="p-2 whitespace-nowrap">
                  <p className="text-foreground text-xs">{format(syncDate, "MMM d, yyyy")}</p>
                  <span className="text-[10px] font-medium" style={{ color: syncColor }}>
                    {syncAgo === 0 ? "Today" : `${syncAgo}d ago`}
                  </span>
                </td>
              );
            }
            case "created": {
              const days = ad;
              const pill = days <= 30 ? { label: `${days}d New`, bg: "#dcfce7", text: "#16a34a" }
                : days <= 90 ? { label: `${days}d Active`, bg: "#dbeafe", text: "#2563eb" }
                : days <= 180 ? { label: `${days}d Mature`, bg: "#fef9c3", text: "#854d0e" }
                : { label: `${days}d Old`, bg: "#f3f4f6", text: "#6b7280" };
              return (
                <td key={c.id} className="p-2 whitespace-nowrap">
                  <p className="text-foreground text-xs">{format(new Date(l.created_at), "MMM d, yyyy")}</p>
                  <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold mt-0.5"
                    style={{ backgroundColor: pill.bg, color: pill.text }}>{pill.label}</span>
                </td>
              );
            }
            case "media_buyer":  return <td key={c.id} className="p-2 text-xs">{l.media_buyer || "—"}</td>;
            case "avg_expenses": return <td key={c.id} className="p-2 text-right font-mono text-xs">{hasCost ? fmtC(costTotal) : "—"}</td>;
            default: return null;
          }
        })}
        <td className="p-2">
          {isDeleted
            ? <button onClick={() => restore(l.id)} className="text-primary hover:text-primary/80 p-1 rounded" title="Restore"><RotateCcw className="h-3.5 w-3.5" /></button>
            : <InlineDeleteBtn id={l.id} />}
        </td>
      </tr>
    );
  };

  const CHIPS: { key: IssueFilter; label: string; icon: any; count: number; active: string; inactive: string }[] = [
    { key: "all",      label: "All Links",   icon: null,        count: activeLinks.length,    active: "border-foreground bg-foreground text-background",                                                   inactive: "border-border text-muted-foreground hover:border-foreground/50" },
    { key: "zero",     label: "No Activity", icon: AlertCircle, count: issueCounts.zero,      active: "border-gray-500 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",                    inactive: "border-border text-muted-foreground hover:border-gray-400" },
    { key: "inactive", label: "Inactive",    icon: Skull,       count: issueCounts.inactive,  active: "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",                      inactive: "border-border text-muted-foreground hover:border-red-400" },
    { key: "source",   label: "No Source",   icon: Tag,         count: issueCounts.source,    active: "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",       inactive: "border-border text-muted-foreground hover:border-yellow-400" },
    { key: "spend",    label: "No Spend",    icon: DollarSign,  count: issueCounts.spend,     active: "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",                 inactive: "border-border text-muted-foreground hover:border-blue-400" },
    { key: "dupes",    label: "Duplicates",  icon: Copy,        count: issueCounts.dupes,     active: "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",       inactive: "border-border text-muted-foreground hover:border-orange-400" },
    { key: "deleted",  label: "Deleted",     icon: Trash2,      count: issueCounts.deleted,   active: "border-destructive bg-destructive/10 text-destructive",                                            inactive: "border-border text-muted-foreground hover:border-destructive/50" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Link Health
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading ? "Loading…" : (
                <>
                  <span className="font-medium text-foreground">{activeLinks.length.toLocaleString()}</span> total links
                  {" · "}
                  <span className={totalIssues > 0 ? "font-medium text-destructive" : "font-medium text-emerald-500"}>
                    {totalIssues} issue{totalIssues !== 1 ? "s" : ""} found
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton queryKeys={["audit_all_links"]} />
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => exportCampaignsCsv(displayLinks, accounts)}>
              <Download className="h-4 w-4 mr-1" /> Export ({displayLinks.length})
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportAuditOpen(true)}>
              <Upload className="h-4 w-4 mr-1" /> Import CSV
            </Button>
          </div>
        </div>

        {/* Issue filter chips */}
        <div className="flex flex-wrap gap-2">
          {CHIPS.map(chip => {
            const isActive = issueFilter === chip.key;
            const Icon = chip.icon;
            return (
              <button
                key={chip.key}
                onClick={() => { setIssueFilter(chip.key); setPage(0); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${isActive ? chip.active : chip.inactive}`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {chip.label}
                <span className={`px-1.5 py-0 rounded-full text-[10px] font-bold ${isActive ? "bg-black/10 dark:bg-white/15" : "bg-muted"}`}>
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Activity filter — All / Active / Inactive (snapshot-derived, hidden when viewing Deleted) */}
        {!isDeleted && (
          <LinkActivityFilter
            value={activityFilter}
            onChange={(v) => { setActivityFilter(v); setPage(0); }}
            totalCount={activityCounts.total}
            activeCount={activityCounts.active}
          />
        )}

        {/* Table card */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">

          {/* Toolbar */}
          <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={filters.search}
                onChange={e => setFilter("search", e.target.value)}
                placeholder="Search links…"
                className="h-8 pl-8 text-xs w-44"
              />
            </div>
            {!isDeleted && (
              <AccountFilterDropdown
                value={filters.model}
                onChange={v => setFilter("model", v)}
                accounts={(accounts as any[]).map(a => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <Columns3 className="h-3.5 w-3.5 mr-1" /> Columns
                </Button>
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
            {anyFilterActive && (
              <button onClick={clearFilters} className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
            <span className="text-xs text-muted-foreground">{displayLinks.length} links</span>
            {selected.size > 0 && !isDeleted && (
              <div className="ml-auto">
                <DeleteConfirmBtn ids={Array.from(selected)} />
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {!isDeleted && (
                    <th className="p-2 w-8">
                      <input type="checkbox"
                        onChange={selectAll}
                        checked={paginatedLinks.length > 0 && paginatedLinks.every(l => selected.has(l.id))}
                      />
                    </th>
                  )}
                  <SortTh colId="name" label="Tracking Link" align="text-left" />
                  {columnOrder.visibleOrderedColumns.map(c => {
                    const align = ["revenue","ltv_sub","spender_rate","expenses","profit","roi","subs_day","clicks","subscribers","cvr","profit_sub","avg_expenses"].includes(c.id) ? "text-right" : "text-left";
                    return <SortTh key={c.id} colId={c.id} label={c.label} align={align} />;
                  })}
                  <th className="p-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedLinks.length > 0
                  ? paginatedLinks.map(l => renderRow(l))
                  : (
                    <tr>
                      <td colSpan={99} className="p-12 text-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                          <span>No links{issueFilter !== "all" ? " with this issue" : ""} found ✓</span>
                        </div>
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>

          <TablePagination page={page} total={displayLinks.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      </div>

      <ImportAuditCsvModal
        open={importAuditOpen}
        onClose={() => setImportAuditOpen(false)}
        onComplete={refreshAll}
        trackingLinks={activeLinks}
        accounts={accounts}
      />
    </DashboardLayout>
  );
}

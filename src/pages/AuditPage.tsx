import { useState, useMemo, useEffect } from "react";
import { getEffectiveSource } from "@/lib/source-helpers"; // still used in renderRow source column
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts, fetchTrackingLinkLtv, fetchAllTrackingLinksNormalized } from "@/lib/supabase-helpers";
import { updateTrackingLink, restoreTrackingLink, setTrackingLinkSourceTag } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { exportCampaignsCsv } from "@/components/audit/ExportCampaignsCsv";
import { ImportAuditCsvModal } from "@/components/audit/ImportAuditCsvModal";
import {
  ShieldCheck, Upload, Trash2, RotateCcw, Download, Columns3,
  AlertCircle, Skull, Tag, DollarSign, CheckCircle2, Copy,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { RefreshButton } from "@/components/RefreshButton";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { useColumnOrder, type ColumnDef } from "@/hooks/useColumnOrder";
import { DraggableColumnSelector } from "@/components/DraggableColumnSelector";
import { STATUS_STYLES as SHARED_STATUS_STYLES, calcStatus as calcStatusFn } from "@/lib/calc-helpers";
import { ModelAvatar } from "@/components/ModelAvatar";

const LS_KEY = "ct_audit_filters";
const PAGE_SIZE = 25;

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { model: p.model ?? "all", activity: p.activity ?? "all" };
    }
  } catch {}
  return { model: "all", activity: "all" };
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

function getActivityStatus(l: any, thirtyDaysAgo: Date) {
  if (l.clicks === 0 && l.subscribers === 0) return "Testing";
  const lastDate = l.calculated_at ? new Date(l.calculated_at) : new Date(l.created_at);
  return lastDate < thirtyDaysAgo ? "Inactive" : "Active";
}

const AUDIT_COLUMNS: ColumnDef[] = [
  { id: "model",        label: "Model",       defaultOn: true },
  { id: "source",       label: "Source",      defaultOn: true },
  { id: "clicks",       label: "Clicks",      defaultOn: false },
  { id: "subscribers",  label: "Subscribers", defaultOn: false },
  { id: "cvr",          label: "CVR",         defaultOn: false },
  { id: "revenue",      label: "Revenue",     defaultOn: true },
  { id: "ltv_sub",      label: "LTV/Sub",     defaultOn: true },
  { id: "spender_rate", label: "Spender %",   defaultOn: false },
  { id: "expenses",     label: "Expenses",    defaultOn: true },
  { id: "profit",       label: "Profit",      defaultOn: true },
  { id: "profit_sub",   label: "Profit/Sub",  defaultOn: true, alwaysOn: true },
  { id: "roi",          label: "ROI",         defaultOn: true },
  { id: "status",       label: "Status",      defaultOn: true },
  { id: "subs_day",     label: "Subs/Day",    defaultOn: true },
  { id: "created",      label: "Created",     defaultOn: true },
  { id: "media_buyer",  label: "Media Buyer", defaultOn: false },
  { id: "avg_expenses", label: "Avg Expenses",defaultOn: false },
];

// ── Pagination ────────────────────────────────────────────────────────────────
function TablePagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (total === 0 || totalPages <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const btnCls = "flex items-center justify-center w-7 h-7 rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors";
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground bg-muted/20">
      <span>{start}–{end} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <button className={btnCls} disabled={page === 0} onClick={() => onChange(0)}><ChevronsLeft className="h-3.5 w-3.5" /></button>
        <button className={btnCls} disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
        <span className="px-3 py-1 rounded border border-border bg-card font-medium text-foreground">
          {page + 1} / {totalPages}
        </span>
        <button className={btnCls} disabled={page >= totalPages - 1} onClick={() => onChange(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></button>
        <button className={btnCls} disabled={page >= totalPages - 1} onClick={() => onChange(totalPages - 1)}><ChevronsRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
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

  const [importAuditOpen, setImportAuditOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState(loadFilters);
  const [activeTab, setActiveTab] = useState("zero");
  const [page, setPage] = useState(0);
  const columnOrder = useColumnOrder("ct_audit_columns", AUDIT_COLUMNS);

  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { setPage(0); }, [activeTab, filters]);

  const setFilter = (key: string, val: string) => setFilters((p: any) => ({ ...p, [key]: val }));
  const anyFilterActive = filters.model !== "all" || filters.activity !== "all";
  const clearFilters = () => setFilters({ model: "all", activity: "all" });

  const activeLinks = useMemo(() => (rawLinks as any[]).filter((l: any) => !l.deleted_at), [rawLinks]);
  const deletedLinks = useMemo(() => (rawLinks as any[]).filter((l: any) => !!l.deleted_at), [rawLinks]);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

const filteredLinks = useMemo(() => {
    return activeLinks.filter((l: any) => {
      if (filters.model !== "all" && l.account_id !== filters.model) return false;
      if (filters.activity !== "all" && getActivityStatus(l, thirtyDaysAgo) !== filters.activity) return false;
      return true;
    });
  }, [activeLinks, filters]);

  const zeroActivity = useMemo(() => filteredLinks.filter((l: any) =>
    l.clicks === 0 && l.subscribers === 0 && new Date(l.created_at) < thirtyDaysAgo
  ), [filteredLinks]);

  const inactive = useMemo(() => filteredLinks.filter((l: any) =>
    (l.clicks > 0 || l.subscribers > 0) && (
      (l.calculated_at && new Date(l.calculated_at) < thirtyDaysAgo) ||
      (!l.calculated_at && new Date(l.created_at) < thirtyDaysAgo)
    )
  ), [filteredLinks]);

  const missingSource = useMemo(() => filteredLinks.filter((l: any) =>
    !getEffectiveSource(l) && (l.clicks > 0 || l.subscribers > 0)
  ).sort((a: any, b: any) => (b.subscribers || 0) - (a.subscribers || 0)), [filteredLinks]);

  const missingSpend = useMemo(() => filteredLinks.filter((l: any) =>
    (!l.cost_total || l.cost_total === 0) && (l.clicks > 0 || l.subscribers > 0)
  ).sort((a: any, b: any) => (b.subscribers || 0) - (a.subscribers || 0)), [filteredLinks]);

  const duplicateGroups = useMemo(() => {
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
    const seenIds = new Set<string>();
    const groups: { key: string; links: any[] }[] = [];
    for (const [key, links] of Object.entries(byExtId)) {
      if (links.length < 2) continue;
      const sorted = [...links].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      groups.push({ key: `ext:${key}`, links: sorted });
      sorted.forEach(l => seenIds.add(l.id));
    }
    for (const [key, links] of Object.entries(byUrl)) {
      if (links.length < 2) continue;
      const unseen = links.filter(l => !seenIds.has(l.id));
      if (unseen.length === links.length) {
        const sorted = [...links].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        groups.push({ key: `url:${key}`, links: sorted });
        sorted.forEach(l => seenIds.add(l.id));
      }
    }
    return groups;
  }, [activeLinks]);

  const duplicateCount = duplicateGroups.reduce((sum, g) => sum + g.links.length - 1, 0);

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
  const selectAll = (ids: string[]) => {
    setSelected(prev => {
      const allSel = ids.every(id => prev.has(id));
      const next = new Set(prev);
      ids.forEach(id => allSel ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const modelName = (l: any) => l.accounts?.username || l.accounts?.display_name || "—";
  const ageDays = (d: string) => differenceInDays(now, new Date(d));
  const exportCount = filteredLinks.length;

  // ── Sub-components ──────────────────────────────────────────────────────────
  const StatCard = ({ icon: Icon, label, count, color }: { icon: any; label: string; count: number; color: string }) => (
    <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold font-mono text-foreground">{count}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );

  const DeleteConfirmBtn = ({ ids, label }: { ids: string[]; label: string }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={ids.length === 0}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> {label} ({ids.length})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {ids.length} tracking link(s)?</AlertDialogTitle>
          <AlertDialogDescription>Tracking links will be soft-deleted and can be restored from the Deleted tab.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => softDelete(ids)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const InlineDeleteBtn = ({ id }: { id: string }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-destructive hover:text-destructive/80 p-1 rounded transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this tracking link?</AlertDialogTitle>
          <AlertDialogDescription>It will be soft-deleted and can be restored from the Deleted tab.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => softDelete([id])} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const SourceDropdown = ({ link }: { link: any }) => {
    const [val, setVal] = useState(link.source_tag || "");
    const sources = ["Reddit", "Twitter", "TikTok", "Instagram", "Google", "Telegram", "SFS", "Other"];
    return (
      <div className="flex items-center gap-1">
        <Select value={val} onValueChange={setVal}>
          <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent>{sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        {val && val !== link.source_tag && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => saveSourceTag(link.id, val)}>
            <CheckCircle2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };

  const ColumnsButton = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs"><Columns3 className="h-3.5 w-3.5 mr-1" /> Columns</Button>
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
  );

  const TabToolbar = ({ rightContent }: { rightContent: React.ReactNode }) => (
    <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
      <AccountFilterDropdown
        value={filters.model}
        onChange={v => setFilter("model", v)}
        accounts={(accounts as any[]).map(a => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))}
      />
      {/* Active / Inactive pills */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
        {(["all", "Active", "Inactive"] as const).map(opt => (
          <button
            key={opt}
            onClick={() => setFilter("activity", opt)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filters.activity === opt
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt === "all" ? "All" : opt}
          </button>
        ))}
      </div>
      <ColumnsButton />
      <span className="text-xs text-muted-foreground">{filteredLinks.length} shown</span>
      <div className="ml-auto flex items-center gap-2">{rightContent}</div>
    </div>
  );

  // ── Row renderer ────────────────────────────────────────────────────────────
  const renderRow = (l: any, opts: { isDeleted?: boolean; showCheckbox?: boolean; showSourceDropdown?: boolean }) => {
    const ad = ageDays(l.created_at);
    const subsPerDay = ad > 0 ? (l.subscribers / ad).toFixed(1) : "—";
    const ltvRecord = ltvLookup[String(l.id).toLowerCase()] || null;
    const ltvPerSub = ltvRecord && l.subscribers > 0 ? Number(ltvRecord.ltv_per_sub || 0).toFixed(2) : "—";
    const spenderRate = ltvRecord ? `${Number(ltvRecord.spender_pct || 0).toFixed(1)}%`
      : l.subscribers > 0 ? `${(((l.spenders_count || l.spenders || 0) / l.subscribers) * 100).toFixed(1)}%` : "—";
    const costTotal = Number(l.cost_total || 0);
    const hasCost = costTotal > 0;
    const ltvVal = ltvRecord ? Number(ltvRecord.total_ltv || 0) : null;
    const effectiveRev = ltvVal !== null && ltvVal > 0 ? ltvVal : Number(l.revenue || 0);
    const profit = hasCost ? effectiveRev - costTotal : null;
    const profitPerSub = l.subscribers > 0 && hasCost && profit !== null ? profit / l.subscribers : null;
    const status = getStatus(l);
    const ss = STATUS_STYLES[status] || STATUS_STYLES.NO_DATA;

    return (
      <tr key={l.id} className={opts.isDeleted ? "border-t border-border opacity-50 bg-muted/20" : "border-t border-border hover:bg-muted/30"}>
        {opts.showCheckbox && (
          <td className="p-2">
            {!opts.isDeleted && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} />}
          </td>
        )}
        <td className="p-2">
          <div className={`font-medium truncate max-w-[220px] ${opts.isDeleted ? "line-through text-muted-foreground" : ""}`}>{l.campaign_name}</div>
          <div className="text-muted-foreground truncate max-w-[220px] text-[10px]">{l.url}</div>
        </td>
        {columnOrder.visibleOrderedColumns.map(c => {
          switch (c.id) {
            case "model": return <td key={c.id} className="p-2"><div className="flex items-center gap-1.5"><ModelAvatar avatarUrl={l.accounts?.avatar_thumb_url} name={l.accounts?.username || l.accounts?.display_name || "?"} size={24} /><span className="text-muted-foreground text-xs">@{modelName(l)}</span></div></td>;
            case "source": return <td key={c.id} className="p-2">{opts.showSourceDropdown ? <SourceDropdown link={l} /> : (getEffectiveSource(l) || "—")}</td>;
            case "clicks": return <td key={c.id} className="p-2 text-right font-mono">{(l.clicks || 0).toLocaleString()}</td>;
            case "subscribers": return <td key={c.id} className="p-2 text-right font-mono">{(l.subscribers || 0).toLocaleString()}</td>;
            case "cvr": return <td key={c.id} className="p-2 text-right font-mono">{l.clicks > 100 ? `${((l.subscribers / l.clicks) * 100).toFixed(1)}%` : "—"}</td>;
            case "revenue": return <td key={c.id} className="p-2 text-right font-mono">{fmtC(l.revenue || 0)}</td>;
            case "ltv_sub": return <td key={c.id} className="p-2 text-right font-mono">${ltvPerSub}</td>;
            case "spender_rate": return <td key={c.id} className="p-2 text-right">{spenderRate}</td>;
            case "expenses": return <td key={c.id} className="p-2 text-right font-mono">{fmtC(costTotal)}</td>;
            case "profit": return <td key={c.id} className="p-2 text-right font-mono" style={{ color: (profit || 0) >= 0 ? "#16a34a" : "#dc2626" }}>{profit !== null ? fmtC(profit) : "—"}</td>;
            case "profit_sub": return (
              <td key={c.id} className="p-2 text-right">
                {profitPerSub !== null
                  ? <span className={`font-mono font-bold ${profitPerSub >= 0 ? "text-primary" : "text-destructive"}`}>{profitPerSub >= 0 ? "" : "-"}${Math.abs(profitPerSub).toFixed(2)}</span>
                  : <span className="text-muted-foreground font-bold">—</span>}
              </td>
            );
            case "roi": return <td key={c.id} className="p-2 text-right font-mono" style={{ color: (l.roi || 0) >= 0 ? "#16a34a" : "#dc2626" }}>{l.roi != null ? fmtP(l.roi) : "—"}</td>;
            case "status": return <td key={c.id} className="p-2"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: ss.bg, color: ss.text }}>{status}</span></td>;
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
            case "created": {
              const days = ad;
              const pill = days <= 30 ? { label: `${days}d New`, bg: "#dcfce7", text: "#16a34a" }
                : days <= 90 ? { label: `${days}d Active`, bg: "#dbeafe", text: "#2563eb" }
                : days <= 180 ? { label: `${days}d Mature`, bg: "#fef9c3", text: "#854d0e" }
                : { label: `${days}d Old`, bg: "#f3f4f6", text: "#6b7280" };
              return (
                <td key={c.id} className="p-2">
                  <p className="text-foreground text-xs">{format(new Date(l.created_at), "MMM d, yyyy")}</p>
                  <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold mt-0.5" style={{ backgroundColor: pill.bg, color: pill.text }}>{pill.label}</span>
                </td>
              );
            }
            case "media_buyer": return <td key={c.id} className="p-2">{l.media_buyer || "—"}</td>;
            case "avg_expenses": return <td key={c.id} className="p-2 text-right font-mono">{hasCost ? fmtC(costTotal) : "—"}</td>;
            default: return null;
          }
        })}
        <td className="p-2">
          {opts.isDeleted
            ? <button onClick={() => restore(l.id)} className="text-primary hover:text-primary/80 p-1 rounded transition-colors" title="Restore"><RotateCcw className="h-3.5 w-3.5" /></button>
            : <InlineDeleteBtn id={l.id} />}
        </td>
      </tr>
    );
  };

  const renderTable = (items: any[], showCheckbox: boolean, showSourceDropdown: boolean) => {
    const paginated = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const visibleColCount = 2 + columnOrder.visibleOrderedColumns.length + (showCheckbox ? 1 : 0);
    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {showCheckbox && <th className="p-2 w-8"><input type="checkbox" onChange={() => selectAll(items.map(l => l.id))} checked={items.length > 0 && items.every(l => selected.has(l.id))} /></th>}
                <th className="p-2 font-medium text-left">Tracking Link</th>
                {columnOrder.visibleOrderedColumns.map(c => {
                  const align = ["revenue","ltv_sub","spender_rate","expenses","profit","roi","subs_day","clicks","subscribers","cvr"].includes(c.id) ? "text-right" : "text-left";
                  return <th key={c.id} className={`p-2 font-medium ${align}`}>{c.label}</th>;
                })}
                <th className="p-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length > 0
                ? paginated.map(l => renderRow(l, { showCheckbox, showSourceDropdown }))
                : <tr><td colSpan={visibleColCount} className="p-8 text-center text-muted-foreground">No tracking links found ✓</td></tr>}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} total={items.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </>
    );
  };

  const renderDeletedTable = () => {
    const paginated = deletedLinks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const visibleColCount = 2 + columnOrder.visibleOrderedColumns.length;
    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 font-medium text-left">Tracking Link</th>
                {columnOrder.visibleOrderedColumns.map(c => {
                  const align = ["revenue","ltv_sub","spender_rate","expenses","profit","roi","subs_day","clicks","subscribers","cvr"].includes(c.id) ? "text-right" : "text-left";
                  return <th key={c.id} className={`p-2 font-medium ${align}`}>{c.label}</th>;
                })}
                <th className="p-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length > 0
                ? paginated.map(l => renderRow(l, { isDeleted: true, showCheckbox: false, showSourceDropdown: false }))
                : <tr><td colSpan={visibleColCount} className="p-8 text-center text-muted-foreground">No deleted tracking links</td></tr>}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} total={deletedLinks.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Tracking Link Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Review, clean up, and manage your tracking links</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton queryKeys={["audit_all_links"]} />
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => exportCampaignsCsv(filteredLinks, accounts)}>
              <Download className="h-4 w-4 mr-1" /> {anyFilterActive ? `Export Filtered (${exportCount})` : `Export All (${exportCount})`}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportAuditOpen(true)}><Upload className="h-4 w-4 mr-1" /> Import Audit CSV</Button>
          </div>
        </div>

        {/* KPI Stat Cards */}
        <div className="grid grid-cols-5 gap-4">
          <StatCard icon={AlertCircle} label="Zero Activity"   count={zeroActivity.length}  color="bg-muted text-muted-foreground" />
          <StatCard icon={Skull}       label="Inactive"        count={inactive.length}       color="bg-destructive/10 text-destructive" />
          <StatCard icon={Tag}         label="Missing Source"  count={missingSource.length}  color="bg-warning/10 text-warning" />
          <StatCard icon={DollarSign}  label="Missing Spend"   count={missingSpend.length}   color="bg-info/10 text-primary" />
          <StatCard icon={Copy}        label="Duplicates"      count={duplicateCount}        color="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted">
            <TabsTrigger value="zero">Zero Activity ({zeroActivity.length})</TabsTrigger>
            <TabsTrigger value="dead">Inactive ({inactive.length})</TabsTrigger>
            <TabsTrigger value="source">Missing Source ({missingSource.length})</TabsTrigger>
            <TabsTrigger value="spend">Missing Spend ({missingSpend.length})</TabsTrigger>
            <TabsTrigger value="dupes">Duplicates ({duplicateCount})</TabsTrigger>
            <TabsTrigger value="deleted" className="text-destructive data-[state=active]:text-destructive">
              Deleted ({deletedLinks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="zero">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={
                <DeleteConfirmBtn ids={Array.from(selected).filter(id => zeroActivity.some(l => l.id === id))} label="Delete selected" />
              } />
              {renderTable(zeroActivity, true, false)}
            </div>
          </TabsContent>

          <TabsContent value="dead">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={
                <DeleteConfirmBtn ids={Array.from(selected).filter(id => inactive.some(l => l.id === id))} label="Delete selected" />
              } />
              {renderTable(inactive, true, false)}
            </div>
          </TabsContent>

          <TabsContent value="source">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={null} />
              {renderTable(missingSource, false, true)}
            </div>
          </TabsContent>

          <TabsContent value="spend">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={null} />
              {renderTable(missingSpend, false, false)}
            </div>
          </TabsContent>

          <TabsContent value="dupes">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-3 border-b border-border">
                <p className="text-xs text-muted-foreground italic">
                  Same campaign name on different models is not flagged — only exact URL or tracking link ID matches are flagged.
                </p>
              </div>
              {duplicateGroups.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No duplicates found ✓</div>
              ) : (
                <div className="divide-y divide-border">
                  {duplicateGroups.map(group => (
                    <div key={group.key} className="p-4 space-y-2">
                      <div className="text-sm font-medium text-foreground">{group.links[0]?.campaign_name || "Unnamed"}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{group.links[0]?.url}</div>
                      <table className="w-full text-xs mt-2">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-2 text-left font-medium">Model</th>
                            <th className="p-2 text-left font-medium">External ID</th>
                            <th className="p-2 text-left font-medium">Created</th>
                            <th className="p-2 text-left font-medium">Status</th>
                            <th className="p-2 w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.links.map((l, idx) => (
                            <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                              <td className="p-2">
                                <div className="flex items-center gap-1.5">
                                  <ModelAvatar avatarUrl={l.accounts?.avatar_thumb_url} name={l.accounts?.username || l.accounts?.display_name || "?"} size={24} />
                                  <span className="text-muted-foreground">@{l.accounts?.username || l.accounts?.display_name || "?"}</span>
                                </div>
                              </td>
                              <td className="p-2 font-mono text-muted-foreground">{l.external_tracking_link_id || "—"}</td>
                              <td className="p-2">{format(new Date(l.created_at), "MMM d, yyyy")}</td>
                              <td className="p-2">
                                {idx === 0
                                  ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">Original</span>
                                  : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Duplicate</span>}
                              </td>
                              <td className="p-2">{idx !== 0 && <InlineDeleteBtn id={l.id} />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="deleted">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Soft-deleted tracking links — click <RotateCcw className="h-3 w-3 inline mx-0.5" /> to restore.
                </p>
                <span className="text-xs text-muted-foreground">{deletedLinks.length} deleted</span>
              </div>
              {renderDeletedTable()}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ImportAuditCsvModal open={importAuditOpen} onClose={() => setImportAuditOpen(false)} onComplete={refreshAll} trackingLinks={activeLinks} accounts={accounts} />
    </DashboardLayout>
  );
}

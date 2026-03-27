import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAccounts } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { exportCampaignsCsv } from "@/components/audit/ExportCampaignsCsv";
import { ImportAuditCsvModal } from "@/components/audit/ImportAuditCsvModal";
import {
  ShieldCheck, Upload, Trash2, RotateCcw, Download, Columns3,
  AlertCircle, Skull, Tag, DollarSign, ChevronDown, X, CheckCircle2, FilterX
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { RefreshButton } from "@/components/RefreshButton";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";

const LS_KEY = "ct_audit_filters";
const LS_COLS_KEY = "ct_audit_cols";

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { model: "all", source: "all", status: "all", activity: "all", action: "all" };
}
function saveFilters(f: any) { localStorage.setItem(LS_KEY, JSON.stringify(f)); }

function loadHiddenCols(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LS_COLS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
function saveHiddenCols(h: Record<string, string[]>) { localStorage.setItem(LS_COLS_KEY, JSON.stringify(h)); }

async function fetchAllTrackingLinks() {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tracking_links")
      .select("*, accounts(display_name, username, avatar_thumb_url)")
      .order("revenue", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

function getAction(l: any, ageDays: number) {
  if (l.clicks === 0 && l.subscribers === 0) return "delete";
  if (l.subscribers > 0 && !l.cost_total) return "add_spend";
  if (l.subscribers > 0 && l.cost_total > 0) return "keep";
  if (l.clicks > 0 && l.subscribers === 0 && ageDays > 14) return "review";
  return "keep";
}

function getStatus(l: any) {
  if (l.deleted_at) return "DELETED";
  if (!l.cost_total && l.subscribers > 0) return "NO SPEND";
  if (l.roi !== null && l.roi !== undefined) {
    if (l.roi >= 100) return "SCALE";
    if (l.roi >= 0) return "WATCH";
    if (l.roi >= -50) return "LOW";
    if (l.roi >= -100) return "KILL";
    return "DEAD";
  }
  return "NO_DATA";
}

function getActivityStatus(l: any, thirtyDaysAgo: Date) {
  if (l.clicks === 0 && l.subscribers === 0) return "Testing";
  const lastDate = l.calculated_at ? new Date(l.calculated_at) : new Date(l.created_at);
  return lastDate < thirtyDaysAgo ? "Inactive" : "Active";
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  SCALE: { bg: "#dcfce7", text: "#16a34a" }, WATCH: { bg: "#dbeafe", text: "#0891b2" },
  LOW: { bg: "#fef9c3", text: "#854d0e" }, KILL: { bg: "#fee2e2", text: "#dc2626" },
  DEAD: { bg: "#f3f4f6", text: "#6b7280" }, "NO SPEND": { bg: "#f9fafb", text: "#94a3b8" },
  NO_DATA: { bg: "#f9fafb", text: "#94a3b8" }, DELETED: { bg: "#f3f4f6", text: "#9ca3af" },
};

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (v: number) => `${v.toFixed(1)}%`;

// ─── Unified columns matching Campaigns page ───
type ColumnId = "model" | "source" | "revenue" | "ltv" | "ltv_sub" | "spender_rate" | "expenses" | "profit" | "roi" | "status" | "subs_day" | "clicks" | "subscribers" | "cvr" | "created" | "media_buyer";

const ALL_COLUMNS: { id: ColumnId; label: string; defaultOn: boolean; align?: string }[] = [
  { id: "model", label: "Model", defaultOn: true },
  { id: "source", label: "Source", defaultOn: true },
  { id: "revenue", label: "Revenue", defaultOn: true, align: "right" },
  { id: "ltv", label: "LTV", defaultOn: true, align: "right" },
  { id: "ltv_sub", label: "LTV/Sub", defaultOn: true, align: "right" },
  { id: "spender_rate", label: "Spender %", defaultOn: false, align: "right" },
  { id: "expenses", label: "Expenses", defaultOn: true, align: "right" },
  { id: "profit", label: "Profit", defaultOn: true, align: "right" },
  { id: "roi", label: "ROI", defaultOn: true, align: "right" },
  { id: "status", label: "Status", defaultOn: true },
  { id: "subs_day", label: "Subs/Day", defaultOn: true, align: "right" },
  { id: "clicks", label: "Clicks", defaultOn: false, align: "right" },
  { id: "subscribers", label: "Subscribers", defaultOn: false, align: "right" },
  { id: "cvr", label: "CVR", defaultOn: false, align: "right" },
  { id: "created", label: "Created", defaultOn: false },
  { id: "media_buyer", label: "Media Buyer", defaultOn: false },
];

function getDefaultColumns(): Record<ColumnId, boolean> {
  const d: Record<string, boolean> = {};
  ALL_COLUMNS.forEach(c => { d[c.id] = c.defaultOn; });
  return d as Record<ColumnId, boolean>;
}

function loadColumnVisibility(): Record<ColumnId, boolean> {
  try {
    const saved = localStorage.getItem("ct_audit_columns");
    if (saved) return { ...getDefaultColumns(), ...JSON.parse(saved) };
  } catch {}
  return getDefaultColumns();
}

export default function AuditPage() {
  const queryClient = useQueryClient();
  const { data: allLinks = [], isLoading } = useQuery({ queryKey: ["audit_all_links"], queryFn: fetchAllTrackingLinks });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [importAuditOpen, setImportAuditOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState(loadFilters);
  const [activeTab, setActiveTab] = useState("zero");
  const [columns, setColumns] = useState<Record<ColumnId, boolean>>(loadColumnVisibility);

  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { localStorage.setItem("ct_audit_columns", JSON.stringify(columns)); }, [columns]);

  const setFilter = (key: string, val: string) => setFilters((p: any) => ({ ...p, [key]: val }));
  const anyFilterActive = filters.model !== "all" || filters.source !== "all" || filters.status !== "all" || filters.activity !== "all" || filters.action !== "all";
  const clearFilters = () => setFilters({ model: "all", source: "all", status: "all", activity: "all", action: "all" });

  const activeLinks = useMemo(() => allLinks.filter((l: any) => !l.deleted_at), [allLinks]);
  const deletedLinks = useMemo(() => allLinks.filter((l: any) => l.deleted_at), [allLinks]);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  const distinctSources = useMemo(() => {
    const s = [...new Set(activeLinks.map((l: any) => l.source_tag).filter(Boolean))].sort();
    if (!s.includes("Untagged")) s.push("Untagged");
    return s;
  }, [activeLinks]);

  const filteredLinks = useMemo(() => {
    return activeLinks.filter((l: any) => {
      const linkAccountId = l.account_id || "";
      const ad = differenceInDays(now, new Date(l.created_at));
      if (filters.model !== "all" && linkAccountId !== filters.model) return false;
      if (filters.source !== "all") {
        if (filters.source === "Untagged") { if (l.source_tag && l.source_tag !== "Untagged") return false; }
        else { if (l.source_tag !== filters.source) return false; }
      }
      if (filters.status !== "all") { if (getStatus(l) !== filters.status) return false; }
      if (filters.activity !== "all") { if (getActivityStatus(l, thirtyDaysAgo) !== filters.activity) return false; }
      if (filters.action !== "all") { if (getAction(l, ad) !== filters.action) return false; }
      return true;
    });
  }, [activeLinks, filters]);

  const zeroActivity = useMemo(() => filteredLinks.filter((l: any) =>
    l.clicks === 0 && l.subscribers === 0 && new Date(l.created_at) < thirtyDaysAgo
  ), [filteredLinks]);

  const dead = useMemo(() => filteredLinks.filter((l: any) =>
    (l.clicks > 0 || l.subscribers > 0) && (
      (l.calculated_at && new Date(l.calculated_at) < thirtyDaysAgo) ||
      (!l.calculated_at && new Date(l.created_at) < thirtyDaysAgo)
    )
  ), [filteredLinks]);

  const missingSource = useMemo(() => filteredLinks.filter((l: any) =>
    (!l.source_tag || l.source_tag === "Untagged") && (l.clicks > 0 || l.subscribers > 0)
  ).sort((a: any, b: any) => (b.subscribers || 0) - (a.subscribers || 0)), [filteredLinks]);

  const missingSpend = useMemo(() => filteredLinks.filter((l: any) =>
    (!l.cost_total || l.cost_total === 0) && (l.clicks > 0 || l.subscribers > 0)
  ).sort((a: any, b: any) => (b.subscribers || 0) - (a.subscribers || 0)), [filteredLinks]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["audit_all_links"] });
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
  };

  const softDelete = async (ids: string[]) => {
    for (const id of ids) {
      await supabase.from("tracking_links").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
    }
    toast.success(`Deleted ${ids.length} campaign(s)`);
    setSelected(new Set());
    refreshAll();
  };

  const restore = async (id: string) => {
    await supabase.from("tracking_links").update({ deleted_at: null } as any).eq("id", id);
    toast.success("Campaign restored");
    refreshAll();
  };

  const saveSourceTag = async (id: string, tag: string) => {
    await supabase.from("tracking_links").update({ source_tag: tag, manually_tagged: true } as any).eq("id", id);
    toast.success("Source tag saved");
    refreshAll();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const selectAll = (ids: string[]) => {
    setSelected((prev) => {
      const allSel = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      ids.forEach((id) => allSel ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const modelName = (l: any) => l.accounts?.username || l.accounts?.display_name || "—";
  const ageDays = (d: string) => differenceInDays(now, new Date(d));

  const toggleCol = (id: ColumnId) => setColumns(prev => ({ ...prev, [id]: !prev[id] }));
  const resetCols = () => setColumns(getDefaultColumns());
  const isVis = (id: ColumnId) => columns[id];

  const exportCount = filteredLinks.length;

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
          <AlertDialogTitle>Delete {ids.length} campaign(s)?</AlertDialogTitle>
          <AlertDialogDescription>Campaigns will be soft-deleted and can be restored later.</AlertDialogDescription>
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
          <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
          <AlertDialogDescription>It will be soft-deleted and can be restored later.</AlertDialogDescription>
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
          <SelectContent>{sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        {val && val !== link.source_tag && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => saveSourceTag(link.id, val)}>
            <CheckCircle2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };

  const FilterSelect = ({ value, onValueChange, placeholder, options }: { value: string; onValueChange: (v: string) => void; placeholder: string; options: { value: string; label: string }[] }) => (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 text-xs w-[130px] bg-card border-border">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const ColumnsButton = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs"><Columns3 className="h-3.5 w-3.5 mr-1" /> Columns</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ALL_COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem key={c.id} checked={columns[c.id]} onCheckedChange={() => toggleCol(c.id)}>
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <button className="w-full text-xs text-primary hover:text-primary/80 px-2 py-1.5 text-left" onClick={resetCols}>
          Reset to defaults
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const TabToolbar = ({ rightContent }: { rightContent: React.ReactNode }) => (
    <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
      <AccountFilterDropdown value={filters.model} onChange={(v) => setFilter("model", v)} accounts={accounts.map((a: any) => ({ id: a.id, username: a.username || "unknown", display_name: a.display_name, avatar_thumb_url: a.avatar_thumb_url }))} />
      <FilterSelect value={filters.source} onValueChange={(v) => setFilter("source", v)} placeholder="All Sources" options={distinctSources.map((s: string) => ({ value: s, label: s }))} />
      <FilterSelect value={filters.status} onValueChange={(v) => setFilter("status", v)} placeholder="All Statuses" options={[
        { value: "SCALE", label: "SCALE" }, { value: "WATCH", label: "WATCH" }, { value: "LOW", label: "LOW" },
        { value: "KILL", label: "KILL" }, { value: "DEAD", label: "DEAD" }, { value: "NO SPEND", label: "NO SPEND" },
      ]} />
      <FilterSelect value={filters.activity} onValueChange={(v) => setFilter("activity", v)} placeholder="All Activity" options={[
        { value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }, { value: "Testing", label: "Testing" },
      ]} />
      <FilterSelect value={filters.action} onValueChange={(v) => setFilter("action", v)} placeholder="All Actions" options={[
        { value: "keep", label: "Keep" }, { value: "delete", label: "Delete" }, { value: "add_spend", label: "Add Spend" }, { value: "review", label: "Review" },
      ]} />
      <ColumnsButton />
      {anyFilterActive && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>
          <FilterX className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      )}
      <span className="text-xs text-muted-foreground">{filteredLinks.length} shown</span>
      <div className="ml-auto flex items-center gap-2">{rightContent}</div>
    </div>
  );

  // ─── Render a row (shared for active + deleted) ───
  const renderRow = (l: any, opts: { isDeleted?: boolean; showCheckbox?: boolean; showSourceDropdown?: boolean }) => {
    const ad = ageDays(l.created_at);
    const subsPerDay = ad > 0 ? (l.subscribers / ad).toFixed(1) : "—";
    const ltvVal = l.ltv || l.revenue || 0;
    const ltvPerSub = l.subscribers > 0 ? (ltvVal / l.subscribers).toFixed(2) : "—";
    const spenderRate = l.subscribers > 0 ? (((l.spenders_count || l.spenders || 0) / l.subscribers) * 100).toFixed(1) + "%" : "—";
    const status = getStatus(l);
    const ss = STATUS_STYLES[status] || STATUS_STYLES.NO_DATA;
    const rowClass = opts.isDeleted
      ? "border-t border-border opacity-50 bg-muted/20"
      : "border-t border-border hover:bg-muted/30";

    return (
      <tr key={l.id} className={rowClass}>
        {opts.showCheckbox && (
          <td className="p-2"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
        )}
        {/* Campaign — always visible */}
        <td className="p-2">
          <div className={`font-medium truncate max-w-[220px] ${opts.isDeleted ? "line-through text-muted-foreground" : ""}`}>{l.campaign_name}</div>
          <div className="text-muted-foreground truncate max-w-[220px] text-[10px]">{l.url}</div>
        </td>
        {isVis("model") && <td className="p-2">{modelName(l)}</td>}
        {isVis("source") && <td className="p-2">{opts.showSourceDropdown ? <SourceDropdown link={l} /> : (l.source_tag || "—")}</td>}
        {isVis("revenue") && <td className="p-2 text-right font-mono">{fmtC(l.revenue || 0)}</td>}
        {isVis("ltv") && <td className="p-2 text-right font-mono">{fmtC(ltvVal)}</td>}
        {isVis("ltv_sub") && <td className="p-2 text-right font-mono">${ltvPerSub}</td>}
        {isVis("spender_rate") && <td className="p-2 text-right">{spenderRate}</td>}
        {isVis("expenses") && <td className="p-2 text-right font-mono">{fmtC(l.cost_total || 0)}</td>}
        {isVis("profit") && <td className="p-2 text-right font-mono" style={{ color: (l.profit || 0) >= 0 ? "#16a34a" : "#dc2626" }}>{fmtC(l.profit || 0)}</td>}
        {isVis("roi") && <td className="p-2 text-right font-mono" style={{ color: (l.roi || 0) >= 0 ? "#16a34a" : "#dc2626" }}>{l.roi != null ? fmtP(l.roi) : "—"}</td>}
        {isVis("status") && (
          <td className="p-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: ss.bg, color: ss.text }}>{status}</span>
          </td>
        )}
        {isVis("subs_day") && <td className="p-2 text-right">{subsPerDay}</td>}
        {isVis("clicks") && <td className="p-2 text-right">{l.clicks}</td>}
        {isVis("subscribers") && <td className="p-2 text-right">{l.subscribers}</td>}
        {isVis("cvr") && <td className="p-2 text-right">{l.cvr != null ? fmtP(l.cvr) : "—"}</td>}
        {isVis("created") && <td className="p-2">{format(new Date(l.created_at), "MMM d, yyyy")}</td>}
        {isVis("media_buyer") && <td className="p-2">{l.media_buyer || "—"}</td>}
        {/* Actions */}
        <td className="p-2">
          <div className="flex items-center gap-1">
            {opts.isDeleted ? (
              <button onClick={() => restore(l.id)} className="text-primary hover:text-primary/80 p-1 rounded transition-colors" title="Restore">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : (
              <InlineDeleteBtn id={l.id} />
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Visible column count for colSpan
  const visibleColCount = 2 + ALL_COLUMNS.filter(c => columns[c.id]).length + 1; // campaign(locked) + checkbox + actions

  const renderTable = (items: any[], tabKey: string, showCheckbox: boolean, showSourceDropdown: boolean) => (
    <table className="w-full text-xs">
      <thead className="bg-muted/50">
        <tr>
          {showCheckbox && <th className="p-2 w-8"><input type="checkbox" onChange={() => selectAll(items.map((l: any) => l.id))} checked={items.length > 0 && items.every((l: any) => selected.has(l.id))} /></th>}
          <th className="p-2 font-medium text-left">Campaign</th>
          {isVis("model") && <th className="p-2 font-medium text-left">Model</th>}
          {isVis("source") && <th className="p-2 font-medium text-left">Source</th>}
          {isVis("revenue") && <th className="p-2 font-medium text-right">Revenue</th>}
          {isVis("ltv") && <th className="p-2 font-medium text-right">LTV</th>}
          {isVis("ltv_sub") && <th className="p-2 font-medium text-right">LTV/Sub</th>}
          {isVis("spender_rate") && <th className="p-2 font-medium text-right">Spender %</th>}
          {isVis("expenses") && <th className="p-2 font-medium text-right">Expenses</th>}
          {isVis("profit") && <th className="p-2 font-medium text-right">Profit</th>}
          {isVis("roi") && <th className="p-2 font-medium text-right">ROI</th>}
          {isVis("status") && <th className="p-2 font-medium text-left">Status</th>}
          {isVis("subs_day") && <th className="p-2 font-medium text-right">Subs/Day</th>}
          {isVis("clicks") && <th className="p-2 font-medium text-right">Clicks</th>}
          {isVis("subscribers") && <th className="p-2 font-medium text-right">Subs</th>}
          {isVis("cvr") && <th className="p-2 font-medium text-right">CVR</th>}
          {isVis("created") && <th className="p-2 font-medium text-left">Created</th>}
          {isVis("media_buyer") && <th className="p-2 font-medium text-left">Media Buyer</th>}
          <th className="p-2 w-12"></th>
        </tr>
      </thead>
      <tbody>
        {items.map((l: any) => renderRow(l, { showCheckbox, showSourceDropdown }))}
        {/* Show deleted items in same table, grayed out */}
        {deletedLinks.length > 0 && items.length > 0 && tabKey === activeTab && deletedLinks.map((l: any) =>
          renderRow(l, { isDeleted: true, showCheckbox: false, showSourceDropdown: false })
        )}
        {items.length === 0 && deletedLinks.length === 0 && (
          <tr><td colSpan={visibleColCount} className="p-8 text-center text-muted-foreground">No campaigns found ✓</td></tr>
        )}
      </tbody>
    </table>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Campaign Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Review, clean up, and manage your tracking link campaigns</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton queryKeys={["audit_all_links"]} />
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => exportCampaignsCsv(filteredLinks, accounts)}>
              <Download className="h-4 w-4 mr-1" /> {anyFilterActive ? `Export Filtered (${exportCount})` : `Export All (${exportCount})`}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportAuditOpen(true)}><Upload className="h-4 w-4 mr-1" /> Import Audit CSV</Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={AlertCircle} label="Zero Activity" count={zeroActivity.length} color="bg-muted text-muted-foreground" />
          <StatCard icon={Skull} label="Dead" count={dead.length} color="bg-destructive/10 text-destructive" />
          <StatCard icon={Tag} label="Missing Source" count={missingSource.length} color="bg-warning/10 text-warning" />
          <StatCard icon={DollarSign} label="Missing Spend" count={missingSpend.length} color="bg-info/10 text-primary" />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted">
            <TabsTrigger value="zero">Zero Activity ({zeroActivity.length})</TabsTrigger>
            <TabsTrigger value="dead">Dead ({dead.length})</TabsTrigger>
            <TabsTrigger value="source">Missing Source ({missingSource.length})</TabsTrigger>
            <TabsTrigger value="spend">Missing Spend ({missingSpend.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="zero">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={
                <DeleteConfirmBtn ids={Array.from(selected).filter((id) => zeroActivity.some((l: any) => l.id === id))} label="Delete selected" />
              } />
              {renderTable(zeroActivity, "zero", true, false)}
            </div>
          </TabsContent>

          <TabsContent value="dead">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={
                <DeleteConfirmBtn ids={Array.from(selected).filter((id) => dead.some((l: any) => l.id === id))} label="Delete selected" />
              } />
              {renderTable(dead, "dead", true, false)}
            </div>
          </TabsContent>

          <TabsContent value="source">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={null} />
              {renderTable(missingSource, "source", false, true)}
            </div>
          </TabsContent>

          <TabsContent value="spend">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <TabToolbar rightContent={null} />
              {renderTable(missingSpend, "spend", false, false)}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ImportAuditCsvModal open={importAuditOpen} onClose={() => setImportAuditOpen(false)} onComplete={refreshAll} trackingLinks={activeLinks} accounts={accounts} />
    </DashboardLayout>
  );
}

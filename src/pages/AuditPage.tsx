import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchTrackingLinks, fetchAccounts } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { exportCampaignsCsv } from "@/components/audit/ExportCampaignsCsv";
import { ImportAuditCsvModal } from "@/components/audit/ImportAuditCsvModal";
import {
  ShieldCheck, Upload, Trash2, RotateCcw, Download, Columns3,
  AlertCircle, Skull, Tag, DollarSign, ChevronDown, X, CheckCircle2, FilterX
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { RefreshButton } from "@/components/RefreshButton";

const LS_KEY = "ct_audit_filters";
const LS_COLS_KEY = "ct_audit_cols";

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { model: "all", source: "all", status: "all", activity: "all", action: "all" };
}

function saveFilters(f: any) {
  localStorage.setItem(LS_KEY, JSON.stringify(f));
}

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
  if (!l.cost_total && l.subscribers > 0) return "NO SPEND";
  if (l.roi !== null && l.roi !== undefined) {
    if (l.roi >= 100) return "SCALE";
    if (l.roi >= 0) return "WATCH";
    if (l.roi >= -50) return "LOW";
    if (l.roi >= -100) return "KILL";
    return "DEAD";
  }
  return "";
}

function getActivityStatus(l: any, thirtyDaysAgo: Date) {
  if (l.clicks === 0 && l.subscribers === 0) return "Testing";
  const lastDate = l.calculated_at ? new Date(l.calculated_at) : new Date(l.created_at);
  return lastDate < thirtyDaysAgo ? "Inactive" : "Active";
}

// Column definitions per tab
const ZERO_COLS = [
  { key: "campaign", label: "Campaign + URL", locked: true },
  { key: "model", label: "Model" },
  { key: "source", label: "Source" },
  { key: "clicks", label: "Clicks", align: "right" },
  { key: "subs", label: "Subs", align: "right" },
  { key: "ltv", label: "LTV", align: "right" },
  { key: "created", label: "Created" },
  { key: "age", label: "Age" },
  { key: "delete", label: "", locked: true },
];
const DEAD_COLS = [
  { key: "campaign", label: "Campaign + URL", locked: true },
  { key: "model", label: "Model" },
  { key: "source", label: "Source" },
  { key: "clicks", label: "Clicks", align: "right" },
  { key: "subs", label: "Subs", align: "right" },
  { key: "ltv", label: "LTV", align: "right" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "daysSince", label: "Days Since" },
  { key: "delete", label: "", locked: true },
];
const SOURCE_COLS = [
  { key: "campaign", label: "Campaign + URL", locked: true },
  { key: "model", label: "Model" },
  { key: "clicks", label: "Clicks", align: "right" },
  { key: "subs", label: "Subs", align: "right" },
  { key: "ltv", label: "LTV", align: "right" },
  { key: "subsDay", label: "Subs/Day", align: "right" },
  { key: "age", label: "Age" },
  { key: "sourceDropdown", label: "Source", locked: true },
];
const SPEND_COLS = [
  { key: "campaign", label: "Campaign + URL", locked: true },
  { key: "model", label: "Model" },
  { key: "source", label: "Source" },
  { key: "clicks", label: "Clicks", align: "right" },
  { key: "subs", label: "Subs", align: "right" },
  { key: "ltv", label: "LTV", align: "right" },
  { key: "ltvSub", label: "LTV/Sub", align: "right" },
  { key: "subsDay", label: "Subs/Day", align: "right" },
  { key: "spenderRate", label: "Spender %", align: "right" },
  { key: "setSpend", label: "Set Spend", locked: true },
];

export default function AuditPage() {
  const queryClient = useQueryClient();
  const { data: allLinks = [], isLoading } = useQuery({ queryKey: ["audit_all_links"], queryFn: fetchAllTrackingLinks });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [importAuditOpen, setImportAuditOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [filters, setFilters] = useState(loadFilters);
  const [hiddenCols, setHiddenCols] = useState<Record<string, Set<string>>>({
    zero: new Set(), dead: new Set(), source: new Set(), spend: new Set(),
  });
  const [activeTab, setActiveTab] = useState("zero");

  useEffect(() => { saveFilters(filters); }, [filters]);

  const setFilter = (key: string, val: string) => setFilters((p: any) => ({ ...p, [key]: val }));
  const anyFilterActive = filters.model !== "all" || filters.source !== "all" || filters.status !== "all" || filters.activity !== "all" || filters.action !== "all";
  const clearFilters = () => setFilters({ model: "all", source: "all", status: "all", activity: "all", action: "all" });

  const activeLinks = useMemo(() => allLinks.filter((l: any) => !l.deleted_at), [allLinks]);
  const deletedLinks = useMemo(() => allLinks.filter((l: any) => l.deleted_at), [allLinks]);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // Distinct values for filters
  const distinctModels = useMemo(() => [...new Set(activeLinks.map((l: any) => l.accounts?.username || l.accounts?.display_name).filter(Boolean))].sort(), [activeLinks]);
  const distinctSources = useMemo(() => {
    const s = [...new Set(activeLinks.map((l: any) => l.source_tag).filter(Boolean))].sort();
    if (!s.includes("Untagged")) s.push("Untagged");
    return s;
  }, [activeLinks]);

  // Apply global filters to active links
  const filteredLinks = useMemo(() => {
    return activeLinks.filter((l: any) => {
      const mName = l.accounts?.username || l.accounts?.display_name || "";
      const ageDays = differenceInDays(now, new Date(l.created_at));
      if (filters.model !== "all" && mName !== filters.model) return false;
      if (filters.source !== "all") {
        if (filters.source === "Untagged") { if (l.source_tag && l.source_tag !== "Untagged") return false; }
        else { if (l.source_tag !== filters.source) return false; }
      }
      if (filters.status !== "all") { if (getStatus(l) !== filters.status) return false; }
      if (filters.activity !== "all") { if (getActivityStatus(l, thirtyDaysAgo) !== filters.activity) return false; }
      if (filters.action !== "all") { if (getAction(l, ageDays) !== filters.action) return false; }
      return true;
    });
  }, [activeLinks, filters]);

  // Tab data from filtered links
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
  const age = (d: string) => differenceInDays(now, new Date(d));

  const toggleCol = (tab: string, colKey: string) => {
    setHiddenCols((prev) => {
      const s = new Set(prev[tab]);
      s.has(colKey) ? s.delete(colKey) : s.add(colKey);
      return { ...prev, [tab]: s };
    });
  };

  const isColVisible = (tab: string, colKey: string) => !hiddenCols[tab]?.has(colKey);

  // Get columns for current tab
  const getTabCols = (tab: string) => {
    const map: Record<string, typeof ZERO_COLS> = { zero: ZERO_COLS, dead: DEAD_COLS, source: SOURCE_COLS, spend: SPEND_COLS };
    return map[tab] || ZERO_COLS;
  };

  const currentCols = getTabCols(activeTab);
  const visibleCols = currentCols.filter((c) => c.locked || isColVisible(activeTab, c.key));

  // Export count
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
        <button className="text-destructive hover:text-destructive/80 p-1 rounded transition-colors"><X className="h-4 w-4" /></button>
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
      <SelectTrigger className="h-8 text-xs w-[140px] bg-card border-border">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
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

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect value={filters.model} onValueChange={(v) => setFilter("model", v)} placeholder="All Models" options={distinctModels.map((m: string) => ({ value: m, label: m }))} />
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

          {/* Columns toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs"><Columns3 className="h-3.5 w-3.5 mr-1" /> Columns</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {currentCols.filter((c) => !c.locked && c.label).map((c) => (
                <DropdownMenuCheckboxItem key={c.key} checked={isColVisible(activeTab, c.key)} onCheckedChange={() => toggleCol(activeTab, c.key)}>
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {anyFilterActive && (
            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>
              <FilterX className="h-3.5 w-3.5 mr-1" /> Clear filters
            </Button>
          )}

          <span className="text-xs text-muted-foreground ml-auto">{filteredLinks.length} campaigns shown</span>
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

          {/* TAB 1 — Zero Activity */}
          <TabsContent value="zero">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Campaigns with 0 clicks and 0 subscribers, created over 30 days ago</span>
                <DeleteConfirmBtn ids={Array.from(selected).filter((id) => zeroActivity.some((l: any) => l.id === id))} label="Delete selected" />
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 w-8"><input type="checkbox" onChange={() => selectAll(zeroActivity.map((l: any) => l.id))} checked={zeroActivity.length > 0 && zeroActivity.every((l: any) => selected.has(l.id))} /></th>
                    {visibleCols.map((c) => activeTab === "zero" && (c.locked || isColVisible("zero", c.key)) ? (
                      <th key={c.key} className={`p-2 font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.key === "delete" ? "w-10" : ""}`}>{c.label}</th>
                    ) : null)}
                  </tr>
                </thead>
                <tbody>
                  {zeroActivity.map((l: any) => (
                    <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-2"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                      {isColVisible("zero", "campaign") && <td className="p-2"><div className="font-medium truncate max-w-[250px]">{l.campaign_name}</div><div className="text-muted-foreground truncate max-w-[250px]">{l.url}</div></td>}
                      {isColVisible("zero", "model") && <td className="p-2">{modelName(l)}</td>}
                      {isColVisible("zero", "source") && <td className="p-2">{l.source_tag || "—"}</td>}
                      {isColVisible("zero", "clicks") && <td className="p-2 text-right">{l.clicks}</td>}
                      {isColVisible("zero", "subs") && <td className="p-2 text-right">{l.subscribers}</td>}
                      {isColVisible("zero", "ltv") && <td className="p-2 text-right">${(l.ltv || l.revenue || 0).toFixed(0)}</td>}
                      {isColVisible("zero", "created") && <td className="p-2">{format(new Date(l.created_at), "MMM d, yyyy")}</td>}
                      {isColVisible("zero", "age") && <td className="p-2">{age(l.created_at)}d</td>}
                      <td className="p-2"><InlineDeleteBtn id={l.id} /></td>
                    </tr>
                  ))}
                  {zeroActivity.length === 0 && <tr><td colSpan={20} className="p-8 text-center text-muted-foreground">No zero-activity campaigns found ✓</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 2 — Dead */}
          <TabsContent value="dead">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Active campaigns with no data update in 30+ days</span>
                <DeleteConfirmBtn ids={Array.from(selected).filter((id) => dead.some((l: any) => l.id === id))} label="Delete selected" />
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 w-8"><input type="checkbox" onChange={() => selectAll(dead.map((l: any) => l.id))} checked={dead.length > 0 && dead.every((l: any) => selected.has(l.id))} /></th>
                    {DEAD_COLS.map((c) => (c.locked || isColVisible("dead", c.key)) ? (
                      <th key={c.key} className={`p-2 font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.key === "delete" ? "w-10" : ""}`}>{c.label}</th>
                    ) : null)}
                  </tr>
                </thead>
                <tbody>
                  {dead.map((l: any) => (
                    <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-2"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                      {isColVisible("dead", "campaign") && <td className="p-2"><div className="font-medium truncate max-w-[200px]">{l.campaign_name}</div><div className="text-muted-foreground truncate max-w-[200px]">{l.url}</div></td>}
                      {isColVisible("dead", "model") && <td className="p-2">{modelName(l)}</td>}
                      {isColVisible("dead", "source") && <td className="p-2">{l.source_tag || "—"}</td>}
                      {isColVisible("dead", "clicks") && <td className="p-2 text-right">{l.clicks}</td>}
                      {isColVisible("dead", "subs") && <td className="p-2 text-right">{l.subscribers}</td>}
                      {isColVisible("dead", "ltv") && <td className="p-2 text-right">${(l.ltv || l.revenue || 0).toFixed(0)}</td>}
                      {isColVisible("dead", "lastActivity") && <td className="p-2">{l.calculated_at ? format(new Date(l.calculated_at), "MMM d") : "—"}</td>}
                      {isColVisible("dead", "daysSince") && <td className="p-2">{l.calculated_at ? age(l.calculated_at) + "d" : l.created_at ? age(l.created_at) + "d" : "—"}</td>}
                      <td className="p-2"><InlineDeleteBtn id={l.id} /></td>
                    </tr>
                  ))}
                  {dead.length === 0 && <tr><td colSpan={20} className="p-8 text-center text-muted-foreground">No dead campaigns found ✓</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 3 — Missing Source */}
          <TabsContent value="source">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-3 border-b border-border">
                <span className="text-xs text-muted-foreground">Active campaigns with clicks or subs but no source tag</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {SOURCE_COLS.map((c) => (c.locked || isColVisible("source", c.key)) ? (
                      <th key={c.key} className={`p-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                    ) : null)}
                  </tr>
                </thead>
                <tbody>
                  {missingSource.map((l: any) => {
                    const ageDays = age(l.created_at);
                    const subsPerDay = ageDays > 0 ? (l.subscribers / ageDays).toFixed(1) : "—";
                    return (
                      <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                        {isColVisible("source", "campaign") && <td className="p-2"><div className="font-medium truncate max-w-[200px]">{l.campaign_name}</div><div className="text-muted-foreground truncate max-w-[200px]">{l.url}</div></td>}
                        {isColVisible("source", "model") && <td className="p-2">{modelName(l)}</td>}
                        {isColVisible("source", "clicks") && <td className="p-2 text-right">{l.clicks}</td>}
                        {isColVisible("source", "subs") && <td className="p-2 text-right">{l.subscribers}</td>}
                        {isColVisible("source", "ltv") && <td className="p-2 text-right">${(l.ltv || l.revenue || 0).toFixed(0)}</td>}
                        {isColVisible("source", "subsDay") && <td className="p-2 text-right">{subsPerDay}</td>}
                        {isColVisible("source", "age") && <td className="p-2">{ageDays}d</td>}
                        <td className="p-2"><SourceDropdown link={l} /></td>
                      </tr>
                    );
                  })}
                  {missingSource.length === 0 && <tr><td colSpan={20} className="p-8 text-center text-muted-foreground">All campaigns have source tags ✓</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 4 — Missing Spend */}
          <TabsContent value="spend">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-3 border-b border-border">
                <span className="text-xs text-muted-foreground">Active campaigns with clicks or subs but no spend data</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {SPEND_COLS.map((c) => (c.locked || isColVisible("spend", c.key)) ? (
                      <th key={c.key} className={`p-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                    ) : null)}
                  </tr>
                </thead>
                <tbody>
                  {missingSpend.map((l: any) => {
                    const ageDays = age(l.created_at);
                    const subsPerDay = ageDays > 0 ? (l.subscribers / ageDays).toFixed(1) : "—";
                    const ltvPerSub = l.subscribers > 0 ? ((l.ltv || l.revenue || 0) / l.subscribers).toFixed(2) : "—";
                    const spenderRate = l.subscribers > 0 ? (((l.spenders_count || l.spenders || 0) / l.subscribers) * 100).toFixed(1) + "%" : "—";
                    return (
                      <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                        {isColVisible("spend", "campaign") && <td className="p-2"><div className="font-medium truncate max-w-[200px]">{l.campaign_name}</div><div className="text-muted-foreground truncate max-w-[200px]">{l.url}</div></td>}
                        {isColVisible("spend", "model") && <td className="p-2">{modelName(l)}</td>}
                        {isColVisible("spend", "source") && <td className="p-2">{l.source_tag || "—"}</td>}
                        {isColVisible("spend", "clicks") && <td className="p-2 text-right">{l.clicks}</td>}
                        {isColVisible("spend", "subs") && <td className="p-2 text-right">{l.subscribers}</td>}
                        {isColVisible("spend", "ltv") && <td className="p-2 text-right">${(l.ltv || l.revenue || 0).toFixed(0)}</td>}
                        {isColVisible("spend", "ltvSub") && <td className="p-2 text-right">${ltvPerSub}</td>}
                        {isColVisible("spend", "subsDay") && <td className="p-2 text-right">{subsPerDay}</td>}
                        {isColVisible("spend", "spenderRate") && <td className="p-2 text-right">{spenderRate}</td>}
                        <td className="p-2">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toast.info("Use Bulk Edit CSV to set spend for multiple campaigns at once")}>
                            <DollarSign className="h-3 w-3 mr-1" /> Set
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {missingSpend.length === 0 && <tr><td colSpan={20} className="p-8 text-center text-muted-foreground">All campaigns have spend data ✓</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>

        {/* Deleted campaigns */}
        <Collapsible open={deletedOpen} onOpenChange={setDeletedOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={`h-4 w-4 transition-transform ${deletedOpen ? "rotate-0" : "-rotate-90"}`} />
              Deleted Campaigns ({deletedLinks.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 bg-card rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Campaign</th>
                    <th className="text-left p-2 font-medium">Model</th>
                    <th className="text-left p-2 font-medium">Deleted At</th>
                    <th className="p-2 font-medium">Restore</th>
                  </tr>
                </thead>
                <tbody>
                  {deletedLinks.map((l: any) => (
                    <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-2 max-w-[250px] truncate font-medium">{l.campaign_name}</td>
                      <td className="p-2">{modelName(l)}</td>
                      <td className="p-2">{l.deleted_at ? format(new Date(l.deleted_at), "MMM d, yyyy HH:mm") : "—"}</td>
                      <td className="p-2">
                        <Button variant="outline" size="sm" className="h-7 text-xs text-primary hover:text-primary" onClick={() => restore(l.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" /> Restore
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {deletedLinks.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No deleted campaigns</td></tr>}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <ImportAuditCsvModal open={importAuditOpen} onClose={() => setImportAuditOpen(false)} onComplete={refreshAll} trackingLinks={activeLinks} accounts={accounts} />
    </DashboardLayout>
  );
}

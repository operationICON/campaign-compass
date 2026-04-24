import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs, fetchAccounts, triggerSync } from "@/lib/supabase-helpers";
import { streamSync } from "@/lib/api";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle, XCircle, Clock, Loader2,
  ChevronDown, ChevronRight, Filter, ChevronLeft, ChevronRight as ChevronRightIcon,
  BarChart3, Camera, Users, Truck, Play, Square, Zap, History, GitMerge,
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { SortableTh } from "@/components/SortableTh";

import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 25;

type SyncType = "dashboard" | "snapshot" | "snapshot_backfill" | "ltv" | "onlytraffic" | "ot_snapshot" | "crosspoll" | "revenue_breakdown";

const SYNC_COLORS: Record<SyncType, { bg: string; text: string; border: string; badge: string }> = {
  dashboard:         { bg: "bg-blue-500/10",    text: "text-blue-600 dark:text-blue-400",      border: "border-blue-500/30",   badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  snapshot:          { bg: "bg-emerald-500/10",  text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  snapshot_backfill: { bg: "bg-teal-500/10",     text: "text-teal-600 dark:text-teal-400",       border: "border-teal-500/30",    badge: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  ltv:               { bg: "bg-purple-500/10",   text: "text-purple-600 dark:text-purple-400",   border: "border-purple-500/30",  badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  onlytraffic:       { bg: "bg-orange-500/10",   text: "text-orange-600 dark:text-orange-400",   border: "border-orange-500/30",  badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  ot_snapshot:       { bg: "bg-amber-500/10",    text: "text-amber-600 dark:text-amber-400",     border: "border-amber-500/30",   badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  crosspoll:         { bg: "bg-pink-500/10",     text: "text-pink-600 dark:text-pink-400",       border: "border-pink-500/30",    badge: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
  revenue_breakdown: { bg: "bg-green-500/10",   text: "text-green-600 dark:text-green-400",     border: "border-green-500/30",   badge: "bg-green-500/15 text-green-700 dark:text-green-300" },
};

const SYNC_LABELS: Record<SyncType, string> = {
  dashboard: "Dashboard",
  snapshot: "Snapshots",
  snapshot_backfill: "Backfill",
  ltv: "LTV",
  onlytraffic: "OnlyTraffic",
  ot_snapshot: "OT Snapshots",
  crosspoll: "Cross-Poll",
  revenue_breakdown: "Rev Breakdown",
};

const SYNC_ICONS: Record<SyncType, typeof BarChart3> = {
  dashboard: BarChart3,
  snapshot: Camera,
  snapshot_backfill: History,
  ltv: Users,
  onlytraffic: Truck,
  ot_snapshot: Camera,
  crosspoll: GitMerge,
  revenue_breakdown: BarChart3,
};

function classifySyncType(log: any): SyncType {
  const msg = (log.message || "").toLowerCase();
  const details = JSON.stringify(log.details || {}).toLowerCase();
  const triggered = (log.triggered_by || "").toLowerCase();
  if (triggered.includes("ot_snapshot") || triggered.includes("onlytraffic_snapshot") || msg.includes("ot snapshot") || details.includes("ot_snapshot")) return "ot_snapshot";
  if (triggered.includes("revenue_breakdown") || msg.includes("revenue breakdown")) return "revenue_breakdown";
  if (triggered.includes("ltv") || triggered.includes("fan_sync") || msg.includes("ltv") || msg.includes("fan sync")) return "ltv";
  if (triggered.includes("crosspoll") || msg.includes("cross-poll") || msg.includes("crosspoll")) return "crosspoll";
  if (triggered.includes("backfill") || msg.includes("backfill")) return "snapshot_backfill";
  if (triggered.includes("snapshot") || msg.includes("snapshot")) return "snapshot";
  if (triggered.includes("onlytraffic") || msg.includes("onlytraffic") || msg.includes("auto-tag")) return "onlytraffic";
  return "dashboard";
}

function getEffectiveStatus(log: any) {
  if (log.status === "running" || log.status === "pending") {
    const elapsed = Date.now() - new Date(log.started_at).getTime();
    if (elapsed > 10 * 60 * 1000) return "error";
  }
  return log.status;
}

type StatusFilter = "all" | "success" | "error" | "running";
type TypeFilter = "all" | SyncType;
type LogSortKey = "date" | "type" | "account" | "records" | "duration" | "status";

export default function LogsPage() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<LogSortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [syncPage, setSyncPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  

  // Running state per sync type
  const [running, setRunning] = useState<Record<SyncType, boolean>>({ dashboard: false, snapshot: false, snapshot_backfill: false, ltv: false, onlytraffic: false, ot_snapshot: false, crosspoll: false, revenue_breakdown: false });
  const [progress, setProgress] = useState<Record<SyncType, string>>({ dashboard: "", snapshot: "", snapshot_backfill: "", ltv: "", onlytraffic: "", ot_snapshot: "", crosspoll: "", revenue_breakdown: "" });
  const abortRefs = useRef<Record<string, AbortController>>({});

  const [allRunning, setAllRunning] = useState(false);
  const [allProgress, setAllProgress] = useState("");

  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    }, 10000);
    return () => clearInterval(id);
  }, [queryClient]);

  // Classify all logs
  const classifiedLogs = useMemo(() => logs.map((log: any) => ({
    ...log,
    syncType: classifySyncType(log),
    effectiveStatus: getEffectiveStatus(log),
  })), [logs]);

  // Build status cards from last log per type
  const statusCards = useMemo(() => {
    const cards: Record<SyncType, any> = { dashboard: null, snapshot: null, snapshot_backfill: null, ltv: null, onlytraffic: null, ot_snapshot: null, crosspoll: null, revenue_breakdown: null };
    for (const log of classifiedLogs) {
      const t = log.syncType as SyncType;
      if (!cards[t]) cards[t] = log;
    }
    return cards;
  }, [classifiedLogs]);

  // All-time aggregates per sync type across all successful runs
  const allTimeStats = useMemo(() => {
    const zero = () => ({ runs: 0, records: 0, links: 0, accounts: 0, credits: 0 });
    const totals: Record<SyncType, ReturnType<typeof zero>> = {
      dashboard: zero(), snapshot: zero(), snapshot_backfill: zero(), ltv: zero(),
      onlytraffic: zero(), ot_snapshot: zero(), crosspoll: zero(), revenue_breakdown: zero(),
    };
    for (const log of classifiedLogs) {
      if (log.effectiveStatus !== "success" && log.effectiveStatus !== "partial") continue;
      const t = totals[log.syncType as SyncType];
      t.runs++;
      t.records  += Number(log.records_processed     ?? 0);
      t.links    += Number(log.tracking_links_synced  ?? 0);
      t.accounts += Number(log.accounts_synced        ?? 0);
      t.credits  += Number(log.details?.api_calls     ?? 0);
    }
    return totals;
  }, [classifiedLogs]);

  // Total credits consumed per sync type across all runs
  const totalCredits = useMemo(() => {
    const totals: Record<SyncType, number> = { dashboard: 0, snapshot: 0, snapshot_backfill: 0, ltv: 0, onlytraffic: 0, ot_snapshot: 0, crosspoll: 0, revenue_breakdown: 0 };
    for (const log of classifiedLogs) {
      const calls = log.details?.api_calls ?? 0;
      if (calls > 0) totals[log.syncType as SyncType] += calls;
    }
    return totals;
  }, [classifiedLogs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return classifiedLogs.filter((log: any) => {
      if (statusFilter !== "all" && log.effectiveStatus !== statusFilter) return false;
      if (typeFilter !== "all" && log.syncType !== typeFilter) return false;
      return true;
    });
  }, [classifiedLogs, statusFilter, typeFilter]);

  // Sort logs
  const sortedLogs = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    const dur = (log: any) => {
      const end = log.completed_at || log.finished_at;
      if (!end) return -1;
      return new Date(end).getTime() - new Date(log.started_at).getTime();
    };
    const getVal = (log: any): number | string => {
      switch (sortKey) {
        case "date": return new Date(log.started_at).getTime();
        case "type": return SYNC_LABELS[log.syncType as SyncType] || "";
        case "account": return (log.accounts?.display_name || "").toLowerCase();
        case "records": return Number(log.records_processed || 0);
        case "duration": return dur(log);
        case "status": return log.effectiveStatus || "";
      }
    };
    return [...filteredLogs].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((va as number) - (vb as number));
    });
  }, [filteredLogs, sortKey, sortAsc]);

  const handleSort = (k: LogSortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };

  const syncTotalPages = Math.max(1, Math.ceil(sortedLogs.length / PAGE_SIZE));
  const syncPageLogs = sortedLogs.slice((syncPage - 1) * PAGE_SIZE, syncPage * PAGE_SIZE);

  useEffect(() => { setSyncPage(1); }, [statusFilter, typeFilter, sortKey, sortAsc]);

  // Stop handler — aborts live SSE + cancels all running DB logs for the type
  // Pass a specific logId to kill only that row (from the history table Kill button)
  const stopSync = useCallback(async (type: string, specificLogId?: string) => {
    const ctrl = abortRefs.current[type];
    if (ctrl) {
      ctrl.abort();
      delete abortRefs.current[type];
    }
    const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
    const body = specificLogId
      ? { sync_log_id: specificLogId }
      : { sync_type: type };
    await fetch(`${apiBase}/sync/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
    setRunning(r => ({ ...r, [type]: false }));
    setProgress(p => ({ ...p, [type]: "" }));
    queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    toast.info(`${SYNC_LABELS[type as SyncType]} sync stopped`);
  }, [queryClient]);

  // Sync handlers
  const runDashboardSync = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.dashboard = ctrl;
    setRunning(r => ({ ...r, dashboard: true }));
    setProgress(p => ({ ...p, dashboard: "Starting..." }));
    try {
      await triggerSync(undefined, true, (msg) => {
        if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
        setProgress(p => ({ ...p, dashboard: msg }));
      });
      if (ctrl.signal.aborted) return;
      toast.success("Dashboard sync complete");
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Dashboard sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.dashboard;
      setRunning(r => ({ ...r, dashboard: false }));
      setProgress(p => ({ ...p, dashboard: "" }));
    }
  }, [queryClient]);

  const runSnapshotSync = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.snapshot = ctrl;
    setRunning(r => ({ ...r, snapshot: true }));
    setProgress(p => ({ ...p, snapshot: "Starting..." }));
    try {
      const lastData = await streamSync(
        "/sync/snapshots",
        { triggered_by: "manual" },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, snapshot: msg })); },
        ctrl.signal,
      );

      if (ctrl.signal.aborted) return;
      toast.success(`Snapshot sync complete — ${lastData?.snapshots_saved ?? 0} snapshots saved`);
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["daily_snapshots"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Snapshot sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.snapshot;
      setRunning(r => ({ ...r, snapshot: false }));
      setProgress(p => ({ ...p, snapshot: "" }));
    }
  }, [queryClient]);

  const runOnlyTrafficSync = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.onlytraffic = ctrl;
    setRunning(r => ({ ...r, onlytraffic: true }));
    setProgress(p => ({ ...p, onlytraffic: "Starting..." }));
    try {
      const lastData = await streamSync(
        "/sync/onlytraffic",
        { triggered_by: "manual" },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, onlytraffic: msg })); },
        ctrl.signal,
      );

      if (ctrl.signal.aborted) return;
      const linksUpdated = lastData?.links_updated ?? 0;
      const unmatched = lastData?.unmatched ?? 0;
      toast.success(`OnlyTraffic sync complete — ${linksUpdated} links updated${unmatched > 0 ? `, ${unmatched} unmatched` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`OnlyTraffic sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.onlytraffic;
      setRunning(r => ({ ...r, onlytraffic: false }));
      setProgress(p => ({ ...p, onlytraffic: "" }));
    }
  }, [queryClient]);

  const runBackfillSync = useCallback(async (days = 7) => {
    const ctrl = new AbortController();
    abortRefs.current.snapshot_backfill = ctrl;
    setRunning(r => ({ ...r, snapshot_backfill: true }));
    setProgress(p => ({ ...p, snapshot_backfill: "Starting..." }));
    try {
      const lastData = await streamSync(
        "/sync/snapshots/backfill",
        { triggered_by: "manual", days },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, snapshot_backfill: msg })); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      toast.success(`Backfill complete — ${lastData?.snapshots_saved ?? 0} rows saved`);
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["daily_snapshots"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Backfill failed: ${err.message}`);
    } finally {
      delete abortRefs.current.snapshot_backfill;
      setRunning(r => ({ ...r, snapshot_backfill: false }));
      setProgress(p => ({ ...p, snapshot_backfill: "" }));
    }
  }, [queryClient]);

  const runCrosspollSync = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.crosspoll = ctrl;
    setRunning(r => ({ ...r, crosspoll: true }));
    setProgress(p => ({ ...p, crosspoll: "Starting..." }));
    try {
      const lastData = await streamSync(
        "/sync/crosspoll",
        { triggered_by: "manual" },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, crosspoll: msg })); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (lastData?.step === "error") throw new Error(lastData.error ?? "Unknown error");
      const errCount = lastData?.errors ?? 0;
      if (errCount > 0) {
        toast.warning(`Cross-poll sync — ${lastData?.links_updated ?? 0} links updated, ${errCount} failed`);
      } else {
        toast.success(`Cross-poll sync complete — ${lastData?.links_updated ?? 0} links updated`);
      }
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Cross-poll sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.crosspoll;
      setRunning(r => ({ ...r, crosspoll: false }));
      setProgress(p => ({ ...p, crosspoll: "" }));
    }
  }, [queryClient]);

  const runRevenueBreakdownSync = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.revenue_breakdown = ctrl;
    setRunning(r => ({ ...r, revenue_breakdown: true }));
    setProgress(p => ({ ...p, revenue_breakdown: "Starting..." }));
    try {
      const lastData = await streamSync(
        "/sync/revenue-breakdown",
        { triggered_by: "manual" },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, revenue_breakdown: msg })); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (lastData?.step === "error") throw new Error(lastData.error ?? "Unknown error");
      const updated = lastData?.accounts_updated ?? 0;
      if (updated === 0) {
        toast.warning("Revenue breakdown sync — no transaction data found. Run a Dashboard sync first to populate transactions.");
      } else {
        toast.success(`Revenue breakdown sync complete — ${updated} accounts updated`);
      }
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Revenue breakdown sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.revenue_breakdown;
      setRunning(r => ({ ...r, revenue_breakdown: false }));
      setProgress(p => ({ ...p, revenue_breakdown: "" }));
    }
  }, [queryClient]);

  const runAllSync = useCallback(async () => {
    setAllRunning(true);
    const steps = [
      { label: "Dashboard", fn: runDashboardSync },
      { label: "OnlyTraffic", fn: runOnlyTrafficSync },
      { label: "Backfill (7d)", fn: () => runBackfillSync(7) },
      { label: "Snapshots", fn: runSnapshotSync },
      { label: "Cross-Poll", fn: runCrosspollSync },
    ];
    for (const { label, fn } of steps) {
      setAllProgress(`Running ${label}...`);
      await fn();
    }
    setAllRunning(false);
    setAllProgress("");
    toast.success("Full sync complete");
    queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
  }, [runDashboardSync, runSnapshotSync, runOnlyTrafficSync, runBackfillSync, runCrosspollSync, queryClient]);

  const syncHandlers: Partial<Record<SyncType, () => void>> = {
    dashboard: runDashboardSync,
    snapshot: runSnapshotSync,
    snapshot_backfill: () => runBackfillSync(7),
    onlytraffic: runOnlyTrafficSync,
    crosspoll: runCrosspollSync,
    revenue_breakdown: runRevenueBreakdownSync,
  };

  const hasFilters = statusFilter !== "all" || typeFilter !== "all";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ═══ Header ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-medium text-foreground">Sync Center</h1>
            <p className="text-sm text-muted-foreground">{logs.length.toLocaleString()} sync runs recorded</p>
          </div>
          <RefreshButton queryKeys={["sync_logs", "accounts"]} />
        </div>

        {/* ═══ SYNC ALL ═══ */}
        <div className="flex flex-col gap-1.5">
          <Button
            onClick={runAllSync}
            disabled={allRunning || Object.values(running).some(Boolean)}
            className="h-auto py-4 px-6 flex items-center justify-center gap-3 bg-primary hover:bg-primary/90 text-primary-foreground w-full"
          >
            {allRunning
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <Zap className="h-5 w-5" />}
            <div className="text-left">
              <div className="text-sm font-bold">Sync All</div>
              <div className="text-xs opacity-75">
                {allRunning && allProgress ? allProgress : "Dashboard → Snapshots → OnlyTraffic"}
              </div>
            </div>
          </Button>
        </div>

        {/* ═══ SYNC BUTTONS ═══ */}
        <div className="grid grid-cols-6 gap-3">
          {(["dashboard", "onlytraffic", "snapshot", "snapshot_backfill", "crosspoll", "revenue_breakdown"] as SyncType[]).map((type) => {
            const Icon = SYNC_ICONS[type];
            const colors = SYNC_COLORS[type];
            const isRunning = running[type];
            const dbRunning = statusCards[type]?.effectiveStatus === "running";
            const showStop = isRunning || dbRunning;

            return (
              <div key={type} className="flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  onClick={syncHandlers[type]}
                  disabled={showStop || allRunning}
                  className={`h-auto py-4 px-4 flex flex-col items-center gap-2 ${colors.border} hover:${colors.bg} transition-all`}
                >
                  {showStop ? (
                    <Loader2 className={`h-5 w-5 animate-spin ${colors.text}`} />
                  ) : (
                    <Icon className={`h-5 w-5 ${colors.text}`} />
                  )}
                  <span className="text-sm font-semibold text-foreground">
                    Sync {SYNC_LABELS[type]}
                  </span>
                  {isRunning && progress[type] && (
                    <span className="text-[10px] text-muted-foreground text-center truncate max-w-full">
                      {progress[type]}
                    </span>
                  )}
                  {!isRunning && dbRunning && (
                    <span className="text-[10px] text-muted-foreground text-center">Running…</span>
                  )}
                </Button>
                {showStop && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => stopSync(type)}
                    className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                  >
                    <Square className="h-3 w-3" />
                    Stop
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* ═══ SYNC STATUS CARDS ═══ */}
        <div className="grid grid-cols-6 gap-3">
          {(["dashboard", "onlytraffic", "snapshot", "snapshot_backfill", "crosspoll", "revenue_breakdown"] as SyncType[]).map((type) => {
            const colors = SYNC_COLORS[type];
            const Icon = SYNC_ICONS[type];
            const last = statusCards[type];
            const endTime = last?.completed_at || last?.finished_at;
            const duration = last && endTime
              ? Math.round((new Date(endTime).getTime() - new Date(last.started_at).getTime()) / 1000)
              : null;
            const status = last ? last.effectiveStatus : null;
            const isRunning = running[type];
            const dbRunning = status === "running";
            const showStop = isRunning || dbRunning;

            return (
              <Card key={type} className={`border ${colors.border} overflow-hidden`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-md ${colors.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${colors.text}`} />
                      </div>
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                        {SYNC_LABELS[type]}
                      </span>
                    </div>
                    {status && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        status === "success" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                        status === "error" ? "bg-destructive/15 text-destructive" :
                        "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      }`}>
                        {status === "success" ? <CheckCircle className="h-2.5 w-2.5" /> :
                         status === "error" ? <XCircle className="h-2.5 w-2.5" /> :
                         <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                        {status === "error" ? "Failed" : status === "success" ? "Success" : "Running"}
                      </span>
                    )}
                  </div>
                  {showStop && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => stopSync(type)}
                      className="w-full h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </Button>
                  )}

                  {(() => {
                    const stats = allTimeStats[type];
                    const hasData = stats.runs > 0;
                    return hasData ? (
                      <div className="space-y-2">
                        {/* All-time primary stat */}
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">All Time</p>
                          <p className="text-[22px] font-bold font-mono text-foreground leading-tight">
                            {stats.records > 0 ? stats.records.toLocaleString() : stats.links > 0 ? stats.links.toLocaleString() : stats.runs.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {stats.records > 0 ? "records" : stats.links > 0 ? "links" : "runs"} · {stats.runs} sync{stats.runs !== 1 ? "s" : ""}
                          </p>
                        </div>
                        {/* Secondary all-time stats */}
                        <div className="space-y-1 border-t border-border/40 pt-1.5">
                          {stats.links > 0 && stats.records > 0 && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Links</span>
                              <span className="font-mono text-foreground">{stats.links.toLocaleString()}</span>
                            </div>
                          )}
                          {stats.accounts > 0 && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Accounts</span>
                              <span className="font-mono text-foreground">{stats.accounts.toLocaleString()}</span>
                            </div>
                          )}
                          {stats.credits > 0 && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1 text-muted-foreground"><Zap className="h-3 w-3" />Credits</span>
                              <span className="font-mono font-bold text-primary">{stats.credits.toLocaleString()}</span>
                            </div>
                          )}
                          {last && (
                            <div className="flex items-center justify-between text-xs border-t border-border/30 pt-1">
                              <span className="text-muted-foreground">Last run</span>
                              <span className="font-mono text-muted-foreground">{format(new Date(last.started_at), "MMM d, HH:mm")}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-2">Never run</p>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ═══ MANUAL SYNC NOTE ═══ */}
        <p className="text-center text-muted-foreground" style={{ fontSize: 11 }}>
          ⓘ Snapshot sync saves today's incremental stats for all active tracking links. Dashboard sync updates accounts, links, and transactions.
        </p>

        {/* ═══ SYNC HISTORY TABLE ═══ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Sync History</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value as TypeFilter)}
                  className="text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  <option value="all">All Types</option>
                  <option value="dashboard">Dashboard</option>
                  <option value="snapshot">Snapshots</option>
                  <option value="ltv">LTV</option>
                  <option value="onlytraffic">OnlyTraffic</option>
                  <option value="ot_snapshot">OT Snapshots</option>
                  <option value="revenue_breakdown">Rev Breakdown</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                  className="text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  <option value="all">All Statuses</option>
                  <option value="success">Success</option>
                  <option value="error">Failed</option>
                  <option value="running">Running</option>
                </select>
              </div>
              {hasFilters && (
                <button
                  onClick={() => { setStatusFilter("all"); setTypeFilter("all"); }}
                  className="text-xs text-primary hover:underline"
                >
                  Clear
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {filteredLogs.length} result{filteredLogs.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton-shimmer h-12 rounded-lg" />)}
            </div>
          ) : !filteredLogs.length ? (
            <div className="bg-card border border-border rounded-lg p-12 text-center text-muted-foreground text-sm">
              {hasFilters ? "No logs match your filters" : "No sync logs yet — run a sync to get started"}
            </div>
          ) : (
            <>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <SortableTh<LogSortKey> label="Date & Time" sortKey="date" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" className="py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }} />
                        <SortableTh<LogSortKey> label="Type" sortKey="type" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" className="py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }} />
                        <SortableTh<LogSortKey> label="Account" sortKey="account" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="left" className="py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }} />
                        <SortableTh<LogSortKey> label="Records" sortKey="records" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }} />
                        <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>
                          <span className="flex items-center justify-end gap-1"><Zap className="h-3 w-3" />Credits</span>
                        </th>
                        <SortableTh<LogSortKey> label="Duration" sortKey="duration" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" className="py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }} />
                        <SortableTh<LogSortKey> label="Status" sortKey="status" activeKey={sortKey} asc={sortAsc} onSort={handleSort} align="center" className="py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }} />
                        <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Triggered by</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Message</th>
                        <th className="py-2.5 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {syncPageLogs.map((log: any) => {
                        const syncType = log.syncType as SyncType;
                        const colors = SYNC_COLORS[syncType];
                        const status = log.effectiveStatus;
                        const endTime = log.completed_at || log.finished_at;
                        const duration = endTime
                          ? Math.round((new Date(endTime).getTime() - new Date(log.started_at).getTime()) / 1000)
                          : status === "error"
                            ? Math.round(Math.min(Date.now() - new Date(log.started_at).getTime(), 10 * 60 * 1000) / 1000)
                            : null;
                        const isExpanded = expandedLogId === log.id;
                        const displayMessage = log.error_message || log.message || "";

                        return (
                          <tr
                            key={log.id}
                            className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-secondary/20 ${isExpanded ? "bg-secondary/30" : ""}`}
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          >
                            <td className="py-2.5 px-4 font-mono text-muted-foreground whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                                {format(new Date(log.started_at), "MMM d, HH:mm")}
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${colors.badge}`}>
                                {SYNC_LABELS[syncType]}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-foreground">
                              {log.accounts?.display_name || "—"}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-foreground">
                              {log.records_processed ?? 0}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono">
                              {(log.details?.api_calls ?? 0) > 0
                                ? <span className="text-primary font-bold">{log.details.api_calls}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                              {duration !== null ? `${duration}s` : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                status === "success" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                                status === "error" ? "bg-destructive/15 text-destructive" :
                                "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              }`}>
                                {status === "success" ? <CheckCircle className="h-2.5 w-2.5" /> :
                                 status === "error" ? <XCircle className="h-2.5 w-2.5" /> :
                                 <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                {status === "error" ? "Failed" : status === "success" ? "Success" : "Running"}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                              {log.triggered_by ? (log.triggered_by === "manual" ? "LIZA (manual)" : log.triggered_by) : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground max-w-[250px] truncate">
                              {status === "error" ? (
                                <span className="text-destructive">{displayMessage || "Unknown error"}</span>
                              ) : (
                                displayMessage || "—"
                              )}
                            </td>
                            <td className="py-2.5 px-2" onClick={e => e.stopPropagation()}>
                              {log.status === "running" && (
                                <button
                                  onClick={() => stopSync(log.syncType, log.id)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Force stop this run"
                                >
                                  <Square className="h-2.5 w-2.5" /> Kill
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Expanded detail row rendered below table */}
                {expandedLogId && (() => {
                  const log = syncPageLogs.find((l: any) => l.id === expandedLogId);
                  if (!log) return null;
                  const details = log.details;
                  return (
                    <div className="border-t border-border bg-secondary/20 p-4 space-y-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        {log.accounts_synced != null && (
                          <div>
                            <p className="text-muted-foreground">Accounts synced</p>
                            <p className="font-mono font-bold text-foreground">{log.accounts_synced}</p>
                          </div>
                        )}
                        {log.tracking_links_synced != null && (
                          <div>
                            <p className="text-muted-foreground">Links synced</p>
                            <p className="font-mono font-bold text-foreground">{log.tracking_links_synced}</p>
                          </div>
                        )}
                        {(log.details?.api_calls ?? 0) > 0 && (
                          <div>
                            <p className="flex items-center gap-1 text-muted-foreground"><Zap className="h-3 w-3" />Credits used</p>
                            <p className="font-mono font-bold text-primary">{log.details.api_calls}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-muted-foreground">Started</p>
                          <p className="font-mono text-foreground">{format(new Date(log.started_at), "HH:mm:ss")}</p>
                        </div>
                        {(log.completed_at || log.finished_at) && (
                          <div>
                            <p className="text-muted-foreground">Finished</p>
                            <p className="font-mono text-foreground">{format(new Date(log.completed_at || log.finished_at), "HH:mm:ss")}</p>
                          </div>
                        )}
                      </div>
                      {log.error_message && (
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Error</p>
                          <p className="text-xs text-destructive">{log.error_message}</p>
                        </div>
                      )}
                      {details && typeof details === "object" && (
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Details</p>
                          <pre className="text-[11px] text-muted-foreground bg-secondary/50 p-2 rounded overflow-x-auto max-h-40">
                            {JSON.stringify(details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Pagination */}
              {syncTotalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Page {syncPage} of {syncTotalPages} · {filteredLogs.length} total
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSyncPage(p => Math.max(1, p - 1))}
                      disabled={syncPage <= 1}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 disabled:opacity-30"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </button>
                    <button
                      onClick={() => setSyncPage(p => Math.min(syncTotalPages, p + 1))}
                      disabled={syncPage >= syncTotalPages}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 disabled:opacity-30"
                    >
                      Next <ChevronRightIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
    </DashboardLayout>
  );
}

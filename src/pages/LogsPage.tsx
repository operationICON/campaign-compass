import { useEffect, useState, useMemo, useCallback, useRef, Fragment } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs, fetchAccounts, triggerSync } from "@/lib/supabase-helpers";
import { streamSync } from "@/lib/api";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle, XCircle, Clock, Loader2, AlertCircle,
  ChevronDown, ChevronRight, Filter, ChevronLeft, ChevronRight as ChevronRightIcon,
  BarChart3, Camera, Users, Truck, Play, Square, Zap, History, GitMerge, Bot, Hand,
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { SortableTh } from "@/components/SortableTh";

import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE = 25;

type SyncType = "dashboard" | "snapshot" | "snapshot_backfill" | "ltv" | "onlytraffic" | "ot_snapshot" | "crosspoll" | "revenue_breakdown" | "fans" | "subscribers";

const SYNC_COLORS: Record<SyncType, { bg: string; text: string; border: string; badge: string }> = {
  dashboard:         { bg: "bg-blue-500/10",    text: "text-blue-600 dark:text-blue-400",      border: "border-blue-500/30",   badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  snapshot:          { bg: "bg-emerald-500/10",  text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  snapshot_backfill: { bg: "bg-teal-500/10",     text: "text-teal-600 dark:text-teal-400",       border: "border-teal-500/30",    badge: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  ltv:               { bg: "bg-purple-500/10",   text: "text-purple-600 dark:text-purple-400",   border: "border-purple-500/30",  badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  onlytraffic:       { bg: "bg-orange-500/10",   text: "text-orange-600 dark:text-orange-400",   border: "border-orange-500/30",  badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  ot_snapshot:       { bg: "bg-amber-500/10",    text: "text-amber-600 dark:text-amber-400",     border: "border-amber-500/30",   badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  crosspoll:         { bg: "bg-pink-500/10",     text: "text-pink-600 dark:text-pink-400",       border: "border-pink-500/30",    badge: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
  revenue_breakdown: { bg: "bg-green-500/10",    text: "text-green-600 dark:text-green-400",     border: "border-green-500/30",   badge: "bg-green-500/15 text-green-700 dark:text-green-300" },
  fans:              { bg: "bg-rose-500/10",      text: "text-rose-600 dark:text-rose-400",       border: "border-rose-500/30",    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  subscribers:       { bg: "bg-violet-500/10",    text: "text-violet-600 dark:text-violet-400",   border: "border-violet-500/30",  badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
};

const SYNC_LABELS: Record<SyncType, string> = {
  dashboard: "Dashboard",
  snapshot: "Snapshots",
  snapshot_backfill: "Backfill",
  ltv: "Analytics",
  onlytraffic: "OnlyTraffic",
  ot_snapshot: "OT Snapshots",
  crosspoll: "Cross-Poll",
  revenue_breakdown: "Rev Breakdown",
  fans: "Fans",
  subscribers: "Sub Attribution",
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
  fans: Users,
  subscribers: GitMerge,
};

function isAutoTriggered(log: any): boolean {
  const t = (log.triggered_by || "").toLowerCase();
  return t.includes("cron") || t.includes("scheduler") || t.includes("auto") || t.includes("interval");
}

function friendlyTriggeredBy(log: any): string {
  const t = (log.triggered_by || "").toLowerCase();
  if (t.includes("cron_daily"))     return "Auto — Daily (02:00 UTC)";
  if (t.includes("cron_dashboard")) return "Auto — Daily (01:00 UTC)";
  if (t.includes("cron_interval"))  return "Auto — OT Interval";
  if (t.includes("cron"))           return "Auto — Scheduled";
  return "Manual";
}

function nextUtcHour(hour: number): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function classifySyncType(log: any): SyncType {
  const msg = (log.message || "").toLowerCase();
  const details = JSON.stringify(log.details || {}).toLowerCase();
  const triggered = (log.triggered_by || "").toLowerCase();
  if (triggered.includes("ot_snapshot") || triggered.includes("onlytraffic_snapshot") || msg.includes("ot snapshot") || details.includes("ot_snapshot")) return "ot_snapshot";
  if (triggered.includes("revenue_breakdown") || msg.includes("revenue breakdown")) return "revenue_breakdown";
  if (triggered.includes("subscriber_sync")) return "subscribers";
  if (triggered.includes("fan_sync") || triggered.includes("fan_bootstrap")) return "fans";
  if (triggered.includes("ltv") || msg.includes("ltv")) return "ltv";
  if (triggered.includes("crosspoll") || msg.includes("cross-poll") || msg.includes("crosspoll")) return "crosspoll";
  if (triggered.includes("backfill") || msg.includes("backfill")) return "snapshot_backfill";
  if (triggered.includes("snapshot") || msg.includes("snapshot")) return "snapshot";
  if (triggered.includes("onlytraffic") || msg.includes("onlytraffic") || msg.includes("auto-tag")) return "onlytraffic";
  return "dashboard";
}

function getEffectiveStatus(log: any) {
  if (log.status === "running" || log.status === "pending") {
    const elapsed = Date.now() - new Date(log.started_at).getTime();
    // Revenue breakdown can run 60-90 min on a full scan — give it more headroom
    const threshold = (log.triggered_by || "").includes("revenue_breakdown")
      ? 120 * 60 * 1000
      : 15 * 60 * 1000;
    if (elapsed > threshold) return "error";
  }
  return log.status;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
      <CheckCircle className="h-2.5 w-2.5" /> Success
    </span>
  );
  if (status === "partial") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/15 text-amber-600 dark:text-amber-400">
      <AlertCircle className="h-2.5 w-2.5" /> Partial
    </span>
  );
  if (status === "error") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-destructive/15 text-destructive">
      <XCircle className="h-2.5 w-2.5" /> Failed
    </span>
  );
  if (status === "running") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/15 text-blue-600 dark:text-blue-400">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Running
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-secondary text-muted-foreground">
      {status}
    </span>
  );
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
  const [running, setRunning] = useState<Record<SyncType, boolean>>({ dashboard: false, snapshot: false, snapshot_backfill: false, ltv: false, onlytraffic: false, ot_snapshot: false, crosspoll: false, revenue_breakdown: false, fans: false, subscribers: false });
  const [progress, setProgress] = useState<Record<SyncType, string>>({ dashboard: "", snapshot: "", snapshot_backfill: "", ltv: "", onlytraffic: "", ot_snapshot: "", crosspoll: "", revenue_breakdown: "", fans: "", subscribers: "" });
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

  // Per-account child logs (account_id set) spawned by grouped sync types.
  // They're surfaced inside the parent row's expand panel — not as top-level table rows.
  const GROUPED_TYPES = new Set<SyncType>(["dashboard", "revenue_breakdown"]);
  const isChildLog = (log: any) => !!log.account_id && GROUPED_TYPES.has(log.syncType as SyncType);

  // Build status cards from last log per type — skip child logs
  const statusCards = useMemo(() => {
    const cards: Record<SyncType, any> = { dashboard: null, snapshot: null, snapshot_backfill: null, ltv: null, onlytraffic: null, ot_snapshot: null, crosspoll: null, revenue_breakdown: null, fans: null, subscribers: null };
    for (const log of classifiedLogs) {
      if (isChildLog(log)) continue;
      const t = log.syncType as SyncType;
      if (!cards[t]) cards[t] = log;
    }
    return cards;
  }, [classifiedLogs]);

  // All-time aggregates per sync type — skip dashboard children to avoid double-counting
  const allTimeStats = useMemo(() => {
    const zero = () => ({ runs: 0, records: 0, links: 0, accounts: 0, credits: 0 });
    const totals: Record<SyncType, ReturnType<typeof zero>> = {
      dashboard: zero(), snapshot: zero(), snapshot_backfill: zero(), ltv: zero(),
      onlytraffic: zero(), ot_snapshot: zero(), crosspoll: zero(), revenue_breakdown: zero(), fans: zero(), subscribers: zero(),
    };
    for (const log of classifiedLogs) {
      if (isChildLog(log)) continue;
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

  // Total credits consumed per sync type — skip dashboard children
  const totalCredits = useMemo(() => {
    const totals: Record<SyncType, number> = { dashboard: 0, snapshot: 0, snapshot_backfill: 0, ltv: 0, onlytraffic: 0, ot_snapshot: 0, crosspoll: 0, revenue_breakdown: 0, fans: 0, subscribers: 0 };
    for (const log of classifiedLogs) {
      if (isChildLog(log)) continue;
      const calls = log.details?.api_calls ?? 0;
      if (calls > 0) totals[log.syncType as SyncType] += calls;
    }
    return totals;
  }, [classifiedLogs]);

  // Filter logs — hide per-account dashboard children from the history table
  const filteredLogs = useMemo(() => {
    return classifiedLogs.filter((log: any) => {
      if (isChildLog(log)) return false;
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
      const errors = lastData?.errors ?? 0;
      if (errors > 0 && updated === 0) {
        toast.warning(`Revenue breakdown sync — all accounts failed (${errors} errors). Check API key / rate limits.`);
      } else if (updated === 0) {
        toast.warning("Revenue breakdown sync — no transactions found.");
      } else if (errors > 0) {
        toast.warning(`Revenue breakdown sync — ${updated} accounts updated, ${errors} failed`);
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

  const runRevenueFullScan = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.revenue_breakdown = ctrl;
    setRunning(r => ({ ...r, revenue_breakdown: true }));
    setProgress(p => ({ ...p, revenue_breakdown: "Full history scan — fetching all transactions..." }));
    try {
      const lastData = await streamSync(
        "/sync/revenue-breakdown",
        { triggered_by: "manual_full_scan", force_full: true },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, revenue_breakdown: msg })); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (lastData?.step === "error") throw new Error(lastData.error ?? "Unknown error");
      const updated = lastData?.accounts_updated ?? 0;
      toast.success(`Full history scan complete — ${updated} accounts updated with all historical transactions`);
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Full history scan failed: ${err.message}`);
    } finally {
      delete abortRefs.current.revenue_breakdown;
      setRunning(r => ({ ...r, revenue_breakdown: false }));
      setProgress(p => ({ ...p, revenue_breakdown: "" }));
    }
  }, [queryClient]);

  const runFanSync = useCallback(async () => {
    const ctrl = new AbortController();
    abortRefs.current.fans = ctrl;
    setRunning(r => ({ ...r, fans: true }));
    setProgress(p => ({ ...p, fans: "Starting..." }));
    try {
      const lastData = await streamSync(
        "/sync/fans",
        { triggered_by: "manual" },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, fans: msg })); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (lastData?.step === "error") throw new Error(lastData.error ?? "Unknown error");
      const fetched = lastData?.fans_fetched ?? 0;
      const built = lastData?.profiles_built ?? 0;
      const errCount = lastData?.errors?.length ?? 0;
      if (errCount > 0 && fetched === 0) {
        toast.warning(`Fan sync — API probe failed for all accounts. Check Sync Logs for details.`);
      } else if (fetched === 0) {
        toast.warning("Fan sync — 0 fans returned. API may not support this endpoint.");
      } else {
        toast.success(`Fan sync complete — ${fetched} fans fetched, ${built} profiles built`);
      }
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["fans_list"] });
      queryClient.invalidateQueries({ queryKey: ["fan_stats"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Fan sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.fans;
      setRunning(r => ({ ...r, fans: false }));
      setProgress(p => ({ ...p, fans: "" }));
    }
  }, [queryClient]);

  const runSubscriberSync = useCallback(async (forceFull = false) => {
    const ctrl = new AbortController();
    abortRefs.current.subscribers = ctrl;
    setRunning(r => ({ ...r, subscribers: true }));
    setProgress(p => ({ ...p, subscribers: forceFull ? "Full history scan..." : "Starting incremental..." }));
    try {
      const lastData = await streamSync(
        "/sync/subscribers",
        { triggered_by: forceFull ? "manual_full" : "manual", force_full: forceFull },
        (msg) => { if (!ctrl.signal.aborted) setProgress(p => ({ ...p, subscribers: msg })); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (lastData?.step === "error") throw new Error(lastData.error ?? "Unknown error");
      const attributed = lastData?.attributed ?? 0;
      const apiCalls = lastData?.api_calls ?? 0;
      if (attributed === 0) {
        toast.warning(`Subscriber sync — 0 fans attributed. Check if API supports /subscribers endpoint.`);
      } else {
        toast.success(`Subscriber sync complete — ${attributed.toLocaleString()} fans attributed (${apiCalls} API calls)`);
      }
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_link_ltv"] });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      toast.error(`Subscriber sync failed: ${err.message}`);
    } finally {
      delete abortRefs.current.subscribers;
      setRunning(r => ({ ...r, subscribers: false }));
      setProgress(p => ({ ...p, subscribers: "" }));
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
    fans: runFanSync,
    subscribers: () => runSubscriberSync(false),
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

        {/* ═══ SYNC BUTTONS ═══ */}
        <div className="grid grid-cols-4 xl:grid-cols-8 gap-3">
          {(["dashboard", "onlytraffic", "snapshot", "snapshot_backfill", "crosspoll", "revenue_breakdown", "fans", "subscribers"] as SyncType[]).map((type) => {
            const Icon = SYNC_ICONS[type];
            const colors = SYNC_COLORS[type];
            const isRunning = running[type];
            const dbRunning = statusCards[type]?.status === "running";
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
              </div>
            );
          })}
        </div>

        {/* ═══ SYNC STATUS CARDS ═══ */}
        <div className="grid grid-cols-4 xl:grid-cols-8 gap-3">
          {(["dashboard", "onlytraffic", "snapshot", "snapshot_backfill", "crosspoll", "revenue_breakdown", "fans", "subscribers"] as SyncType[]).map((type) => {
            const colors = SYNC_COLORS[type];
            const Icon = SYNC_ICONS[type];
            const last = statusCards[type];
            const endTime = last?.completed_at || last?.finished_at;
            const duration = last && endTime
              ? Math.round((new Date(endTime).getTime() - new Date(last.started_at).getTime()) / 1000)
              : null;
            const status = last ? last.effectiveStatus : null;
            const isRunning = running[type];
            const dbRunning = last?.status === "running";
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
                    {status && <StatusBadge status={status} />}
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

        {/* ═══ SCHEDULER STATUS ═══ */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Auto-Sync Schedule</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium">Active</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-muted-foreground mb-1 font-medium">Dashboard Sync</div>
              <div className="font-bold text-foreground">Daily at 01:00 UTC</div>
              <div className="text-muted-foreground mt-1">Accounts + tracking links</div>
              <div className="mt-2 text-primary font-medium">
                Next: {formatDistanceToNow(nextUtcHour(1), { addSuffix: true })}
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-muted-foreground mb-1 font-medium">Snapshot Sync</div>
              <div className="font-bold text-foreground">Daily at 03:00 UTC</div>
              <div className="text-muted-foreground mt-1">Yesterday + today subscriber data</div>
              <div className="mt-2 text-primary font-medium">
                Next: {formatDistanceToNow(nextUtcHour(3), { addSuffix: true })}
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-muted-foreground mb-1 font-medium">OnlyTraffic</div>
              <div className="font-bold text-foreground">Every 30 min (interval-based)</div>
              <div className="text-muted-foreground mt-1">Only runs when interval has elapsed</div>
              <div className="mt-2 text-primary font-medium">
                {statusCards.onlytraffic?.started_at
                  ? `Last: ${formatDistanceToNow(new Date(statusCards.onlytraffic.started_at), { addSuffix: true })}`
                  : "Never run"}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ SYNC HISTORY TABLE ═══ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Sync History</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={typeFilter} onValueChange={v => setTypeFilter(v as TypeFilter)}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="dashboard">Dashboard</SelectItem>
                    <SelectItem value="snapshot">Snapshots</SelectItem>
                    <SelectItem value="ltv">Analytics</SelectItem>
                    <SelectItem value="onlytraffic">OnlyTraffic</SelectItem>
                    <SelectItem value="ot_snapshot">OT Snapshots</SelectItem>
                    <SelectItem value="revenue_breakdown">Rev Breakdown</SelectItem>
                    <SelectItem value="fans">Fans</SelectItem>
                    <SelectItem value="subscribers">Sub Attribution</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="error">Failed</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                  </SelectContent>
                </Select>
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
                        const rawMessage = log.error_message || log.message || "";
                        const displayMessage = rawMessage.length > 80 ? rawMessage.slice(0, 80) + "…" : rawMessage;
                        const isGroupedParent = GROUPED_TYPES.has(syncType) && !log.account_id;
                        const details = log.details;
                        const TWO_MIN_MS = 2 * 60 * 1000;
                        const parentTime = new Date(log.started_at).getTime();
                        const childLogs = isGroupedParent
                          ? classifiedLogs
                              .filter((l: any) =>
                                isChildLog(l) &&
                                l.syncType === syncType &&
                                Math.abs(new Date(l.started_at).getTime() - parentTime) < TWO_MIN_MS
                              )
                              .sort((a: any, b: any) =>
                                (a.account_display_name ?? "").localeCompare(b.account_display_name ?? "")
                              )
                          : [];
                        const avatarMap = new Map<string, string | null>(
                          (accounts as any[]).map((a: any) => [a.display_name, a.avatar_thumb_url ?? null])
                        );

                        return (
                          <Fragment key={log.id}>
                          <tr
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
                              {isGroupedParent
                                ? <span className="text-[10px] text-muted-foreground italic">All accounts</span>
                                : (log.account_display_name || "—")}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-foreground">
                              {(log.records_processed ?? 0).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono">
                              {(log.details?.api_calls ?? 0) > 0
                                ? <span className="text-primary font-bold">{Number(log.details.api_calls).toLocaleString()}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                              {duration !== null ? `${duration}s` : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              <StatusBadge status={status} />
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {isAutoTriggered(log) ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                                  <Bot className="h-2.5 w-2.5" /> {friendlyTriggeredBy(log)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground">
                                  <Hand className="h-2.5 w-2.5" /> Manual
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground max-w-[220px]" title={rawMessage || undefined}>
                              {status === "error" ? (
                                <span className="text-destructive truncate block">{displayMessage || "Unknown error"}</span>
                              ) : (
                                <span className="truncate block">{displayMessage || "—"}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-2">
                              {log.status === "running" && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); stopSync(log.syncType, log.id); }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Force stop this run"
                                >
                                  <Square className="h-2.5 w-2.5" /> Kill
                                </button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="p-0">
                                <div className="border-t border-border bg-secondary/20 p-4 space-y-3">
                                  {/* Summary stats */}
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                    {log.accounts_synced != null && (
                                      <div>
                                        <p className="text-muted-foreground">Accounts synced</p>
                                        <p className="font-mono font-bold text-foreground">{Number(log.accounts_synced).toLocaleString()}</p>
                                      </div>
                                    )}
                                    {log.tracking_links_synced != null && (
                                      <div>
                                        <p className="text-muted-foreground">Links synced</p>
                                        <p className="font-mono font-bold text-foreground">{Number(log.tracking_links_synced).toLocaleString()}</p>
                                      </div>
                                    )}
                                    {(log.details?.api_calls ?? 0) > 0 && (
                                      <div>
                                        <p className="flex items-center gap-1 text-muted-foreground"><Zap className="h-3 w-3" />Credits used</p>
                                        <p className="font-mono font-bold text-primary">{Number(log.details.api_calls).toLocaleString()}</p>
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

                                  {/* API probe results */}
                                  {details?.probe_results && Array.isArray(details.probe_results) && details.probe_results.length > 0 && (
                                    <div>
                                      <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">API Probe Results</p>
                                      <div className="space-y-1">
                                        {(details.probe_results as any[]).map((r: any, i: number) => (
                                          <div key={i} className="flex items-start gap-2 text-[11px] bg-secondary/50 rounded px-2 py-1.5">
                                            <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${r.working ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : r.status >= 400 ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-600"}`}>
                                              {r.status}
                                            </span>
                                            <span className="text-muted-foreground shrink-0">{r.account}</span>
                                            <span className="text-foreground font-mono shrink-0">/{r.endpoint}</span>
                                            {r.working && r.item_keys && <span className="text-primary truncate">fields: {r.item_keys}</span>}
                                            {!r.working && r.raw && <span className="text-muted-foreground truncate">{r.raw}</span>}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Per-account rows from child logs (grouped types) */}
                                  {isGroupedParent && childLogs.length > 0 && (
                                    <div>
                                      <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">
                                        Per-Account Results <span className="font-normal normal-case text-muted-foreground">({childLogs.length})</span>
                                      </p>
                                      <div className="rounded border border-border overflow-hidden">
                                        {childLogs.map((child: any, i: number) => {
                                          const childEnd = child.completed_at || child.finished_at;
                                          const dur = childEnd
                                            ? Math.round((new Date(childEnd).getTime() - new Date(child.started_at).getTime()) / 1000)
                                            : null;
                                          const childStatus = child.effectiveStatus;
                                          const name = child.account_display_name ?? "—";
                                          const avatarUrl = avatarMap.get(name) ?? null;
                                          const stat = (child.records_processed ?? 0) > 0 ? Number(child.records_processed) : null;
                                          const credits = child.details?.api_calls ?? 0;
                                          const err = child.error_message;
                                          const statLabel = syncType === "dashboard" ? "links" : "txns";
                                          const StatusIcon = childStatus === "success" ? CheckCircle
                                            : childStatus === "error" ? XCircle
                                            : childStatus === "partial" ? AlertCircle
                                            : childStatus === "running" ? Loader2
                                            : Clock;
                                          const iconCls = childStatus === "success" ? "text-emerald-500"
                                            : childStatus === "error" ? "text-destructive"
                                            : childStatus === "partial" ? "text-amber-500"
                                            : "text-muted-foreground";
                                          return (
                                            <div key={child.id} className={`flex items-center gap-2.5 px-3 py-2 border-b border-border/40 last:border-b-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                              <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${iconCls}${childStatus === "running" ? " animate-spin" : ""}`} />
                                              {avatarUrl
                                                ? <img src={avatarUrl} alt={name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                                                : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">{name.charAt(0).toUpperCase()}</div>
                                              }
                                              <span className="font-medium text-[11px] text-foreground w-28 shrink-0 truncate" title={name}>{name}</span>
                                              <div className="flex items-center gap-3 min-w-0 text-[10px]">
                                                {stat != null && <span className="text-muted-foreground"><span className="font-mono font-semibold text-foreground">{stat.toLocaleString()}</span> {statLabel}</span>}
                                                {credits > 0 && <span className="text-muted-foreground"><span className="font-mono font-semibold text-foreground">{Number(credits).toLocaleString()}</span> credits</span>}
                                                {dur != null && <span className="font-mono text-muted-foreground">{dur}s</span>}
                                                {err && childStatus === "error" && <span className="text-destructive truncate max-w-[220px]" title={err}>{err.length > 80 ? err.slice(0, 80) + "…" : err}</span>}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Fallback: account_results for grouped parents with no child logs (old data) */}
                                  {isGroupedParent && childLogs.length === 0 && details?.account_results && Array.isArray(details.account_results) && details.account_results.length > 0 && (() => {
                                    const rows = details.account_results as any[];
                                    const borderCls = (s: string | undefined) => s === "ok" || s === "success" ? "border-l-emerald-500" : s === "error" ? "border-l-destructive" : s === "auth_error" || s === "partial" ? "border-l-amber-500" : "border-l-border";
                                    return (
                                      <div>
                                        <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Per-Account Results <span className="font-normal normal-case">({rows.length})</span></p>
                                        <div className="rounded border border-border overflow-hidden">
                                          {rows.map((r: any, i: number) => {
                                            const avatarUrl = avatarMap.get(r.account) ?? null;
                                            const noteText: string | null = typeof r.note === "string" ? r.note : null;
                                            const noteIsRevenue = noteText?.startsWith("$") ?? false;
                                            const isErrStatus = r.status === "error" || r.status === "auth_error";
                                            const truncNote = noteText && noteText.length > 80 ? noteText.slice(0, 80) + "…" : noteText;
                                            return (
                                              <div key={i} className={`flex items-center gap-2.5 px-3 py-2 border-l-2 border-b border-border/40 last:border-b-0 ${borderCls(r.status)} ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                                {avatarUrl ? <img src={avatarUrl} alt={r.account} className="w-6 h-6 rounded-full object-cover shrink-0" /> : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">{(r.account ?? "?").charAt(0).toUpperCase()}</div>}
                                                <span className="font-medium text-[11px] text-foreground w-28 shrink-0 truncate" title={r.account}>{r.account}</span>
                                                <div className="flex items-center gap-3 text-[10px]">
                                                  {syncType === "dashboard" && r.links != null && <span><span className="text-muted-foreground">Links </span><span className="font-mono font-semibold">{Number(r.links).toLocaleString()}</span></span>}
                                                  {syncType === "revenue_breakdown" && r.transactions != null && <span><span className="text-muted-foreground">Txns </span><span className="font-mono font-semibold">{Number(r.transactions).toLocaleString()}</span></span>}
                                                  {r.api_calls != null && <span><span className="text-muted-foreground">Credits </span><span className="font-mono font-semibold">{Number(r.api_calls).toLocaleString()}</span></span>}
                                                  {truncNote && <span className={`truncate max-w-[200px] ${noteIsRevenue ? "text-emerald-600 dark:text-emerald-400 font-semibold" : isErrStatus ? "text-destructive" : "text-muted-foreground"}`} title={noteText ?? ""}>{truncNote}</span>}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Per-account rows for non-grouped types */}
                                  {!isGroupedParent && details?.account_results && Array.isArray(details.account_results) && details.account_results.length > 0 && (() => {
                                    const rows = details.account_results as any[];
                                    const borderCls = (s: string | undefined) => s === "ok" || s === "success" ? "border-l-emerald-500" : s === "error" ? "border-l-destructive" : s === "auth_error" || s === "partial" ? "border-l-amber-500" : "border-l-border";
                                    return (
                                      <div>
                                        <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Per-Account Results <span className="font-normal normal-case">({rows.length})</span></p>
                                        <div className="rounded border border-border overflow-hidden">
                                          {rows.map((r: any, i: number) => {
                                            const avatarUrl = avatarMap.get(r.account) ?? null;
                                            const isErrStatus = r.status === "error" || r.status === "auth_error";
                                            const noteText: string | null = typeof r.note === "string" ? r.note : null;
                                            const noteIsRevenue = noteText?.startsWith("$") ?? false;
                                            const truncNote = noteText && noteText.length > 80 ? noteText.slice(0, 80) + "…" : noteText;
                                            return (
                                              <div key={i} className={`flex items-center gap-2.5 px-3 py-2 border-l-2 border-b border-border/40 last:border-b-0 ${borderCls(r.status)} ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                                {avatarUrl ? <img src={avatarUrl} alt={r.account} className="w-6 h-6 rounded-full object-cover shrink-0" /> : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">{(r.account ?? "?").charAt(0).toUpperCase()}</div>}
                                                <span className="font-medium text-[11px] text-foreground w-28 shrink-0 truncate" title={r.account}>{r.account}</span>
                                                <div className="flex items-center gap-3 flex-wrap min-w-0 text-[10px]">
                                                  {syncType === "snapshot" && <>
                                                    {r.links != null && <span><span className="text-muted-foreground">Links </span><span className="font-mono font-semibold tabular-nums">{Number(r.links).toLocaleString()}</span></span>}
                                                    {r.snapshots != null && <span><span className="text-muted-foreground">Snapshots </span><span className="font-mono font-semibold tabular-nums">{Number(r.snapshots).toLocaleString()}</span></span>}
                                                    {r.api_calls != null && <span><span className="text-muted-foreground">Credits </span><span className="font-mono font-semibold tabular-nums">{Number(r.api_calls).toLocaleString()}</span></span>}
                                                    {r.errors != null && r.errors > 0 && <span><span className="text-muted-foreground">Errors </span><span className="font-mono font-semibold tabular-nums text-destructive">{Number(r.errors).toLocaleString()}</span></span>}
                                                  </>}
                                                  {syncType === "fans" && <>
                                                    {r.fans != null && <span><span className="text-muted-foreground">Fans </span><span className="font-mono font-semibold tabular-nums">{Number(r.fans).toLocaleString()}</span></span>}
                                                    {r.pages != null && <span><span className="text-muted-foreground">Pages </span><span className="font-mono font-semibold tabular-nums">{Number(r.pages).toLocaleString()}</span></span>}
                                                  </>}
                                                  {syncType === "subscribers" && <>
                                                    {r.attributed != null && <span><span className="text-muted-foreground">Attributed </span><span className="font-mono font-semibold tabular-nums">{Number(r.attributed).toLocaleString()}</span></span>}
                                                    {r.api_calls != null && <span><span className="text-muted-foreground">Credits </span><span className="font-mono font-semibold tabular-nums">{Number(r.api_calls).toLocaleString()}</span></span>}
                                                    {r.mode && <span><span className="text-muted-foreground">Mode </span><span className="font-semibold">{r.mode}</span></span>}
                                                  </>}
                                                  {truncNote && <span className={`truncate max-w-[200px] ${noteIsRevenue ? "text-emerald-600 dark:text-emerald-400 font-semibold" : isErrStatus ? "text-destructive" : "text-muted-foreground"}`} title={noteText ?? ""}>{truncNote}</span>}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Raw details fallback */}
                                  {details && typeof details === "object" && !details.probe_results && !details.account_results && !isGroupedParent && (
                                    <div>
                                      <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Details</p>
                                      <pre className="text-[11px] text-muted-foreground bg-secondary/50 p-2 rounded overflow-x-auto max-h-40">
                                        {JSON.stringify(details, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* expanded detail renders inline as <tr> inside the tbody above */}
                {false && (() => {
                  const log = syncPageLogs.find((l: any) => l.id === expandedLogId);
                  if (!log) return null;
                  const details = log.details;
                  const syncT = log.syncType as SyncType;
                  const isGroupedParent = GROUPED_TYPES.has(syncT) && !log.account_id;

                  // For grouped types, pull child logs from the full classified set (within 2 min)
                  const TWO_MIN_MS = 2 * 60 * 1000;
                  const parentTime = new Date(log.started_at).getTime();
                  const childLogs = isGroupedParent
                    ? classifiedLogs
                        .filter((l: any) =>
                          isChildLog(l) &&
                          l.syncType === syncT &&
                          Math.abs(new Date(l.started_at).getTime() - parentTime) < TWO_MIN_MS
                        )
                        .sort((a: any, b: any) =>
                          (a.account_display_name ?? "").localeCompare(b.account_display_name ?? "")
                        )
                    : [];

                  const avatarMap = new Map<string, string | null>(
                    (accounts as any[]).map((a: any) => [a.display_name, a.avatar_thumb_url ?? null])
                  );

                  return (
                    <div className="border-t border-border bg-secondary/20 p-4 space-y-3">
                      {/* ── Summary stats ── */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        {log.accounts_synced != null && (
                          <div>
                            <p className="text-muted-foreground">Accounts synced</p>
                            <p className="font-mono font-bold text-foreground">{Number(log.accounts_synced).toLocaleString()}</p>
                          </div>
                        )}
                        {log.tracking_links_synced != null && (
                          <div>
                            <p className="text-muted-foreground">Links synced</p>
                            <p className="font-mono font-bold text-foreground">{Number(log.tracking_links_synced).toLocaleString()}</p>
                          </div>
                        )}
                        {(log.details?.api_calls ?? 0) > 0 && (
                          <div>
                            <p className="flex items-center gap-1 text-muted-foreground"><Zap className="h-3 w-3" />Credits used</p>
                            <p className="font-mono font-bold text-primary">{Number(log.details.api_calls).toLocaleString()}</p>
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

                      {/* ── API probe results ── */}
                      {details?.probe_results && Array.isArray(details.probe_results) && details.probe_results.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">API Probe Results</p>
                          <div className="space-y-1">
                            {(details.probe_results as any[]).map((r: any, i: number) => (
                              <div key={i} className="flex items-start gap-2 text-[11px] bg-secondary/50 rounded px-2 py-1.5">
                                <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${r.working ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : r.status >= 400 ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-600"}`}>
                                  {r.status}
                                </span>
                                <span className="text-muted-foreground shrink-0">{r.account}</span>
                                <span className="text-foreground font-mono shrink-0">/{r.endpoint}</span>
                                {r.working && r.item_keys && <span className="text-primary truncate">fields: {r.item_keys}</span>}
                                {!r.working && r.raw && <span className="text-muted-foreground truncate">{r.raw}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Per-account rows: GROUPED TYPES (dashboard, rev breakdown) — from child logs ── */}
                      {isGroupedParent && childLogs.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">
                            Per-Account Results <span className="font-normal normal-case text-muted-foreground">({childLogs.length})</span>
                          </p>
                          <div className="rounded border border-border overflow-hidden">
                            {childLogs.map((child: any, i: number) => {
                              const childEnd = child.completed_at || child.finished_at;
                              const dur = childEnd
                                ? Math.round((new Date(childEnd).getTime() - new Date(child.started_at).getTime()) / 1000)
                                : null;
                              const childStatus = child.effectiveStatus;
                              const name = child.account_display_name ?? "—";
                              const avatarUrl = avatarMap.get(name) ?? null;
                              const stat = (child.records_processed ?? 0) > 0 ? Number(child.records_processed) : null;
                              const credits = child.details?.api_calls ?? 0;
                              const err = child.error_message;
                              const statLabel = syncT === "dashboard" ? "links" : "txns";

                              const StatusIcon = childStatus === "success" ? CheckCircle
                                : childStatus === "error" ? XCircle
                                : childStatus === "partial" ? AlertCircle
                                : childStatus === "running" ? Loader2
                                : Clock;
                              const iconCls = childStatus === "success" ? "text-emerald-500"
                                : childStatus === "error" ? "text-destructive"
                                : childStatus === "partial" ? "text-amber-500"
                                : "text-muted-foreground";

                              return (
                                <div
                                  key={child.id}
                                  className={`flex items-center gap-2.5 px-3 py-2 border-b border-border/40 last:border-b-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                                >
                                  <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${iconCls}${childStatus === "running" ? " animate-spin" : ""}`} />
                                  {avatarUrl
                                    ? <img src={avatarUrl} alt={name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                                    : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">{name.charAt(0).toUpperCase()}</div>
                                  }
                                  <span className="font-medium text-[11px] text-foreground w-28 shrink-0 truncate" title={name}>{name}</span>
                                  <div className="flex items-center gap-3 min-w-0 text-[10px]">
                                    {stat != null && (
                                      <span className="text-muted-foreground">
                                        <span className="font-mono font-semibold text-foreground">{stat.toLocaleString()}</span> {statLabel}
                                      </span>
                                    )}
                                    {credits > 0 && (
                                      <span className="text-muted-foreground">
                                        <span className="font-mono font-semibold text-foreground">{Number(credits).toLocaleString()}</span> credits
                                      </span>
                                    )}
                                    {dur != null && <span className="font-mono text-muted-foreground">{dur}s</span>}
                                    {err && childStatus === "error" && (
                                      <span className="text-destructive truncate max-w-[220px]" title={err}>
                                        {err.length > 80 ? err.slice(0, 80) + "…" : err}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Fallback: account_results for grouped parents with no child logs found (old data) */}
                      {isGroupedParent && childLogs.length === 0 && details?.account_results && Array.isArray(details.account_results) && details.account_results.length > 0 && (() => {
                        const rows = details.account_results as any[];
                        const borderCls = (status: string | undefined) => {
                          if (status === "ok" || status === "success") return "border-l-emerald-500";
                          if (status === "error") return "border-l-destructive";
                          if (status === "auth_error" || status === "partial") return "border-l-amber-500";
                          return "border-l-border";
                        };
                        return (
                          <div>
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Per-Account Results <span className="font-normal normal-case">({rows.length})</span></p>
                            <div className="rounded border border-border overflow-hidden">
                              {rows.map((r: any, i: number) => {
                                const avatarUrl = avatarMap.get(r.account) ?? null;
                                const noteText: string | null = typeof r.note === "string" ? r.note : null;
                                const noteIsRevenue = noteText?.startsWith("$") ?? false;
                                const isErrStatus = r.status === "error" || r.status === "auth_error";
                                const truncNote = noteText && noteText.length > 80 ? noteText.slice(0, 80) + "…" : noteText;
                                return (
                                  <div key={i} className={`flex items-center gap-2.5 px-3 py-2 border-l-2 border-b border-border/40 last:border-b-0 ${borderCls(r.status)} ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                    {avatarUrl ? <img src={avatarUrl} alt={r.account} className="w-6 h-6 rounded-full object-cover shrink-0" /> : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">{(r.account ?? "?").charAt(0).toUpperCase()}</div>}
                                    <span className="font-medium text-[11px] text-foreground w-28 shrink-0 truncate" title={r.account}>{r.account}</span>
                                    <div className="flex items-center gap-3 text-[10px]">
                                      {syncT === "dashboard" && r.links != null && <span><span className="text-muted-foreground">Links </span><span className="font-mono font-semibold">{Number(r.links).toLocaleString()}</span></span>}
                                      {syncT === "revenue_breakdown" && r.transactions != null && <span><span className="text-muted-foreground">Txns </span><span className="font-mono font-semibold">{Number(r.transactions).toLocaleString()}</span></span>}
                                      {r.api_calls != null && <span><span className="text-muted-foreground">Credits </span><span className="font-mono font-semibold">{Number(r.api_calls).toLocaleString()}</span></span>}
                                      {truncNote && <span className={`truncate max-w-[200px] ${noteIsRevenue ? "text-emerald-600 dark:text-emerald-400 font-semibold" : isErrStatus ? "text-destructive" : "text-muted-foreground"}`} title={noteText ?? ""}>{truncNote}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── Per-account rows: NON-GROUPED TYPES — from account_results ── */}
                      {!isGroupedParent && details?.account_results && Array.isArray(details.account_results) && details.account_results.length > 0 && (() => {
                        const rows = details.account_results as any[];
                        const borderCls = (status: string | undefined) => {
                          if (status === "ok" || status === "success") return "border-l-emerald-500";
                          if (status === "error") return "border-l-destructive";
                          if (status === "auth_error" || status === "partial") return "border-l-amber-500";
                          return "border-l-border";
                        };
                        return (
                          <div>
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Per-Account Results <span className="font-normal normal-case">({rows.length})</span></p>
                            <div className="rounded border border-border overflow-hidden">
                              {rows.map((r: any, i: number) => {
                                const avatarUrl = avatarMap.get(r.account) ?? null;
                                const isErrStatus = r.status === "error" || r.status === "auth_error";
                                const noteText: string | null = typeof r.note === "string" ? r.note : null;
                                const noteIsRevenue = noteText?.startsWith("$") ?? false;
                                const truncNote = noteText && noteText.length > 80 ? noteText.slice(0, 80) + "…" : noteText;
                                return (
                                  <div key={i} className={`flex items-center gap-2.5 px-3 py-2 border-l-2 border-b border-border/40 last:border-b-0 ${borderCls(r.status)} ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                    {avatarUrl ? <img src={avatarUrl} alt={r.account} className="w-6 h-6 rounded-full object-cover shrink-0" /> : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">{(r.account ?? "?").charAt(0).toUpperCase()}</div>}
                                    <span className="font-medium text-[11px] text-foreground w-28 shrink-0 truncate" title={r.account}>{r.account}</span>
                                    <div className="flex items-center gap-3 flex-wrap min-w-0 text-[10px]">
                                      {syncT === "snapshot" && <>
                                        {r.links != null && <span><span className="text-muted-foreground">Links </span><span className="font-mono font-semibold tabular-nums">{Number(r.links).toLocaleString()}</span></span>}
                                        {r.snapshots != null && <span><span className="text-muted-foreground">Snapshots </span><span className="font-mono font-semibold tabular-nums">{Number(r.snapshots).toLocaleString()}</span></span>}
                                        {r.api_calls != null && <span><span className="text-muted-foreground">Credits </span><span className="font-mono font-semibold tabular-nums">{Number(r.api_calls).toLocaleString()}</span></span>}
                                        {r.errors != null && r.errors > 0 && <span><span className="text-muted-foreground">Errors </span><span className="font-mono font-semibold tabular-nums text-destructive">{Number(r.errors).toLocaleString()}</span></span>}
                                      </>}
                                      {syncT === "fans" && <>
                                        {r.fans != null && <span><span className="text-muted-foreground">Fans </span><span className="font-mono font-semibold tabular-nums">{Number(r.fans).toLocaleString()}</span></span>}
                                        {r.pages != null && <span><span className="text-muted-foreground">Pages </span><span className="font-mono font-semibold tabular-nums">{Number(r.pages).toLocaleString()}</span></span>}
                                      </>}
                                      {syncT === "subscribers" && <>
                                        {r.attributed != null && <span><span className="text-muted-foreground">Attributed </span><span className="font-mono font-semibold tabular-nums">{Number(r.attributed).toLocaleString()}</span></span>}
                                        {r.api_calls != null && <span><span className="text-muted-foreground">Credits </span><span className="font-mono font-semibold tabular-nums">{Number(r.api_calls).toLocaleString()}</span></span>}
                                        {r.mode && <span><span className="text-muted-foreground">Mode </span><span className="font-semibold">{r.mode}</span></span>}
                                      </>}
                                      {truncNote && (
                                        <span
                                          className={`truncate max-w-[200px] ${noteIsRevenue ? "text-emerald-600 dark:text-emerald-400 font-semibold" : isErrStatus ? "text-destructive" : "text-muted-foreground"}`}
                                          title={noteText ?? ""}
                                        >
                                          {truncNote}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── Raw details fallback ── */}
                      {details && typeof details === "object" && !details.probe_results && !details.account_results && !isGroupedParent && (
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

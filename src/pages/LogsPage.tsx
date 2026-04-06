import { useEffect, useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs, fetchAccounts, triggerSync } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle, XCircle, Clock, Loader2,
  ChevronDown, ChevronRight, Filter, ChevronLeft, ChevronRight as ChevronRightIcon,
  BarChart3, Camera, Users, Truck, Play,
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { FanSyncModal } from "@/components/dashboard/FanSyncModal";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 25;

type SyncType = "dashboard" | "snapshot" | "ltv" | "onlytraffic";

const SYNC_COLORS: Record<SyncType, { bg: string; text: string; border: string; badge: string }> = {
  dashboard:   { bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400",     border: "border-blue-500/30",  badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  snapshot:    { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  ltv:         { bg: "bg-purple-500/10",  text: "text-purple-600 dark:text-purple-400",  border: "border-purple-500/30", badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  onlytraffic: { bg: "bg-orange-500/10",  text: "text-orange-600 dark:text-orange-400",  border: "border-orange-500/30", badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
};

const SYNC_LABELS: Record<SyncType, string> = {
  dashboard: "Dashboard",
  snapshot: "Snapshots",
  ltv: "LTV",
  onlytraffic: "OnlyTraffic",
};

const SYNC_ICONS: Record<SyncType, typeof BarChart3> = {
  dashboard: BarChart3,
  snapshot: Camera,
  ltv: Users,
  onlytraffic: Truck,
};

function classifySyncType(log: any): SyncType {
  const msg = (log.message || "").toLowerCase();
  const details = JSON.stringify(log.details || {}).toLowerCase();
  const triggered = (log.triggered_by || "").toLowerCase();
  if (triggered.includes("ltv") || msg.includes("ltv") || msg.includes("fan sync") || details.includes("ltv")) return "ltv";
  if (triggered.includes("snapshot") || msg.includes("snapshot") || details.includes("snapshot")) return "snapshot";
  if (triggered.includes("onlytraffic") || msg.includes("onlytraffic") || details.includes("onlytraffic")) return "onlytraffic";
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

export default function LogsPage() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [syncPage, setSyncPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [fanSyncOpen, setFanSyncOpen] = useState(false);

  // Running state per sync type
  const [running, setRunning] = useState<Record<SyncType, boolean>>({ dashboard: false, snapshot: false, ltv: false, onlytraffic: false });
  const [progress, setProgress] = useState<Record<SyncType, string>>({ dashboard: "", snapshot: "", ltv: "", onlytraffic: "" });

  useEffect(() => {
    const channel = supabase
      .channel("sync_logs_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Classify all logs
  const classifiedLogs = useMemo(() => logs.map((log: any) => ({
    ...log,
    syncType: classifySyncType(log),
    effectiveStatus: getEffectiveStatus(log),
  })), [logs]);

  // Build status cards from last log per type
  const statusCards = useMemo(() => {
    const cards: Record<SyncType, any> = { dashboard: null, snapshot: null, ltv: null, onlytraffic: null };
    for (const log of classifiedLogs) {
      const t = log.syncType as SyncType;
      if (!cards[t]) cards[t] = log;
    }
    return cards;
  }, [classifiedLogs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return classifiedLogs.filter((log: any) => {
      if (statusFilter !== "all" && log.effectiveStatus !== statusFilter) return false;
      if (typeFilter !== "all" && log.syncType !== typeFilter) return false;
      return true;
    });
  }, [classifiedLogs, statusFilter, typeFilter]);

  const syncTotalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const syncPageLogs = filteredLogs.slice((syncPage - 1) * PAGE_SIZE, syncPage * PAGE_SIZE);

  useEffect(() => { setSyncPage(1); }, [statusFilter, typeFilter]);

  // Sync handlers
  const runDashboardSync = useCallback(async () => {
    setRunning(r => ({ ...r, dashboard: true }));
    setProgress(p => ({ ...p, dashboard: "Starting..." }));
    try {
      await triggerSync(undefined, true, (msg) => setProgress(p => ({ ...p, dashboard: msg })));
      toast.success("Dashboard sync complete");
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err: any) {
      toast.error(`Dashboard sync failed: ${err.message}`);
    } finally {
      setRunning(r => ({ ...r, dashboard: false }));
      setProgress(p => ({ ...p, dashboard: "" }));
    }
  }, [queryClient]);

  const runSnapshotSync = useCallback(async () => {
    setRunning(r => ({ ...r, snapshot: true }));
    setProgress(p => ({ ...p, snapshot: "Saving snapshots..." }));
    try {
      // Log this as a snapshot sync
      await supabase.from("sync_logs").insert({
        status: "running", triggered_by: "snapshot_sync", message: "Snapshot sync started",
        records_processed: 0,
      });
      const res = await supabase.functions.invoke("sync-account", {
        body: { snapshot_only: true },
      });
      if (res.error) throw res.error;
      toast.success(`Snapshot sync complete — ${res.data?.snapshots_saved ?? 0} snapshots saved`);
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["daily_snapshots"] });
    } catch (err: any) {
      toast.error(`Snapshot sync failed: ${err.message}`);
    } finally {
      setRunning(r => ({ ...r, snapshot: false }));
      setProgress(p => ({ ...p, snapshot: "" }));
    }
  }, [queryClient]);

  const runLtvSync = useCallback(() => {
    setFanSyncOpen(true);
  }, []);

  const runOnlyTrafficSync = useCallback(async () => {
    setRunning(r => ({ ...r, onlytraffic: true }));
    setProgress(p => ({ ...p, onlytraffic: "Syncing OnlyTraffic..." }));
    try {
      const res = await supabase.functions.invoke("auto-tag-campaigns", {
        body: {},
      });
      if (res.error) throw res.error;
      toast.success(`OnlyTraffic sync complete — ${res.data?.tagged ?? 0} campaigns tagged`);
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    } catch (err: any) {
      toast.error(`OnlyTraffic sync failed: ${err.message}`);
    } finally {
      setRunning(r => ({ ...r, onlytraffic: false }));
      setProgress(p => ({ ...p, onlytraffic: "" }));
    }
  }, [queryClient]);

  const syncHandlers: Record<SyncType, () => void> = {
    dashboard: runDashboardSync,
    snapshot: runSnapshotSync,
    ltv: runLtvSync,
    onlytraffic: runOnlyTrafficSync,
  };

  const hasFilters = statusFilter !== "all" || typeFilter !== "all";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ═══ Header ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sync Center</h1>
            <p className="text-sm text-muted-foreground">{logs.length.toLocaleString()} sync runs recorded</p>
          </div>
          <RefreshButton queryKeys={["sync_logs", "accounts"]} />
        </div>

        {/* ═══ SYNC BUTTONS ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(["dashboard", "snapshot", "ltv", "onlytraffic"] as SyncType[]).map((type) => {
            const Icon = SYNC_ICONS[type];
            const colors = SYNC_COLORS[type];
            const isRunning = running[type];
            return (
              <Button
                key={type}
                variant="outline"
                onClick={syncHandlers[type]}
                disabled={isRunning}
                className={`h-auto py-4 px-4 flex flex-col items-center gap-2 ${colors.border} hover:${colors.bg} transition-all`}
              >
                {isRunning ? (
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
              </Button>
            );
          })}
        </div>

        {/* ═══ SYNC STATUS CARDS ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(["dashboard", "snapshot", "ltv", "onlytraffic"] as SyncType[]).map((type) => {
            const colors = SYNC_COLORS[type];
            const Icon = SYNC_ICONS[type];
            const last = statusCards[type];
            const endTime = last?.completed_at || last?.finished_at;
            const duration = last && endTime
              ? Math.round((new Date(endTime).getTime() - new Date(last.started_at).getTime()) / 1000)
              : null;
            const status = last ? last.effectiveStatus : null;

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

                  {last ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Last run</span>
                        <span className="font-mono text-foreground">
                          {format(new Date(last.started_at), "MMM d, HH:mm")}
                        </span>
                      </div>
                      {duration !== null && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Duration</span>
                          <span className="font-mono text-foreground">{duration}s</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Records</span>
                        <span className="font-mono text-foreground">{last.records_processed ?? 0}</span>
                      </div>
                      {(last.tracking_links_synced ?? 0) > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Links synced</span>
                          <span className="font-mono text-foreground">{last.tracking_links_synced}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">Never run</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

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
                        <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Date & Time</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Type</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Account</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Records</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Duration</th>
                        <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Status</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontSize: 10 }}>Message</th>
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
                            <td className="py-2.5 px-4 text-muted-foreground max-w-[250px] truncate">
                              {status === "error" ? (
                                <span className="text-destructive">{displayMessage || "Unknown error"}</span>
                              ) : (
                                displayMessage || "—"
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
      <FanSyncModal open={fanSyncOpen} onOpenChange={setFanSyncOpen} />
    </DashboardLayout>
  );
}

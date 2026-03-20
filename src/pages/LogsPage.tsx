import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { CheckCircle, XCircle, Clock } from "lucide-react";

const STUCK_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

function getEffectiveStatus(log: any) {
  if (log.status === "running" || log.status === "pending") {
    const elapsed = Date.now() - new Date(log.started_at).getTime();
    if (elapsed > STUCK_THRESHOLD_MS) return "error";
  }
  return log.status;
}

function getEffectiveMessage(log: any, effectiveStatus: string) {
  if (effectiveStatus === "error" && (log.status === "running" || log.status === "pending")) {
    return "Sync timed out — exceeded 3 minute limit";
  }
  return log.error_message || log.message;
}

export default function LogsPage() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("sync_logs_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Sync Logs</h1>
          <p className="text-sm text-muted-foreground">View sync history and troubleshoot errors</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton-shimmer h-16 rounded-lg" />)}
          </div>
        ) : !logs.length ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center text-muted-foreground">No sync logs yet</div>
        ) : (
          <div className="relative">
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />
            <div className="space-y-3">
              {logs.map((log: any) => {
                const effectiveStatus = getEffectiveStatus(log);
                const endTime = log.completed_at || log.finished_at;
                const duration = endTime
                  ? Math.round((new Date(endTime).getTime() - new Date(log.started_at).getTime()) / 1000)
                  : effectiveStatus === "error"
                    ? Math.round(Math.min(Date.now() - new Date(log.started_at).getTime(), STUCK_THRESHOLD_MS) / 1000)
                    : null;
                const isSuccess = effectiveStatus === "success";
                const isError = effectiveStatus === "error";
                const displayMessage = getEffectiveMessage(log, effectiveStatus);

                return (
                  <div key={log.id} className="flex gap-4 relative">
                    <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 z-10 ${
                      isSuccess ? "border-primary bg-primary/15" : isError ? "border-destructive bg-destructive/15" : "border-warning bg-warning/15"
                    }`}>
                      {isSuccess ? <CheckCircle className="h-4 w-4 text-primary" /> :
                       isError ? <XCircle className="h-4 w-4 text-destructive" /> :
                       <Clock className="h-4 w-4 text-warning" />}
                    </div>

                    <div className="bg-card border border-border rounded-lg p-4 flex-1 card-hover">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold uppercase tracking-wider ${
                            isSuccess ? "text-primary" : isError ? "text-destructive" : "text-warning"
                          }`}>{isError ? "FAILED" : effectiveStatus.toUpperCase()}</span>
                          <span className="text-xs text-muted-foreground font-mono">{format(new Date(log.started_at), "MMM d, HH:mm:ss")}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {duration !== null && <span className="font-mono">{duration}s</span>}
                          <span>{log.records_processed} records</span>
                        </div>
                      </div>
                      {log.accounts?.display_name && (
                        <p className="text-sm text-foreground mb-1">{log.accounts.display_name}</p>
                      )}
                      {isError && displayMessage && (
                        <p className="text-xs text-destructive mt-1">{displayMessage}</p>
                      )}
                      {!isError && log.message && (
                        <p className="text-xs text-muted-foreground">{log.message}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

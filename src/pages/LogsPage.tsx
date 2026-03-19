import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs } from "@/lib/supabase-helpers";
import { format } from "date-fns";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export default function LogsPage() {
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });

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
            {/* Timeline line */}
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />

            <div className="space-y-3">
              {logs.map((log: any) => {
                const duration = log.completed_at
                  ? Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                  : null;
                const isSuccess = log.status === "success";
                const isError = log.status === "error";

                return (
                  <div key={log.id} className="flex gap-4 relative">
                    {/* Dot */}
                    <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 z-10 ${
                      isSuccess ? "border-primary bg-primary/15" : isError ? "border-destructive bg-destructive/15" : "border-warning bg-warning/15"
                    }`}>
                      {isSuccess ? <CheckCircle className="h-4 w-4 text-primary" /> :
                       isError ? <XCircle className="h-4 w-4 text-destructive" /> :
                       <Clock className="h-4 w-4 text-warning" />}
                    </div>

                    {/* Content */}
                    <div className="bg-card border border-border rounded-lg p-4 flex-1 card-hover">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold uppercase tracking-wider ${
                            isSuccess ? "text-primary" : isError ? "text-destructive" : "text-warning"
                          }`}>{log.status}</span>
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
                      {log.message && (
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

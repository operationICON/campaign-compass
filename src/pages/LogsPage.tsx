import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs } from "@/lib/supabase-helpers";
import { format } from "date-fns";

export default function LogsPage() {
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });

  const statusColor = (status: string) => {
    if (status === "success") return "bg-primary/15 text-primary";
    if (status === "error") return "bg-destructive/15 text-destructive";
    return "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]";
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Sync Logs</h1>
          <p className="text-sm text-muted-foreground">View sync history and troubleshoot errors</p>
        </div>

        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading...</div>
          ) : !logs.length ? (
            <div className="p-12 text-center text-muted-foreground">No sync logs yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Time</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Account</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Status</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Message</th>
                  <th className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-left">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => {
                  const duration = log.completed_at
                    ? Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                    : null;
                  return (
                    <tr key={log.id} className="border-b border-border hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{format(new Date(log.started_at), "MMM d, HH:mm:ss")}</td>
                      <td className="px-4 py-3 text-foreground">{log.accounts?.display_name || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase ${statusColor(log.status)}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[300px] truncate">{log.message || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{duration !== null ? `${duration}s` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

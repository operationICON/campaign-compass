import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchSyncLogs } from "@/lib/supabase-helpers";
import { format } from "date-fns";

export default function LogsPage() {
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });

  const statusColor = (status: string) => {
    if (status === "success") return "bg-primary/20 text-primary";
    if (status === "error") return "bg-destructive/20 text-destructive";
    return "bg-chart-amber/20 text-chart-amber";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Sync Logs</h1>
          <p className="text-sm text-muted-foreground">View sync history and troubleshoot errors</p>
        </div>

        <Card className="border-border bg-card">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Time</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Account</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Message</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: any) => {
                    const duration = log.completed_at
                      ? Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                      : null;
                    return (
                      <TableRow key={log.id} className="hover:bg-secondary/30">
                        <TableCell className="font-mono text-sm">{format(new Date(log.started_at), "MMM d, HH:mm:ss")}</TableCell>
                        <TableCell>{log.accounts?.display_name || "—"}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(log.status)}`}>
                            {log.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[300px] truncate">{log.message || "—"}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{duration !== null ? `${duration}s` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                  {!logs.length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No sync logs yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

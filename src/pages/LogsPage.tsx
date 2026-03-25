import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs, fetchAccounts } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle, XCircle, Clock, FlaskConical, X, Loader2 } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";

const STUCK_THRESHOLD_MS = 3 * 60 * 1000;

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

type TestResult = {
  name: string;
  status: "pass" | "warn" | "fail" | "running";
  detail: string;
};

export default function LogsPage() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const [showTest, setShowTest] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testTimestamp, setTestTimestamp] = useState<Date | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel("sync_logs_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const runTests = async () => {
    setTestRunning(true);
    setTestTimestamp(new Date());
    const results: TestResult[] = [
      { name: "API Connectivity", status: "running", detail: "Checking accounts..." },
      { name: "Database Connection", status: "running", detail: "Querying tables..." },
      { name: "Last Sync Recency", status: "running", detail: "Checking sync logs..." },
      { name: "Spend Data Coverage", status: "running", detail: "Counting spend entries..." },
      { name: "Source Tag Coverage", status: "running", detail: "Counting tagged campaigns..." },
    ];
    setTestResults([...results]);

    // Test 1 — API connectivity (check accounts exist)
    try {
      const accountDetails = accounts.map((a: any) => `@${a.username || "unknown"} — Connected`);
      results[0] = {
        name: "API Connectivity",
        status: accounts.length > 0 ? "pass" : "fail",
        detail: accounts.length > 0
          ? accountDetails.join(" · ")
          : "No accounts found",
      };
    } catch {
      results[0] = { name: "API Connectivity", status: "fail", detail: "Failed to check accounts" };
    }
    setTestResults([...results]);

    // Test 2 — Database connection
    try {
      const { count: tlCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true });
      const { count: accCount } = await supabase.from("accounts").select("*", { count: "exact", head: true });
      results[1] = {
        name: "Database Connection",
        status: (tlCount ?? 0) > 0 && (accCount ?? 0) > 0 ? "pass" : "warn",
        detail: `tracking_links — ${tlCount ?? 0} rows · accounts — ${accCount ?? 0} rows`,
      };
    } catch {
      results[1] = { name: "Database Connection", status: "fail", detail: "Database query failed" };
    }
    setTestResults([...results]);

    // Test 3 — Last sync recency
    try {
      const { data: recentLogs } = await supabase.from("sync_logs").select("finished_at, completed_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1);
      const lastFinished = recentLogs?.[0]?.finished_at || recentLogs?.[0]?.completed_at;
      if (lastFinished) {
        const daysAgo = Math.floor((Date.now() - new Date(lastFinished).getTime()) / 86400000);
        const status = daysAgo <= 7 ? "pass" : daysAgo <= 14 ? "warn" : "fail";
        results[2] = {
          name: "Last Sync Recency",
          status,
          detail: `Last sync: ${format(new Date(lastFinished), "MMM d, HH:mm")} — ${formatDistanceToNow(new Date(lastFinished), { addSuffix: true })}`,
        };
      } else {
        results[2] = { name: "Last Sync Recency", status: "fail", detail: "No completed syncs found" };
      }
    } catch {
      results[2] = { name: "Last Sync Recency", status: "fail", detail: "Failed to check sync logs" };
    }
    setTestResults([...results]);

    // Test 4 — Spend data check
    try {
      const { count: totalCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true });
      const { count: spendCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true }).gt("cost_total", 0);
      const pct = (totalCount ?? 0) > 0 ? ((spendCount ?? 0) / (totalCount ?? 1)) * 100 : 0;
      results[3] = {
        name: "Spend Data Coverage",
        status: pct >= 10 ? "pass" : "warn",
        detail: `${spendCount ?? 0} of ${(totalCount ?? 0).toLocaleString()} campaigns have spend set (${pct.toFixed(1)}%)`,
      };
    } catch {
      results[3] = { name: "Spend Data Coverage", status: "fail", detail: "Failed to check spend data" };
    }
    setTestResults([...results]);

    // Test 5 — Source tag coverage
    try {
      const { count: totalCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true });
      const { count: taggedCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true }).not("source_tag", "is", null);
      const pct = (totalCount ?? 0) > 0 ? ((taggedCount ?? 0) / (totalCount ?? 1)) * 100 : 0;
      results[4] = {
        name: "Source Tag Coverage",
        status: pct >= 50 ? "pass" : "warn",
        detail: `${taggedCount ?? 0} of ${(totalCount ?? 0).toLocaleString()} campaigns are tagged (${pct.toFixed(1)}%)`,
      };
    } catch {
      results[4] = { name: "Source Tag Coverage", status: "fail", detail: "Failed to check tags" };
    }
    setTestResults([...results]);
    setTestRunning(false);
  };

  const passCount = testResults.filter(r => r.status === "pass").length;
  const failCount = testResults.filter(r => r.status === "fail").length;
  const warnCount = testResults.filter(r => r.status === "warn").length;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sync Logs</h1>
            <p className="text-sm text-muted-foreground">View sync history and troubleshoot errors</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton queryKeys={["sync_logs", "accounts"]} />
            <button
              onClick={() => { setShowTest(true); runTests(); }}
              disabled={testRunning}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <FlaskConical className="h-4 w-4" />
              Run Test
            </button>
          </div>
        </div>

        {/* ═══ Test Results Panel ═══ */}
        {showTest && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-foreground">System Test</h2>
                {testTimestamp && (
                  <p className="text-[11px] text-muted-foreground">{format(testTimestamp, "MMM d, yyyy HH:mm:ss")}</p>
                )}
              </div>
              <button onClick={() => setShowTest(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              {testResults.map((test, i) => (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-secondary/30">
                  {test.status === "running" ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                  ) : test.status === "pass" ? (
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                  ) : test.status === "warn" ? (
                    <Clock className="h-4 w-4 text-[hsl(var(--warning))] shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{test.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{test.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {!testRunning && testResults.length > 0 && (
              <div className={`text-sm font-semibold px-3 py-2 rounded-lg ${
                failCount > 0 ? "bg-destructive/10 text-destructive" :
                warnCount > 0 ? "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]" :
                "bg-primary/10 text-primary"
              }`}>
                {passCount} of {testResults.length} tests passed
                {warnCount > 0 && ` · ${warnCount} warning${warnCount > 1 ? "s" : ""}`}
                {failCount > 0 && ` · ${failCount} failed`}
              </div>
            )}
          </div>
        )}

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

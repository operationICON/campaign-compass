import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncLogs, fetchAccounts, fetchTestLogs, insertTestLog, clearTestLogs } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle, XCircle, Clock, FlaskConical, X, Loader2,
  ChevronDown, ChevronRight, Search, Filter, ChevronLeft, ChevronRight as ChevronRightIcon, Trash2, Users,
} from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { FanSyncModal } from "@/components/dashboard/FanSyncModal";
import { toast } from "sonner";

const STUCK_THRESHOLD_MS = 3 * 60 * 1000;
const PAGE_SIZE = 25;

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
  responseTimeMs?: number;
  accountUsername?: string;
};

type StatusFilter = "all" | "success" | "error" | "running";
type TestFilter = "all" | "pass" | "fail" | "warn";

export default function LogsPage() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useQuery({ queryKey: ["sync_logs"], queryFn: fetchSyncLogs });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: testHistory = [] } = useQuery({ queryKey: ["test_logs"], queryFn: fetchTestLogs });

  // Sync logs state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [syncPage, setSyncPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Test state
  const [showTest, setShowTest] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testTimestamp, setTestTimestamp] = useState<Date | null>(null);
  const [testPage, setTestPage] = useState(1);
  const [testFilter, setTestFilter] = useState<TestFilter>("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [fanSyncOpen, setFanSyncOpen] = useState(false);

  const clearMutation = useMutation({
    mutationFn: clearTestLogs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test_logs"] });
      toast.success("Test history cleared");
      setShowClearConfirm(false);
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("sync_logs_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Filter sync logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log: any) => {
      const eff = getEffectiveStatus(log);
      if (statusFilter !== "all" && eff !== statusFilter) return false;
      if (dateFrom && new Date(log.started_at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(log.started_at) > to) return false;
      }
      return true;
    });
  }, [logs, statusFilter, dateFrom, dateTo]);

  const syncTotalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const syncPageLogs = filteredLogs.slice((syncPage - 1) * PAGE_SIZE, syncPage * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setSyncPage(1); }, [statusFilter, dateFrom, dateTo]);

  // Filter test history
  const filteredTestHistory = useMemo(() => {
    if (testFilter === "all") return testHistory;
    return testHistory.filter((t: any) => t.status === testFilter);
  }, [testHistory, testFilter]);

  const testTotalPages = Math.max(1, Math.ceil(filteredTestHistory.length / PAGE_SIZE));
  const testPageItems = filteredTestHistory.slice((testPage - 1) * PAGE_SIZE, testPage * PAGE_SIZE);

  const hasFilters = statusFilter !== "all" || dateFrom || dateTo;

  const runTests = async () => {
    setTestRunning(true);
    const runAt = new Date();
    setTestTimestamp(runAt);
    const runAtIso = runAt.toISOString();
    const results: TestResult[] = [
      { name: "API Connectivity", status: "running", detail: "Checking accounts..." },
      { name: "Database Connection", status: "running", detail: "Querying tables..." },
      { name: "Last Sync Recency", status: "running", detail: "Checking sync logs..." },
      { name: "Spend Data Coverage", status: "running", detail: "Counting spend entries..." },
      { name: "Source Tag Coverage", status: "running", detail: "Counting tagged campaigns..." },
    ];
    setTestResults([...results]);

    const saveResult = async (r: TestResult) => {
      try {
        await insertTestLog({
          run_at: runAtIso,
          test_name: r.name,
          status: r.status,
          message: r.detail,
          response_time_ms: r.responseTimeMs,
          account_username: r.accountUsername,
        });
      } catch { /* ignore save errors */ }
    };

    // Test 1 — API connectivity
    let t0 = performance.now();
    try {
      const accountDetails = accounts.map((a: any) => `@${a.username || "unknown"}`);
      results[0] = {
        name: "API Connectivity",
        status: accounts.length > 0 ? "pass" : "fail",
        detail: accounts.length > 0 ? accountDetails.join(" · ") : "No accounts found",
        responseTimeMs: Math.round(performance.now() - t0),
        accountUsername: accounts.map((a: any) => a.username).filter(Boolean).join(", "),
      };
    } catch {
      results[0] = { name: "API Connectivity", status: "fail", detail: "Failed to check accounts", responseTimeMs: Math.round(performance.now() - t0) };
    }
    setTestResults([...results]);
    await saveResult(results[0]);

    // Test 2 — Database connection
    t0 = performance.now();
    try {
      const { count: tlCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true });
      const { count: accCount } = await supabase.from("accounts").select("*", { count: "exact", head: true });
      results[1] = {
        name: "Database Connection",
        status: (tlCount ?? 0) > 0 && (accCount ?? 0) > 0 ? "pass" : "warn",
        detail: `tracking_links — ${tlCount ?? 0} rows · accounts — ${accCount ?? 0} rows`,
        responseTimeMs: Math.round(performance.now() - t0),
      };
    } catch {
      results[1] = { name: "Database Connection", status: "fail", detail: "Database query failed", responseTimeMs: Math.round(performance.now() - t0) };
    }
    setTestResults([...results]);
    await saveResult(results[1]);

    // Test 3 — Last sync recency
    t0 = performance.now();
    try {
      const { data: recentLogs } = await supabase.from("sync_logs").select("finished_at, completed_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1);
      const lastFinished = recentLogs?.[0]?.finished_at || recentLogs?.[0]?.completed_at;
      if (lastFinished) {
        const daysAgo = Math.floor((Date.now() - new Date(lastFinished).getTime()) / 86400000);
        const status = daysAgo <= 7 ? "pass" : daysAgo <= 14 ? "warn" : "fail";
        results[2] = {
          name: "Last Sync Recency", status,
          detail: `Last sync: ${format(new Date(lastFinished), "MMM d, HH:mm")} — ${formatDistanceToNow(new Date(lastFinished), { addSuffix: true })}`,
          responseTimeMs: Math.round(performance.now() - t0),
        };
      } else {
        results[2] = { name: "Last Sync Recency", status: "fail", detail: "No completed syncs found", responseTimeMs: Math.round(performance.now() - t0) };
      }
    } catch {
      results[2] = { name: "Last Sync Recency", status: "fail", detail: "Failed to check sync logs", responseTimeMs: Math.round(performance.now() - t0) };
    }
    setTestResults([...results]);
    await saveResult(results[2]);

    // Test 4 — Spend data check
    t0 = performance.now();
    try {
      const { count: totalCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true });
      const { count: spendCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true }).gt("cost_total", 0);
      const pct = (totalCount ?? 0) > 0 ? ((spendCount ?? 0) / (totalCount ?? 1)) * 100 : 0;
      results[3] = {
        name: "Spend Data Coverage",
        status: pct >= 10 ? "pass" : "warn",
        detail: `${spendCount ?? 0} of ${(totalCount ?? 0).toLocaleString()} campaigns have spend set (${pct.toFixed(1)}%)`,
        responseTimeMs: Math.round(performance.now() - t0),
      };
    } catch {
      results[3] = { name: "Spend Data Coverage", status: "fail", detail: "Failed to check spend data", responseTimeMs: Math.round(performance.now() - t0) };
    }
    setTestResults([...results]);
    await saveResult(results[3]);

    // Test 5 — Source tag coverage
    t0 = performance.now();
    try {
      const { count: totalCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true });
      const { count: taggedCount } = await supabase.from("tracking_links").select("*", { count: "exact", head: true }).not("source_tag", "is", null);
      const pct = (totalCount ?? 0) > 0 ? ((taggedCount ?? 0) / (totalCount ?? 1)) * 100 : 0;
      results[4] = {
        name: "Source Tag Coverage",
        status: pct >= 50 ? "pass" : "warn",
        detail: `${taggedCount ?? 0} of ${(totalCount ?? 0).toLocaleString()} campaigns are tagged (${pct.toFixed(1)}%)`,
        responseTimeMs: Math.round(performance.now() - t0),
      };
    } catch {
      results[4] = { name: "Source Tag Coverage", status: "fail", detail: "Failed to check tags", responseTimeMs: Math.round(performance.now() - t0) };
    }
    setTestResults([...results]);
    await saveResult(results[4]);

    setTestRunning(false);
    queryClient.invalidateQueries({ queryKey: ["test_logs"] });
  };

  const passCount = testResults.filter(r => r.status === "pass").length;
  const failCount = testResults.filter(r => r.status === "fail").length;
  const warnCount = testResults.filter(r => r.status === "warn").length;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* ═══ Header ═══ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sync Logs</h1>
            <p className="text-sm text-muted-foreground">{logs.length.toLocaleString()} sync runs recorded</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton queryKeys={["sync_logs", "accounts", "test_logs"]} />
            <button
              onClick={() => setFanSyncOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
            >
              <Users className="h-4 w-4" />
              Sync Fan LTV
            </button>
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
          <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
            {/* Section 1: Current Run */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Current Test Run</h2>
                  {testTimestamp && (
                    <p className="text-[11px] text-muted-foreground">{format(testTimestamp, "MMM d, yyyy HH:mm:ss")}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runTests}
                    disabled={testRunning}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    {testRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                    Run Test Again
                  </button>
                  <button onClick={() => setShowTest(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
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
                    {test.responseTimeMs !== undefined && test.status !== "running" && (
                      <span className="text-[11px] font-mono text-muted-foreground shrink-0">{test.responseTimeMs}ms</span>
                    )}
                  </div>
                ))}
              </div>

              {!testRunning && testResults.length > 0 && (
                <div className={`text-sm font-semibold px-3 py-2 rounded-lg mt-3 ${
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

            {/* Section 2: Test History */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-foreground">Test History</h2>
                <div className="flex items-center gap-2">
                  <select
                    value={testFilter}
                    onChange={e => { setTestFilter(e.target.value as TestFilter); setTestPage(1); }}
                    className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground"
                  >
                    <option value="all">All</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="warn">Warning</option>
                  </select>
                  {showClearConfirm ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-destructive">Delete all?</span>
                      <button onClick={() => clearMutation.mutate()} className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90">Yes</button>
                      <button onClick={() => setShowClearConfirm(false)} className="text-xs px-2 py-1 rounded bg-secondary text-foreground hover:bg-secondary/80">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowClearConfirm(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3 w-3" /> Clear history
                    </button>
                  )}
                </div>
              </div>

              {filteredTestHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No test history yet</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 font-semibold text-muted-foreground" style={{ fontSize: 11 }}>Date</th>
                          <th className="text-left py-2 px-3 font-semibold text-muted-foreground" style={{ fontSize: 11 }}>Test Name</th>
                          <th className="text-left py-2 px-3 font-semibold text-muted-foreground" style={{ fontSize: 11 }}>Status</th>
                          <th className="text-left py-2 px-3 font-semibold text-muted-foreground" style={{ fontSize: 11 }}>Message</th>
                          <th className="text-right py-2 px-3 font-semibold text-muted-foreground" style={{ fontSize: 11 }}>Response Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testPageItems.map((t: any) => (
                          <tr
                            key={t.id}
                            className={`border-b border-border/50 ${
                              t.status === "pass" ? "bg-primary/5" :
                              t.status === "fail" ? "bg-destructive/5" :
                              t.status === "warn" ? "bg-[hsl(var(--warning))]/5" : ""
                            }`}
                          >
                            <td className="py-2 px-3 text-muted-foreground font-mono whitespace-nowrap">{format(new Date(t.run_at), "MMM d, HH:mm")}</td>
                            <td className="py-2 px-3 text-foreground font-medium">{t.test_name}</td>
                            <td className="py-2 px-3">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                t.status === "pass" ? "bg-primary/15 text-primary" :
                                t.status === "fail" ? "bg-destructive/15 text-destructive" :
                                "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]"
                              }`}>
                                {t.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground max-w-[300px] truncate">{t.message}</td>
                            <td className="py-2 px-3 text-right font-mono text-muted-foreground">{t.response_time_ms != null ? `${t.response_time_ms}ms` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {testTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-muted-foreground">Page {testPage} of {testTotalPages}</span>
                      <div className="flex gap-1">
                        <button onClick={() => setTestPage(p => Math.max(1, p - 1))} disabled={testPage <= 1} className="p-1 rounded hover:bg-secondary disabled:opacity-30">
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button onClick={() => setTestPage(p => Math.min(testTotalPages, p + 1))} disabled={testPage >= testTotalPages} className="p-1 rounded hover:bg-secondary disabled:opacity-30">
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══ Filters ═══ */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
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
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground"
              placeholder="From"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground"
              placeholder="To"
            />
          </div>
          {hasFilters && (
            <button
              onClick={() => { setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}
              className="text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredLogs.length} result{filteredLogs.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ═══ Sync Logs List ═══ */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton-shimmer h-16 rounded-lg" />)}
          </div>
        ) : !filteredLogs.length ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center text-muted-foreground">
            {hasFilters ? "No logs match your filters" : "No sync logs yet"}
          </div>
        ) : (
          <>
            <div className="relative">
              <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />
              <div className="space-y-3">
                {syncPageLogs.map((log: any) => {
                  const effectiveStatus = getEffectiveStatus(log);
                  const endTime = log.completed_at || log.finished_at;
                  const duration = endTime
                    ? Math.round((new Date(endTime).getTime() - new Date(log.started_at).getTime()) / 1000)
                    : effectiveStatus === "error"
                      ? Math.round(Math.min(Date.now() - new Date(log.started_at).getTime(), STUCK_THRESHOLD_MS) / 1000)
                      : null;
                  const isSuccess = effectiveStatus === "success";
                  const isError = effectiveStatus === "error";
                  const isRunning = effectiveStatus === "running" || effectiveStatus === "pending";
                  const displayMessage = getEffectiveMessage(log, effectiveStatus);
                  const isExpanded = expandedLogId === log.id;
                  const details = log.details;

                  return (
                    <div key={log.id} className="flex gap-4 relative">
                      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 z-10 ${
                        isSuccess ? "border-primary bg-primary/15" : isError ? "border-destructive bg-destructive/15" : "border-warning bg-warning/15"
                      }`}>
                        {isSuccess ? <CheckCircle className="h-4 w-4 text-primary" /> :
                         isError ? <XCircle className="h-4 w-4 text-destructive" /> :
                         isRunning ? <Loader2 className="h-4 w-4 text-warning animate-spin" /> :
                         <Clock className="h-4 w-4 text-warning" />}
                      </div>

                      <div
                        className="bg-card border border-border rounded-lg p-4 flex-1 card-hover cursor-pointer"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            <span className={`text-xs font-bold uppercase tracking-wider ${
                              isSuccess ? "text-primary" : isError ? "text-destructive" : "text-warning"
                            }`}>{isError ? "FAILED" : isRunning ? "RUNNING" : effectiveStatus.toUpperCase()}</span>
                            <span className="text-xs text-muted-foreground font-mono">{format(new Date(log.started_at), "MMM d, yyyy HH:mm")}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {duration !== null && <span className="font-mono">{duration}s</span>}
                            <span>{log.records_processed} records</span>
                          </div>
                        </div>
                        {log.accounts?.display_name && (
                          <p className="text-sm text-foreground mb-1 ml-5">{log.accounts.display_name}</p>
                        )}
                        {isError && displayMessage && !isExpanded && (
                          <p className="text-xs text-destructive mt-1 ml-5 truncate">{displayMessage}</p>
                        )}

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="mt-3 ml-5 space-y-2 border-t border-border/50 pt-3">
                            {displayMessage && (
                              <div>
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">
                                  {isError ? "Error Message" : "Message"}
                                </p>
                                <p className={`text-xs ${isError ? "text-destructive" : "text-foreground"}`}>{displayMessage}</p>
                              </div>
                            )}
                            {log.accounts_synced != null && (
                              <p className="text-xs text-muted-foreground">Accounts synced: {log.accounts_synced}</p>
                            )}
                            {log.tracking_links_synced != null && (
                              <p className="text-xs text-muted-foreground">Tracking links synced: {log.tracking_links_synced}</p>
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
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pagination */}
            {syncTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
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
      <FanSyncModal open={fanSyncOpen} onOpenChange={setFanSyncOpen} />
    </DashboardLayout>
  );
}

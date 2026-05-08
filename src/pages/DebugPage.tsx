import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { debugCallEndpoint, debugAction, getAccounts } from "@/lib/api";
import { Bug, Send, Loader2, FlaskConical } from "lucide-react";
import { CreditMonitor } from "@/components/debug/CreditMonitor";
import { EndpointLibrary } from "@/components/debug/EndpointLibrary";
import { ResponseDisplay, type ApiResponse } from "@/components/debug/ResponseDisplay";
import { RequestHistory } from "@/components/debug/RequestHistory";

export default function DebugPage() {
  const [quickUrl, setQuickUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<ApiResponse | null>(null);
  const [history, setHistory] = useState<ApiResponse[]>([]);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [sessionCredits, setSessionCredits] = useState(0);
  const [txSampleResult, setTxSampleResult] = useState<any>(null);
  const [txSampleLoading, setTxSampleLoading] = useState(false);
  const [txTypesResult, setTxTypesResult] = useState<any>(null);
  const [txTypesLoading, setTxTypesLoading] = useState(false);
  const [findTotalResult, setFindTotalResult] = useState<any>(null);
  const [findTotalLoading, setFindTotalLoading] = useState(false);
  const [sumEarningsResult, setSumEarningsResult] = useState<any>(null);
  const [sumEarningsLoading, setSumEarningsLoading] = useState(false);
  const [txTotalsResult, setTxTotalsResult] = useState<any>(null);
  const [txTotalsLoading, setTxTotalsLoading] = useState(false);
  const [txDateTestResult, setTxDateTestResult] = useState<any>(null);
  const [txDateTestLoading, setTxDateTestLoading] = useState(false);
  const [revMonthlyResult, setRevMonthlyResult] = useState<any>(null);
  const [revMonthlyLoading, setRevMonthlyLoading] = useState(false);
  const [rawEarningsResult, setRawEarningsResult] = useState<any>(null);
  const [rawEarningsLoading, setRawEarningsLoading] = useState(false);
  const [finAnalyticsResult, setFinAnalyticsResult] = useState<any>(null);
  const [finAnalyticsLoading, setFinAnalyticsLoading] = useState(false);
  const [txCoverageResult, setTxCoverageResult] = useState<any>(null);
  const [txCoverageLoading, setTxCoverageLoading] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const callEndpoint = useCallback(async (url: string) => {
    setLoading(true);
    try {
      const start = Date.now();
      const bodyParsed = await debugCallEndpoint(url);
      const responseTimeMs = Date.now() - start;
      const res = { status: bodyParsed?.status ?? 200, statusText: bodyParsed?.status_text ?? "OK" };

      const creditsUsed = bodyParsed?.body?._meta?._credits?.used ?? null;
      const creditsBalance = bodyParsed?.body?._meta?._credits?.balance ?? null;

      const response: ApiResponse = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        url,
        status: res.status,
        status_text: res.statusText,
        response_time_ms: responseTimeMs,
        credits_used: creditsUsed,
        credits_balance: creditsBalance,
        body: bodyParsed?.body ?? bodyParsed,
      };

      if (creditsBalance !== null) setCreditBalance(creditsBalance);
      if (creditsUsed !== null) setSessionCredits((p) => p + creditsUsed);

      setCurrentResponse(response);
      setHistory((prev) => [response, ...prev].slice(0, 10));
    } catch (err: any) {
      const response: ApiResponse = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        url,
        status: 500,
        status_text: "Error",
        response_time_ms: 0,
        credits_used: null,
        credits_balance: null,
        body: { error: err.message },
      };
      setCurrentResponse(response);
      setHistory((prev) => [response, ...prev].slice(0, 10));
    } finally {
      setLoading(false);
    }
  }, []);

  const runTxTypes = useCallback(async () => {
    setTxTypesLoading(true);
    setTxTypesResult(null);
    try {
      const data = await debugAction("revenue_diag");
      setTxTypesResult(data);
    } catch (err: any) {
      setTxTypesResult({ error: err.message });
    } finally {
      setTxTypesLoading(false);
    }
  }, []);

  const runFindTotal = useCallback(async () => {
    setFindTotalLoading(true);
    setFindTotalResult(null);
    try {
      const data = await debugAction("find_total");
      setFindTotalResult(data);
    } catch (err: any) {
      setFindTotalResult({ error: err.message });
    } finally {
      setFindTotalLoading(false);
    }
  }, []);

  const runSumEarnings = useCallback(async () => {
    setSumEarningsLoading(true);
    setSumEarningsResult(null);
    try {
      const data = await debugAction("sum_earnings");
      setSumEarningsResult(data);
    } catch (err: any) {
      setSumEarningsResult({ error: err.message });
    } finally {
      setSumEarningsLoading(false);
    }
  }, []);

  const runRawEarnings = useCallback(async () => {
    setRawEarningsLoading(true);
    setRawEarningsResult(null);
    try {
      const data = await debugAction("raw_earnings");
      setRawEarningsResult(data);
    } catch (err: any) {
      setRawEarningsResult({ error: err.message });
    } finally {
      setRawEarningsLoading(false);
    }
  }, []);

  const runRevMonthly = useCallback(async () => {
    setRevMonthlyLoading(true);
    setRevMonthlyResult(null);
    try {
      const data = await debugAction("rev_monthly_check");
      setRevMonthlyResult(data);
    } catch (err: any) {
      setRevMonthlyResult({ error: err.message });
    } finally {
      setRevMonthlyLoading(false);
    }
  }, []);

  const runTxDateTest = useCallback(async () => {
    setTxDateTestLoading(true);
    setTxDateTestResult(null);
    try {
      const data = await debugAction("tx_date_test");
      setTxDateTestResult(data);
    } catch (err: any) {
      setTxDateTestResult({ error: err.message });
    } finally {
      setTxDateTestLoading(false);
    }
  }, []);

  const runTxTotals = useCallback(async () => {
    setTxTotalsLoading(true);
    setTxTotalsResult(null);
    try {
      const data = await debugAction("tx_totals");
      setTxTotalsResult(data);
    } catch (err: any) {
      setTxTotalsResult({ error: err.message });
    } finally {
      setTxTotalsLoading(false);
    }
  }, []);

  const runTxCoverage = useCallback(async () => {
    setTxCoverageLoading(true);
    setTxCoverageResult(null);
    try {
      const data = await debugAction("tx_coverage");
      setTxCoverageResult(data);
    } catch (err: any) {
      setTxCoverageResult({ error: err.message });
    } finally {
      setTxCoverageLoading(false);
    }
  }, []);

  const runFinAnalytics = useCallback(async () => {
    setFinAnalyticsLoading(true);
    setFinAnalyticsResult(null);
    try {
      const data = await debugAction("fin_analytics_probe");
      setFinAnalyticsResult(data);
    } catch (err: any) {
      setFinAnalyticsResult({ error: err.message });
    } finally {
      setFinAnalyticsLoading(false);
    }
  }, []);

  const runTxSample = useCallback(async () => {
    setTxSampleLoading(true);
    setTxSampleResult(null);
    try {
      const data = await debugAction("tx_sample");
      setTxSampleResult(data);
    } catch (err: any) {
      setTxSampleResult({ error: err.message });
    } finally {
      setTxSampleLoading(false);
    }
  }, []);

  return (
    <DashboardLayout>
      <div className="w-full px-6 py-4 space-y-4">
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Bug className="h-5 w-5" /> API Testing Tool
          </h1>
          <p className="text-sm text-muted-foreground">Test OnlyFans API endpoints and inspect raw responses</p>
        </div>

        {/* Section 5 — Credit Monitor (always visible) */}
        <CreditMonitor balance={creditBalance} sessionUsed={sessionCredits} />

        {/* Per-Account DB Transaction Check */}
        <div className="bg-card border border-sky-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-sky-400" /> Per-Account Transaction Check
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows how many transactions are in the DB per account, date range, and revenue total — use this to verify backfill completeness
              </p>
            </div>
            <button
              onClick={runTxTotals}
              disabled={txTotalsLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
            >
              {txTotalsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Check DB Transactions
            </button>
          </div>
          {txTotalsResult && (
            <div className="space-y-2">
              {txTotalsResult.error && <p className="text-xs text-destructive">{txTotalsResult.error}</p>}
              {txTotalsResult.totals && (
                <div className="space-y-1.5">
                  {/* Summary row */}
                  <div className="flex items-center gap-4 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 text-[11px] flex-wrap">
                    <span className="text-muted-foreground font-semibold">Totals:</span>
                    <span className="font-bold text-[#f1f5f9]">Dashboard: ${Number(txTotalsResult.totals.link_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-sky-400">{Number(txTotalsResult.totals.tx_count).toLocaleString()} real txns</span>
                    {txTotalsResult.totals.em_count > 0 && <>
                      <span className="text-muted-foreground">+</span>
                      <span className="text-violet-400">{Number(txTotalsResult.totals.em_count).toLocaleString()} monthly summaries</span>
                    </>}
                    <span className="text-muted-foreground">·</span>
                    <span className="text-emerald-400">Combined net: ${Number(txTotalsResult.totals.tx_net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {/* Net formula breakdown */}
                  <div className="flex items-center gap-4 bg-secondary/40 rounded px-3 py-1.5 text-[10px] text-muted-foreground">
                    <span className="font-semibold">Net formula used:</span>
                    <span className="text-emerald-400">{Number(txTotalsResult.totals.used_net_field).toLocaleString()} used revenue_net field</span>
                    <span className="text-amber-400">{Number(txTotalsResult.totals.used_fee_calc).toLocaleString()} used revenue−fee</span>
                    <span className="text-orange-400">{Number(txTotalsResult.totals.used_80pct).toLocaleString()} used revenue×0.80 fallback</span>
                  </div>
                  {/* Column headers */}
                  <div className="grid grid-cols-[160px_80px_80px_160px_120px_120px_120px] gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    <span>Account</span>
                    <span>Real TX</span>
                    <span>Monthly</span>
                    <span>Real TX Range</span>
                    <span>History From</span>
                    <span>Dashboard Rev</span>
                    <span>Combined Net</span>
                  </div>
                </div>
              )}
              {(txTotalsResult.accounts ?? []).map((r: any, i: number) => {
                const noTx = Number(r.tx_count) === 0;
                const hasHistory = Number(r.em_count) > 0;
                const fmt = (v: any) => v != null && v !== "" ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                return (
                  <div key={i} className="grid grid-cols-[160px_80px_80px_160px_120px_120px_120px] gap-2 items-center text-[11px] bg-secondary/50 rounded px-2 py-1.5">
                    <span className="font-semibold text-foreground truncate">{r.display_name}</span>
                    <span className={noTx ? "text-destructive font-bold" : "text-sky-400"}>{Number(r.tx_count).toLocaleString()}</span>
                    <span className={hasHistory ? "text-violet-400" : "text-muted-foreground/40"}>{Number(r.em_count).toLocaleString()}</span>
                    <span className={`font-mono text-[10px] ${noTx ? "text-destructive" : "text-muted-foreground"}`}>
                      {r.earliest_real ?? "—"} → {r.latest_real ?? "—"}
                    </span>
                    <span className={`font-mono text-[10px] ${hasHistory ? "text-violet-400" : "text-muted-foreground/40"}`}>
                      {r.earliest_em ?? "—"}
                    </span>
                    <span className="text-[#f1f5f9] font-semibold">{fmt(r.link_revenue)}</span>
                    <span className="text-emerald-400">{fmt(r.tx_net)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Raw Earnings Endpoint Probe */}
        <div className="bg-card border border-indigo-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-indigo-400" /> Raw Earnings Endpoint Probe
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calls <code className="font-mono">statistics/statements/earnings?start_date=2018-01-01</code> and shows exact <code className="font-mono">chartAmount</code> structure — needed to fix field names
              </p>
            </div>
            <button
              onClick={runRawEarnings}
              disabled={rawEarningsLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
            >
              {rawEarningsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Probe Earnings Endpoint
            </button>
          </div>
          {rawEarningsResult && (
            <div className="space-y-2">
              {rawEarningsResult.error && <p className="text-xs text-destructive">{rawEarningsResult.error}</p>}
              {rawEarningsResult.account && (
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <span className="text-muted-foreground">Account: <span className="text-foreground font-semibold">{rawEarningsResult.account}</span></span>
                  <span className="text-muted-foreground">HTTP: <span className={rawEarningsResult.status === 200 ? "text-emerald-400 font-bold" : "text-destructive font-bold"}>{rawEarningsResult.status}</span></span>
                  <span className="text-muted-foreground">chartAmount entries: <span className={rawEarningsResult.chartAmount_length > 0 ? "text-emerald-400 font-bold" : "text-destructive font-bold"}>{rawEarningsResult.chartAmount_length}</span></span>
                </div>
              )}
              {rawEarningsResult.total_scalars && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">data.total (scalar fields)</p>
                  <pre className="text-[10px] bg-secondary/50 p-2 rounded overflow-x-auto text-muted-foreground">{JSON.stringify(rawEarningsResult.total_scalars, null, 2)}</pre>
                </div>
              )}
              {rawEarningsResult.chartAmount_first3?.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">First 3 chartAmount entries</p>
                  <pre className="text-[10px] bg-secondary/50 p-2 rounded overflow-x-auto text-emerald-400">{JSON.stringify(rawEarningsResult.chartAmount_first3, null, 2)}</pre>
                </div>
              )}
              {rawEarningsResult.chartAmount_last3?.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Last 3 chartAmount entries</p>
                  <pre className="text-[10px] bg-secondary/50 p-2 rounded overflow-x-auto text-sky-400">{JSON.stringify(rawEarningsResult.chartAmount_last3, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* TX Daily Coverage */}
        <div className="bg-card border border-amber-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-amber-400" /> Transaction Daily Coverage
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows what daily data is stored in the transactions table — earliest date, gaps, and last 90-day coverage
              </p>
            </div>
            <button
              onClick={runTxCoverage}
              disabled={txCoverageLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              {txCoverageLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Check Coverage
            </button>
          </div>
          {txCoverageResult && (
            <div className="space-y-3">
              {txCoverageResult.error && <p className="text-xs text-destructive">{txCoverageResult.error}</p>}
              {txCoverageResult.global && (() => {
                const g = txCoverageResult.global;
                const fmt = (v: any) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                return (
                  <div className="flex flex-wrap gap-4 text-[11px] bg-secondary/50 rounded p-3">
                    <span className="text-muted-foreground">Total rows: <span className="text-foreground font-bold">{Number(g.total_rows).toLocaleString()}</span></span>
                    <span className="text-muted-foreground">Distinct days: <span className="text-amber-400 font-bold">{Number(g.distinct_days).toLocaleString()}</span></span>
                    <span className="text-muted-foreground">Earliest: <span className="text-foreground font-mono">{g.earliest_date ?? "—"}</span></span>
                    <span className="text-muted-foreground">Latest: <span className="text-foreground font-mono">{g.latest_date ?? "—"}</span></span>
                    <span className="text-muted-foreground">Accounts: <span className="text-foreground font-bold">{g.accounts_with_data}</span></span>
                    <span className="text-muted-foreground">Gross: <span className="text-foreground">{fmt(g.total_gross)}</span></span>
                    <span className="text-muted-foreground">Net: <span className="text-emerald-400 font-bold">{fmt(g.total_net)}</span></span>
                  </div>
                );
              })()}
              {txCoverageResult.per_account?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Per account</p>
                  <div className="grid grid-cols-[160px_70px_70px_110px_110px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    <span>Account</span><span>Tx rows</span><span>Days</span><span>Earliest</span><span>Latest</span>
                  </div>
                  {txCoverageResult.per_account.map((r: any, i: number) => (
                    <div key={i} className="grid grid-cols-[160px_70px_70px_110px_110px] gap-2 items-center text-[11px] rounded px-2 py-1 bg-secondary/40">
                      <span className="font-semibold text-foreground truncate">{r.display_name}</span>
                      <span className={Number(r.tx_count) > 0 ? "text-amber-400" : "text-muted-foreground/40"}>{Number(r.tx_count).toLocaleString()}</span>
                      <span className={Number(r.distinct_days) > 0 ? "text-teal-400" : "text-muted-foreground/40"}>{r.distinct_days ?? 0}</span>
                      <span className="text-muted-foreground font-mono text-[10px]">{r.earliest ?? "—"}</span>
                      <span className="text-muted-foreground font-mono text-[10px]">{r.latest ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              {txCoverageResult.coverage_note && (
                <p className="text-[11px] text-amber-400/70 italic">{txCoverageResult.coverage_note}</p>
              )}
            </div>
          )}
        </div>

        {/* Financial Analytics Probe */}
        <div className="bg-card border border-violet-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-violet-400" /> Financial Analytics Probe
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tests 5 variants of <code className="font-mono">analytics/financial/...</code> to find which returns Net $1,977,515 (OFAPI Summary figure)
              </p>
            </div>
            <button
              onClick={runFinAnalytics}
              disabled={finAnalyticsLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
            >
              {finAnalyticsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              {finAnalyticsLoading ? "Probing…" : "Probe Financial Analytics"}
            </button>
          </div>
          {finAnalyticsResult && (
            <div className="space-y-1.5">
              {finAnalyticsResult.error && <p className="text-xs text-destructive">{finAnalyticsResult.error}</p>}
              <div className="grid grid-cols-[160px_60px_130px_130px_130px_80px_1fr] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                <span>Variant</span><span>HTTP</span><span>Net</span><span>Gross</span><span>Fees</span><span>Chart entries</span><span>Keys found</span>
              </div>
              {(finAnalyticsResult.results ?? []).map((r: any, i: number) => {
                const isTarget = r.net && Math.abs(Number(r.net) - 1977515.19) < 5000;
                const fmt = (v: any) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                return (
                  <div key={i} className={`grid grid-cols-[160px_60px_130px_130px_130px_80px_1fr] gap-2 items-center text-[11px] rounded px-2 py-1.5 ${isTarget ? "bg-emerald-500/10 border border-emerald-500/30" : r.error ? "bg-destructive/10 border border-destructive/20" : "bg-secondary/50"}`}>
                    <span className="font-mono text-[10px] text-foreground">{r.id}</span>
                    <span className={r.status === 200 ? "text-emerald-400 font-bold" : r.error ? "text-destructive font-bold" : "text-muted-foreground"}>{r.error ? "ERR" : r.status}</span>
                    <span className={isTarget ? "text-emerald-400 font-bold" : "text-muted-foreground"}>{fmt(r.net)}</span>
                    <span className="text-muted-foreground">{fmt(r.gross)}</span>
                    <span className="text-muted-foreground">{fmt(r.fees)}</span>
                    <span className={r.chart_entries > 0 ? "text-teal-400" : "text-muted-foreground/40"}>{r.chart_entries ?? 0}</span>
                    <span className="text-muted-foreground/70 font-mono text-[10px] truncate">{r.error ?? r.raw_error ?? r.raw_response ?? (r.total_keys ? r.total_keys.join(", ") : r.data_keys ? r.data_keys.join(", ") : r.top_keys ? r.top_keys.join(", ") : "—")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Revenue Monthly Check */}
        <div className="bg-card border border-teal-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-teal-400" /> Revenue Monthly Check
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows what's stored in <code className="font-mono">revenue_monthly</code> per account — the All Time chart reads from this field
              </p>
            </div>
            <button
              onClick={runRevMonthly}
              disabled={revMonthlyLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-teal-500/10 border border-teal-500/30 text-teal-400 hover:bg-teal-500/20 transition-colors disabled:opacity-50"
            >
              {revMonthlyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Check Revenue Monthly
            </button>
          </div>
          {revMonthlyResult && (
            <div className="space-y-1.5">
              {revMonthlyResult.error && <p className="text-xs text-destructive">{revMonthlyResult.error}</p>}
              <div className="grid grid-cols-[160px_80px_80px_100px_100px_120px_120px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                <span>Account</span><span>Status</span><span>Months</span><span>Earliest</span><span>Latest</span><span>Monthly Net</span><span>LTV Total</span>
              </div>
              {(revMonthlyResult.accounts ?? []).map((r: any, i: number) => {
                const hasData = r.status === "HAS DATA";
                const fmt = (v: any) => v != null && v !== "" ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                return (
                  <div key={i} className={`grid grid-cols-[160px_80px_80px_100px_100px_120px_120px] gap-2 items-center text-[11px] rounded px-2 py-1.5 ${hasData ? "bg-secondary/50" : "bg-destructive/10 border border-destructive/20"}`}>
                    <span className="font-semibold text-foreground truncate">{r.display_name}</span>
                    <span className={hasData ? "text-emerald-400 font-semibold" : "text-destructive font-bold"}>{r.status}</span>
                    <span className={hasData ? "text-teal-400" : "text-muted-foreground/40"}>{Number(r.month_count).toLocaleString()}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">{r.earliest_month ?? "—"}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">{r.latest_month ?? "—"}</span>
                    <span className={hasData ? "text-emerald-400" : "text-muted-foreground/40"}>{fmt(r.total_net)}</span>
                    <span className="text-muted-foreground/70">{fmt(r.ltv_total)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* TX Date Range Param Test */}
        <div className="bg-card border border-orange-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-orange-400" /> TX Date Range Test
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tests 10 date-param variants on the transactions endpoint to find which one unlocks history before 2026-04-07
              </p>
            </div>
            <button
              onClick={runTxDateTest}
              disabled={txDateTestLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-50"
            >
              {txDateTestLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              {txDateTestLoading ? "Testing params…" : "Test Date Params"}
            </button>
          </div>
          {txDateTestResult && (
            <div className="space-y-1.5">
              {txDateTestResult.error && <p className="text-xs text-destructive">{txDateTestResult.error}</p>}
              {txDateTestResult.account && (
                <p className="text-[10px] text-muted-foreground">Testing on: <span className="text-foreground font-semibold">{txDateTestResult.account}</span></p>
              )}
              <div className="grid grid-cols-[130px_50px_60px_100px_100px_1fr] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                <span>Param variant</span><span>Status</span><span>Count</span><span>Earliest</span><span>Latest</span><span>Notes</span>
              </div>
              {(txDateTestResult.results ?? []).map((r: any, i: number) => {
                const hasOldData = r.earliest && r.earliest < "2026-04-01";
                return (
                  <div key={i} className={`grid grid-cols-[130px_50px_60px_100px_100px_1fr] gap-2 items-center text-[11px] rounded px-2 py-1.5 ${hasOldData ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-secondary/50"}`}>
                    <span className={`font-mono ${hasOldData ? "text-emerald-400 font-bold" : "text-foreground"}`}>{r.id}</span>
                    <span className={`font-mono text-[10px] ${r.status === 200 ? "text-emerald-400" : "text-destructive"}`}>{r.status ?? "ERR"}</span>
                    <span className="text-muted-foreground">{r.count ?? "—"}</span>
                    <span className={hasOldData ? "text-emerald-400 font-bold" : "text-muted-foreground"}>{r.earliest ?? "—"}</span>
                    <span className="text-muted-foreground">{r.latest ?? "—"}</span>
                    <span className="text-muted-foreground/60 text-[10px]">
                      {r.error ?? (r.total_count != null ? `total: ${r.total_count}` : "")}
                      {r.pagination_keys?.length ? ` [${r.pagination_keys.join(", ")}]` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Fan Data Diagnostic */}
        <div className="bg-card border border-rose-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-rose-500" /> Fan Data Diagnostic
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fetches a raw transaction from the API for each account — shows all fields returned so we can find fan IDs
              </p>
            </div>
            <button
              onClick={runTxSample}
              disabled={txSampleLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
            >
              {txSampleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Run Transaction Sample
            </button>
          </div>
          {txSampleResult && (
            <div className="space-y-3">
              {(txSampleResult.results ?? []).map((r: any, i: number) => (
                <div key={i} className="bg-secondary/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${r.status === 200 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/15 text-destructive"}`}>
                      {r.status ?? "ERR"}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{r.account}</span>
                    {r.error && <span className="text-xs text-destructive">{r.error}</span>}
                  </div>
                  {r.tx_fields && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Transaction fields ({r.tx_fields.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {r.tx_fields.map((f: string) => (
                          <span key={f} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${["userId","user_id","fanId","fan_id","subscriberId","subscriber_id","from","payer","buyer","user"].includes(f) ? "bg-primary/15 text-primary font-bold" : "bg-secondary text-muted-foreground"}`}>
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {r.first_tx && (
                    <details className="text-[11px]">
                      <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Show raw transaction</summary>
                      <pre className="mt-1 bg-secondary/50 p-2 rounded overflow-x-auto max-h-48 text-muted-foreground">
                        {JSON.stringify(r.first_tx, null, 2)}
                      </pre>
                    </details>
                  )}
                  {!r.tx_fields && !r.error && (
                    <p className="text-xs text-muted-foreground">No transactions returned — top keys: {JSON.stringify(r.top_keys)}</p>
                  )}
                </div>
              ))}
              {txSampleResult.error && (
                <p className="text-xs text-destructive">{txSampleResult.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Transaction Type Breakdown Diagnostic */}
        <div className="bg-card border border-amber-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-amber-500" /> Transaction Type Breakdown
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows all distinct transaction types in the DB — reveals what's being dumped in "other" and inflating the Unattributed number
              </p>
            </div>
            <button
              onClick={runTxTypes}
              disabled={txTypesLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              {txTypesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Check Transaction Types
            </button>
          </div>
          {txTypesResult && (
            <div className="space-y-2">
              {txTypesResult.error && <p className="text-xs text-destructive">{txTypesResult.error}</p>}
              {txTypesResult.types && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    {txTypesResult.transaction_count} total transactions · {txTypesResult.types.length} distinct types
                  </p>
                  <div className="space-y-1">
                    {txTypesResult.types.map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 text-[11px] bg-secondary/50 rounded px-2 py-1.5">
                        <span className="font-mono text-foreground w-32 shrink-0">{t.type || "(null/empty)"}</span>
                        <span className="text-muted-foreground">{Number(t.cnt).toLocaleString()} txns</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sum Earnings (Full History) */}
        <div className="bg-card border border-violet-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-violet-500" /> Sum Earnings — Full History
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calls <code className="font-mono">statistics/statements/earnings?start_date=2018-01-01&amp;type=total</code> for every account and sums the result — looking for ~$1.99M
              </p>
            </div>
            <button
              onClick={runSumEarnings}
              disabled={sumEarningsLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
            >
              {sumEarningsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              {sumEarningsLoading ? "Fetching all accounts…" : "Sum Earnings (Full History)"}
            </button>
          </div>
          {sumEarningsResult && (
            <div className="space-y-2">
              {sumEarningsResult.error && <p className="text-xs text-destructive">{sumEarningsResult.error}</p>}
              {sumEarningsResult.grand_total != null && (
                <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2">
                  <span className="text-[11px] text-muted-foreground">{sumEarningsResult.account_count} accounts ·</span>
                  <span className="text-lg font-bold text-violet-400">
                    ${Number(sumEarningsResult.grand_total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[11px] text-muted-foreground">grand total net</span>
                </div>
              )}
              {(sumEarningsResult.results ?? []).map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-3 text-[11px] bg-secondary/50 rounded px-2 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${r.status === 200 ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"}`}>
                    {r.status ?? "ERR"}
                  </span>
                  <span className="font-semibold text-foreground w-36 shrink-0">{r.account}</span>
                  {r.net != null
                    ? <span className="text-emerald-400 font-bold">${Number(r.net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    : <span className="text-destructive/70">no net</span>}
                  {r.gross != null && <span className="text-muted-foreground/60 ml-1">(gross: ${Number(r.gross).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>}
                  {r.error && <span className="text-destructive">{r.error}</span>}
                  {r.data_total_keys && (
                    <span className="text-muted-foreground/60 ml-1 font-mono">[{r.data_total_keys.join(", ")}]</span>
                  )}
                  {!r.error && r.raw_sample && (
                    <details className="ml-2">
                      <summary className="text-muted-foreground cursor-pointer">raw</summary>
                      <pre className="text-[10px] bg-secondary p-1 rounded mt-1 overflow-x-auto max-w-xs">{r.raw_sample}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Find Revenue Total */}
        <div className="bg-card border border-emerald-500/30 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-emerald-500" /> Find Revenue Total
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tests 8 OFAPI analytics endpoint variants to find which one returns the Financial Analytics total (~$1.99M)
              </p>
            </div>
            <button
              onClick={runFindTotal}
              disabled={findTotalLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {findTotalLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              {findTotalLoading ? "Testing endpoints…" : "Find Revenue Total"}
            </button>
          </div>
          {findTotalResult && (
            <div className="space-y-1.5">
              {findTotalResult.error && <p className="text-xs text-destructive">{findTotalResult.error}</p>}
              {(findTotalResult.results ?? []).map((r: any, i: number) => {
                const hasTotal = r.total != null && r.total !== 0;
                return (
                  <div key={i} className={`flex items-center gap-3 text-[11px] rounded px-2 py-1.5 ${hasTotal ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-secondary/50"}`}>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${r.status === 200 ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"}`}>
                      {r.status ?? "ERR"}
                    </span>
                    <span className="font-mono text-foreground w-44 shrink-0">{r.id}</span>
                    {r.total != null
                      ? <span className={`font-bold ${hasTotal ? "text-emerald-400" : "text-muted-foreground"}`}>${Number(r.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      : <span className="text-muted-foreground/50">no total</span>}
                    {r.gross != null && <span className="text-muted-foreground/60 ml-1">(gross: ${Number(r.gross).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>}
                    {r.error && <span className="text-destructive">{r.error}</span>}
                    {r.ofapi_ids_found != null && <span className="text-muted-foreground">OFAPI acct IDs: {r.ofapi_ids_found} · sample: {r.sample_acct_id}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-[1fr_300px] gap-5">
          <div className="space-y-6">
            {/* Section 1 — Quick Test */}
            <div className="bg-card border border-border rounded-lg p-5 space-y-3">
              <h2 className="text-[13px] font-bold text-foreground">Quick Test</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickUrl}
                  onChange={(e) => setQuickUrl(e.target.value)}
                  placeholder="https://app.onlyfansapi.com/api/..."
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground"
                />
                <button
                  onClick={() => quickUrl && callEndpoint(quickUrl)}
                  disabled={loading || !quickUrl}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium border border-[#0891b2]/30 text-[#0891b2] hover:bg-[#0891b2] hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  GET
                </button>
              </div>
            </div>

            {/* Section 2 — Endpoint Library */}
            <div>
              <h2 className="text-[15px] font-bold text-foreground mb-3">Endpoint Library</h2>
              {accounts && accounts.length > 0 && (
                <EndpointLibrary accounts={accounts} onCall={callEndpoint} loading={loading} />
              )}
            </div>

            {/* Section 3 — Response Display */}
            <ResponseDisplay response={currentResponse} loading={loading && !currentResponse} />
          </div>

          {/* Section 4 — Request History (sidebar) */}
          <div className="space-y-4">
            <RequestHistory history={history} onSelect={setCurrentResponse} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

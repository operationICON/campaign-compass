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
                <div className="flex items-center gap-4 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 text-[11px]">
                  <span className="text-muted-foreground">Totals:</span>
                  <span className="font-bold text-sky-400">{Number(txTotalsResult.totals.tx_count).toLocaleString()} txns</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-bold text-emerald-400">
                    ${Number(txTotalsResult.totals.net_sum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} net
                  </span>
                  <span className="text-muted-foreground/60">
                    (gross ${Number(txTotalsResult.totals.gross_sum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </span>
                </div>
              )}
              {(txTotalsResult.accounts ?? []).map((r: any, i: number) => (
                <div key={i} className="grid grid-cols-[160px_1fr_1fr_1fr_1fr] gap-2 items-center text-[11px] bg-secondary/50 rounded px-2 py-1.5">
                  <span className="font-semibold text-foreground truncate">{r.display_name}</span>
                  <span className="text-muted-foreground">{Number(r.tx_count).toLocaleString()} txns</span>
                  <span className={`font-mono ${Number(r.tx_count) === 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {r.earliest_date ?? "—"} → {r.latest_date ?? "—"}
                  </span>
                  <span className="text-emerald-400 font-semibold">
                    {r.net_sum != null ? `$${Number(r.net_sum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                  </span>
                  <span className="text-muted-foreground/60">
                    {r.gross_sum != null ? `gross $${Number(r.gross_sum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
                  </span>
                </div>
              ))}
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

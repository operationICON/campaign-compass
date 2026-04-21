import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Bug, Send, Loader2 } from "lucide-react";
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

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, display_name, username, onlyfans_account_id");
      return data ?? [];
    },
  });

  const callEndpoint = useCallback(async (url: string) => {
    setLoading(true);
    try {
      const start = Date.now();
      // All OF API calls go through the edge function — key never reaches the browser
      const { data: proxyData, error: proxyError } = await supabase.functions.invoke("debug-api", {
        body: { action: "call_endpoint", url },
      });
      const responseTimeMs = Date.now() - start;

      if (proxyError) throw new Error(proxyError.message);

      const bodyParsed = proxyData;
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

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Bug className="h-5 w-5" /> API Testing Tool
          </h1>
          <p className="text-sm text-muted-foreground">Test OnlyFans API endpoints and inspect raw responses</p>
        </div>

        {/* Section 5 — Credit Monitor (always visible) */}
        <CreditMonitor balance={creditBalance} sessionUsed={sessionCredits} />

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

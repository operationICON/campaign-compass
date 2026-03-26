import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Bug, RefreshCw, Search, Zap } from "lucide-react";
import { format } from "date-fns";

async function testApiConnection(): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke("debug-api");
  if (error) throw error;
  return data;
}

async function fetchDeepDive(accountId: string, trackingLinkId: string, endpoint: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("debug-api", {
    body: { action: "tracking_link_deep_dive", account_id: accountId, tracking_link_id: trackingLinkId, endpoint },
  });
  if (error) throw error;
  return data;
}

async function fetchAdvanced(url: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("debug-api", {
    body: { action: "advanced_endpoint", url },
  });
  if (error) throw error;
  return data;
}

export default function DebugPage() {
  const [result, setResult] = useState<Record<string, any> | null>(null);

  // Deep dive state
  const [ddAccountId, setDdAccountId] = useState("acct_50601363a87541b0910ffd6c1181314c");
  const [ddTrackingLinkId, setDdTrackingLinkId] = useState("2876566");
  const [subsResult, setSubsResult] = useState<any>(null);
  const [spendersResult, setSpendersResult] = useState<any>(null);

  // Advanced endpoint state
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = format(now, "yyyy-MM-dd");
  const [statsDateStart, setStatsDateStart] = useState(firstOfMonth);
  const [statsDateEnd, setStatsDateEnd] = useState(today);
  const [statsResult, setStatsResult] = useState<any>(null);
  const [storedResult, setStoredResult] = useState<any>(null);

  // Fetch accounts for dropdown
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, display_name, username, onlyfans_account_id");
      return data ?? [];
    },
  });

  const testMutation = useMutation({
    mutationFn: testApiConnection,
    onSuccess: setResult,
  });

  const subsMutation = useMutation({
    mutationFn: () => fetchDeepDive(ddAccountId, ddTrackingLinkId, "subscribers"),
    onSuccess: setSubsResult,
  });

  const spendersMutation = useMutation({
    mutationFn: () => fetchDeepDive(ddAccountId, ddTrackingLinkId, "spenders"),
    onSuccess: setSpendersResult,
  });

  const statsMutation = useMutation({
    mutationFn: () => fetchAdvanced(
      `https://app.onlyfansapi.com/api/acct_50601363a87541b0910ffd6c1181314c/tracking-links/2876566/stats?date_start=${statsDateStart}&date_end=${statsDateEnd}`
    ),
    onSuccess: setStatsResult,
  });

  const storedMutation = useMutation({
    mutationFn: () => fetchAdvanced(
      `https://app.onlyfansapi.com/api/acct_50601363a87541b0910ffd6c1181314c/stored/tracking-links`
    ),
    onSuccess: setStoredResult,
  });

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Standard API Test */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Bug className="h-5 w-5" /> API Debug
            </h1>
            <p className="text-sm text-muted-foreground">Raw JSON from OnlyFans API endpoints</p>
          </div>
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Test API
          </button>
        </div>

        {testMutation.isError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-[10px] p-5">
            <p className="text-destructive font-medium">Failed</p>
            <pre className="mt-2 text-sm text-destructive/80 whitespace-pre-wrap">{(testMutation.error as any)?.message}</pre>
          </div>
        )}

        {result && Object.entries(result).map(([name, data]) => (
          <div key={name} className="bg-card border border-border rounded-[10px] overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {name} — {data.status ?? "ERROR"} {data.status_text ?? ""}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{data.url}</p>
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all p-5 max-h-[600px] overflow-auto text-muted-foreground">
              {JSON.stringify(data.body ?? data.error, null, 2)}
            </pre>
          </div>
        ))}

        {!result && !testMutation.isPending && !testMutation.isError && (
          <div className="bg-card border border-border rounded-[10px] p-12 text-center text-muted-foreground">
            Click "Test API" to fetch raw responses from 3 endpoints.
          </div>
        )}

        {/* Tracking Link Deep Dive */}
        <div className="border-t border-border pt-6">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
            <Search className="h-5 w-5" /> Tracking Link Deep Dive
          </h2>

          <div className="bg-card border border-border rounded-[10px] p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Account ID</label>
                <select
                  value={ddAccountId}
                  onChange={(e) => setDdAccountId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="acct_50601363a87541b0910ffd6c1181314c">acct_50601363a87541b0910ffd6c1181314c (default)</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.onlyfans_account_id}>
                      {a.onlyfans_account_id} — @{a.username ?? a.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Tracking Link ID</label>
                <input
                  type="text"
                  value={ddTrackingLinkId}
                  onChange={(e) => setDdTrackingLinkId(e.target.value)}
                  placeholder="e.g. 2876566"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => subsMutation.mutate()}
                disabled={subsMutation.isPending || !ddAccountId || !ddTrackingLinkId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {subsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Fetch Subscribers
              </button>
              <button
                onClick={() => spendersMutation.mutate()}
                disabled={spendersMutation.isPending || !ddAccountId || !ddTrackingLinkId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
              >
                {spendersMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Fetch Spenders
              </button>
            </div>
          </div>

          {/* Subscribers result */}
          {subsMutation.isError && (
            <div className="mt-3 bg-destructive/10 border border-destructive/20 rounded-[10px] p-5">
              <p className="text-destructive font-medium">Subscribers — Failed</p>
              <pre className="mt-2 text-sm text-destructive/80 whitespace-pre-wrap">{(subsMutation.error as any)?.message}</pre>
            </div>
          )}
          {subsResult && (
            <div className="mt-3 bg-card border border-border rounded-[10px] overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Subscribers — {subsResult.status ?? "ERROR"} {subsResult.status_text ?? ""}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{subsResult.url}</p>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all p-5 max-h-[600px] overflow-auto text-muted-foreground">
                {JSON.stringify(subsResult.body ?? subsResult.error, null, 2)}
              </pre>
            </div>
          )}

          {/* Spenders result */}
          {spendersMutation.isError && (
            <div className="mt-3 bg-destructive/10 border border-destructive/20 rounded-[10px] p-5">
              <p className="text-destructive font-medium">Spenders — Failed</p>
              <pre className="mt-2 text-sm text-destructive/80 whitespace-pre-wrap">{(spendersMutation.error as any)?.message}</pre>
            </div>
          )}
          {spendersResult && (
            <div className="mt-3 bg-card border border-border rounded-[10px] overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Spenders — {spendersResult.status ?? "ERROR"} {spendersResult.status_text ?? ""}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{spendersResult.url}</p>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all p-5 max-h-[600px] overflow-auto text-muted-foreground">
                {JSON.stringify(spendersResult.body ?? spendersResult.error, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

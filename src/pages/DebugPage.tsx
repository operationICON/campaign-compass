import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, XCircle, Loader2, Bug, RefreshCw } from "lucide-react";

interface DebugResult {
  api_key_present: boolean;
  api_key_length: number;
  accounts_endpoint: { status: number; status_text: string; ok: boolean } | null;
  accounts_count: number;
  accounts_error: string | null;
  accounts_sample: { id: string; username: string } | null;
  tracking_links_endpoint: { status: number; status_text: string; ok: boolean } | null;
  tracking_links_count: number;
  tracking_links_error: string | null;
  last_successful_sync: { completed_at: string; message: string; records_processed: number } | null;
  latest_sync_error: { started_at: string; completed_at: string; message: string; details: any } | null;
}

async function testApiConnection(): Promise<DebugResult> {
  const { data, error } = await supabase.functions.invoke("debug-api");
  if (error) throw error;
  return data as DebugResult;
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted-foreground">—</span>;
  return ok ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-destructive" />;
}

export default function DebugPage() {
  const [result, setResult] = useState<DebugResult | null>(null);

  const testMutation = useMutation({
    mutationFn: testApiConnection,
    onSuccess: setResult,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bug className="h-6 w-6" /> API Debug
            </h1>
            <p className="text-sm text-muted-foreground">Test OnlyFans API connection and diagnose issues</p>
          </div>
          <Button onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Test API Connection
          </Button>
        </div>

        {testMutation.isError && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="pt-6">
              <p className="text-destructive font-medium">Connection test failed</p>
              <pre className="mt-2 text-sm text-destructive/80 whitespace-pre-wrap">{(testMutation.error as any)?.message}</pre>
            </CardContent>
          </Card>
        )}

        {result && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* API Key Status */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">API Key</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span>ONLYFANS_API_KEY present</span>
                  <StatusIcon ok={result.api_key_present} />
                </div>
                <div className="flex items-center justify-between">
                  <span>Key length</span>
                  <Badge variant="outline" className="font-mono">{result.api_key_length} chars</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Accounts Endpoint */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">/accounts Endpoint</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span>Response</span>
                  {result.accounts_endpoint ? (
                    <Badge variant={result.accounts_endpoint.ok ? "default" : "destructive"}>
                      {result.accounts_endpoint.status} {result.accounts_endpoint.status_text}
                    </Badge>
                  ) : <span className="text-muted-foreground">Not tested</span>}
                </div>
                <div className="flex items-center justify-between">
                  <span>Accounts returned</span>
                  <Badge variant="outline" className="font-mono">{result.accounts_count}</Badge>
                </div>
                {result.accounts_sample && (
                  <div className="flex items-center justify-between">
                    <span>Sample account</span>
                    <span className="text-sm font-mono text-muted-foreground">{result.accounts_sample.username}</span>
                  </div>
                )}
                {result.accounts_error && (
                  <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive whitespace-pre-wrap break-all">
                    {result.accounts_error}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tracking Links Endpoint */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">/tracking-links Endpoint</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span>Response</span>
                  {result.tracking_links_endpoint ? (
                    <Badge variant={result.tracking_links_endpoint.ok ? "default" : "destructive"}>
                      {result.tracking_links_endpoint.status} {result.tracking_links_endpoint.status_text}
                    </Badge>
                  ) : <span className="text-muted-foreground">{result.accounts_count === 0 ? "Skipped (no accounts)" : "Not tested"}</span>}
                </div>
                <div className="flex items-center justify-between">
                  <span>Links returned</span>
                  <Badge variant="outline" className="font-mono">{result.tracking_links_count}</Badge>
                </div>
                {result.tracking_links_error && (
                  <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive whitespace-pre-wrap break-all">
                    {result.tracking_links_error}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sync Status */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sync Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span>Last successful sync</span>
                  <span className="text-sm font-mono text-muted-foreground">
                    {result.last_successful_sync?.completed_at
                      ? new Date(result.last_successful_sync.completed_at).toLocaleString()
                      : "Never"}
                  </span>
                </div>
                {result.last_successful_sync && (
                  <div className="flex items-center justify-between">
                    <span>Records processed</span>
                    <Badge variant="outline" className="font-mono">{result.last_successful_sync.records_processed}</Badge>
                  </div>
                )}
                {result.latest_sync_error && (
                  <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                    <p className="font-medium mb-1">Latest error:</p>
                    <p className="whitespace-pre-wrap break-all">{result.latest_sync_error.message}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {!result && !testMutation.isPending && !testMutation.isError && (
          <Card className="border-border bg-card">
            <CardContent className="py-12 text-center text-muted-foreground">
              Click "Test API Connection" to diagnose your OnlyFans API integration.
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

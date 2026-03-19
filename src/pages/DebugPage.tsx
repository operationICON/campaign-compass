import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Bug, RefreshCw } from "lucide-react";

async function testApiConnection(): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke("debug-api");
  if (error) throw error;
  return data;
}

export default function DebugPage() {
  const [result, setResult] = useState<Record<string, any> | null>(null);

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
              <Bug className="h-6 w-6" /> API Debug — Raw Responses
            </h1>
            <p className="text-sm text-muted-foreground">Raw JSON from OnlyFans API endpoints</p>
          </div>
          <Button onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Test API
          </Button>
        </div>

        {testMutation.isError && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="pt-6">
              <p className="text-destructive font-medium">Failed</p>
              <pre className="mt-2 text-sm text-destructive/80 whitespace-pre-wrap">{(testMutation.error as any)?.message}</pre>
            </CardContent>
          </Card>
        )}

        {result && Object.entries(result).map(([name, data]) => (
          <Card key={name} className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                {name} — {data.status ?? "ERROR"} {data.status_text ?? ""}
              </CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{data.url}</p>
            </CardHeader>
            <CardContent>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted p-4 rounded-md max-h-[600px] overflow-auto">
                {JSON.stringify(data.body ?? data.error, null, 2)}
              </pre>
              {data.headers && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer">Response Headers</summary>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted p-2 rounded-md mt-1">
                    {JSON.stringify(data.headers, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        ))}

        {!result && !testMutation.isPending && !testMutation.isError && (
          <Card className="border-border bg-card">
            <CardContent className="py-12 text-center text-muted-foreground">
              Click "Test API" to fetch raw responses from 3 endpoints.
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

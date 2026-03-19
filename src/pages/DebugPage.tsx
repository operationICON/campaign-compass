import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
      <div className="space-y-5">
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
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch, getTrackingLinks, getAccounts } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Users, Loader2, CheckCircle, XCircle, Square } from "lucide-react";

type QueueItem = {
  id: string;
  campaign_name: string | null;
  account_id: string;
  subscribers: number;
  fans_last_synced_at: string | null;
  needs_full_sync: boolean | null;
  accountUsername?: string;
};

type SyncResult = {
  id: string;
  campaign_name: string | null;
  success: boolean;
  error?: string;
  subscribers_synced?: number;
  spenders_synced?: number;
  ltv?: number;
};

export function FanSyncModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"loading" | "queue" | "running" | "done">("loading");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentLink, setCurrentLink] = useState<QueueItem | null>(null);
  const [results, setResults] = useState<SyncResult[]>([]);
  const [totalFans, setTotalFans] = useState(0);
  const stopRef = useRef(false);

  // Load queue on open
  useEffect(() => {
    if (!open) return;
    setPhase("loading");
    setResults([]);
    setCurrentIndex(0);
    setTotalFans(0);
    stopRef.current = false;
    loadQueue();
  }, [open]);

  const loadQueue = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const allLinks: any[] = await getTrackingLinks();

    // Filter: has activity AND (needs_full_sync OR never synced OR stale)
    const needsSync = allLinks.filter((l: any) =>
      (Number(l.subscribers || 0) > 0 || Number(l.clicks || 0) > 0) &&
      (l.needs_full_sync === true ||
        !l.fans_last_synced_at ||
        new Date(l.fans_last_synced_at) < new Date(sevenDaysAgo))
    );

    const allAccounts: any[] = await getAccounts();
    const accountMap = Object.fromEntries(allAccounts.map((a: any) => [a.id, a.username]));

    const enriched = needsSync.map((l: any) => ({
      ...l,
      accountUsername: accountMap[l.account_id] || "unknown",
    }));

    setQueue(enriched);
    setPhase("queue");
  };

  const startSync = useCallback(async () => {
    setPhase("running");
    stopRef.current = false;
    const newResults: SyncResult[] = [];
    let fans = 0;

    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) break;
      const link = queue[i];
      setCurrentIndex(i);
      setCurrentLink(link);

      try {
        const data = await apiFetch("/fans/sync", {
          method: "POST",
          body: JSON.stringify({ tracking_link_id: link.id, account_id: link.account_id }),
        }).catch((e: any) => ({ success: false, error: e.message }));
        if (data?.success) {
          fans += (data.subscribers_synced || 0);
          newResults.push({
            id: link.id,
            campaign_name: link.campaign_name,
            success: true,
            subscribers_synced: data.subscribers_synced,
            spenders_synced: data.spenders_synced,
            ltv: data.ltv,
          });
        } else {
          newResults.push({
            id: link.id,
            campaign_name: link.campaign_name,
            success: false,
            error: data?.error || "Unknown error",
          });
        }
      } catch (err: any) {
        newResults.push({
          id: link.id,
          campaign_name: link.campaign_name,
          success: false,
          error: err.message,
        });
      }

      setResults([...newResults]);
      setTotalFans(fans);
    }

    setPhase("done");
    // Refresh data
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [queue, queryClient]);

  const stopSync = () => {
    stopRef.current = true;
  };

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;
  const estimatedMinutes = Math.ceil(queue.length * 0.5);
  const progress = queue.length > 0 ? ((currentIndex + (phase === "done" ? 1 : 0)) / queue.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Fan Sync
          </DialogTitle>
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading queue...</span>
          </div>
        )}

        {phase === "queue" && (
          <div className="space-y-4">
            <div className="bg-secondary/30 rounded-lg p-4">
              <p className="text-sm font-medium text-foreground">
                Found {queue.length} tracking links needing fan sync
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Estimated time: ~{estimatedMinutes} minute{estimatedMinutes !== 1 ? "s" : ""}
              </p>
            </div>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All tracking links are up to date!
              </p>
            ) : (
              <div className="flex gap-2">
                <Button onClick={startSync} className="flex-1">
                  Start Sync
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {phase === "running" && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground">
                  Syncing fans: {currentIndex + 1} of {queue.length}
                </p>
                <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {currentLink && (
              <div className="bg-secondary/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Current:</p>
                <p className="text-sm font-medium text-foreground truncate">
                  {currentLink.campaign_name || "Unnamed"} — @{currentLink.accountUsername}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Subscribers synced: {totalFans.toLocaleString()}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>✅ {successCount} synced · ❌ {errorCount} errors</span>
            </div>

            <Button variant="outline" onClick={stopSync} className="w-full gap-2">
              <Square className="h-3 w-3" /> Stop after current
            </Button>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-4">
            <div className="bg-primary/10 rounded-lg p-4 text-center">
              <CheckCircle className="h-8 w-8 text-primary mx-auto mb-2" />
              <p className="text-sm font-bold text-foreground">Fan sync complete</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground">{successCount}</p>
                <p className="text-[11px] text-muted-foreground">Synced</p>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground">{errorCount}</p>
                <p className="text-[11px] text-muted-foreground">Errors</p>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground">{totalFans.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">Fans</p>
              </div>
            </div>

            {errorCount > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                <p className="text-xs font-medium text-destructive">Failed links:</p>
                {results.filter((r) => !r.success).map((r) => (
                  <div key={r.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                    <span className="truncate">{r.campaign_name || r.id}: {r.error}</span>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={() => onOpenChange(false)} className="w-full">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getSyncLogsByAccount } from "@/lib/api";

type SyncLogStatus = "success" | "partial" | "error" | "running" | "pending";

const SYNC_TYPE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  snapshot: "Snapshots",
  snapshot_backfill: "Backfill",
  ltv: "Analytics",
  onlytraffic: "OnlyTraffic",
  ot_snapshot: "OT Snapshots",
  crosspoll: "Cross-Poll",
  revenue_breakdown: "Rev Breakdown",
  fans: "Fans",
  subscribers: "Sub Attribution",
};

function classifySyncType(log: any): string {
  const msg = (log.message || "").toLowerCase();
  const details = JSON.stringify(log.details || {}).toLowerCase();
  const triggered = (log.triggered_by || "").toLowerCase();
  if (triggered.includes("ot_snapshot") || triggered.includes("onlytraffic_snapshot") || msg.includes("ot snapshot") || details.includes("ot_snapshot")) return "ot_snapshot";
  if (triggered.includes("revenue_breakdown") || msg.includes("revenue breakdown")) return "revenue_breakdown";
  if (triggered.includes("subscriber_sync")) return "subscribers";
  if (triggered.includes("fan_sync") || triggered.includes("fan_bootstrap")) return "fans";
  if (triggered.includes("ltv") || msg.includes("ltv")) return "ltv";
  if (triggered.includes("crosspoll") || msg.includes("cross-poll") || msg.includes("crosspoll")) return "crosspoll";
  if (triggered.includes("backfill") || msg.includes("backfill")) return "snapshot_backfill";
  if (triggered.includes("snapshot") || msg.includes("snapshot")) return "snapshot";
  if (triggered.includes("onlytraffic") || msg.includes("onlytraffic") || msg.includes("auto-tag")) return "onlytraffic";
  return "dashboard";
}

function getEffectiveStatus(log: any): SyncLogStatus {
  if (log.status === "running" || log.status === "pending") {
    const elapsed = Date.now() - new Date(log.started_at).getTime();
    const threshold = (log.triggered_by || "").includes("revenue_breakdown")
      ? 120 * 60 * 1000
      : 15 * 60 * 1000;
    if (elapsed > threshold) return "error";
  }
  return log.status as SyncLogStatus;
}

function StatusIcon({ status }: { status: SyncLogStatus }) {
  if (status === "success") return <CheckCircle className="h-3 w-3 text-emerald-500" />;
  if (status === "partial") return <Clock className="h-3 w-3 text-amber-500" />;
  if (status === "error") return <XCircle className="h-3 w-3 text-destructive" />;
  if (status === "running" || status === "pending") return <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />;
  return <AlertCircle className="h-3 w-3 text-muted-foreground" />;
}

interface SyncHistoryDropdownProps {
  accountId: string;
  onSelect?: (log: any) => void;
}

export function SyncHistoryDropdown({ accountId, onSelect }: SyncHistoryDropdownProps) {
  const [selectedLogId, setSelectedLogId] = useState<string>("");

  const { data: syncLogs = [], isLoading } = useQuery({
    queryKey: ["sync_logs", accountId],
    queryFn: () => getSyncLogsByAccount(accountId),
    enabled: !!accountId,
    staleTime: 60 * 1000, // 1 minute
  });

  const handleSelect = (logId: string) => {
    setSelectedLogId(logId);
    if (logId && onSelect) {
      const log = syncLogs.find((l: any) => l.id === logId);
      if (log) onSelect(log);
    }
  };

  // Format sync type for display
  const formatSyncType = (log: any): string => {
    const syncType = classifySyncType(log);
    return SYNC_TYPE_LABELS[syncType] || syncType;
  };

  // Format date for dropdown display
  const formatDate = (dateStr: string): string => {
    return format(new Date(dateStr), "MMM d, HH:mm");
  };

  // Get display text for the selected log
  const getSelectedDisplay = (): string => {
    if (!selectedLogId) return "Select sync...";
    const log = syncLogs.find((l: any) => l.id === selectedLogId);
    if (!log) return "Select sync...";
    const syncType = formatSyncType(log);
    const status = getEffectiveStatus(log);
    return `${syncType} · ${status} · ${formatDate(log.started_at)}`;
  };

  if (!accountId) {
    return (
      <span className="text-[10px] text-muted-foreground italic">No account</span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <History className="h-3 w-3 text-muted-foreground shrink-0" />
      <Select value={selectedLogId} onValueChange={handleSelect}>
        <SelectTrigger className="h-6 text-[11px] w-full bg-transparent border-0 px-1 focus:ring-0 hover:bg-secondary/50 rounded cursor-pointer">
          <SelectValue placeholder={isLoading ? "Loading..." : "Select sync..."}>
            {isLoading ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </span>
            ) : selectedLogId ? (
              <span className="flex items-center gap-1">
                {(() => {
                  const log = syncLogs.find((l: any) => l.id === selectedLogId);
                  if (!log) return null;
                  const status = getEffectiveStatus(log);
                  return (
                    <>
                      <StatusIcon status={status} />
                      <span className="truncate">{formatSyncType(log)}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{formatDate(log.started_at)}</span>
                    </>
                  );
                })()}
              </span>
            ) : (
              <span className="text-muted-foreground">Select sync...</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {syncLogs.length === 0 && !isLoading ? (
            <SelectItem value="__empty__" disabled>No sync history</SelectItem>
          ) : (
            syncLogs.slice(0, 50).map((log: any) => {
              const status = getEffectiveStatus(log);
              return (
                <SelectItem key={log.id} value={log.id} className="text-[11px] py-1">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={status} />
                    <span className="font-medium">{formatSyncType(log)}</span>
                    <span className="text-muted-foreground">{formatDate(log.started_at)}</span>
                    {log.records_processed > 0 && (
                      <span className="text-muted-foreground ml-auto">
                        {log.records_processed.toLocaleString()} recs
                      </span>
                    )}
                  </div>
                </SelectItem>
              );
            })
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
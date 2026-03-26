import { format } from "date-fns";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ApiResponse } from "./ResponseDisplay";

interface RequestHistoryProps {
  history: ApiResponse[];
  onSelect: (r: ApiResponse) => void;
}

export function RequestHistory({ history, onSelect }: RequestHistoryProps) {
  if (history.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-5 text-center text-muted-foreground text-sm">
        No requests made yet this session.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[13px] font-semibold text-foreground">Request History</p>
        <p className="text-[11px] text-muted-foreground">Last {history.length} calls this session</p>
      </div>
      <div className="divide-y divide-border max-h-[400px] overflow-auto">
        {history.map((r) => {
          const ok = r.status >= 200 && r.status < 300;
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {ok ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                )}
                <span className="text-[11px] text-muted-foreground font-mono">
                  {format(r.timestamp, "HH:mm:ss")}
                </span>
                {r.credits_used !== null && (
                  <span className="text-[10px] text-[#0891b2] font-mono">{r.credits_used}cr</span>
                )}
              </div>
              <p className="text-[11px] text-foreground font-mono truncate mt-0.5">
                {r.url.replace("https://app.onlyfansapi.com/api", "")}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { Zap } from "lucide-react";

interface CreditMonitorProps {
  balance: number | null;
  sessionUsed: number;
}

export function CreditMonitor({ balance, sessionUsed }: CreditMonitorProps) {
  return (
    <div className="sticky top-0 z-20 bg-background border-b border-border pb-3 pt-1">
      <div className="flex items-center gap-6 bg-card border border-border rounded-lg px-5 py-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-semibold text-foreground">Credits</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance:</span>
          <span className="text-sm font-bold font-mono text-foreground">
            {balance !== null ? balance.toLocaleString() : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Session:</span>
          <span className="text-sm font-bold font-mono text-[#0891b2]">
            {sessionUsed.toLocaleString()} used
          </span>
        </div>
      </div>
    </div>
  );
}

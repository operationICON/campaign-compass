import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, Eye, XCircle } from "lucide-react";
import { differenceInDays } from "date-fns";

interface DailyDecisionViewProps {
  links: any[];
}

export function DailyDecisionView({ links }: DailyDecisionViewProps) {
  const [open, setOpen] = useState(true);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const scaleLinks = links
    .filter(l => l.status === "SCALE")
    .sort((a, b) => Number(b.roi || 0) - Number(a.roi || 0))
    .slice(0, 5);

  const watchLinks = links
    .filter(l => l.status === "WATCH")
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
    .slice(0, 5);

  const stopLinks = links
    .filter(l => {
      if (l.status === "KILL") return true;
      // Only show truly DEAD (had traffic then lost it), not INACTIVE
      if (l.status === "DEAD") {
        return (l.subscribers > 0 || l.spenders > 0 || Number(l.revenue || 0) > 0);
      }
      return false;
    });

  if (scaleLinks.length === 0 && watchLinks.length === 0 && stopLinks.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/30 transition-colors"
      >
        <h3 className="text-sm font-bold text-foreground">📊 Daily Decision View</h3>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-0 border-t border-border">
          {/* Scale Now */}
          <div className="p-4 border-r border-border">
            <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Scale Now
            </h4>
            {scaleLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No campaigns to scale</p>
            ) : (
              <div className="space-y-2">
                {scaleLinks.map((l) => (
                  <div key={l.id} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      <p className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</p>
                    </div>
                    <span className="font-mono text-xs font-bold text-primary ml-2">{Number(l.roi || 0).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Watch */}
          <div className="p-4 border-r border-border">
            <h4 className="text-xs font-bold text-warning uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Watch
            </h4>
            {watchLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No campaigns to watch</p>
            ) : (
              <div className="space-y-2">
                {watchLinks.map((l) => (
                  <div key={l.id} className="flex items-center justify-between bg-warning/5 border border-warning/20 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      <p className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</p>
                    </div>
                    <span className="font-mono text-xs font-bold text-warning ml-2">{fmtC(Number(l.revenue || 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stop / Fix */}
          <div className="p-4">
            <h4 className="text-xs font-bold text-destructive uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5" /> Stop / Fix
            </h4>
            {stopLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No campaigns to stop</p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {stopLinks.map((l) => {
                  const daysSinceClick = l.calculated_at ? differenceInDays(new Date(), new Date(l.calculated_at)) : null;
                  return (
                    <div key={l.id} className="flex items-center justify-between bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {l.status === "DEAD" && daysSinceClick !== null ? `${daysSinceClick}d since last click` : l.accounts?.display_name}
                        </p>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        l.status === "DEAD" ? "bg-destructive/20 text-destructive" : "bg-destructive/20 text-destructive"
                      }`}>{l.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

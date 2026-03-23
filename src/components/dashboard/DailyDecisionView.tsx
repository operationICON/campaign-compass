import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, TrendingUp, Eye, XCircle } from "lucide-react";
import { differenceInDays, format } from "date-fns";

interface DailyDecisionViewProps {
  links: any[];
}

export function DailyDecisionView({ links }: DailyDecisionViewProps) {
  const [open, setOpen] = useState(false);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const noSpendCount = useMemo(() => links.filter(l => l.status === "NO SPEND" || l.status === "NO_DATA" || (!l.ad_spend && !l.cost_total)).length, [links]);

  const scaleLinks = useMemo(() =>
    links
      .filter(l => l.status === "SCALE" && Number(l.roi || 0) > 150 && Number(l.profit || 0) > 0)
      .sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0))
      .slice(0, 5),
    [links]
  );

  const watchLinks = useMemo(() =>
    links
      .filter(l => l.status === "WATCH" || l.status === "LOW")
      .sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0))
      .slice(0, 5),
    [links]
  );

  const stopLinks = useMemo(() =>
    links.filter(l => {
      if (l.status === "KILL") return true;
      if (l.status === "DEAD") {
        return l.clicks > 0 || l.subscribers > 0 || l.spenders > 0 || Number(l.revenue || 0) > 0;
      }
      if (l.roi !== null && l.roi !== undefined && l.roi < 0) return true;
      if (l.clicks > 0 && l.calculated_at) {
        const daysSince = differenceInDays(new Date(), new Date(l.calculated_at));
        if (daysSince >= 3) return true;
      }
      return false;
    }),
    [links]
  );

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-foreground">📊 Daily Decision View</h3>
          <span className="text-xs text-muted-foreground">
            {scaleLinks.length > 0 ? `${scaleLinks.length} campaigns ready to scale` : "No campaigns ready to scale yet"}
          </span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="grid grid-cols-3 gap-0">
            {/* Scale Now */}
            <div className="p-4 border-r border-border">
              <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Scale Now
              </h4>
              {scaleLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No campaigns ready to scale yet — enter spend to see ROI</p>
              ) : (
                <div className="space-y-2">
                  {scaleLinks.map((l) => (
                    <div key={l.id} className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-foreground truncate flex-1 min-w-0">{l.campaign_name}</p>
                        <span className="font-mono text-xs font-bold text-primary ml-2">{Number(l.roi || 0).toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">LTV {fmtC(Number(l.revenue || 0))}</span>
                          <span className={`text-[10px] font-mono font-bold ${Number(l.profit || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            P {fmtC(Number(l.profit || 0))}
                          </span>
                        </div>
                      </div>
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
                <p className="text-xs text-muted-foreground">No campaigns in watch list yet</p>
              ) : (
                <div className="space-y-2">
                  {watchLinks.map((l) => (
                    <div key={l.id} className="bg-warning/5 border border-warning/20 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-foreground truncate flex-1 min-w-0">{l.campaign_name}</p>
                        <span className="font-mono text-xs font-bold text-warning ml-2">
                          {l.roi !== null && l.roi !== undefined ? `${Number(l.roi).toFixed(0)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">LTV {fmtC(Number(l.revenue || 0))}</span>
                          <span className={`text-[10px] font-mono font-bold ${Number(l.profit || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            P {fmtC(Number(l.profit || 0))}
                          </span>
                        </div>
                      </div>
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
                <p className="text-xs text-muted-foreground">No campaigns flagged — looking good!</p>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {stopLinks.map((l) => {
                    const daysSinceClick = l.calculated_at ? differenceInDays(new Date(), new Date(l.calculated_at)) : null;
                    return (
                      <div key={l.id} className="bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-foreground truncate flex-1 min-w-0">{l.campaign_name}</p>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-destructive/20 text-destructive">
                            {l.status === "DEAD" ? "DEAD" : l.status === "KILL" ? "KILL" : "DEAD"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground font-mono">LTV {fmtC(Number(l.revenue || 0))}</span>
                            <span className={`text-[10px] font-mono font-bold ${Number(l.profit || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                              P {fmtC(Number(l.profit || 0))}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

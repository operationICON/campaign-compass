import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, TrendingUp, Eye, XCircle } from "lucide-react";

interface DailyDecisionViewProps {
  links: any[];
  ltvLookup?: Record<string, any>;
}

export function DailyDecisionView({ links, ltvLookup = {} }: DailyDecisionViewProps) {
  const [open, setOpen] = useState(false);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const getLtv = (l: any) => {
    const rec = ltvLookup[l.id];
    return rec ? Number(rec.total_ltv || 0) : Number(l.revenue || 0);
  };
  const linksWithSpend = useMemo(() => links.filter(l => l.cost_total > 0 || l.ad_spend > 0), [links]);
  const noSpendCount = useMemo(() => links.filter(l => !l.cost_total && !l.ad_spend).length, [links]);

  const scaleLinks = useMemo(() =>
    linksWithSpend
      .filter(l => l.roi !== null && l.roi > 150 && Number(l.profit || 0) > 0)
      .sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0))
      .slice(0, 5),
    [linksWithSpend]
  );

  const watchLinks = useMemo(() =>
    linksWithSpend
      .filter(l => l.roi !== null && l.roi >= 50 && l.roi <= 150)
      .sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0))
      .slice(0, 5),
    [linksWithSpend]
  );

  const stopLinks = useMemo(() =>
    links.filter(l => {
      if (l.status === "Kill" || l.status === "KILL") return true;
      if (l.roi !== null && l.roi < 0) return true;
      return false;
    }).filter(l => {
      // Exclude TESTING and INACTIVE
      if (l.clicks === 0 && l.subscribers === 0) return false;
      const calcDate = l.calculated_at ? new Date(l.calculated_at) : null;
      if (calcDate) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        if (calcDate < thirtyDaysAgo) return false;
      }
      return true;
    }).slice(0, 5),
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
                <TrendingUp className="h-3.5 w-3.5" /> Scale Now ({scaleLinks.length})
              </h4>
              {scaleLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet</p>
              ) : (
                <div className="space-y-2">
                  {scaleLinks.map((l) => (
                    <div key={l.id} className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">LTV {fmtC(getLtv(l))}</span>
                          <span className={`text-[10px] font-mono font-bold ${Number(l.profit || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            P {fmtC(Number(l.profit || 0))}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-primary">{Number(l.roi || 0).toFixed(0)}%</span>
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
                <Eye className="h-3.5 w-3.5" /> Watch ({watchLinks.length})
              </h4>
              {watchLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet</p>
              ) : (
                <div className="space-y-2">
                  {watchLinks.map((l) => (
                    <div key={l.id} className="bg-warning/5 border border-warning/20 rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">LTV {fmtC(getLtv(l))}</span>
                          <span className={`text-[10px] font-mono font-bold ${Number(l.profit || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            P {fmtC(Number(l.profit || 0))}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-warning">
                            {l.roi !== null ? `${Number(l.roi).toFixed(0)}%` : "—"}
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
                <XCircle className="h-3.5 w-3.5" /> Stop / Fix ({stopLinks.length})
              </h4>
              {stopLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet</p>
              ) : (
                <div className="space-y-2">
                  {stopLinks.map((l) => (
                    <div key={l.id} className="bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">LTV {fmtC(getLtv(l))}</span>
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
          </div>
          {noSpendCount > 0 && (
            <div className="px-5 py-2 border-t border-border">
              <p className="text-[11px] text-muted-foreground">{noSpendCount} campaigns have no spend set</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

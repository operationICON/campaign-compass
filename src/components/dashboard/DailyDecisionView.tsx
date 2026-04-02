import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, TrendingUp, Eye, XCircle, BarChart3, Users, DollarSign, Zap } from "lucide-react";
import { subDays } from "date-fns";
import { ModelAvatar } from "@/components/ModelAvatar";

interface DailyDecisionViewProps {
  links: any[];
  ltvLookup?: Record<string, any>;
  accounts?: any[];
}

export function DailyDecisionView({ links, ltvLookup = {}, accounts = [] }: DailyDecisionViewProps) {
  const [open, setOpen] = useState(false);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const getLtv = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    const rec = ltvLookup[key];
    return rec ? Number(rec.total_ltv || 0) : Number(l.revenue || 0);
  };
  const getCrossPoll = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    const rec = ltvLookup[key];
    return rec ? Number(rec.cross_poll_revenue || 0) : 0;
  };
  const getNewSubs = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    const rec = ltvLookup[key];
    return rec ? Number(rec.new_subs_total || 0) : 0;
  };

  const sevenDaysAgo = useMemo(() => subDays(new Date(), 7).toISOString(), []);

  const linksWithSpend = useMemo(() => links.filter(l => Number(l.cost_total || 0) > 0), [links]);
  const noSpendCount = useMemo(() => links.filter(l => (!l.cost_total || Number(l.cost_total) === 0) && (l.clicks > 0 || l.subscribers > 0)).length, [links]);

  // Agency today stats
  const agencyToday = useMemo(() => {
    const todayLinks = links.filter(l => l.calculated_at && new Date(l.calculated_at) >= subDays(new Date(), 1));
    const newSubsToday = todayLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const spendToday = todayLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
    const ltvToday = todayLinks.reduce((s: number, l: any) => s + getLtv(l), 0);
    const profitToday = ltvToday - spendToday;
    return { newSubsToday, spendToday, ltvToday, profitToday };
  }, [links, ltvLookup]);

  // Compute profit and ROI for links with spend
  const enrichedWithSpend = useMemo(() => {
    return linksWithSpend.map(l => {
      const ltv = getLtv(l);
      const cp = getCrossPoll(l);
      const cost = Number(l.cost_total || 0);
      const profit = (ltv + cp) - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const newSubs = getNewSubs(l);
      const profitPerSub = newSubs > 0 ? profit / newSubs : null;
      return { ...l, profit, roi, profitPerSub, ltv, newSubs };
    });
  }, [linksWithSpend, ltvLookup]);

  const recentActive = useMemo(() => enrichedWithSpend.filter(l => l.calculated_at && l.calculated_at >= sevenDaysAgo), [enrichedWithSpend, sevenDaysAgo]);

  const scaleLinks = useMemo(() =>
    recentActive
      .filter(l => l.roi > 150 && l.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5),
    [recentActive]
  );

  const watchLinks = useMemo(() =>
    recentActive
      .filter(l => l.roi >= 50 && l.roi <= 150)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5),
    [recentActive]
  );

  const stopLinks = useMemo(() =>
    recentActive
      .filter(l => l.roi < 0)
      .sort((a, b) => a.roi - b.roi)
      .slice(0, 5),
    [recentActive]
  );

  // Top 5 by Profit/Sub
  const topProfitPerSub = useMemo(() =>
    enrichedWithSpend
      .filter(l => l.profitPerSub !== null && l.profitPerSub > 0)
      .sort((a, b) => (b.profitPerSub || 0) - (a.profitPerSub || 0))
      .slice(0, 5),
    [enrichedWithSpend]
  );

  // Models snapshot
  const modelSnapshot = useMemo(() => {
    if (!accounts.length) return [];
    return accounts.map((acc: any) => {
      const accLinks = links.filter((l: any) => l.account_id === acc.id);
      const subsToday = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const spendToday = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
      const totalLtv = accLinks.reduce((s: number, l: any) => s + getLtv(l), 0);
      const newSubs = accLinks.reduce((s: number, l: any) => s + getNewSubs(l), 0);
      const profit = totalLtv - spendToday;
      const profitPerSub = newSubs > 0 ? profit / newSubs : null;
      return { ...acc, subsToday, spendToday, profitPerSub };
    }).sort((a: any, b: any) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity));
  }, [accounts, links, ltvLookup]);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Daily Decision View</h3>
          <span className="text-xs text-muted-foreground">
            {scaleLinks.length > 0 ? `${scaleLinks.length} ready to scale` : "No campaigns ready to scale yet"}
            {noSpendCount > 0 && ` · ${noSpendCount} no spend`}
          </span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border">
          {/* Section 1 — Agency Today */}
          <div className="grid grid-cols-4 gap-0 border-b border-border">
            {[
              { label: "New Subs", value: agencyToday.newSubsToday.toLocaleString(), icon: <Users className="h-3.5 w-3.5" /> },
              { label: "Spend", value: fmtC(agencyToday.spendToday), icon: <DollarSign className="h-3.5 w-3.5" /> },
              { label: "LTV", value: fmtC(agencyToday.ltvToday), icon: <TrendingUp className="h-3.5 w-3.5" /> },
              { label: "Profit", value: fmtC(agencyToday.profitToday), icon: <Zap className="h-3.5 w-3.5" />, color: agencyToday.profitToday >= 0 },
            ].map((item, i) => (
              <div key={i} className={`px-4 py-3 ${i < 3 ? "border-r border-border" : ""}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{item.label}</span>
                </div>
                <p className={`text-lg font-bold font-mono ${item.color !== undefined ? (item.color ? "text-primary" : "text-destructive") : "text-foreground"}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* Section 2 — Needs Action */}
          <div className="grid grid-cols-3 gap-0 border-b border-border">
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
                          <span className={`text-[10px] font-mono font-bold ${l.profit >= 0 ? "text-primary" : "text-destructive"}`}>
                            P {fmtC(l.profit)}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-primary">{l.roi.toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Watch */}
            <div className="p-4 border-r border-border">
              <h4 className="text-xs font-bold text-[hsl(var(--warning))] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" /> Watch ({watchLinks.length})
              </h4>
              {watchLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet</p>
              ) : (
                <div className="space-y-2">
                  {watchLinks.map((l) => (
                    <div key={l.id} className="bg-[hsl(var(--warning)/0.05)] border border-[hsl(var(--warning)/0.2)] rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold ${l.profit >= 0 ? "text-primary" : "text-destructive"}`}>
                            P {fmtC(l.profit)}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-[hsl(var(--warning))]">{l.roi.toFixed(0)}%</span>
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
                          <span className="text-[10px] font-mono font-bold text-destructive">
                            P {fmtC(l.profit)}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-destructive">{l.roi.toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section 3 — Top 5 by Profit/Sub */}
          <div className="p-4 border-b border-border">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" /> Top 5 by Profit/Sub
            </h4>
            {topProfitPerSub.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {topProfitPerSub.map((l) => (
                  <div key={l.id} className="bg-secondary/50 border border-border rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground">{l.accounts?.display_name}</span>
                      <span className="text-[10px] font-mono font-bold text-primary">{fmtC(l.profitPerSub!)}/sub</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 4 — Models Snapshot */}
          {modelSnapshot.length > 0 && (
            <div className="p-4">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-primary" /> Models Snapshot
              </h4>
              <div className="space-y-1.5">
                {modelSnapshot.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-3 text-xs">
                    <ModelAvatar avatarUrl={m.avatar_thumb_url} name={m.display_name} size={24} />
                    <span className="text-foreground font-medium w-24 truncate">{m.display_name}</span>
                    <span className="text-muted-foreground font-mono">{m.subsToday.toLocaleString()} subs</span>
                    <span className="text-muted-foreground font-mono">{fmtC(m.spendToday)} spend</span>
                    <span className={`font-mono font-bold ${m.profitPerSub != null ? (m.profitPerSub >= 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                      {m.profitPerSub != null ? `${fmtC(m.profitPerSub)}/sub` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Eye, XCircle, BarChart3, Users, Zap, Link2, AlertTriangle, Trophy, DollarSign } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";

interface DailyDecisionViewProps {
  links: any[];
  ltvLookup?: Record<string, any>;
  accounts?: any[];
  snapshotLookup?: Record<string, { clicks: number; subscribers: number; revenue: number }> | null;
  isAllTime?: boolean;
  todaySnapshots?: any[];
  lastWeekSnapshots?: any[];
  activeLinkCount?: number;
  snapshotRows?: any[];
}

export function DailyDecisionView({
  links,
  ltvLookup = {},
  accounts = [],
  snapshotLookup = null,
  isAllTime = true,
  todaySnapshots = [],
  lastWeekSnapshots = [],
  activeLinkCount,
}: DailyDecisionViewProps) {
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

  // Build today's snapshot lookup by tracking_link_id
  const todayLookup = useMemo(() => {
    const map: Record<string, { subscribers: number; revenue: number; clicks: number }> = {};
    for (const s of todaySnapshots) {
      const id = String(s.tracking_link_id ?? "").toLowerCase();
      if (!id) continue;
      map[id] = {
        subscribers: Number(s.subscribers || 0),
        revenue: Number(s.revenue || 0),
        clicks: Number(s.clicks || 0),
      };
    }
    return map;
  }, [todaySnapshots]);

  // Build last week lookup for trend comparison
  const lastWeekLookup = useMemo(() => {
    const map: Record<string, { subscribers: number; revenue: number }> = {};
    for (const s of lastWeekSnapshots) {
      const id = String(s.tracking_link_id ?? "").toLowerCase();
      if (!id) continue;
      const existing = map[id];
      if (existing) {
        if (Number(s.subscribers || 0) > existing.subscribers) existing.subscribers = Number(s.subscribers || 0);
        if (Number(s.revenue || 0) > existing.revenue) existing.revenue = Number(s.revenue || 0);
      } else {
        map[id] = {
          subscribers: Number(s.subscribers || 0),
          revenue: Number(s.revenue || 0),
        };
      }
    }
    return map;
  }, [lastWeekSnapshots]);

  // Only consider links with activity in the selected period
  const activeInPeriod = useMemo(() => {
    if (isAllTime || !snapshotLookup) return links;
    return links.filter(l => {
      const id = String(l.id ?? "").toLowerCase();
      const snap = snapshotLookup[id];
      return snap && (snap.clicks > 0 || snap.subscribers > 0);
    });
  }, [links, isAllTime, snapshotLookup]);

  const linksWithSpend = useMemo(() => activeInPeriod.filter(l => Number(l.cost_total || 0) > 0), [activeInPeriod]);
  const noSpendCount = useMemo(() => activeInPeriod.filter(l => (!l.cost_total || Number(l.cost_total) === 0) && (l.clicks > 0 || l.subscribers > 0)).length, [activeInPeriod]);

  // === SUMMARY METRICS (from tracking_links + tracking_link_ltv, always available) ===
  const resolvedActiveLinksCount = activeLinkCount ?? links.filter(l => Number(l.clicks || 0) > 0 || Number(l.subscribers || 0) > 0).length;

  const bestRoi = useMemo(() => {
    let best: { name: string; roi: number } | null = null;
    for (const l of links) {
      const cost = Number(l.cost_total || 0);
      if (cost <= 0) continue;
      const key = String(l.id ?? "").trim().toLowerCase();
      const rec = ltvLookup[key];
      const ltv = rec ? Number(rec.total_ltv || 0) : 0;
      if (ltv <= 0) continue;
      const roi = ((ltv - cost) / cost) * 100;
      if (!best || roi > best.roi) {
        best = { name: l.campaign_name || "Unknown", roi };
      }
    }
    return best;
  }, [links, ltvLookup]);

  const topEarner = useMemo(() => {
    let best: { name: string; ltv: number } | null = null;
    for (const l of links) {
      const key = String(l.id ?? "").trim().toLowerCase();
      const rec = ltvLookup[key];
      const ltv = rec ? Number(rec.total_ltv || 0) : 0;
      if (ltv > 0 && (!best || ltv > best.ltv)) {
        best = { name: l.campaign_name || "Unknown", ltv };
      }
    }
    return best;
  }, [links, ltvLookup]);

  // Compute profit and ROI for links with spend
  const enrichedWithSpend = useMemo(() => {
    return linksWithSpend.map(l => {
      const rev = isAllTime ? getLtv(l) : Number(l.revenue || 0);
      const cp = isAllTime ? getCrossPoll(l) : 0;
      const cost = Number(l.cost_total || 0);
      const profit = (rev + cp) - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const newSubs = isAllTime ? getNewSubs(l) : Number(l.subscribers || 0);
      const profitPerSub = newSubs > 0 ? profit / newSubs : null;

      // Today's snapshot data
      const id = String(l.id ?? "").toLowerCase();
      const todaySnap = todayLookup[id];
      const lastWeekSnap = lastWeekLookup[id];
      const todaySubs = todaySnap?.subscribers ?? 0;
      const todayRev = todaySnap?.revenue ?? 0;
      const lastWeekRev = lastWeekSnap?.revenue ?? 0;
      const trend = todayRev > 0 && lastWeekRev > 0
        ? ((todayRev - lastWeekRev) / lastWeekRev) * 100
        : null;

      // Find account name
      const account = accounts.find((a: any) => a.id === l.account_id);
      const modelName = account?.display_name || l.accounts?.display_name || "";

      return { ...l, profit, roi, profitPerSub, ltv: rev, newSubs, todaySubs, todayRev, trend, modelName };
    });
  }, [linksWithSpend, ltvLookup, isAllTime, todayLookup, lastWeekLookup, accounts]);

  const scaleLinks = useMemo(() =>
    enrichedWithSpend
      .filter(l => l.roi > 150 && l.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5),
    [enrichedWithSpend]
  );

  const watchLinks = useMemo(() =>
    enrichedWithSpend
      .filter(l => l.roi >= 50 && l.roi <= 150)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5),
    [enrichedWithSpend]
  );

  const stopLinks = useMemo(() =>
    enrichedWithSpend
      .filter(l => l.roi < 0)
      .sort((a, b) => a.roi - b.roi)
      .slice(0, 5),
    [enrichedWithSpend]
  );

  const needsAttentionCount = useMemo(() => {
    return links.filter(l => {
      const cost = Number(l.cost_total || 0);
      if (cost <= 0) return false;
      const key = String(l.id ?? "").trim().toLowerCase();
      const rec = ltvLookup[key];
      const ltv = rec ? Number(rec.total_ltv || 0) : 0;
      return ltv < cost;
    }).length;
  }, [links, ltvLookup]);

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
      const subsToday = accLinks.reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
      const spendToday = accLinks.reduce((s: number, l: any) => s + Number(l.cost_total || 0), 0);
      const totalLtvVal = isAllTime
        ? accLinks.reduce((s: number, l: any) => s + getLtv(l), 0)
        : accLinks.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
      const newSubs = isAllTime
        ? accLinks.reduce((s: number, l: any) => s + getNewSubs(l), 0)
        : subsToday;
      const profit = totalLtvVal - spendToday;
      const profitPerSub = newSubs > 0 ? profit / newSubs : null;
      return { ...acc, subsToday, spendToday, profitPerSub };
    }).sort((a: any, b: any) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity));
  }, [accounts, links, ltvLookup, isAllTime]);

  function TrendBadge({ trend }: { trend: number | null }) {
    if (trend === null) return <span className="text-[9px] text-muted-foreground">—</span>;
    const up = trend >= 0;
    return (
      <span className={`inline-flex items-center gap-0.5 text-[9px] font-mono font-bold ${up ? "text-primary" : "text-destructive"}`}>
        {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
        {Math.abs(trend).toFixed(0)}%
      </span>
    );
  }

  function CampaignCard({ l, borderClass }: { l: any; borderClass: string }) {
    return (
      <div className={`${borderClass} rounded-lg px-3 py-2`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground truncate flex-1">{l.campaign_name}</p>
          <TrendBadge trend={l.trend} />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">{l.modelName}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">{l.todaySubs} subs</span>
            <span className="text-[10px] font-mono text-muted-foreground">{fmtC(l.todayRev)}</span>
            <span className={`font-mono text-[10px] font-bold ${l.roi >= 0 ? "text-primary" : "text-destructive"}`}>{l.roi.toFixed(0)}%</span>
          </div>
        </div>
      </div>
    );
  }

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
          {/* Section 1 — Key Metrics */}
          <div className="grid grid-cols-4 gap-0 border-b border-border">
            <div className="px-4 py-3 border-r border-border">
              <div className="flex items-center gap-1.5 mb-1">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active Links</span>
              </div>
              <p className="text-lg font-mono font-bold text-foreground">{resolvedActiveLinksCount.toLocaleString()}</p>
            </div>
            <div className="px-4 py-3 border-r border-border">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Best ROI</span>
              </div>
              {bestRoi ? (
                <>
                  <p className="text-sm font-bold text-primary truncate">{bestRoi.roi.toFixed(0)}%</p>
                  <p className="text-[10px] text-muted-foreground truncate">{bestRoi.name}</p>
                </>
              ) : (
                <p className="text-sm font-bold text-muted-foreground">—</p>
              )}
            </div>
            <div className="px-4 py-3 border-r border-border">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Needs Attention</span>
              </div>
              <p className={`text-lg font-mono font-bold ${needsAttentionCount > 0 ? "text-destructive" : "text-primary"}`}>{needsAttentionCount.toLocaleString()}</p>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Top Earner</span>
              </div>
              {topEarner ? (
                <>
                  <p className="text-sm font-bold text-foreground truncate">{fmtC(topEarner.ltv)}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{topEarner.name}</p>
                </>
              ) : (
                <p className="text-sm font-bold text-muted-foreground">—</p>
              )}
            </div>
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
                    <CampaignCard key={l.id} l={l} borderClass="bg-primary/5 border border-primary/20" />
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
                    <CampaignCard key={l.id} l={l} borderClass="bg-[hsl(var(--warning)/0.05)] border border-[hsl(var(--warning)/0.2)]" />
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
                    <CampaignCard key={l.id} l={l} borderClass="bg-destructive/5 border border-destructive/20" />
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
                      <span className="text-[10px] text-muted-foreground">{l.modelName}</span>
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

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
  snapshotRows = [],
}: DailyDecisionViewProps) {
  const [open, setOpen] = useState(false);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // === Helpers to read from tracking_link_ltv ===
  const getLtv = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    const rec = ltvLookup[key];
    return rec ? Number(rec.total_ltv || 0) : 0;
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

  // === Period snapshot lookups ===
  const periodSnapshotByLink = useMemo(() => {
    if (isAllTime || !snapshotLookup) return null;
    return snapshotLookup;
  }, [isAllTime, snapshotLookup]);

  // === Determine "live" links: not DEAD/NO_DATA + had activity in period ===
  const liveLinks = useMemo(() => {
    return links.filter(l => {
      const status = (l.status || "").toUpperCase();
      if (status === "DEAD" || status === "NO_DATA") return false;

      // Check activity: for period filters use snapshots, for all time use tracking_links cumulative
      if (periodSnapshotByLink) {
        const id = String(l.id ?? "").toLowerCase();
        const snap = periodSnapshotByLink[id];
        return snap && (snap.subscribers > 0 || snap.clicks > 0);
      }
      // All time: use tracking_links fields
      return Number(l.clicks || 0) > 0 || Number(l.subscribers || 0) > 0;
    });
  }, [links, periodSnapshotByLink]);

  // === Build today/lastweek lookups for trend badges ===
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

  // === Summary metrics ===
  const resolvedActiveLinksCount = activeLinkCount ?? liveLinks.length;

  const bestRoi = useMemo(() => {
    let best: { name: string; roi: number } | null = null;
    for (const l of liveLinks) {
      const cost = Number(l.cost_total || 0);
      if (cost <= 0) continue;
      const ltv = getLtv(l) + getCrossPoll(l);
      if (ltv <= 0) continue;
      const roi = ((ltv - cost) / cost) * 100;
      if (!best || roi > best.roi) {
        best = { name: l.campaign_name || "Unknown", roi };
      }
    }
    return best;
  }, [liveLinks, ltvLookup]);

  const topEarner = useMemo(() => {
    let best: { name: string; ltv: number } | null = null;
    for (const l of liveLinks) {
      const ltv = getLtv(l);
      if (ltv > 0 && (!best || ltv > best.ltv)) {
        best = { name: l.campaign_name || "Unknown", ltv };
      }
    }
    return best;
  }, [liveLinks, ltvLookup]);

  const needsAttentionCount = useMemo(() => {
    return liveLinks.filter(l => {
      const cost = Number(l.cost_total || 0);
      if (cost <= 0) return false;
      const ltv = getLtv(l);
      return ltv < cost;
    }).length;
  }, [liveLinks, ltvLookup]);

  const noSpendCount = useMemo(() =>
    liveLinks.filter(l => (!l.cost_total || Number(l.cost_total) === 0)).length,
  [liveLinks]);

  // === Enrich live links with spend for categorisation ===
  const enrichedLive = useMemo(() => {
    return liveLinks.filter(l => Number(l.cost_total || 0) > 0).map(l => {
      const id = String(l.id ?? "").toLowerCase();
      const allTimeLtv = getLtv(l) + getCrossPoll(l);
      const cost = Number(l.cost_total || 0);
      // All Time ROI (always from tracking_link_ltv)
      const allTimeRoi = cost > 0 ? ((allTimeLtv - cost) / cost) * 100 : 0;

      // Period subs & revenue from snapshots (or all-time from tracking_links)
      const snap = periodSnapshotByLink?.[id];
      const periodSubs = snap ? snap.subscribers : Number(l.subscribers || 0);
      const periodRev = snap ? snap.revenue : Number(l.revenue || 0);

      // Today snapshot for trend
      const todaySnap = todayLookup[id];
      const lastWeekSnap = lastWeekLookup[id];
      const todaySubs = todaySnap?.subscribers ?? 0;
      const todayRev = todaySnap?.revenue ?? 0;
      const lastWeekRev = lastWeekSnap?.revenue ?? 0;
      const trend = todayRev > 0 && lastWeekRev > 0
        ? ((todayRev - lastWeekRev) / lastWeekRev) * 100
        : null;

      // Model name
      const account = accounts.find((a: any) => a.id === l.account_id);
      const modelName = account?.display_name || l.accounts?.display_name || "";

      return {
        ...l,
        allTimeLtv,
        allTimeRoi,
        periodSubs,
        periodRev,
        todaySubs,
        todayRev,
        trend,
        modelName,
      };
    });
  }, [liveLinks, ltvLookup, periodSnapshotByLink, todayLookup, lastWeekLookup, accounts]);

  // === SCALE / WATCH / STOP categories using All Time ROI ===
  const scaleLinks = useMemo(() =>
    enrichedLive
      .filter(l => l.allTimeRoi > 150)
      .sort((a, b) => b.allTimeLtv - a.allTimeLtv)
      .slice(0, 5),
  [enrichedLive]);

  const watchLinks = useMemo(() =>
    enrichedLive
      .filter(l => l.allTimeRoi >= 50 && l.allTimeRoi <= 150)
      .sort((a, b) => b.allTimeLtv - a.allTimeLtv)
      .slice(0, 5),
  [enrichedLive]);

  // STOP/FIX: has cost + zero period activity + ROI <= 0
  const stopLinks = useMemo(() => {
    return liveLinks
      .filter(l => {
        const cost = Number(l.cost_total || 0);
        if (cost <= 0) return false;
        const id = String(l.id ?? "").toLowerCase();
        // Check zero activity in selected period
        if (periodSnapshotByLink) {
          const snap = periodSnapshotByLink[id];
          const hasActivity = snap && (snap.subscribers > 0 || snap.clicks > 0);
          if (hasActivity) return false; // has activity — not a stop candidate from period filter
        }
        const allTimeLtv = getLtv(l) + getCrossPoll(l);
        const roi = ((allTimeLtv - cost) / cost) * 100;
        return roi <= 0;
      })
      .map(l => {
        const id = String(l.id ?? "").toLowerCase();
        const allTimeLtv = getLtv(l) + getCrossPoll(l);
        const cost = Number(l.cost_total || 0);
        const allTimeRoi = cost > 0 ? ((allTimeLtv - cost) / cost) * 100 : 0;
        const account = accounts.find((a: any) => a.id === l.account_id);
        const modelName = account?.display_name || l.accounts?.display_name || "";
        const todaySnap = todayLookup[id];
        const lastWeekSnap = lastWeekLookup[id];
        const todayRev = todaySnap?.revenue ?? 0;
        const lastWeekRev = lastWeekSnap?.revenue ?? 0;
        const trend = todayRev > 0 && lastWeekRev > 0
          ? ((todayRev - lastWeekRev) / lastWeekRev) * 100
          : null;
        return {
          ...l,
          allTimeLtv,
          allTimeRoi,
          periodSubs: 0,
          periodRev: 0,
          todaySubs: todaySnap?.subscribers ?? 0,
          todayRev,
          trend,
          modelName,
        };
      })
      .sort((a, b) => a.allTimeRoi - b.allTimeRoi)
      .slice(0, 5);
  }, [liveLinks, ltvLookup, periodSnapshotByLink, todayLookup, lastWeekLookup, accounts]);

  // === TOP 5 by LTV/Sub from tracking_link_ltv ===
  const topProfitPerSub = useMemo(() => {
    // Build per-link LTV/Sub from tracking_link_ltv
    const items: { id: string; campaign_name: string; modelName: string; ltvPerSub: number }[] = [];
    for (const l of liveLinks) {
      const key = String(l.id ?? "").trim().toLowerCase();
      const rec = ltvLookup[key];
      if (!rec) continue;
      const totalLtv = Number(rec.total_ltv || 0);
      const newSubs = Number(rec.new_subs_total || 0);
      if (newSubs <= 0 || totalLtv <= 0) continue;
      const ltvPerSub = totalLtv / newSubs;
      const account = accounts.find((a: any) => a.id === l.account_id);
      const modelName = account?.display_name || l.accounts?.display_name || "";
      items.push({ id: l.id, campaign_name: l.campaign_name || "Unknown", modelName, ltvPerSub });
    }
    return items.sort((a, b) => b.ltvPerSub - a.ltvPerSub).slice(0, 5);
  }, [liveLinks, ltvLookup, accounts]);

  // === MODELS SNAPSHOT ===
  const modelSnapshot = useMemo(() => {
    if (!accounts.length) return [];
    return accounts.map((acc: any) => {
      const accLinks = links.filter((l: any) => l.account_id === acc.id);

      // Subs/day from snapshot rows
      const accLinkIds = new Set(accLinks.map((l: any) => String(l.id).toLowerCase()));
      const accSnapshots = snapshotRows.filter((r: any) =>
        accLinkIds.has(String(r.tracking_link_id ?? "").toLowerCase())
      );
      const totalSnapshotSubs = accSnapshots.reduce((s: number, r: any) => s + Number(r.subscribers || 0), 0);
      const distinctDates = new Set(accSnapshots.map((r: any) => r.snapshot_date));
      const subsPerDay = distinctDates.size > 0 ? Math.round(totalSnapshotSubs / distinctDates.size) : 0;

      // Spend from tracking_links
      const spendTotal = accLinks.reduce((s: number, l: any) => s + (Number(l.cost_total || 0) > 0 ? Number(l.cost_total) : 0), 0);

      // LTV/Sub from tracking_link_ltv: SUM(total_ltv) / SUM(new_subs_total) per account
      let accLtv = 0;
      let accNewSubs = 0;
      for (const l of accLinks) {
        const key = String(l.id ?? "").trim().toLowerCase();
        const rec = ltvLookup[key];
        if (rec) {
          accLtv += Number(rec.total_ltv || 0);
          accNewSubs += Number(rec.new_subs_total || 0);
        }
      }
      const ltvPerSub = accNewSubs > 0 ? accLtv / accNewSubs : null;

      // Profit/Sub = LTV/Sub - (cost_total / subscribers)
      const totalSubs = accLinks.reduce((s: number, l: any) => s + Number(l.subscribers || 0), 0);
      const costPerSub = totalSubs > 0 ? spendTotal / totalSubs : 0;
      const profitPerSub = ltvPerSub != null ? ltvPerSub - costPerSub : null;

      return { ...acc, subsPerDay, spendTotal, ltvPerSub, profitPerSub };
    }).sort((a: any, b: any) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity));
  }, [accounts, links, ltvLookup, snapshotRows]);

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
            <span className="text-[10px] font-mono text-muted-foreground">{l.periodSubs} subs</span>
            <span className="text-[10px] font-mono text-muted-foreground">{fmtC(l.periodRev)}</span>
            <span className="text-[10px] font-mono text-muted-foreground">LTV {fmtC(l.allTimeLtv)}</span>
            <span className={`font-mono text-[10px] font-bold ${l.allTimeRoi >= 0 ? "text-primary" : "text-destructive"}`}>{l.allTimeRoi.toFixed(0)}%</span>
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

          {/* Section 3 — Top 5 by LTV/Sub */}
          <div className="p-4 border-b border-border">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" /> Top 5 by LTV/Sub
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
                      <span className="text-[10px] font-mono font-bold text-primary">{fmtC(l.ltvPerSub)}/sub</span>
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
                    <span className="text-muted-foreground font-mono">{m.subsPerDay.toLocaleString()} subs/day</span>
                    <span className="text-muted-foreground font-mono">{fmtC(m.spendTotal)} spend</span>
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

import { useState, useMemo } from "react";
import {
  ChevronDown, ChevronUp, TrendingUp, TrendingDown, Eye, XCircle,
  BarChart3, Users, Zap, Link2, AlertTriangle, DollarSign,
} from "lucide-react";
import { getEffectiveSource } from "@/lib/source-helpers";
import { ModelAvatar } from "@/components/ModelAvatar";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
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
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const queryClient = useQueryClient();

  const fmtC = (v: number) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtC2 = (v: number) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) => `${v.toFixed(0)}%`;

  // === LTV helpers ===
  const getLtv = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    return Number(ltvLookup[key]?.total_ltv || 0);
  };
  const getCrossPoll = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    return Number(ltvLookup[key]?.cross_poll_revenue || 0);
  };
  const getNewSubs = (l: any) => {
    const key = String(l.id ?? "").trim().toLowerCase();
    return Number(ltvLookup[key]?.new_subs_total || 0);
  };
  const getLtvPerSub = (l: any) => {
    const ns = getNewSubs(l);
    return ns > 0 ? getLtv(l) / ns : 0;
  };

  // === Period snapshot per link ===
  const periodSnapshotByLink = useMemo(() => {
    if (isAllTime || !snapshotLookup) return null;
    return snapshotLookup;
  }, [isAllTime, snapshotLookup]);

  // === Build "all" snapshot lookup for All Time ===
  const allTimeSnapshotByLink = useMemo(() => {
    if (!isAllTime) return null;
    const map: Record<string, { clicks: number; subscribers: number; revenue: number }> = {};
    for (const r of snapshotRows) {
      const id = String(r.tracking_link_id ?? "").toLowerCase();
      if (!id) continue;
      if (!map[id]) map[id] = { clicks: 0, subscribers: 0, revenue: 0 };
      map[id].clicks += Number(r.clicks || 0);
      map[id].subscribers += Number(r.subscribers || 0);
      map[id].revenue += Number(r.revenue || 0);
    }
    return map;
  }, [isAllTime, snapshotRows]);

  // Unified snapshot getter
  const getSnap = (linkId: string) => {
    const id = linkId.toLowerCase();
    if (periodSnapshotByLink) return periodSnapshotByLink[id] || null;
    if (allTimeSnapshotByLink) return allTimeSnapshotByLink[id] || null;
    return null;
  };

  // === Campaigns with subs in period ===
  const campaignsWithSubs = useMemo(() => {
    return links.filter(l => {
      const snap = getSnap(String(l.id ?? ""));
      return snap && snap.subscribers > 0;
    });
  }, [links, periodSnapshotByLink, allTimeSnapshotByLink]);

  // === Enrich all links ===
  const enriched = useMemo(() => {
    return links.map(l => {
      const id = String(l.id ?? "").toLowerCase();
      const snap = getSnap(id);
      const periodSubs = snap?.subscribers ?? 0;
      const periodRev = snap?.revenue ?? 0;
      const periodClicks = snap?.clicks ?? 0;
      const totalLtv = getLtv(l);
      const crossPoll = getCrossPoll(l);
      const newSubs = getNewSubs(l);
      const ltvPerSub = newSubs > 0 ? totalLtv / newSubs : 0;
      const cost = Number(l.cost_total || 0);
      const roi = cost > 0 ? ((totalLtv + crossPoll - cost) / cost) * 100 : 0;
      const account = accounts.find((a: any) => a.id === l.account_id);
      const modelName = account?.display_name || l.accounts?.display_name || "";
      const avatarUrl = account?.avatar_thumb_url || l.accounts?.avatar_thumb_url || null;

      return {
        ...l,
        periodSubs, periodRev, periodClicks,
        totalLtv, crossPoll, newSubs, ltvPerSub, cost, roi,
        modelName, avatarUrl,
        hasPeriodSubs: periodSubs > 0,
        allTimeSubs: Number(l.subscribers || 0),
        allTimeSpenders: Number(l.spenders || 0),
      };
    });
  }, [links, periodSnapshotByLink, allTimeSnapshotByLink, ltvLookup, accounts]);

  // === SCALE NOW (sorted by highest LTV/sub) ===
  const allScaleLinks = useMemo(() =>
    enriched
      .filter(l => l.hasPeriodSubs && l.ltvPerSub > 20 && (l.cost === 0 || l.roi > 150))
      .sort((a, b) => b.ltvPerSub - a.ltvPerSub),
  [enriched]);
  const scaleLinks = allScaleLinks.slice(0, 5);

  // === WATCH (sorted by highest LTV/sub) ===
  const allWatchLinks = useMemo(() =>
    enriched
      .filter(l => l.hasPeriodSubs && ((l.ltvPerSub >= 5 && l.ltvPerSub <= 20) || (l.roi >= 50 && l.roi <= 150)))
      .filter(l => !allScaleLinks.some(s => s.id === l.id))
      .sort((a, b) => b.ltvPerSub - a.ltvPerSub),
  [enriched, allScaleLinks]);
  const watchLinks = allWatchLinks.slice(0, 5);

  // === STOP/FIX (sorted by highest spend first) ===
  const allStopLinks = useMemo(() =>
    enriched
      .filter(l => {
        if (l.cost <= 0) return false;
        const zeroSubs = !l.hasPeriodSubs;
        const negRoi = l.roi < 0;
        return zeroSubs || negRoi;
      })
      .filter(l => !allScaleLinks.some(s => s.id === l.id) && !allWatchLinks.some(w => w.id === l.id))
      .sort((a, b) => b.cost - a.cost),
  [enriched, allScaleLinks, allWatchLinks]);
  const stopLinks = allStopLinks.slice(0, 5);

  const [showAllScale, setShowAllScale] = useState(false);
  const [showAllWatch, setShowAllWatch] = useState(false);
  const [showAllStop, setShowAllStop] = useState(false);

  // === Summary metrics ===
  const activeLinksCount = campaignsWithSubs.length;
  const bestLtvSub = useMemo(() => {
    let best: any = null;
    for (const l of enriched) {
      if (!l.hasPeriodSubs) continue;
      if (!best || l.ltvPerSub > best.ltvPerSub) best = l;
    }
    return best;
  }, [enriched]);

  const needsAttention = useMemo(() =>
    enriched.filter(l => l.cost > 0 && !l.hasPeriodSubs).length,
  [enriched]);

  const topEarner = useMemo(() => {
    let best: any = null;
    const bestRev = 0;
    for (const l of enriched) {
      const rev = Number(l.revenue || 0);
      if (rev > 0 && (!best || rev > bestRev)) best = { ...l, _topRev: rev };
    }
    return best;
  }, [enriched]);

  // === TOP 5 by LTV/Sub (min 5 new fans) ===
  const topLtvPerSub = useMemo(() =>
    enriched
      .filter(l => l.newSubs >= 5 && l.ltvPerSub > 0)
      .sort((a, b) => b.ltvPerSub - a.ltvPerSub)
      .slice(0, 5),
  [enriched]);

  // === MODELS SNAPSHOT ===
  const modelSnapshot = useMemo(() => {
    if (!accounts.length) return [];
    return accounts.map((acc: any) => {
      const accLinks = links.filter((l: any) => l.account_id === acc.id);
      const accLinkIds = new Set(accLinks.map((l: any) => String(l.id).toLowerCase()));
      const accSnaps = snapshotRows.filter((r: any) =>
        accLinkIds.has(String(r.tracking_link_id ?? "").toLowerCase())
      );
      const totalSnapshotSubs = accSnaps.reduce((s: number, r: any) => s + Number(r.subscribers || 0), 0);
      const distinctDates = new Set(accSnaps.map((r: any) => r.snapshot_date));
      const subsPerDay = distinctDates.size > 0 ? Math.round(totalSnapshotSubs / distinctDates.size) : 0;
      const spendTotal = accLinks.reduce((s: number, l: any) => s + Math.max(0, Number(l.cost_total || 0)), 0);

      // Est. Daily Spend = total spend / days since first campaign
      const oldestCreated = accLinks.reduce((oldest: string | null, l: any) => {
        if (!l.created_at) return oldest;
        return !oldest || l.created_at < oldest ? l.created_at : oldest;
      }, null as string | null);
      const daysSinceFirst = oldestCreated
        ? Math.max(1, Math.round((Date.now() - new Date(oldestCreated).getTime()) / 86400000))
        : 1;
      const estDailySpend = spendTotal / daysSinceFirst;

      let accLtv = 0, accNewSubs = 0;
      for (const l of accLinks) {
        const key = String(l.id ?? "").trim().toLowerCase();
        const rec = ltvLookup[key];
        if (rec) {
          accLtv += Number(rec.total_ltv || 0);
          accNewSubs += Number(rec.new_subs_total || 0);
        }
      }
      const ltvPerSub = accNewSubs > 0 ? accLtv / accNewSubs : null;
      const profitPerSub = accNewSubs > 0 ? (accLtv - spendTotal) / accNewSubs : null;

      return { ...acc, subsPerDay, spendTotal, estDailySpend, ltvPerSub, profitPerSub };
    }).sort((a: any, b: any) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity));
  }, [accounts, links, ltvLookup, snapshotRows]);

  const noSpendCount = useMemo(() =>
    campaignsWithSubs.filter(l => !l.cost_total || Number(l.cost_total) === 0).length,
  [campaignsWithSubs]);

  // === Campaign Card ===
  function CampaignCard({ l, accentClass }: { l: any; accentClass: string }) {
    return (
      <button
        onClick={() => setSelectedCampaign(l)}
        className={`w-full text-left rounded-lg px-3 py-2.5 transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer ${accentClass}`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <ModelAvatar avatarUrl={l.avatarUrl} name={l.modelName} size={20} />
          <p className="text-xs font-semibold text-foreground truncate flex-1">{l.campaign_name || "Unknown"}</p>
          <span className={`text-[10px] font-mono font-bold ${l.roi >= 0 ? "text-primary" : "text-destructive"}`}>
            {fmtPct(l.roi)} ROI
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <div>
            <p className="text-[9px] text-muted-foreground uppercase">Subs</p>
            <p className="text-[11px] font-mono font-medium text-foreground">{l.periodSubs.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase">Revenue</p>
            <p className="text-[11px] font-mono font-medium text-foreground">{fmtC(l.periodRev)}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase">LTV/New Sub</p>
            <p className="text-[11px] font-mono font-medium text-foreground">{fmtC2(l.ltvPerSub)}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase">All Time LTV</p>
            <p className="text-[11px] font-mono font-medium text-foreground">{fmtC(l.totalLtv)}</p>
          </div>
        </div>
      </button>
    );
  }

  // === Drawer detail row helper ===
  function getValueColor(tone: "positive" | "negative" | "neutral" = "neutral") {
    if (tone === "positive") return "text-primary";
    if (tone === "negative") return "text-destructive";
    return "text-foreground";
  }

  function DataCard({
    label,
    value,
    tone = "neutral",
  }: {
    label: string;
    value: string;
    tone?: "positive" | "negative" | "neutral";
  }) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-[11px] text-muted-foreground leading-none mb-1">{label}</p>
        <p className={`text-[15px] font-mono font-bold leading-tight ${getValueColor(tone)}`}>{value}</p>
      </div>
    );
  }

  // Drawer is handled by shared CampaignDetailDrawer

  return (
    <>
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Daily Decision View</h3>
            <span className="text-xs text-muted-foreground">
              {scaleLinks.length > 0 ? `${scaleLinks.length} ready to scale` : "No campaigns ready to scale"}
              {needsAttention > 0 && ` · ${needsAttention} need attention`}
            </span>
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="border-t border-border">
            {/* Summary Bar */}
            <div className="grid grid-cols-4 gap-0 border-b border-border">
              <div className="px-4 py-3 border-r border-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active Links</span>
                </div>
                <p className="text-lg font-mono font-bold text-foreground">{activeLinksCount.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">With subs in period</p>
              </div>
              <div className="px-4 py-3 border-r border-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Best LTV/New Sub</span>
                </div>
                {bestLtvSub ? (
                  <>
                    <p className="text-sm font-bold text-primary">{fmtC2(bestLtvSub.ltvPerSub)}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{bestLtvSub.campaign_name}</p>
                  </>
                ) : <p className="text-sm font-bold text-muted-foreground">—</p>}
              </div>
              <div className="px-4 py-3 border-r border-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Needs Attention</span>
                </div>
                <p className={`text-lg font-mono font-bold ${needsAttention > 0 ? "text-destructive" : "text-primary"}`}>
                  {needsAttention.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">Spend + zero subs</p>
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Top Earner</span>
                </div>
                {topEarner ? (
                  <>
                    <p className="text-sm font-bold text-foreground truncate">{fmtC(topEarner.totalLtv)}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{topEarner.campaign_name}</p>
                  </>
                ) : <p className="text-sm font-bold text-muted-foreground">—</p>}
              </div>
            </div>

            {/* SCALE / WATCH / STOP */}
            <div className="grid grid-cols-3 gap-0 border-b border-border">
              <div className="p-4 border-r border-border">
                <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Scale Now ({allScaleLinks.length})
                </h4>
                {scaleLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No campaigns qualify</p>
                ) : (
                  <div className="space-y-2">
                    {(showAllScale ? allScaleLinks : scaleLinks).map(l => <CampaignCard key={l.id} l={l} accentClass="bg-primary/5 border border-primary/20" />)}
                    {allScaleLinks.length > 5 && (
                      <button onClick={() => setShowAllScale(!showAllScale)} className="w-full text-center text-xs text-primary font-medium py-1.5 hover:underline">
                        {showAllScale ? "Show Less" : `View All (${allScaleLinks.length})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="p-4 border-r border-border">
                <h4 className="text-xs font-bold text-[hsl(var(--warning))] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" /> Watch ({allWatchLinks.length})
                </h4>
                {watchLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No campaigns qualify</p>
                ) : (
                  <div className="space-y-2">
                    {(showAllWatch ? allWatchLinks : watchLinks).map(l => <CampaignCard key={l.id} l={l} accentClass="bg-[hsl(var(--warning)/0.05)] border border-[hsl(var(--warning)/0.2)]" />)}
                    {allWatchLinks.length > 5 && (
                      <button onClick={() => setShowAllWatch(!showAllWatch)} className="w-full text-center text-xs text-[hsl(var(--warning))] font-medium py-1.5 hover:underline">
                        {showAllWatch ? "Show Less" : `View All (${allWatchLinks.length})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="p-4">
                <h4 className="text-xs font-bold text-destructive uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" /> Stop / Fix ({allStopLinks.length})
                </h4>
                {stopLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No campaigns qualify</p>
                ) : (
                  <div className="space-y-2">
                    {(showAllStop ? allStopLinks : stopLinks).map(l => <CampaignCard key={l.id} l={l} accentClass="bg-destructive/5 border border-destructive/20" />)}
                    {allStopLinks.length > 5 && (
                      <button onClick={() => setShowAllStop(!showAllStop)} className="w-full text-center text-xs text-destructive font-medium py-1.5 hover:underline">
                        {showAllStop ? "Show Less" : `View All (${allStopLinks.length})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>


            {/* Top 5 by LTV/Sub */}
            <div className="p-4 border-b border-border">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-primary" /> Top 5 by LTV/New Sub
              </h4>
              {topLtvPerSub.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data yet</p>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {topLtvPerSub.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setSelectedCampaign(l)}
                      className="bg-secondary/50 border border-border rounded-lg px-3 py-2.5 text-left hover:bg-secondary/80 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ModelAvatar avatarUrl={l.avatarUrl} name={l.modelName} size={20} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{l.modelName}</p>
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-mono font-bold text-primary">{fmtC2(l.ltvPerSub)}/sub</span>
                        <span className="text-[10px] text-muted-foreground">{l.newSubs} fans</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Models Snapshot */}
            {modelSnapshot.length > 0 && (
              <div className="p-4">
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" /> Models Snapshot
                </h4>
                <div className="overflow-x-auto">
                  <div className="min-w-[760px] space-y-2">
                    <div className="grid grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Model</span>
                      <span>Subs/Day</span>
                      <span>Est. Daily Spend</span>
                      <span>LTV/New Sub</span>
                      <span>Profit/Sub</span>
                    </div>
                    {modelSnapshot.map((m: any) => (
                      <div key={m.id} className="grid grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <ModelAvatar avatarUrl={m.avatar_thumb_url} name={m.display_name} size={24} />
                          <span className="truncate font-medium text-foreground">{m.display_name}</span>
                        </div>
                        <span className="font-mono text-muted-foreground">{m.subsPerDay.toLocaleString()} subs/day</span>
                        <span className="font-mono text-muted-foreground">{fmtC2(m.estDailySpend)}/day</span>
                        <span className={`font-mono font-semibold ${getValueColor(m.ltvPerSub != null && m.ltvPerSub > 0 ? "positive" : "neutral")}`}>
                          {m.ltvPerSub != null ? `${fmtC2(m.ltvPerSub)}/sub` : "—"}
                        </span>
                        <span className={`font-mono font-semibold ${getValueColor(m.profitPerSub != null ? (m.profitPerSub >= 0 ? "positive" : "negative") : "neutral")}`}>
                          {m.profitPerSub != null ? `${fmtC2(m.profitPerSub)}/sub` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {noSpendCount > 0 && (
              <div className="px-5 py-2 border-t border-border">
                <p className="text-[11px] text-muted-foreground">{noSpendCount} active campaigns have no spend set</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Campaign Detail Bottom Drawer */}
      <CampaignDetailDrawer
        campaign={selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
      />
    </>
  );
}

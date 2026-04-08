import { useState, useMemo } from "react";
import {
  ChevronDown, ChevronUp, TrendingUp, TrendingDown, Eye, XCircle,
  BarChart3, Users, Zap, Link2, AlertTriangle, DollarSign, Copy, ExternalLink,
  Pencil, Coins, Activity, Trash2, ArrowUpRight, Loader2,
} from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
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
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionSaving, setActionSaving] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Source tags for edit source panel
  const { data: sourceTags = [] } = useQuery({
    queryKey: ["distinct_source_tags"],
    queryFn: async () => {
      const { data } = await supabase.from("source_tag_rules").select("tag_name, color").order("tag_name");
      return data || [];
    },
  });

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

  // === SCALE NOW ===
  const scaleLinks = useMemo(() =>
    enriched
      .filter(l => l.hasPeriodSubs && l.ltvPerSub > 20 && (l.cost === 0 || l.roi > 150))
      .sort((a, b) => b.totalLtv - a.totalLtv)
      .slice(0, 8),
  [enriched]);

  // === WATCH ===
  const watchLinks = useMemo(() =>
    enriched
      .filter(l => l.hasPeriodSubs && ((l.ltvPerSub >= 5 && l.ltvPerSub <= 20) || (l.roi >= 50 && l.roi <= 150)))
      .filter(l => !scaleLinks.some(s => s.id === l.id))
      .sort((a, b) => b.totalLtv - a.totalLtv)
      .slice(0, 8),
  [enriched, scaleLinks]);

  // === STOP/FIX ===
  const stopLinks = useMemo(() =>
    enriched
      .filter(l => {
        if (l.cost <= 0) return false;
        const zeroSubs = !l.hasPeriodSubs;
        const negRoi = l.roi < 0;
        return zeroSubs || negRoi;
      })
      .filter(l => !scaleLinks.some(s => s.id === l.id) && !watchLinks.some(w => w.id === l.id))
      .sort((a, b) => a.roi - b.roi)
      .slice(0, 8),
  [enriched, scaleLinks, watchLinks]);

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
    for (const l of enriched) {
      if (l.totalLtv > 0 && (!best || l.totalLtv > best.totalLtv)) best = l;
    }
    return best;
  }, [enriched]);

  // === TOP 5 by LTV/Sub ===
  const topLtvPerSub = useMemo(() =>
    enriched
      .filter(l => l.newSubs > 0 && l.ltvPerSub > 0)
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

      return { ...acc, subsPerDay, spendTotal, ltvPerSub, profitPerSub };
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
            <p className="text-[9px] text-muted-foreground uppercase">LTV/Sub</p>
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

  // === Drawer ===
  const drawerCampaign = selectedCampaign;
  const drawerProfit = drawerCampaign ? (drawerCampaign.totalLtv + drawerCampaign.crossPoll - drawerCampaign.cost) : 0;
  const drawerProfitPerSub = drawerCampaign && drawerCampaign.newSubs > 0
    ? drawerProfit / drawerCampaign.newSubs : 0;
  const drawerCvr = drawerCampaign && Number(drawerCampaign.clicks || 0) > 0
    ? (Number(drawerCampaign.subscribers || 0) / Number(drawerCampaign.clicks || 0)) * 100 : 0;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

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
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Best LTV/Sub</span>
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
                  <TrendingUp className="h-3.5 w-3.5" /> Scale Now ({scaleLinks.length})
                </h4>
                {scaleLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No campaigns qualify</p>
                ) : (
                  <div className="space-y-2">
                    {scaleLinks.map(l => <CampaignCard key={l.id} l={l} accentClass="bg-primary/5 border border-primary/20" />)}
                  </div>
                )}
              </div>
              <div className="p-4 border-r border-border">
                <h4 className="text-xs font-bold text-[hsl(var(--warning))] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" /> Watch ({watchLinks.length})
                </h4>
                {watchLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No campaigns qualify</p>
                ) : (
                  <div className="space-y-2">
                    {watchLinks.map(l => <CampaignCard key={l.id} l={l} accentClass="bg-[hsl(var(--warning)/0.05)] border border-[hsl(var(--warning)/0.2)]" />)}
                  </div>
                )}
              </div>
              <div className="p-4">
                <h4 className="text-xs font-bold text-destructive uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" /> Stop / Fix ({stopLinks.length})
                </h4>
                {stopLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No campaigns qualify</p>
                ) : (
                  <div className="space-y-2">
                    {stopLinks.map(l => <CampaignCard key={l.id} l={l} accentClass="bg-destructive/5 border border-destructive/20" />)}
                  </div>
                )}
              </div>
            </div>

            {/* Top 5 by LTV/Sub */}
            <div className="p-4 border-b border-border">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-primary" /> Top 5 by LTV/Sub
              </h4>
              {topLtvPerSub.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data yet</p>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {topLtvPerSub.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setSelectedCampaign(l)}
                      className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-left hover:bg-secondary/80 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <ModelAvatar avatarUrl={l.avatarUrl} name={l.modelName} size={16} />
                        <p className="text-xs font-medium text-foreground truncate">{l.campaign_name}</p>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-primary">{fmtC2(l.ltvPerSub)}/sub</span>
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
                      <span>Spend</span>
                      <span>LTV/Sub</span>
                      <span>Profit/Sub</span>
                    </div>
                    {modelSnapshot.map((m: any) => (
                      <div key={m.id} className="grid grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <ModelAvatar avatarUrl={m.avatar_thumb_url} name={m.display_name} size={24} />
                          <span className="truncate font-medium text-foreground">{m.display_name}</span>
                        </div>
                        <span className="font-mono text-muted-foreground">{m.subsPerDay.toLocaleString()} subs/day</span>
                        <span className="font-mono text-muted-foreground">{fmtC(m.spendTotal)} spend</span>
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
      <Drawer open={!!selectedCampaign} onOpenChange={(v) => { if (!v) { setSelectedCampaign(null); setActiveAction(null); } }}>
        <DrawerContent className="h-[65vh] max-h-[65vh] p-0 overflow-hidden border-t border-border" style={{ background: "#161B22" }}>
          {drawerCampaign && <DrawerBody
            campaign={drawerCampaign}
            profit={drawerProfit}
            profitPerSub={drawerProfitPerSub}
            cvr={drawerCvr}
            fmtC={fmtC}
            fmtC2={fmtC2}
            fmtPct={fmtPct}
            handleCopy={handleCopy}
            activeAction={activeAction}
            setActiveAction={setActiveAction}
            actionSaving={actionSaving}
            setActionSaving={setActionSaving}
            sourceTags={sourceTags}
            queryClient={queryClient}
            navigate={navigate}
            setSelectedCampaign={setSelectedCampaign}
          />}
        </DrawerContent>
      </Drawer>
    </>
  );
}

/* ─── Data Row helper ─── */
function DataRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const colorClass = tone === "positive" ? "text-primary" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between h-9 px-3 border-b border-border">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-mono font-bold ${colorClass}`}>{value}</span>
    </div>
  );
}

/* ─── Drawer Body (extracted for hooks) ─── */
function DrawerBody({
  campaign: d, profit, profitPerSub, cvr,
  fmtC, fmtC2, fmtPct, handleCopy,
  activeAction, setActiveAction, actionSaving, setActionSaving,
  sourceTags, queryClient, navigate, setSelectedCampaign,
}: any) {
  const [sourceVal, setSourceVal] = useState(d.source_tag || "");
  const [costType, setCostType] = useState(d.cost_type || "CPL");
  const [costValue, setCostValue] = useState(String(d.cost_value || ""));

  const daysRunning = d.created_at
    ? Math.max(1, Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000))
    : null;
  const atSubs = Number(d.allTimeSubs || d.subscribers || 0);
  const atSpenders = Number(d.allTimeSpenders || d.spenders || 0);
  const spenderRate = Math.min(100, atSubs > 0 ? (atSpenders / atSubs) * 100 : 0);
  const existingFans = Math.max(0, atSubs - d.newSubs);
  const orgPct = Math.min(100, atSubs > 0 ? (d.newSubs / atSubs) * 100 : 0);
  const cpl = atSubs > 0 ? d.cost / atSubs : 0;

  const calcCostTotal = () => {
    const v = Number(costValue) || 0;
    if (costType === "CPC") return v * Number(d.clicks || 0);
    if (costType === "CPL") return v * Number(d.subscribers || 0);
    return v;
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["daily_snapshots"] });
  };

  const saveSource = async () => {
    setActionSaving(true);
    try {
      const { error } = await supabase.from("tracking_links").update({ source_tag: sourceVal, manually_tagged: true }).eq("id", d.id);
      if (error) throw error;
      toast.success("Source tag saved");
      refreshAll();
      setActiveAction(null);
    } catch { toast.error("Failed to save source tag"); }
    setActionSaving(false);
  };

  const saveSpend = async () => {
    setActionSaving(true);
    try {
      const total = calcCostTotal();
      const { error } = await supabase.from("tracking_links").update({
        cost_type: costType, cost_value: Number(costValue) || 0, cost_total: total,
      }).eq("id", d.id);
      if (error) throw error;
      toast.success("Spend saved");
      refreshAll();
      setActiveAction(null);
    } catch { toast.error("Failed to save spend"); }
    setActionSaving(false);
  };

  const saveStatus = async (status: string) => {
    setActionSaving(true);
    try {
      const { error } = await supabase.from("tracking_links").update({ status }).eq("id", d.id);
      if (error) throw error;
      toast.success(`Status set to ${status}`);
      refreshAll();
      setActiveAction(null);
    } catch { toast.error("Failed to save status"); }
    setActionSaving(false);
  };

  const confirmDelete = async () => {
    setActionSaving(true);
    try {
      const { error } = await supabase.from("tracking_links").update({ deleted_at: new Date().toISOString() }).eq("id", d.id);
      if (error) throw error;
      toast.success("Campaign deleted");
      refreshAll();
      setSelectedCampaign(null);
    } catch { toast.error("Failed to delete"); }
    setActionSaving(false);
  };

  const statuses = ["SCALE", "WATCH", "KILL", "HOLD", "TEST"];

  return (
    <div className="overflow-y-auto flex-1">
      {/* HEADER */}
      <div className="px-6 pt-3 pb-2 border-b border-border flex items-center gap-4">
        <ModelAvatar avatarUrl={d.avatarUrl} name={d.modelName} size={44} />
        <div className="flex-1 min-w-0">
          <DrawerHeader className="p-0">
            <DrawerTitle className="truncate text-lg font-bold leading-tight text-foreground">
              {d.campaign_name || "Unknown"}
            </DrawerTitle>
            <span className="text-[13px] font-medium text-primary">{d.modelName}</span>
          </DrawerHeader>
          <DrawerDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
              {d.created_at && <span>Created {new Date(d.created_at).toLocaleDateString()}</span>}
              {daysRunning && <><span>·</span><span className="font-semibold text-foreground">{daysRunning}d running</span></>}
              {d.status && <><span>·</span><span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-semibold text-primary text-[11px]">{d.status}</span></>}
              {d.traffic_category && <><span>·</span><span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px]">{d.traffic_category}</span></>}
            </div>
          </DrawerDescription>
        </div>
        {d.url && (
          <div className="flex items-center gap-1.5 shrink-0">
            <p className="truncate font-mono text-[11px] text-muted-foreground max-w-[200px]">{d.url}</p>
            <button onClick={() => handleCopy(d.url)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><Copy className="h-3.5 w-3.5" /></button>
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground p-1 transition-colors"><ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
        )}
        <button onClick={() => setSelectedCampaign(null)} className="text-muted-foreground hover:text-foreground p-1 transition-colors shrink-0">
          <XCircle className="h-5 w-5" />
        </button>
      </div>

      {/* ACTION BUTTONS */}
      <div className="px-6 py-2.5 border-b border-border">
        <div className="flex gap-1.5">
          {[
            { key: "source", icon: <Pencil className="h-3.5 w-3.5" />, label: "Source" },
            { key: "spend", icon: <Coins className="h-3.5 w-3.5" />, label: "Spend" },
            { key: "status", icon: <Activity className="h-3.5 w-3.5" />, label: "Status" },
            { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, label: "Delete" },
            { key: "details", icon: <ArrowUpRight className="h-3.5 w-3.5" />, label: "Details" },
          ].map(btn => (
            <Button
              key={btn.key}
              variant={activeAction === btn.key ? "default" : "outline"}
              size="sm"
              className="flex-1 h-9 text-[13px] gap-1.5"
              onClick={() => {
                if (btn.key === "details") {
                  navigate(`/campaigns?link=${d.id}`);
                  return;
                }
                setActiveAction(activeAction === btn.key ? null : btn.key);
              }}
            >
              {btn.icon}{btn.label}
            </Button>
          ))}
        </div>

        {/* ACTION PANELS */}
        {activeAction === "source" && (
          <div className="border-t border-border mt-2 pt-2 space-y-2">
            <select value={sourceVal} onChange={e => setSourceVal(e.target.value)} className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-sm text-foreground">
              <option value="">— None —</option>
              {sourceTags.map((t: any) => <option key={t.tag_name} value={t.tag_name}>{t.tag_name}</option>)}
            </select>
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-xs flex-1" onClick={saveSource} disabled={actionSaving}>
                {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setActiveAction(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {activeAction === "spend" && (
          <div className="border-t border-border mt-2 pt-2 space-y-2">
            <div className="flex gap-2">
              <select value={costType} onChange={e => setCostType(e.target.value)} className="h-9 rounded-md border border-border bg-secondary px-3 text-sm text-foreground w-28">
                <option value="CPL">CPL</option><option value="CPC">CPC</option><option value="FIXED">Fixed</option>
              </select>
              <Input type="number" value={costValue} onChange={e => setCostValue(e.target.value)} placeholder="Value" className="h-9 text-sm flex-1" />
            </div>
            <p className="text-xs text-muted-foreground">Total: <span className="font-mono font-semibold text-foreground">{fmtC2(calcCostTotal())}</span></p>
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-xs flex-1" onClick={saveSpend} disabled={actionSaving}>
                {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setActiveAction(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {activeAction === "status" && (
          <div className="border-t border-border mt-2 pt-2">
            <div className="flex gap-1.5">
              {statuses.map(s => (
                <Button key={s} size="sm" variant={d.status === s ? "default" : "outline"} className="flex-1 h-8 text-xs" disabled={actionSaving} onClick={() => saveStatus(s)}>
                  {actionSaving && d.status === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {activeAction === "delete" && (
          <div className="border-t border-destructive/20 mt-2 pt-2">
            <p className="text-sm text-destructive font-medium mb-2">Delete "{d.campaign_name}"? Cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setActiveAction(null)}>Cancel</Button>
              <Button size="sm" variant="destructive" className="h-8 text-xs flex-1" onClick={confirmDelete} disabled={actionSaving}>
                {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Delete"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* THREE COLUMN DATA GRID */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4">
        {/* COLUMN 1 — FINANCIALS */}
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(var(--destructive))" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">💰 Financials</h4>
          </div>
          <div className="p-0">
            <DataRow label="Total Spend" value={fmtC2(d.cost)} />
            <DataRow label="Cost Type" value={d.cost_type || "—"} />
            <DataRow label="Cost Per Lead" value={cpl > 0 ? fmtC2(cpl) : "—"} />
            <DataRow label="Profit" value={fmtC2(profit)} tone={profit >= 0 ? "positive" : "negative"} />
            <DataRow label="Profit/Sub" value={d.newSubs > 0 ? fmtC2(profitPerSub) : "—"} tone={d.newSubs > 0 ? (profitPerSub >= 0 ? "positive" : "negative") : "neutral"} />
            <DataRow label="ROI" value={d.cost > 0 ? fmtPct(d.roi) : "No spend"} tone={d.cost > 0 ? (d.roi >= 0 ? "positive" : "negative") : "neutral"} />
            <DataRow label="CVR %" value={cvr > 0 ? `${cvr.toFixed(2)}%` : "—"} tone={cvr > 0 ? "positive" : "neutral"} />
            <DataRow label="Total Clicks" value={Number(d.clicks || 0).toLocaleString()} />
            <DataRow label="Spenders" value={Number(d.spenders || 0).toLocaleString()} />
          </div>
        </div>

        {/* COLUMN 2 — PERFORMANCE */}
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(var(--primary))" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">📅 Performance</h4>
          </div>
          <div className="p-0">
            <DataRow label="Period Subs" value={d.periodSubs.toLocaleString()} />
            <DataRow label="Period Revenue" value={fmtC(d.periodRev)} tone={d.periodRev > 0 ? "positive" : "neutral"} />
            <DataRow label="Period Clicks" value={d.periodClicks.toLocaleString()} />
            <DataRow label="Avg Subs/Day" value={daysRunning ? (d.periodSubs / Math.max(1, daysRunning)).toFixed(1) : "—"} />
          </div>
        </div>

        {/* COLUMN 3 — ALL TIME */}
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(142 55% 49%)" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">⭐ All Time</h4>
          </div>
          <div className="p-0">
            <DataRow label="Campaign LTV" value={fmtC2(d.totalLtv)} tone={d.totalLtv > 0 ? "positive" : "neutral"} />
            <DataRow label="Cross-Poll LTV" value={fmtC2(d.crossPoll)} tone={d.crossPoll > 0 ? "positive" : "neutral"} />
            <DataRow label="New Fans" value={d.newSubs.toLocaleString()} />
            <DataRow label="Existing Fans" value={existingFans.toLocaleString()} />
            <DataRow label="LTV/Sub" value={fmtC2(d.ltvPerSub)} tone={d.ltvPerSub > 0 ? "positive" : "neutral"} />
            <DataRow label="Org %" value={`${orgPct.toFixed(1)}%`} />
            <DataRow label="Spender Rate" value={`${spenderRate.toFixed(1)}%`} tone={spenderRate > 0 ? "positive" : "neutral"} />
            <DataRow label="Total Subs" value={atSubs.toLocaleString()} />
          </div>
        </div>
      </div>

      {/* TRACKING LINK */}
      {d.url && (
        <div className="mx-6 mb-4 rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="truncate font-mono text-xs text-muted-foreground flex-1">{d.url}</p>
          <button onClick={() => handleCopy(d.url)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><Copy className="h-4 w-4" /></button>
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground p-1 transition-colors"><ExternalLink className="h-4 w-4" /></a>
        </div>
      )}
    </div>
  );
}

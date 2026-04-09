import { useState } from "react";
import {
  Copy, ExternalLink, XCircle, Coins, Activity, Trash2,
  ArrowUpRight, Loader2, DollarSign, Calculator,
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

const fmtC = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtC2 = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

interface CampaignDetailDrawerProps {
  campaign: any | null;
  onClose: () => void;
}

export function CampaignDetailDrawer({ campaign, onClose }: CampaignDetailDrawerProps) {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionSaving, setActionSaving] = useState(false);

  return (
    <Drawer open={!!campaign} onOpenChange={(v) => { if (!v) { onClose(); } }}>
      <DrawerContent className="h-[65vh] max-h-[65vh] p-0 overflow-hidden border-t border-border" style={{ background: "#161B22" }}>
        {campaign && (
          <DrawerBodyInner
            campaign={campaign}
            activeAction={activeAction}
            setActiveAction={setActiveAction}
            actionSaving={actionSaving}
            setActionSaving={setActionSaving}
            onClose={onClose}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerBodyInner({
  campaign: d, activeAction, setActiveAction, actionSaving, setActionSaving, onClose,
}: any) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: sourceTags = [] } = useQuery({
    queryKey: ["distinct_source_tags"],
    queryFn: async () => {
      const { data } = await supabase.from("source_tag_rules").select("tag_name, color").order("tag_name");
      return data || [];
    },
  });

  const [sourceVal, setSourceVal] = useState(d.source_tag || "");
  const [costType, setCostType] = useState(d.cost_type || "CPL");
  const [costValue, setCostValue] = useState(String(d.cost_value || ""));

  // ─── RAW SOURCE VALUES ───
  const cost = Number(d.cost_total ?? d.cost ?? 0);
  const costInputValue = Number(d.cost_value ?? 0);
  const totalClicks = Number(d.clicks ?? 0);
  const tlSubscribers = Number(d.subscribers ?? d.allTimeSubs ?? 0);
  const tlSpenders = Number(d.spenders ?? d.allTimeSpenders ?? 0);

  // From tracking_link_ltv table
  const rawLtv = d.totalLtv ?? d.ltvFromTable;
  const rawCrossPoll = d.crossPoll ?? d.crossPollRevenue;
  const rawNewSubs = d.newSubs ?? d.newSubsTotal;
  const hasLtvData = rawLtv != null && rawLtv !== 0 || rawCrossPoll != null && rawCrossPoll !== 0 || rawNewSubs != null && rawNewSubs !== 0;
  const totalLtv = Number(rawLtv ?? 0);
  const crossPoll = Number(rawCrossPoll ?? 0);
  const newSubs = Number(rawNewSubs ?? 0);

  // Period values
  const periodSubs = Number(d.periodSubs ?? 0);
  const periodRev = Number(d.periodRev ?? 0);
  const periodClicks = Number(d.periodClicks ?? 0);

  const daysRunning = d.created_at
    ? Math.max(1, Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000))
    : null;

  // ─── FINANCIALS ───
  const profit = totalLtv - cost;
  const profitPerSub = newSubs > 0 ? profit / newSubs : null;
  const roi = cost > 0 ? (profit / cost) * 100 : null;
  const cvr = totalClicks > 0 ? (tlSubscribers / totalClicks) * 100 : null;

  // ─── ALL TIME ───
  const existingFans = Math.max(0, tlSubscribers - newSubs);
  // LTV/Sub = revenue / subscribers (Layer 2)
  const campaignRevenue = Number(d.revenue ?? 0);
  const ltvPerSub = tlSubscribers > 0 ? campaignRevenue / tlSubscribers : null;
  const spenderRate = newSubs > 0 ? Math.min(100, (tlSpenders / newSubs) * 100) : null;

  // ─── CALCULATIONS ───
  const breakEvenLtv = newSubs > 0 && cost > 0 ? cost / newSubs : null;
  const avgExpenses = daysRunning && daysRunning > 0 && cost > 0 ? cost / daysRunning : null;
  const avgDailySubs = daysRunning && daysRunning > 0 && tlSubscribers > 0
    ? tlSubscribers / daysRunning : 0;
  const estDailySpend = costInputValue > 0 && avgDailySubs > 0
    ? costInputValue * avgDailySubs : null;

  const hasPeriodData = periodSubs > 0 || periodRev > 0 || periodClicks > 0;
  const periodDays = daysRunning || 1;
  const avgSubsDay = hasPeriodData && periodSubs > 0
    ? (periodSubs / Math.max(1, periodDays)).toFixed(1) : null;

  const calcCostTotal = () => {
    const v = Number(costValue) || 0;
    if (costType === "CPC") return v * totalClicks;
    if (costType === "CPL") return v * tlSubscribers;
    return v;
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    queryClient.invalidateQueries({ queryKey: ["daily_snapshots"] });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
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
      onClose();
    } catch { toast.error("Failed to delete"); }
    setActionSaving(false);
  };

  const statuses = ["SCALE", "WATCH", "KILL", "HOLD", "TEST"];

  const showCurrency = (v: number | null) => v != null ? fmtC2(v) : "—";
  const showPct = (v: number | null) => v != null ? `${v.toFixed(1)}%` : "—";
  const showRoi = (v: number | null) => v != null ? `${v.toFixed(0)}%` : "No spend";
  const profitTone = (v: number | null): "positive" | "negative" | "neutral" =>
    v == null ? "neutral" : v >= 0 ? "positive" : "negative";

  return (
    <div className="overflow-y-auto flex-1">
      {/* HEADER */}
      <div className="px-6 pt-3 pb-2 border-b border-border flex items-center gap-4">
        <ModelAvatar avatarUrl={d.avatarUrl || d.accounts?.avatar_thumb_url} name={d.modelName || d.accounts?.display_name || ""} size={80} />
        <div className="flex-1 min-w-0">
          <DrawerHeader className="p-0">
            <DrawerTitle className="truncate text-lg font-bold leading-tight text-foreground">
              {d.campaign_name || "Unknown"}
            </DrawerTitle>
            <span className="text-[13px] font-medium text-primary">{d.modelName || d.accounts?.display_name || ""}</span>
          </DrawerHeader>
          <DrawerDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
              {d.created_at && <span>Created {new Date(d.created_at).toLocaleDateString()}</span>}
              {daysRunning && <><span>·</span><span className="font-semibold text-foreground">{daysRunning}d running</span></>}
              {d.status && <><span>·</span><span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-semibold text-primary text-[11px]">{d.status}</span></>}
              {d.source_tag && <><span>·</span><span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px]">{d.source_tag}</span></>}
            </div>
          </DrawerDescription>
        </div>
        {d.url && (
          <div className="flex items-center gap-1.5 shrink-0">
            <p className="font-mono text-[13px] text-muted-foreground max-w-[340px] break-all">{d.url}</p>
            <button onClick={() => handleCopy(d.url)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><Copy className="h-3.5 w-3.5" /></button>
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground p-1 transition-colors"><ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
        )}
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 transition-colors shrink-0">
          <XCircle className="h-5 w-5" />
        </button>
      </div>

      {/* ACTION BUTTONS */}
      <div className="px-6 py-2.5 border-b border-border">
        <div className="flex gap-1.5">
          {[
            { key: "spend_source", icon: <Coins className="h-3.5 w-3.5" />, label: "Spend & Source" },
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

        {/* COMBINED SPEND + SOURCE PANEL */}
        {activeAction === "spend_source" && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ background: "#0D1117" }}>
            <div className="grid grid-cols-2 divide-x divide-border">
              {/* LEFT — SPEND */}
              <div className="p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Spend</span>
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  {cost > 0
                    ? <span className="text-[10px] font-semibold text-primary rounded-full bg-primary/10 border border-primary/30 px-1.5 py-0.5">{fmtC2(cost)}</span>
                    : <span className="flex items-center gap-1 text-[10px] text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Not set</span>
                  }
                </div>
                <div className="flex gap-1">
                  {(["CPL", "CPC", "FIXED"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setCostType(t)}
                      className={`flex-1 h-7 rounded-md text-[11px] font-bold transition-colors ${
                        costType === t
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  value={costValue}
                  onChange={e => setCostValue(e.target.value)}
                  placeholder="Cost value..."
                  className="h-8 text-sm font-mono bg-card border-border"
                />
                <p className="text-[11px] text-muted-foreground">Total: <span className="font-mono font-semibold text-foreground">{fmtC2(calcCostTotal())}</span></p>
                <div className="flex gap-1.5">
                  <Button size="sm" className="flex-1 h-8 text-xs" onClick={saveSpend} disabled={actionSaving}>
                    {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={async () => {
                    setActionSaving(true);
                    try {
                      await supabase.from("tracking_links").update({ cost_type: null, cost_value: 0, cost_total: 0 }).eq("id", d.id);
                      toast.success("Spend cleared");
                      refreshAll();
                    } catch { toast.error("Failed to clear"); }
                    setActionSaving(false);
                  }} disabled={actionSaving}>Clear</Button>
                </div>
              </div>

              {/* RIGHT — SOURCE */}
              <div className="p-3 space-y-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Source</span>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">{d.source_tag || "Untagged"}</span>
                </div>
                <select
                  value={sourceVal}
                  onChange={e => setSourceVal(e.target.value)}
                  className="w-full h-8 rounded-md border border-border bg-card px-2.5 text-sm text-foreground"
                >
                  <option value="">— Untagged —</option>
                  {sourceTags.map((t: any) => <option key={t.tag_name} value={t.tag_name}>{t.tag_name}</option>)}
                </select>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSourceVal("")}>
                    — Edit
                  </Button>
                  <Button size="sm" className="flex-1 h-8 text-xs" onClick={saveSource} disabled={actionSaving}>
                    {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>
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

      {/* FOUR COLUMN DATA GRID */}
      <div className="px-6 py-4 overflow-x-auto">
        <div className="flex min-w-[960px]" style={{ gap: 0 }}>
          {/* COLUMN 1 — FINANCIALS */}
          <div className="flex-1 min-w-[240px] overflow-y-auto" style={{ borderTop: "3px solid hsl(var(--destructive))" }}>
            <div className="px-4 py-2 border-b border-border sticky top-0 z-10 bg-[#161B22]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">🔥 Financials</h4>
            </div>
            <div className="p-0">
              <DataRow label="Total Spend" value={cost > 0 ? fmtC2(cost) : "—"} />
              <DataRow label="Cost Type" value={d.cost_type || "—"} />
              <DataRow label="Cost Per Lead" value={costInputValue > 0 ? fmtC2(costInputValue) : "—"} />
              <DataRow label="Profit" value={cost > 0 ? fmtC2(profit) : "—"} tone={cost > 0 ? profitTone(profit) : "neutral"} />
              <DataRow label="Profit/Sub" value={profitPerSub != null && cost > 0 ? fmtC2(profitPerSub) : "—"} tone={profitPerSub != null && cost > 0 ? profitTone(profitPerSub) : "neutral"} />
              <DataRow label="ROI" value={showRoi(roi)} tone={roi != null ? profitTone(roi) : "neutral"} />
              <DataRow label="CVR %" value={totalClicks > 0 && cvr != null ? `${cvr.toFixed(2)}%` : "—"} tone={cvr != null && cvr > 0 ? "positive" : "neutral"} />
              <DataRow label="Total Clicks" value={totalClicks.toLocaleString()} />
              <DataRow label="Spenders" value={tlSpenders > 0 ? tlSpenders.toLocaleString() : "—"} />
            </div>
          </div>

          <div className="w-px shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />

          {/* COLUMN 2 — PERFORMANCE */}
          <div className="flex-1 min-w-[240px] overflow-y-auto" style={{ borderTop: "3px solid hsl(var(--primary))" }}>
            <div className="px-4 py-2 border-b border-border sticky top-0 z-10 bg-[#161B22]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">📊 Performance</h4>
            </div>
            <div className="p-0">
              <DataRow label="Period Subs" value={hasPeriodData ? periodSubs.toLocaleString() : "—"} />
              <DataRow label="Period Revenue" value={hasPeriodData && periodRev > 0 ? fmtC2(periodRev) : "—"} tone={hasPeriodData && periodRev > 0 ? "positive" : "neutral"} />
              <DataRow label="Period Clicks" value={periodClicks.toLocaleString()} />
              <DataRow label="Avg Subs/Day" value={avgSubsDay ?? "—"} />
            </div>
          </div>

          <div className="w-px shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />

          {/* COLUMN 3 — ALL TIME */}
          <div className="flex-1 min-w-[240px] overflow-y-auto" style={{ borderTop: "3px solid hsl(45 93% 47%)" }}>
            <div className="px-4 py-2 border-b border-border sticky top-0 z-10 bg-[#161B22]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">⭐ All Time</h4>
            </div>
            <div className="p-0">
              <DataRow label="Campaign Revenue" value={campaignRevenue > 0 ? fmtC2(campaignRevenue) : "—"} tone={campaignRevenue > 0 ? "positive" : "neutral"} />
              <DataRow label="Campaign LTV" value={hasLtvData ? fmtC2(totalLtv) : "—"} tone={totalLtv > 0 ? "positive" : "neutral"} />
              <DataRow label="Cross-Poll Revenue" value={hasLtvData ? fmtC2(crossPoll) : "—"} tone={crossPoll > 0 ? "positive" : "neutral"} />
              <DataRow label="Total Revenue incl. Cross-Poll" value={hasLtvData ? fmtC2(totalLtv + crossPoll) : "—"} tone="positive" />
              <DataRow label="LTV/Sub" value={ltvPerSub != null ? fmtC2(ltvPerSub) : "—"} tone={ltvPerSub != null && ltvPerSub > 0 ? "positive" : "neutral"} />
              <DataRow label="New Fans" value={hasLtvData ? newSubs.toLocaleString() : "—"} />
              <DataRow label="Existing Fans" value={hasLtvData ? (existingFans > 0 ? existingFans.toLocaleString() : "0") : "—"} />
              <DataRow label="Spender Rate" value={showPct(spenderRate)} tone={spenderRate != null && spenderRate > 0 ? "positive" : "neutral"} />
              <DataRow label="Total Subs" value={tlSubscribers > 0 ? tlSubscribers.toLocaleString() : "—"} />
            </div>
          </div>

          <div className="w-px shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />

          {/* COLUMN 4 — BREAKDOWN */}
          <div className="flex-1 min-w-[240px] overflow-y-auto" style={{ borderTop: "3px solid hsl(142 55% 49%)" }}>
            <div className="px-4 py-2 border-b border-border sticky top-0 z-10 bg-[#161B22]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">📋 Breakdown</h4>
            </div>
            <div className="px-4 py-3 space-y-0">
              {/* PART 1 — Campaign Summary */}
              <div className="space-y-1 pb-3">
                {!hasLtvData ? (
                  <p className="text-xs italic text-muted-foreground leading-relaxed">
                    This campaign was created {daysRunning ?? "?"} days ago. LTV data not available yet — needs at least one sync cycle to calculate.
                  </p>
                ) : (() => {
                  const realCpl = newSubs > 0 && cost > 0 ? cost / newSubs : null;
                  const cType = d.cost_type || "";
                  let line1: React.ReactNode;
                  if (cost <= 0) {
                    line1 = <span>This campaign has no spend set yet.</span>;
                  } else if (cType === "CPC") {
                    line1 = <>This campaign brought in <span className="text-primary font-semibold not-italic">{newSubs.toLocaleString()}</span> subscribers at <span className="text-primary font-semibold not-italic">{fmtC2(costInputValue)}</span>/click{realCpl != null && <> (<span className="text-primary font-semibold not-italic">{fmtC2(realCpl)}</span>/sub effective cost)</>}.</>;
                  } else if (cType === "FIXED") {
                    line1 = <>This campaign brought in <span className="text-primary font-semibold not-italic">{newSubs.toLocaleString()}</span> subscribers for a flat <span className="text-primary font-semibold not-italic">{fmtC2(cost)}</span> fee{realCpl != null && <> (<span className="text-primary font-semibold not-italic">{fmtC2(realCpl)}</span>/sub)</>}.</>;
                  } else {
                    line1 = <>This campaign brought in <span className="text-primary font-semibold not-italic">{newSubs.toLocaleString()}</span> subscribers at <span className="text-primary font-semibold not-italic">{fmtC2(costInputValue)}</span>/sub.</>;
                  }
                  let line2: React.ReactNode;
                  if (cost <= 0) {
                    line2 = totalLtv > 0
                      ? <>Total LTV earned is <span className="text-primary font-semibold not-italic">{fmtC2(totalLtv)}</span>.</>
                      : <>No LTV data yet.</>;
                  } else {
                    line2 = <>Each subscriber generated <span className="text-primary font-semibold not-italic">{ltvPerSub != null ? fmtC2(ltvPerSub) : "—"}</span> in revenue — a <span className={`font-semibold not-italic ${roi != null && roi >= 0 ? "text-primary" : "text-destructive"}`}>{roi != null ? `${roi.toFixed(0)}%` : "—"}</span> ROI.</>;
                  }
                  let line3: React.ReactNode = null;
                  if (cost > 0) {
                    const noRecentClicks = totalClicks === 0;
                    if (noRecentClicks) {
                      line3 = <span className="text-destructive not-italic">No recent clicks detected. Consider pausing spend.</span>;
                    } else if (profit >= 0) {
                      line3 = <span className="text-primary not-italic">This campaign is profitable. Scale if traffic is available.</span>;
                    } else if (breakEvenLtv != null) {
                      line3 = <>Break-even requires <span className="text-primary font-semibold not-italic">{fmtC2(breakEvenLtv)}</span>/sub LTV.</>;
                    }
                  }
                  return (
                    <p className="text-xs italic text-muted-foreground leading-relaxed">
                      {line1}<br />{line2}{line3 && <><br />{line3}</>}
                    </p>
                  );
                })()}
              </div>

              <div className="border-t border-border" />

              {/* PART 2 — Revenue Reconciliation */}
              {hasLtvData && (
              <div className="py-3 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Where does the money come from?</p>
                {[
                  { label: "Campaign Revenue", value: campaignRevenue, tone: "neutral" as const },
                  { label: "Campaign LTV", value: totalLtv, tone: "neutral" as const },
                  { label: "Cross-Poll Revenue", value: crossPoll, tone: "neutral" as const },
                  { label: "Total Revenue incl. Cross-Poll", value: totalLtv + crossPoll, tone: "positive" as const },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between h-7">
                    <span className="text-[11px] text-muted-foreground">{r.label}</span>
                    <span className={`text-xs font-mono font-bold ${
                      r.label === "Total Revenue incl. Cross-Poll" ? "text-primary" :
                      r.tone === "positive" ? "text-primary" : "text-foreground"
                    }`}>
                      {r.value !== 0 ? fmtC2(r.value) : "—"}
                    </span>
                  </div>
                ))}
                <p className="text-[11px] font-mono text-muted-foreground pt-1">
                  Total = <span className="text-primary">{fmtC2(totalLtv)}</span> LTV + <span className="text-primary">{fmtC2(crossPoll)}</span> cross-poll
                </p>
              </div>
              )}

              {/* PART 3 — Cost Breakdown */}
              {cost > 0 && (
                <>
                  <div className="border-t border-border" />
                  <div className="py-3 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Cost breakdown</p>
                    {(() => {
                      const cType = d.cost_type || "CPL";
                      const realCpl = newSubs > 0 ? cost / newSubs : null;
                      if (cType === "CPL") {
                        return (
                          <p className="text-xs font-mono text-muted-foreground">
                            <span className="text-primary">{tlSubscribers.toLocaleString()}</span> subs × <span className="text-primary">{fmtC2(costInputValue)}</span>/sub = <span className="text-primary">{fmtC2(cost)}</span> total spend
                          </p>
                        );
                      }
                      if (cType === "CPC") {
                        return (
                          <div className="space-y-1">
                            <p className="text-xs font-mono text-muted-foreground">
                              <span className="text-primary">{totalClicks.toLocaleString()}</span> clicks × <span className="text-primary">{fmtC2(costInputValue)}</span>/click = <span className="text-primary">{fmtC2(cost)}</span> total spend
                            </p>
                            {realCpl != null && (
                              <p className="text-xs font-mono text-muted-foreground">
                                Effective CPL: <span className="text-primary">{fmtC2(cost)}</span> / <span className="text-primary">{newSubs.toLocaleString()}</span> = <span className="text-primary">{fmtC2(realCpl)}</span>/sub
                              </p>
                            )}
                          </div>
                        );
                      }
                      // FIXED
                      return (
                        <div className="space-y-1">
                          <p className="text-xs font-mono text-muted-foreground">
                            Flat fee: <span className="text-primary">{fmtC2(cost)}</span>
                          </p>
                          {realCpl != null && (
                            <p className="text-xs font-mono text-muted-foreground">
                              Effective CPL: <span className="text-primary">{fmtC2(cost)}</span> / <span className="text-primary">{newSubs.toLocaleString()}</span> = <span className="text-primary">{fmtC2(realCpl)}</span>/sub
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

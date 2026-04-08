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
const fmtPct = (v: number) => `${v.toFixed(0)}%`;

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

  const daysRunning = d.created_at
    ? Math.max(1, Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000))
    : null;

  const cost = Number(d.cost_total || d.cost || 0);
  const totalLtv = Number(d.totalLtv || d.ltvFromTable || 0);
  const crossPoll = Number(d.crossPoll || d.crossPollRevenue || 0);
  const newSubs = Number(d.newSubs || d.newSubsTotal || 0);

  // FIX: Total Subs = tracking_links.subscribers (all time cumulative)
  const atSubs = Number(d.allTimeSubs || d.subscribers || 0);
  const atSpenders = Number(d.allTimeSpenders || d.spenders || 0);
  const totalClicks = Number(d.clicks || 0);

  // FIX: Existing Fans = tracking_links.subscribers - new_subs_total, floor at 0
  const existingFans = Math.max(0, atSubs - newSubs);

  // FIX: Org % = new_subs_total / tracking_links.subscribers * 100, cap 100
  const orgPct = Math.min(100, atSubs > 0 ? (newSubs / atSubs) * 100 : 0);

  // FIX: Spender Rate = tracking_links.spenders / tracking_links.subscribers * 100, cap 100
  const spenderRate = Math.min(100, atSubs > 0 ? (atSpenders / atSubs) * 100 : 0);

  // Calculations
  const ltvPerSub = newSubs > 0 ? totalLtv / newSubs : 0;
  const profit = totalLtv + crossPoll - cost;
  const profitPerSub = newSubs > 0 ? profit / newSubs : 0;
  const roi = cost > 0 ? ((totalLtv + crossPoll - cost) / cost) * 100 : 0;
  const cvr = totalClicks > 0 ? (atSubs / totalClicks) * 100 : 0;
  const cpl = atSubs > 0 ? cost / atSubs : 0;
  const estDailySpend = daysRunning && daysRunning > 0 ? cost / daysRunning : 0;
  const breakEvenLtv = newSubs > 0 ? cost / newSubs : 0;

  const periodSubs = Number(d.periodSubs || 0);
  const periodRev = Number(d.periodRev || 0);
  const periodClicks = Number(d.periodClicks || 0);

  const calcCostTotal = () => {
    const v = Number(costValue) || 0;
    if (costType === "CPC") return v * totalClicks;
    if (costType === "CPL") return v * atSubs;
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
              {d.traffic_category && <><span>·</span><span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px]">{d.traffic_category}</span></>}
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

      {/* THREE COLUMN DATA GRID */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4">
        {/* COLUMN 1 — FINANCIALS */}
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(var(--destructive))" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">💰 Financials</h4>
          </div>
          <div className="p-0">
            <DataRow label="Total Spend" value={fmtC2(cost)} />
            <DataRow label="Cost Type" value={d.cost_type || "—"} />
            <DataRow label="Cost Per Lead" value={cpl > 0 ? fmtC2(cpl) : "—"} />
            <DataRow label="Profit" value={fmtC2(profit)} tone={profit >= 0 ? "positive" : "negative"} />
            <DataRow label="Profit/Sub" value={newSubs > 0 ? fmtC2(profitPerSub) : "—"} tone={newSubs > 0 ? (profitPerSub >= 0 ? "positive" : "negative") : "neutral"} />
            <DataRow label="ROI" value={cost > 0 ? fmtPct(roi) : "No spend"} tone={cost > 0 ? (roi >= 0 ? "positive" : "negative") : "neutral"} />
            <DataRow label="CVR %" value={cvr > 0 ? `${cvr.toFixed(2)}%` : "—"} tone={cvr > 0 ? "positive" : "neutral"} />
            <DataRow label="Total Clicks" value={totalClicks.toLocaleString()} />
            <DataRow label="Spenders" value={atSpenders.toLocaleString()} />
          </div>
        </div>

        {/* COLUMN 2 — PERFORMANCE */}
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(var(--primary))" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">📅 Performance</h4>
          </div>
          <div className="p-0">
            <DataRow label="Period Subs" value={periodSubs.toLocaleString()} />
            <DataRow label="Period Revenue" value={fmtC(periodRev)} tone={periodRev > 0 ? "positive" : "neutral"} />
            <DataRow label="Period Clicks" value={periodClicks.toLocaleString()} />
            <DataRow label="Avg Subs/Day" value={daysRunning ? (periodSubs / Math.max(1, daysRunning)).toFixed(1) : "—"} />
          </div>
        </div>

        {/* COLUMN 3 — ALL TIME */}
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(142 55% 49%)" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">⭐ All Time</h4>
          </div>
          <div className="p-0">
            <DataRow label="Campaign LTV" value={fmtC2(totalLtv)} tone={totalLtv > 0 ? "positive" : "neutral"} />
            <DataRow label="Cross-Poll LTV" value={fmtC2(crossPoll)} tone={crossPoll > 0 ? "positive" : "neutral"} />
            <DataRow label="New Fans" value={newSubs.toLocaleString()} />
            <DataRow label="Existing Fans" value={existingFans.toLocaleString()} />
            <DataRow label="LTV/Sub" value={fmtC2(ltvPerSub)} tone={ltvPerSub > 0 ? "positive" : "neutral"} />
            <DataRow label="Org %" value={`${orgPct.toFixed(1)}%`} />
            <DataRow label="Spender Rate" value={`${spenderRate.toFixed(1)}%`} tone={spenderRate > 0 ? "positive" : "neutral"} />
            <DataRow label="Total Subs" value={atSubs.toLocaleString()} />
          </div>
        </div>
      </div>

      {/* CALCULATIONS SECTION */}
      <div className="px-6 pb-4">
        <div className="rounded-lg border border-border overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: "hsl(45 93% 47%)" }}>
          <div className="px-4 py-2 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">🧮 Calculations</h4>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="p-0">
              <DataRow label="LTV/Sub" value={newSubs > 0 ? fmtC2(totalLtv / newSubs) : "—"} tone={newSubs > 0 && totalLtv / newSubs > 0 ? "positive" : "neutral"} />
              <DataRow label="Profit/Sub" value={newSubs > 0 ? fmtC2((totalLtv - cost) / newSubs) : "—"} tone={newSubs > 0 ? ((totalLtv - cost) / newSubs >= 0 ? "positive" : "negative") : "neutral"} />
              <DataRow label="ROI" value={cost > 0 ? `${(((totalLtv - cost) / cost) * 100).toFixed(0)}%` : "No spend"} tone={cost > 0 ? ((totalLtv - cost) / cost >= 0 ? "positive" : "negative") : "neutral"} />
              <DataRow label="CVR %" value={totalClicks > 0 ? `${((atSubs / totalClicks) * 100).toFixed(2)}%` : "—"} tone={totalClicks > 0 ? "positive" : "neutral"} />
              <DataRow label="Break Even LTV" value={newSubs > 0 && cost > 0 ? `Need ${fmtC2(breakEvenLtv)}/sub` : "—"} tone="neutral" />
            </div>
            <div className="p-0">
              <DataRow label="Spender %" value={`${spenderRate.toFixed(1)}%`} tone={spenderRate > 0 ? "positive" : "neutral"} />
              <DataRow label="Org %" value={`${orgPct.toFixed(1)}%`} tone={orgPct > 0 ? "positive" : "neutral"} />
              <DataRow label="Avg Expenses" value={atSubs > 0 ? fmtC2(cost / atSubs) : "—"} tone="neutral" />
              <DataRow label="Est Daily Spend" value={estDailySpend > 0 ? fmtC2(estDailySpend) : "—"} tone="neutral" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

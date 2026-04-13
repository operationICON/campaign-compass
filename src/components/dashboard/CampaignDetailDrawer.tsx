import { useState } from "react";
import {
  Copy, ExternalLink, XCircle, Coins, Trash2,
  ArrowUpRight, Loader2, DollarSign, Calculator, User, CheckCircle,
} from "lucide-react";
import { format } from "date-fns";
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

  // ─── FIX 1: FINANCIALS — always from tracking_links ───
  const cost = Number(d.cost_total ?? 0);
  const costInputValue = Number(d.cost_value ?? 0);
  const totalClicks = Number(d.clicks ?? 0);
  const tlSubscribers = Number(d.subscribers ?? 0);
  const tlSpenders = Number(d.spenders_count ?? d.spenders ?? 0);
  const campaignRevenue = Number(d.revenue ?? 0);

  const profit = campaignRevenue - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : null;
  const ltvPerSub = tlSubscribers > 0 ? campaignRevenue / tlSubscribers : null;
  const profitPerSub = cost > 0 && tlSubscribers > 0 ? profit / tlSubscribers : null;
  const cvr = totalClicks > 0 ? (tlSubscribers / totalClicks) * 100 : null;
  const costPerLead = Number(d.cost_per_lead ?? 0);
  const costPerClick = Number(d.cost_per_click ?? d.cpc_real ?? 0);
  const paymentType = d.payment_type || d.cost_type || null;

  const daysRunning = d.created_at
    ? Math.max(1, Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000))
    : null;
  const subsPerDay = daysRunning && daysRunning > 0 && tlSubscribers > 0
    ? (tlSubscribers / daysRunning).toFixed(1) : "0";

  // ─── FIX 3: ALL TIME — from tracking_links only ───
  const spenderRate = tlSubscribers > 0 ? Math.min(100, (tlSpenders / tlSubscribers) * 100) : null;

  // From tracking_link_ltv table (for breakdown section only)
  const rawLtv = d.totalLtv ?? d.ltvFromTable;
  const rawCrossPoll = d.crossPoll ?? d.crossPollRevenue;
  const rawNewSubs = d.newSubs ?? d.newSubsTotal;
  const hasLtvData = rawLtv != null && rawLtv !== 0 || rawCrossPoll != null && rawCrossPoll !== 0 || rawNewSubs != null && rawNewSubs !== 0;
  const totalLtv = Number(rawLtv ?? 0);
  const crossPoll = Number(rawCrossPoll ?? 0);
  const newSubs = Number(rawNewSubs ?? 0);

  // ─── FIX 2: PERFORMANCE — from daily_snapshots via passed props ───
  const periodSubs = Number(d.periodSubs ?? 0);
  const periodRev = Number(d.periodRev ?? 0);
  const periodClicks = Number(d.periodClicks ?? 0);
  const snapshotDays = Number(d.snapshotDays ?? 0);
  // hasSnapshots: true if the campaign has any snapshot data at all
  const hasSnapshots = snapshotDays > 0 || periodSubs > 0 || periodRev > 0 || periodClicks > 0;
  const avgSubsDay = hasSnapshots && snapshotDays > 0 ? (periodSubs / snapshotDays).toFixed(1) : null;

  const profitTone = (v: number | null): "positive" | "negative" | "neutral" =>
    v == null ? "neutral" : v >= 0 ? "positive" : "negative";

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

      {/* TWO COLUMN DATA GRID */}
      <div className="px-6 py-4 overflow-x-auto">
        <div className="flex min-w-[520px]" style={{ gap: 0 }}>
          {/* COLUMN 1 — FINANCIALS */}
          <div className="flex-1 min-w-[260px] overflow-y-auto" style={{ borderTop: "3px solid hsl(var(--destructive))" }}>
            <div className="px-4 py-2 border-b border-border sticky top-0 z-10 bg-[#161B22]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">🔥 Financials</h4>
            </div>
            <div className="p-0">
              <DataRow label="Total Spend" value={cost > 0 ? fmtC2(cost) : "—"} />
              <DataRow label="Revenue" value={campaignRevenue > 0 ? fmtC2(campaignRevenue) : "$0.00"} tone={campaignRevenue > 0 ? "positive" : "neutral"} />
              <DataRow label="Profit" value={cost > 0 ? fmtC2(profit) : "—"} tone={cost > 0 ? profitTone(profit) : "neutral"} />
              <DataRow label="ROI" value={roi != null ? `${roi.toFixed(0)}%` : "—"} tone={roi != null ? profitTone(roi) : "neutral"} />
              <DataRow label="LTV/Sub" value={ltvPerSub != null ? fmtC2(ltvPerSub) : "—"} tone={ltvPerSub != null && ltvPerSub > 0 ? "positive" : "neutral"} />
              <DataRow label="Profit/Sub" value={cost > 0 && profitPerSub != null ? fmtC2(profitPerSub) : "—"} tone={profitPerSub != null ? profitTone(profitPerSub) : "neutral"} />
              <DataRow label="Subs/Day" value={subsPerDay} />
              <DataRow label="CPL" value={costPerLead > 0 ? fmtC2(costPerLead) : "—"} />
              <DataRow label="CVR" value={cvr != null ? fmtPct(cvr) : "—"} />
              <DataRow label="Clicks" value={totalClicks.toLocaleString()} />
              <DataRow label="Subscribers" value={tlSubscribers.toLocaleString()} />
              <DataRow label="Spenders" value={tlSpenders.toLocaleString()} />
              <DataRow label="Spender Rate" value={spenderRate != null ? fmtPct(spenderRate) : "—"} tone={spenderRate != null && spenderRate > 0 ? "positive" : "neutral"} />
            </div>
          </div>

          <div className="w-px shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />

          {/* COLUMN 2 — ALL TIME */}
          <div className="flex-1 min-w-[260px] overflow-y-auto" style={{ borderTop: "3px solid hsl(45 93% 47%)" }}>
            <div className="px-4 py-2 border-b border-border sticky top-0 z-10 bg-[#161B22]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">⭐ All Time</h4>
            </div>
            <div className="p-0">
              <DataRow label="Campaign Revenue" value={fmtC2(campaignRevenue)} tone={campaignRevenue > 0 ? "positive" : "neutral"} />
              <DataRow label="Total Subs" value={tlSubscribers.toLocaleString()} />
              <DataRow label="Total Clicks" value={totalClicks.toLocaleString()} />
              <DataRow label="LTV/Sub" value={ltvPerSub != null ? fmtC2(ltvPerSub) : "—"} tone={ltvPerSub != null && ltvPerSub > 0 ? "positive" : "neutral"} />
              <DataRow label="Spender Rate" value={spenderRate != null ? fmtPct(spenderRate) : "—"} tone={spenderRate != null && spenderRate > 0 ? "positive" : "neutral"} />
              <DataRow label="Source" value={d.source_tag || "—"} />
              <DataRow label="Marketer" value={d.onlytraffic_marketer || "—"} />
              <DataRow label="Traffic Category" value={d.traffic_category || "—"} />
              <DataRow label="Created" value={d.created_at ? format(new Date(d.created_at), "MMM d, yyyy") : "—"} />
              <DataRow label="Days Running" value={daysRunning != null ? String(daysRunning) : "—"} />
            </div>
          </div>
        </div>
      </div>

      {/* ORDER HISTORY — OnlyTraffic only (FIX 4) */}
      {d.traffic_category === "OnlyTraffic" && <OrderHistorySection campaignId={d.id} cappedSpend={cost} />}
    </div>
  );
}

/* ─── Order History Section (FIX 4) ─── */
function OrderHistorySection({ campaignId, cappedSpend }: { campaignId: string; cappedSpend: number }) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["onlytraffic_orders", campaignId],
    queryFn: async () => {
      const { data } = await supabase
        .from("onlytraffic_orders")
        .select("*")
        .eq("tracking_link_id", campaignId)
        .order("order_created_at", { ascending: false });
      return data || [];
    },
  });

  // Build a set of marketers that have >1 unique offer_id
  const marketerMultiOffer = new Set<string>();
  const marketerOffers: Record<string, Set<number>> = {};
  orders.forEach(o => {
    const m = o.marketer;
    if (!m) return;
    if (!marketerOffers[m]) marketerOffers[m] = new Set();
    if (o.offer_id != null) marketerOffers[m].add(o.offer_id);
  });
  Object.entries(marketerOffers).forEach(([m, offers]) => {
    if (offers.size > 1) marketerMultiOffer.add(m);
  });

  // Sort: active/waiting first, then by date desc
  const sorted = [...orders].sort((a, b) => {
    const activeStatuses = ["accepted", "waiting"];
    const aActive = activeStatuses.includes((a.status || "").toLowerCase()) ? 0 : 1;
    const bActive = activeStatuses.includes((b.status || "").toLowerCase()) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.order_created_at || 0).getTime() - new Date(a.order_created_at || 0).getTime();
  });

  const rawSpend = orders.reduce((s, o) => s + Number(o.total_spent || 0), 0);
  const totalOrdered = orders.reduce((s, o) => s + Number(o.quantity_ordered || 0), 0);
  const totalDelivered = orders.reduce((s, o) => s + Number(o.quantity_delivered || 0), 0);

  const statusPill = (status: string | null) => {
    const s = (status || "").toLowerCase();
    const map: Record<string, { label: string; cls: string }> = {
      accepted: { label: "Active", cls: "bg-green-500/15 text-green-400 border-green-500/30" },
      waiting: { label: "Waiting", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
      completed: { label: "Completed", cls: "bg-muted text-muted-foreground border-border" },
      cancelled: { label: "Cancelled", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    };
    const found = map[s];
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${found ? found.cls : "bg-muted text-muted-foreground border-border"}`}>
        {found ? found.label : status || "—"}
      </span>
    );
  };

  const formatMarketer = (o: any) => {
    const m = o.marketer;
    if (!m) return "—";
    // Show offer_id only if this marketer has >1 unique offer_id
    if (marketerMultiOffer.has(m) && o.offer_id != null) {
      return (
        <span>
          {m} <span className="text-muted-foreground text-[10px]">#{o.offer_id}</span>
        </span>
      );
    }
    return m;
  };

  return (
    <div className="px-6 pb-4">
      <div className="border-t border-border pt-4">
        <div className="mb-3">
          <h4 className="text-sm font-bold text-foreground">Order History</h4>
          {!isLoading && orders.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {orders.length} order{orders.length !== 1 ? "s" : ""} · {fmtC2(rawSpend)} total raw spend · {fmtC2(cappedSpend)} capped spend
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading orders…</div>
        ) : orders.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">No order history available</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border" style={{ background: "#0D1117" }}>
                  {["Order ID", "Date", "Marketer", "Source", "Ordered", "Delivered", "Price/Unit", "Amount", "Status"].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(o => (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-mono text-[11px] text-foreground whitespace-nowrap">{o.order_id || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {o.order_created_at ? format(new Date(o.order_created_at), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2 text-foreground">{formatMarketer(o)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{o.source || "—"}</td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-muted-foreground" />{o.quantity_ordered ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      <span className="inline-flex items-center gap-1"><CheckCircle className="h-3 w-3 text-muted-foreground" />{o.quantity_delivered ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">
                      {o.price_per_unit != null
                        ? `$${Number(o.price_per_unit).toFixed(2)}/${(o.order_type || "").toLowerCase().includes("click") ? "click" : "sub"}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold text-foreground whitespace-nowrap">
                      {o.total_spent != null ? fmtC2(Number(o.total_spent)) : "—"}
                    </td>
                    <td className="px-3 py-2">{statusPill(o.status)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border" style={{ background: "#0D1117" }}>
                  <td colSpan={9} className="px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                    Total: {orders.length} orders · {totalOrdered.toLocaleString()} ordered · {totalDelivered.toLocaleString()} delivered · {fmtC2(rawSpend)} raw spend · {fmtC2(cappedSpend)} capped (cost_total)
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

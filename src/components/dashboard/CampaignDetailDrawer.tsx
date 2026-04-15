import { useState } from "react";

import {
  Copy, ExternalLink, XCircle, Coins, Trash2,
  ArrowUpRight, Loader2, DollarSign, Calculator, User, CheckCircle,
  Pencil,
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
function DataRow({ label, value, tone = "neutral" }: { label: string; value: string | React.ReactNode; tone?: "positive" | "negative" | "neutral" }) {
  const colorClass = tone === "positive" ? "text-primary" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between py-[4px] px-3 border-b border-border">
      <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
      <span className={`text-[13px] font-mono font-bold ${colorClass} leading-tight`}>{value}</span>
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
  campaign: initialCampaign, activeAction, setActiveAction, actionSaving, setActionSaving, onClose,
}: any) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [d, setD] = useState(initialCampaign);
  const [costType, setCostType] = useState(d.cost_type || "CPL");
  const [costValue, setCostValue] = useState(String(d.cost_value || ""));
  const [sourceVal, setSourceVal] = useState(d.source_tag || "");

  // Edit panel state
  const [editCampaignName, setEditCampaignName] = useState(d.campaign_name || "");
  const [editUrl, setEditUrl] = useState(d.url || "");
  const [editAccountId, setEditAccountId] = useState(d.account_id || "");

  const { data: allAccounts = [] } = useQuery({
    queryKey: ["accounts_list"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, display_name, avatar_thumb_url, username").eq("is_active", true).order("display_name");
      return data || [];
    },
  });

  const { data: sourceTags = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase.from("traffic_sources")
        .select("id, name, color").order("name");
      return data || [];
    },
  });

  const saveSource = async () => {
    setActionSaving(true);
    try {
      const selected = sourceTags.find((t: any) => t.name === sourceVal);
      const { error } = await supabase.from("tracking_links").update({
        source_tag: sourceVal || null,
        traffic_source_id: selected?.id || null,
        manually_tagged: true,
        traffic_category: "Manual"
      }).eq("id", d.id);
      if (error) throw error;
      setD((prev: any) => ({ ...prev, source_tag: sourceVal }));
      toast.success("Source saved");
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      setActiveAction(null);
    } catch { toast.error("Failed to save source"); }
    setActionSaving(false);
  };

  // ─── FIX 1: FINANCIALS — always from tracking_links ───
  const cost = Number(d.cost_total ?? 0);
  const hasSpendConfig = !!d.cost_type;
  const costInputValue = Number(d.cost_value ?? 0);
  const totalClicks = Number(d.clicks ?? 0);
  const tlSubscribers = Number(d.subscribers ?? 0);
  const tlSpenders = Number(d.spenders_count ?? d.spenders ?? 0);
  const campaignRevenue = Number(d.revenue ?? 0);

  const profit = d.profit != null ? Number(d.profit) : (cost > 0 ? campaignRevenue - cost : null);
  const roi = d.roi != null ? Number(d.roi) : (cost > 0 ? ((campaignRevenue - cost) / cost) * 100 : null);
  const ltvPerSub = tlSubscribers > 0 ? campaignRevenue / tlSubscribers : null;
  const profitPerSub = cost > 0 && tlSubscribers > 0 && profit != null ? profit / tlSubscribers : null;
  const cvr = d.cvr != null ? Number(d.cvr) : (totalClicks > 100 ? (tlSubscribers / totalClicks) * 100 : null);
  const costPerLead = Number(d.cost_per_lead ?? 0);
  const costPerClick = Number(d.cost_per_click ?? d.cpc_real ?? 0);
  const paymentType = d.payment_type || d.cost_type || null;

  const daysRunning = d.created_at
    ? Math.max(1, Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000))
    : null;
  const subsPerDay = daysRunning && daysRunning > 0 && tlSubscribers > 0
    ? (tlSubscribers / daysRunning).toFixed(1) : "0";

  // Spender rate
  const spenderRate = tlSubscribers > 0 ? Math.min(100, (tlSpenders / tlSubscribers) * 100) : null;

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


  const saveSpend = async () => {
    setActionSaving(true);
    try {
      const total = calcCostTotal();
      const { error } = await supabase.from("tracking_links").update({
        cost_type: costType, cost_value: Number(costValue) || 0, cost_total: total,
      }).eq("id", d.id);
      if (error) throw error;
      const { data: refreshed } = await supabase
        .from("tracking_links")
        .select("*, accounts(display_name, username, avatar_thumb_url)")
        .eq("id", d.id)
        .single();
      if (refreshed) {
        setD((prev: any) => ({ ...prev, ...refreshed }));
        setCostType(refreshed.cost_type || "CPL");
        setCostValue(String(refreshed.cost_value || ""));
      }
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
            { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, label: "Edit" },
            { key: "spend", icon: <Coins className="h-3.5 w-3.5" />, label: "Spend" },
            { key: "source", icon: <DollarSign className="h-3.5 w-3.5" />, label: "Source" },
            { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, label: "Delete" },
          ].map(btn => (
            <Button
              key={btn.key}
              variant={activeAction === btn.key ? "default" : "outline"}
              size="sm"
              className="flex-1 h-9 text-[13px] gap-1.5"
              onClick={() => setActiveAction(activeAction === btn.key ? null : btn.key)}
            >
              {btn.icon}{btn.label}
            </Button>
          ))}
        </div>

        {/* SPEND PANEL */}
        {activeAction === "spend" && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ background: "#0D1117" }}>
            <div className="p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Spend</span>
                <DollarSign className="h-3 w-3 text-muted-foreground" />
                {cost > 0
                  ? <span className="text-[10px] font-semibold text-primary rounded-full bg-primary/10 border border-primary/30 px-1.5 py-0.5">{fmtC2(cost)}</span>
                  : hasSpendConfig
                    ? <span className="text-[10px] font-semibold text-primary rounded-full bg-primary/10 border border-primary/30 px-1.5 py-0.5">{d.cost_type} @ {fmtC2(Number(d.cost_value || 0))}</span>
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
                    await supabase.from("tracking_links").update({
                      cost_type: null,
                      cost_value: null,
                      cost_total: 0,
                      profit: null,
                      roi: null,
                      cpl_real: null,
                      cpc_real: null,
                      status: 'NO_SPEND',
                    }).eq("id", d.id);
                    setD((prev: any) => ({ ...prev, cost_type: null, cost_value: null, cost_total: 0, profit: null, roi: null, status: 'NO_SPEND' }));
                    setCostType("CPL");
                    setCostValue("");
                    toast.success("Spend cleared");
                    refreshAll();
                    setActiveAction(null);
                  } catch { toast.error("Failed to clear"); }
                  setActionSaving(false);
                }} disabled={actionSaving}>Clear</Button>
              </div>
            </div>
          </div>
        )}

        {/* SOURCE PANEL */}
        {activeAction === "source" && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ background: "#0D1117" }}>
            <div className="p-3 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Source</span>
              <select
                value={sourceVal}
                onChange={e => setSourceVal(e.target.value)}
                className="w-full h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
              >
                <option value="">— Select source —</option>
                {sourceTags.map((t: any) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
              <Input
                type="text"
                value={sourceVal}
                onChange={e => setSourceVal(e.target.value)}
                placeholder="CREATE NEW SOURCE NAME"
                className="h-8 text-sm bg-card border-border"
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-[11px]"
                  disabled={!sourceVal.trim() || actionSaving}
                  onClick={async () => {
                    if (!sourceVal.trim()) return;
                    const trimmed = sourceVal.trim();
                    const exists = sourceTags.find((t: any) => t.name.toLowerCase() === trimmed.toLowerCase());
                    if (exists) { toast.info(`"${trimmed}" already exists`); return; }
                    setActionSaving(true);
                    try {
                      const { data, error } = await supabase.from("traffic_sources").insert({
                        name: trimmed,
                        category: "Manual",
                        color: "#0891b2",
                        keywords: [],
                      }).select().single();
                      if (error) throw error;
                      // Also assign to the tracking link
                      await supabase.from("tracking_links").update({
                        source_tag: data.name,
                        traffic_source_id: data.id,
                        manually_tagged: true,
                        traffic_category: "Manual",
                      }).eq("id", d.id);
                      setD((prev: any) => ({ ...prev, source_tag: data.name, traffic_source_id: data.id }));
                      setSourceVal(data.name);
                      await queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
                      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                      toast.success(`Source "${trimmed}" created & assigned`);
                    } catch (err) { console.error(err); toast.error("Failed to create"); }
                    setActionSaving(false);
                  }}
                >
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-[11px] text-destructive hover:text-destructive"
                  disabled={!sourceVal.trim() || actionSaving}
                  onClick={async () => {
                    const src = sourceTags.find((t: any) => t.name === sourceVal);
                    if (!src) { toast.error("Source not found in list"); return; }
                    setActionSaving(true);
                    try {
                      // Clear source from any tracking links referencing this source
                      await supabase.from("tracking_links").update({
                        source_tag: null,
                        traffic_source_id: null,
                        manually_tagged: false,
                      }).eq("traffic_source_id", src.id);
                      const { error } = await supabase.from("traffic_sources").delete().eq("id", src.id);
                      if (error) throw error;
                      if (d.traffic_source_id === src.id || d.source_tag === src.name) {
                        setD((prev: any) => ({ ...prev, source_tag: null, traffic_source_id: null }));
                      }
                      await queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
                      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                      setSourceVal("");
                      toast.success(`Deleted "${src.name}"`);
                    } catch { toast.error("Failed to delete"); }
                    setActionSaving(false);
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" className="flex-1 h-8 text-[11px]" onClick={saveSource} disabled={actionSaving}>
                  {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
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

        {/* EDIT PANEL */}
        {activeAction === "edit" && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ background: "#0D1117" }}>
            <div className="p-3 space-y-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Edit Tracking Link</span>

              {/* URL */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">URL</label>
                <Input
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  placeholder="https://onlyfans.com/..."
                  className="h-8 text-sm font-mono bg-card border-border mt-0.5"
                />
              </div>

              {/* Campaign Name & Model */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Campaign Name</label>
                  <Input
                    value={editCampaignName}
                    onChange={e => setEditCampaignName(e.target.value)}
                    placeholder="Campaign name..."
                    className="h-8 text-sm bg-card border-border mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Model</label>
                  <div className="flex items-center gap-2 mt-0.5">
                    {(() => {
                      const sel = allAccounts.find((a: any) => a.id === editAccountId);
                      return sel ? <ModelAvatar avatarUrl={sel.avatar_thumb_url} name={sel.display_name} size={20} className="shrink-0" /> : null;
                    })()}
                    <select
                      value={editAccountId}
                      onChange={e => setEditAccountId(e.target.value)}
                      className="flex-1 min-w-0 h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground appearance-none cursor-pointer"
                    >
                      <option value="">Select...</option>
                      {allAccounts.map((a: any) => (
                        <option key={a.id} value={a.id}>{a.display_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <Button
                size="sm"
                className="w-full h-8 text-xs"
                disabled={actionSaving || !editCampaignName.trim() || !editUrl.trim() || !editAccountId}
                onClick={async () => {
                  setActionSaving(true);
                  try {
                    const { error } = await supabase.from("tracking_links").update({
                      campaign_name: editCampaignName.trim(),
                      url: editUrl.trim(),
                      account_id: editAccountId,
                    } as any).eq("id", d.id);
                    if (error) throw error;

                    const { data: refreshed } = await supabase
                      .from("tracking_links").select("*").eq("id", d.id).single();
                    if (refreshed) setD((prev: any) => ({ ...prev, ...refreshed }));

                    toast.success("Tracking link updated");
                    refreshAll();
                    setActiveAction(null);
                  } catch { toast.error("Failed to save"); }
                  setActionSaving(false);
                }}
              >
                {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ROW 1 — 3 columns: Financials Left | Financials Right | Campaign Info */}
      <div className="px-6 pt-3 pb-1">
        <div className="grid grid-cols-3 gap-0 border-t-2 border-destructive">
          {/* COL 1 — FINANCIALS LEFT */}
          <div className="border-r border-border">
            <div className="px-3 py-1 border-b border-border">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Financials</span>
            </div>
            <DataRow label="Total Spend" value={cost > 0 ? fmtC2(cost) : hasSpendConfig ? fmtC2(cost) : "—"} />
            <DataRow label="Profit" value={cost > 0 ? fmtC2(profit) : hasSpendConfig ? fmtC2(0) : "—"} tone={cost > 0 ? profitTone(profit) : "neutral"} />
            <DataRow label="Profit/Sub" value={cost > 0 && profitPerSub != null ? fmtC2(profitPerSub) : "—"} tone={profitPerSub != null ? profitTone(profitPerSub) : "neutral"} />
            <DataRow label="Subs/Day" value={subsPerDay} />
            <DataRow label="CVR" value={cvr != null ? fmtPct(cvr) : "—"} />
            <DataRow label="Subscribers" value={tlSubscribers.toLocaleString()} />
          </div>
          {/* COL 2 — FINANCIALS RIGHT */}
          <div className="border-r border-border">
            <div className="px-3 py-1 border-b border-border">
              <span className="text-[10px] font-bold uppercase tracking-wider text-transparent select-none">—</span>
            </div>
            <DataRow label="Revenue" value={campaignRevenue > 0 ? fmtC2(campaignRevenue) : "$0.00"} tone={campaignRevenue > 0 ? "positive" : "neutral"} />
            <DataRow label="ROI" value={roi != null ? `${roi.toFixed(0)}%` : "—"} tone={roi != null ? profitTone(roi) : "neutral"} />
            <DataRow label="LTV/Sub" value={ltvPerSub != null ? fmtC2(ltvPerSub) : "—"} tone={ltvPerSub != null && ltvPerSub > 0 ? "positive" : "neutral"} />
            {paymentType === "CPL" && <DataRow label="CPL" value={costPerLead > 0 ? fmtC2(costPerLead) : "—"} />}
            {paymentType === "CPC" && <DataRow label="CPC" value={costPerClick > 0 ? fmtC2(costPerClick) : "—"} />}
            <DataRow label="Clicks" value={totalClicks.toLocaleString()} />
            <DataRow label="Spenders" value={tlSpenders.toLocaleString()} />
            <DataRow label="Spender Rate" value={spenderRate != null ? fmtPct(spenderRate) : "—"} tone={spenderRate != null && spenderRate > 0 ? "positive" : "neutral"} />
          </div>
          {/* COL 3 — CAMPAIGN INFO */}
          <div>
            <div className="px-3 py-1 border-b border-border">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Campaign Info</span>
            </div>
            <DataRow label="Source" value={d.source_tag || "—"} />
            <DataRow label="Marketer" value={d.onlytraffic_marketer || "—"} />
            <DataRow label="Traffic Category" value={d.traffic_category || "—"} />
            <DataRow label="Created" value={d.created_at ? format(new Date(d.created_at), "MMM d, yyyy") : "—"} />
            <DataRow label="Days Running" value={daysRunning != null ? String(daysRunning) : "—"} />
            <DataRow label="Last Synced" value={d.updated_at ? (() => {
              const updated = new Date(d.updated_at);
              const diffHours = Math.floor((Date.now() - updated.getTime()) / 3600000);
              const diffDays = Math.floor(diffHours / 24);
              const relative = diffHours < 1 ? "Just now"
                : diffHours < 24 ? `${diffHours}h ago`
                : `${diffDays}d ago`;
              const exact = updated.toLocaleString("en-US", {
                month: "short", day: "numeric", year: "numeric",
                hour: "2-digit", minute: "2-digit"
              });
              return `${relative} (${exact})`;
            })() : "—"} />
            <DataRow label="Status" value={
              d.status
                ? <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-semibold text-primary text-[11px]">{d.status}</span>
                : "—"
            } />
          </div>
        </div>
      </div>

      {/* ORDER HISTORY — OnlyTraffic only */}
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

  const copyAllOrders = () => {
    const header = "Order ID\tDate\tMarketer\tSource\tOrdered\tDelivered\tPrice/Unit\tAmount\tStatus";
    const rows = sorted.map(o => [
      o.order_id || "", o.order_created_at ? format(new Date(o.order_created_at), "yyyy-MM-dd") : "",
      o.marketer || "", o.source || "", o.quantity_ordered ?? "", o.quantity_delivered ?? "",
      o.price_per_unit != null ? `$${Number(o.price_per_unit).toFixed(2)}` : "",
      o.total_spent != null ? `$${Number(o.total_spent).toFixed(2)}` : "", o.status || "",
    ].join("\t")).join("\n");
    navigator.clipboard.writeText(`${header}\n${rows}`);
    toast.success("All orders copied");
  };

  const copyOrderId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("Order ID copied");
  };

  return (
    <div className="px-6 pb-3">
      <div className="border-t border-border pt-2">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">Order History</h4>
          {!isLoading && orders.length > 0 && (
            <button onClick={copyAllOrders} className="text-muted-foreground hover:text-foreground p-1 transition-colors" title="Copy all orders">
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {!isLoading && orders.length > 0 && (
          <p className="text-[11px] text-muted-foreground mb-1">
            {orders.length} order{orders.length !== 1 ? "s" : ""} · {fmtC2(rawSpend)} raw · {fmtC2(cappedSpend)} capped
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        ) : orders.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-2">No orders</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full" style={{ fontSize: "11px" }}>
              <thead>
                <tr className="border-b border-border" style={{ background: "#0D1117" }}>
                  {["Order ID", "Date", "Marketer", "Source", "Ord", "Del", "$/Unit", "Amount", "Status"].map(h => (
                    <th key={h} className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(o => (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" style={{ height: "36px" }}>
                    <td className="px-2 py-1 font-mono text-foreground whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {o.order_id || "—"}
                        {o.order_id && (
                          <button onClick={() => copyOrderId(o.order_id!)} className="text-muted-foreground hover:text-foreground transition-colors">
                            <Copy className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">
                      {o.order_created_at ? format(new Date(o.order_created_at), "MMM d") : "—"}
                    </td>
                    <td className="px-2 py-1 text-foreground">{formatMarketer(o)}</td>
                    <td className="px-2 py-1 text-muted-foreground">{o.source || "—"}</td>
                    <td className="px-2 py-1 text-foreground">{o.quantity_ordered ?? "—"}</td>
                    <td className="px-2 py-1 text-foreground">{o.quantity_delivered ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-foreground whitespace-nowrap">
                      {o.price_per_unit != null
                        ? `$${Number(o.price_per_unit).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1 font-mono font-semibold text-foreground whitespace-nowrap">
                      {o.total_spent != null ? fmtC2(Number(o.total_spent)) : "—"}
                    </td>
                    <td className="px-2 py-1">{statusPill(o.status)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border" style={{ background: "#0D1117" }}>
                  <td colSpan={9} className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                    {orders.length} orders · {totalOrdered.toLocaleString()} ordered · {totalDelivered.toLocaleString()} delivered · {fmtC2(cappedSpend)} total spend (delivered subs × rate)
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

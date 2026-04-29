import { useEffect, useState } from "react";

import {
  Copy, ExternalLink, XCircle, Coins, Trash2,
  ArrowUpRight, Loader2, DollarSign, Calculator, User, CheckCircle,
  Pencil, Info, Plus, X, StickyNote,
} from "lucide-react";

import { format } from "date-fns";
import { ModelAvatar } from "@/components/ModelAvatar";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getTrackingLink, updateTrackingLink, deleteTrackingLink,
  getTrafficSources, createTrafficSource, deleteTrafficSource,
  getAccounts, getOnlytrafficOrders,
} from "@/lib/api";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { calcStatusFromRoi } from "@/lib/calc-helpers";
import { CampaignGrowthTable } from "./CampaignGrowthTable";

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
  onCampaignUpdated?: (campaign: any) => void;
}

export function CampaignDetailDrawer({ campaign, onClose, onCampaignUpdated }: CampaignDetailDrawerProps) {
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
            onCampaignUpdated={onCampaignUpdated}
            onClose={onClose}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerBodyInner({
  campaign: initialCampaign, activeAction, setActiveAction, actionSaving, setActionSaving, onClose, onCampaignUpdated,
}: any) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [d, setD] = useState(initialCampaign);
  const [, setIsHydratingLink] = useState(false);
  const [costType, setCostType] = useState(d.cost_type || d.payment_type || "CPL");
  const [costValue, setCostValue] = useState(String(d.cost_value || ""));
  const [sourceVal, setSourceVal] = useState(d.source_tag || "");

  // Edit panel state
  const [editCampaignName, setEditCampaignName] = useState(d.campaign_name || "");
  const [editUrl, setEditUrl] = useState(d.url || "");
  const [editAccountId, setEditAccountId] = useState(d.account_id || "");
  const [showNewSource, setShowNewSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");

  // Notes state
  const [noteText, setNoteText] = useState(d.notes || "");

  const { data: allAccounts = [] } = useQuery({
    queryKey: ["accounts_list"],
    queryFn: getAccounts,
  });

  const { data: sourceTags = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: getTrafficSources,
  });

  const syncDrawerState = (nextCampaign: any) => {
    setD(nextCampaign);
    setCostType(nextCampaign.cost_type || nextCampaign.payment_type || "CPL");
    setCostValue(nextCampaign.cost_value != null ? String(nextCampaign.cost_value) : "");
    setSourceVal(nextCampaign.source_tag || "");
    setEditCampaignName(nextCampaign.campaign_name || "");
    setEditUrl(nextCampaign.url || "");
    setEditAccountId(nextCampaign.account_id || "");
    setNoteText(nextCampaign.notes || "");
  };

  const mergeDrawerCampaign = (baseCampaign: any, rawLink: any) => ({
    ...baseCampaign,
    ...rawLink,
    accounts: rawLink?.accounts ?? baseCampaign?.accounts,
    modelName: baseCampaign?.modelName
      || rawLink?.accounts?.display_name
      || rawLink?.accounts?.username
      || baseCampaign?.account_display_name
      || baseCampaign?.account_username
      || "",
    avatarUrl: baseCampaign?.avatarUrl
      || rawLink?.accounts?.avatar_thumb_url
      || baseCampaign?.account_avatar_thumb_url
      || null,
  });

  const fetchTrackingLink = async (linkId: string) => {
    return getTrackingLink(linkId);
  };

  useEffect(() => {
    let cancelled = false;

    syncDrawerState(initialCampaign);

    if (!initialCampaign?.id) return () => {
      cancelled = true;
    };

    setIsHydratingLink(true);

    void (async () => {
      try {
        const rawLink = await fetchTrackingLink(initialCampaign.id);
        if (cancelled) return;

        const merged = mergeDrawerCampaign(initialCampaign, rawLink);
        syncDrawerState(merged);
      } catch (error) {
        console.error("Failed to hydrate campaign drawer", error);
      } finally {
        if (!cancelled) setIsHydratingLink(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialCampaign]);

  const updateCachedLink = (updatedLink: any) => {
    const mergeLink = (prev: any) => Array.isArray(prev)
      ? prev.map((link: any) => (link.id === updatedLink.id ? { ...link, ...updatedLink } : link))
      : prev;

    queryClient.setQueriesData({ queryKey: ["tracking_links"] }, mergeLink);
    queryClient.setQueriesData({ queryKey: ["tracking_links_ts"] }, mergeLink);
  };

  const removeCachedLink = (linkId: string) => {
    const removeLink = (prev: any) => Array.isArray(prev)
      ? prev.filter((link: any) => link.id !== linkId)
      : prev;

    queryClient.setQueriesData({ queryKey: ["tracking_links"] }, removeLink);
    queryClient.setQueriesData({ queryKey: ["tracking_links_ts"] }, removeLink);
  };

  const refreshTrackingQueries = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] }),
    queryClient.invalidateQueries({ queryKey: ["tracking_links_ts"] }),
  ]);

  const refreshAll = () => Promise.all([
    refreshTrackingQueries(),
    queryClient.invalidateQueries({ queryKey: ["daily_snapshots"] }),
  ]);

  const applyFreshTrackingLink = (rawLink: any, baseCampaign: any = d) => {
    const merged = mergeDrawerCampaign(baseCampaign, rawLink);
    syncDrawerState(merged);
    updateCachedLink(merged);
    onCampaignUpdated?.(merged);
    return merged;
  };

  const refetchTrackingLinkAndSync = async (baseCampaign: any = d) => {
    const refreshed = await fetchTrackingLink(baseCampaign?.id || d.id);
    return applyFreshTrackingLink(refreshed, baseCampaign);
  };

  const createAndAssignSource = async () => {
    const trimmed = newSourceName.trim();
    if (!trimmed) return;
    const exists = (sourceTags as any[]).find((t: any) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setSourceVal(exists.name);
      setShowNewSource(false);
      toast.info(`"${trimmed}" already exists — selected`);
      return;
    }
    setActionSaving(true);
    try {
      const data = await createTrafficSource({ name: trimmed, category: "Manual", color: "#3b82f6", keywords: [] });
      setSourceVal(data.name);
      setShowNewSource(false);
      setNewSourceName("");
      await queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      toast.success(`Source "${trimmed}" created`);
    } catch { toast.error("Failed to create source"); }
    setActionSaving(false);
  };

  const saveSource = async () => {
    setActionSaving(true);
    try {
      const selected = sourceTags.find((t: any) => t.name === sourceVal);
      // Don't overwrite traffic_category if the link is already OT-synced
      const newCategory = d.traffic_category === "OnlyTraffic" ? "OnlyTraffic" : "Manual";
      await updateTrackingLink(d.id, {
        source_tag: sourceVal || null,
        traffic_source_id: (selected as any)?.id || null,
        manually_tagged: true,
        traffic_category: newCategory,
      });

      await refetchTrackingLinkAndSync();

      toast.success("Source saved");
      await refreshTrackingQueries();
      setActiveAction(null);
    } catch { toast.error("Failed to save source"); }
    setActionSaving(false);
  };

  // ─── FIX 1: FINANCIALS — always from tracking_links ───
  const cost = Number(d.cost_total ?? 0);
  const configuredCostType = d.cost_type || d.payment_type || null;
  const hasSpendConfig = !!configuredCostType;
  const costInputValue = Number(d.cost_value ?? 0);
  const totalClicks = Number(d.clicks ?? 0);
  const tlSubscribers = Number(d.subscribers ?? 0);
  const tlSpenders = Number(d.spenders_count || d.spenders || 0);
  const campaignRevenue = Number(d.revenue ?? 0);

  const profit = d.profit != null ? Number(d.profit) : (cost > 0 ? campaignRevenue - cost : null);
  const roi = d.roi != null ? Number(d.roi) : (cost > 0 ? ((campaignRevenue - cost) / cost) * 100 : null);
  const ltvPerSub = tlSubscribers > 0 ? campaignRevenue / tlSubscribers : null;
  const profitPerSub = cost > 0 && tlSubscribers > 0 && profit != null ? profit / tlSubscribers : null;
  const cvr = d.cvr != null ? Number(d.cvr) : (totalClicks > 100 ? (tlSubscribers / totalClicks) * 100 : null);
  const costPerLead = Number(d.cost_per_lead ?? d.cpl_real ?? 0);
  const costPerClick = Number(d.cost_per_click ?? d.cpc_real ?? 0);
  const configuredUnitCost = Number(d.cost_value ?? 0);
  const paymentType = configuredCostType;

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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

  const getSpendPayload = (linkData: any) => {
    const unitValue = Number(costValue) || 0;
    const linkClicks = Number(linkData?.clicks ?? 0);
    const linkSubscribers = Number(linkData?.subscribers ?? 0);
    const linkSpenders = Number(linkData?.spenders_count || linkData?.spenders || 0);
    const linkRevenue = Number(linkData?.revenue ?? 0);
    const total = costType === "CPC"
      ? unitValue * linkClicks
      : costType === "CPL"
        ? unitValue * linkSubscribers
        : unitValue;
    const costPerLead = costType === "CPL"
      ? unitValue
      : (total > 0 && linkSubscribers > 0 ? round(total / linkSubscribers, 4) : null);
    const costPerClick = costType === "CPC"
      ? unitValue
      : (total > 0 && linkClicks > 0 ? round(total / linkClicks, 4) : null);
    const profitValue = total > 0 ? round(linkRevenue - total, 2) : null;
    const roiValue = total > 0 ? round(((linkRevenue - total) / total) * 100, 2) : null;
    const cvrValue = linkClicks > 0 && linkSubscribers > 0 && linkClicks >= linkSubscribers
      ? round((linkSubscribers / linkClicks) * 100, 4)
      : null;
    const spenderRateValue = linkSubscribers > 0 && linkSpenders > 0
      ? round((linkSpenders / linkSubscribers) * 100, 4)
      : null;

    const statusValue = total > 0 && roiValue !== null ? calcStatusFromRoi(roiValue) : "NO_SPEND";

    return {
      cost_type: costType,
      payment_type: costType,
      cost_value: unitValue,
      cost_total: total,
      cost_per_lead: costPerLead,
      cost_per_click: costPerClick,
      cpl_real: costPerLead,
      cpc_real: costPerClick,
      profit: profitValue,
      roi: roiValue,
      cvr: cvrValue,
      spender_rate: spenderRateValue,
      status: statusValue,
    };
  };


  const saveSpend = async () => {
    setActionSaving(true);
    try {
      const baseLink = await fetchTrackingLink(d.id);
      const spendPayload = getSpendPayload(baseLink);
      await updateTrackingLink(d.id, spendPayload);

      await refetchTrackingLinkAndSync(baseLink);
      toast.success("Spend saved");
      await refreshAll();
      setActiveAction(null);
    } catch { toast.error("Failed to save spend"); }
    setActionSaving(false);
  };

  const confirmDelete = async () => {
    setActionSaving(true);
    try {
      await deleteTrackingLink(d.id);
      removeCachedLink(d.id);
      toast.success("Campaign deleted");
      refreshAll();
      onClose();
    } catch { toast.error("Failed to delete"); }
    setActionSaving(false);
  };

  return (
    <div className="overflow-y-auto flex-1">
      {/* HEADER */}
      <div className="px-6 pt-2.5 pb-2 border-b border-border flex items-center gap-4">
        <ModelAvatar avatarUrl={d.avatarUrl || d.accounts?.avatar_thumb_url || d.account_avatar_thumb_url} name={d.modelName || d.accounts?.display_name || d.account_display_name || ""} size={64} />
        <div className="flex-1 min-w-0">
          <DrawerHeader className="p-0">
            <DrawerTitle className="truncate text-lg font-bold leading-tight text-foreground">
              {d.campaign_name || "Unknown"}
            </DrawerTitle>
            <span className="text-[13px] font-medium text-primary">{d.modelName || d.accounts?.display_name || d.account_display_name || ""}</span>
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

      {/* MANUAL LINK BANNER */}
      {(d.manually_tagged === true && (!d.external_tracking_link_id || d.external_tracking_link_id === "")) && (
        <div className="mx-6 mt-2 flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/25 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-[12px] text-blue-300 leading-relaxed">
            This link was added manually. Data will appear after the next sync.
          </p>
        </div>
      )}

      {/* ACTION BUTTONS */}
      <div className="px-6 py-2 border-b border-border">
        <div className="flex gap-1.5">
          {[
            { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, label: "Edit" },
            { key: "spend", icon: <Coins className="h-3.5 w-3.5" />, label: "Spend" },
            { key: "source", icon: <DollarSign className="h-3.5 w-3.5" />, label: "Source" },
            { key: "notes", icon: <StickyNote className="h-3.5 w-3.5" />, label: d.notes ? "Notes ·" : "Notes" },
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
                    ? <span className="text-[10px] font-semibold text-primary rounded-full bg-primary/10 border border-primary/30 px-1.5 py-0.5">{configuredCostType} @ {fmtC2(Number(d.cost_value || 0))}</span>
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
                    const clearedSpend = {
                      cost_type: null,
                      payment_type: null,
                      cost_value: null,
                      cost_total: 0,
                      cost_per_lead: null,
                      cost_per_click: null,
                      profit: null,
                      roi: null,
                      cpl_real: null,
                      cpc_real: null,
                      status: 'NO_SPEND',
                    };
                    await updateTrackingLink(d.id, clearedSpend);
                    await refetchTrackingLinkAndSync();
                    toast.success("Spend cleared");
                    await refreshAll();
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
              <div className="flex gap-1.5">
                <Select value={sourceVal || "__none__"} onValueChange={v => setSourceVal(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="flex-1 h-8 text-sm bg-card border-border">
                    <SelectValue placeholder="— Select source —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {(sourceTags as any[]).map((t: any) => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => { setShowNewSource(v => !v); setNewSourceName(""); }}
                  className="h-8 w-8 flex items-center justify-center rounded-md border border-border bg-card hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Create new source"
                >
                  {showNewSource ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </button>
              </div>
              {showNewSource && (
                <div className="flex gap-1.5">
                  <Input
                    type="text"
                    value={newSourceName}
                    onChange={e => setNewSourceName(e.target.value)}
                    placeholder="New source name..."
                    className="h-8 text-sm bg-card border-border flex-1"
                    onKeyDown={async e => { if (e.key === "Enter") await createAndAssignSource(); }}
                    autoFocus
                  />
                  <Button size="sm" className="h-8 text-[11px] px-3" disabled={!newSourceName.trim() || actionSaving}
                    onClick={async () => createAndAssignSource()}>
                    {actionSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              )}
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-[11px] text-destructive hover:text-destructive"
                  disabled={!sourceVal.trim() || actionSaving}
                  onClick={async () => {
                    const src = (sourceTags as any[]).find((t: any) => t.name === sourceVal);
                    if (!src) { toast.error("Source not found in list"); return; }
                    setActionSaving(true);
                    try {
                      await deleteTrafficSource(src.id);
                      if (d.traffic_source_id === src.id || d.source_tag === src.name) await refetchTrackingLinkAndSync();
                      await queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
                      await refreshTrackingQueries();
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

        {/* NOTES PANEL */}
        {activeAction === "notes" && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ background: "#0D1117" }}>
            <div className="p-3 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Notes</span>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add notes, paste links, or anything useful for reference..."
                rows={5}
                className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
              />
              <Button
                size="sm"
                className="w-full h-8 text-xs"
                disabled={actionSaving}
                onClick={async () => {
                  setActionSaving(true);
                  try {
                    const updated = await updateTrackingLink(d.id, { notes: noteText || null });
                    const merged = mergeDrawerCampaign(d, updated);
                    setD(merged);
                    await refreshTrackingQueries();
                    toast.success("Note saved");
                  } catch { toast.error("Failed to save note"); }
                  finally { setActionSaving(false); }
                }}
              >
                {actionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Note"}
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
                    await updateTrackingLink(d.id, {
                      campaign_name: editCampaignName.trim(),
                      url: editUrl.trim(),
                      account_id: editAccountId,
                    });

                    await refetchTrackingLinkAndSync();

                    toast.success("Tracking link updated");
                    await refreshAll();
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
            <DataRow label="Profit" value={cost > 0 ? fmtC2(profit ?? 0) : hasSpendConfig ? fmtC2(0) : "—"} tone={cost > 0 ? profitTone(profit) : "neutral"} />
            <DataRow label="Profit/Sub" value={cost > 0 && profitPerSub != null ? fmtC2(profitPerSub) : "—"} tone={profitPerSub != null ? profitTone(profitPerSub) : "neutral"} />
            <DataRow label="Subs/Day" value={subsPerDay} />
            <DataRow label="CVR" value={cvr != null ? fmtPct(cvr) : "—"} />
            <DataRow label="Subscribers" value={tlSubscribers.toLocaleString()} />
            <DataRow label="Clicks" value={totalClicks.toLocaleString()} />
            <DataRow label="Spenders" value={tlSpenders.toLocaleString()} />
            <DataRow label="Spender Rate" value={spenderRate != null ? fmtPct(spenderRate) : "—"} tone={spenderRate != null && spenderRate > 0 ? "positive" : "neutral"} />
          </div>
          {/* COL 2 — FINANCIALS RIGHT */}
          <div className="border-r border-border">
            <div className="px-3 py-1 border-b border-border">
              <span className="text-[10px] font-bold uppercase tracking-wider text-transparent select-none">—</span>
            </div>
            <DataRow label="Revenue" value={campaignRevenue > 0 ? fmtC2(campaignRevenue) : "$0.00"} tone={campaignRevenue > 0 ? "positive" : "neutral"} />
            <DataRow label="ROI" value={roi != null ? `${roi.toFixed(0)}%` : "—"} tone={roi != null ? profitTone(roi) : "neutral"} />
            <DataRow label="LTV/Sub" value={ltvPerSub != null ? fmtC2(ltvPerSub) : "—"} tone={ltvPerSub != null && ltvPerSub > 0 ? "positive" : "neutral"} />
            <DataRow
              label="Payment Type"
              value={paymentType ? <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold">{paymentType === "FIXED" ? "Fixed" : paymentType}</span> : "—"}
            />
            <DataRow label="Cost Per Lead" value={costPerLead > 0 ? fmtC2(costPerLead) : "—"} />
            <DataRow label="Cost Per Click" value={paymentType === "CPC" && configuredUnitCost > 0 ? fmtC2(configuredUnitCost) : costPerClick > 0 ? fmtC2(costPerClick) : "—"} />
            <DataRow label="EPC" value={totalClicks > 0 ? fmtC2(campaignRevenue / totalClicks) : "—"} />
            <DataRow label="Cost/Sub" value={cost > 0 && tlSubscribers > 0 ? fmtC2(cost / tlSubscribers) : "—"} />
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

      {/* GROWTH SECTION */}
      <CampaignGrowthTable
        trackingLinkId={d.id}
        lifetimeClicks={totalClicks}
        lifetimeSubs={tlSubscribers}
        lifetimeRevenue={campaignRevenue}
      />

      {/* ORDER HISTORY — OnlyTraffic only */}
      {d.traffic_category === "OnlyTraffic" && <OrderHistorySection campaignId={d.id} cappedSpend={Number(d.capped_spend ?? 0)} />}
    </div>
  );
}

/* ─── Order History Section (FIX 4) ─── */
function OrderHistorySection({ campaignId, cappedSpend }: { campaignId: string; cappedSpend: number }) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["onlytraffic_orders", campaignId],
    queryFn: async () => {
      const data = await getOnlytrafficOrders({ tracking_link_ids: [campaignId] });
      return (data || []).sort((a: any, b: any) =>
        new Date(b.order_created_at || 0).getTime() - new Date(a.order_created_at || 0).getTime()
      );
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

import { useState, useMemo } from "react";
import { X, MousePointerClick, Users, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CostSettingSlideInProps {
  link: any;
  onClose: () => void;
  onSaved: () => void;
}

type CostType = "CPC" | "CPL" | "FIXED";

const COST_TYPES: { type: CostType; title: string; desc: string; inputLabel: string; icon: any }[] = [
  { type: "CPC", title: "Cost Per Click", desc: "I pay per click on my ad", inputLabel: "CPC value ($)", icon: MousePointerClick },
  { type: "CPL", title: "Cost Per Subscriber", desc: "I pay per subscriber gained", inputLabel: "CPL value ($)", icon: Users },
  { type: "FIXED", title: "Fixed Amount", desc: "Flat fee (pin, promo, deal)", inputLabel: "Fixed cost ($)", icon: DollarSign },
];

function calcMetrics(costType: CostType, costValue: number, clicks: number, subscribers: number, revenue: number, createdAt: string) {
  const cvr = clicks > 0 ? subscribers / clicks : 0;
  let cost_total = 0, cpc_real = 0, cpl_real = 0;

  if (costType === "CPC") {
    cost_total = clicks * costValue;
    cpc_real = costValue;
    cpl_real = cvr > 0 ? costValue / cvr : 0;
  } else if (costType === "CPL") {
    cost_total = subscribers * costValue;
    cpc_real = cvr > 0 ? costValue * cvr : 0;
    cpl_real = costValue;
  } else {
    cost_total = costValue;
    cpc_real = clicks > 0 ? cost_total / clicks : 0;
    cpl_real = subscribers > 0 ? cost_total / subscribers : 0;
  }

  const arpu = subscribers > 0 ? revenue / subscribers : 0;
  const profit = revenue - cost_total;
  const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0;
  const daysSinceCreated = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);

  let status = "NO_DATA";
  if (clicks === 0 && daysSinceCreated >= 3) status = "DEAD";
  else if (roi > 150) status = "SCALE";
  else if (roi >= 50) status = "WATCH";
  else if (roi >= 0) status = "LOW";
  else status = "KILL";

  return { cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status };
}

const STATUS_STYLES: Record<string, string> = {
  SCALE: "bg-primary/20 text-primary",
  WATCH: "bg-warning/20 text-warning",
  LOW: "bg-warning/20 text-warning",
  KILL: "bg-destructive/20 text-destructive",
  DEAD: "bg-destructive/20 text-destructive",
  NO_DATA: "bg-secondary text-muted-foreground",
};

const STATUS_EMOJI: Record<string, string> = {
  SCALE: "🚀", WATCH: "👀", LOW: "📉", KILL: "🔴", DEAD: "💀", NO_DATA: "⏳",
};

export function CostSettingSlideIn({ link, onClose, onSaved }: CostSettingSlideInProps) {
  const [costType, setCostType] = useState<CostType | null>(link.cost_type || null);
  const [costValue, setCostValue] = useState(link.cost_value ? String(link.cost_value) : "");
  const [saving, setSaving] = useState(false);

  const clicks = link.clicks || 0;
  const subscribers = link.subscribers || 0;
  const revenue = Number(link.revenue || 0);

  const preview = useMemo(() => {
    if (!costType || !costValue || isNaN(Number(costValue)) || Number(costValue) <= 0) return null;
    return calcMetrics(costType, Number(costValue), clicks, subscribers, revenue, link.created_at);
  }, [costType, costValue, clicks, subscribers, revenue, link.created_at]);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtP = (v: number) => `${v.toFixed(1)}%`;

  const handleSave = async () => {
    if (!costType || !costValue || !preview) return;
    setSaving(true);
    try {
      // Write 1: Update tracking_links with calculated metrics
      const { error: linkError } = await supabase.from("tracking_links").update({
        cost_type: costType,
        cost_value: Number(costValue),
        cost_total: preview.cost_total,
        cvr: preview.cvr,
        cpc_real: preview.cpc_real,
        cpl_real: preview.cpl_real,
        arpu: preview.arpu,
        profit: preview.profit,
        roi: preview.roi,
        status: preview.status,
      }).eq("id", link.id);
      if (linkError) throw linkError;

      // Write 2: Upsert to ad_spend table
      await supabase.from("ad_spend").upsert({
        campaign_id: link.campaign_id,
        traffic_source: link.source || "direct",
        amount: preview.cost_total,
        date: new Date().toISOString().split("T")[0],
        notes: `${costType} @ $${Number(costValue).toFixed(2)}`,
        media_buyer: link.source || null,
        account_id: link.account_id,
      }, { onConflict: "campaign_id" });

      onSaved();
    } catch (err: any) {
      console.error("Save spend error:", err);
    } finally {
      setSaving(false);
    }
  };

  const costFormula = useMemo(() => {
    if (!costType || !costValue || isNaN(Number(costValue))) return null;
    const v = Number(costValue);
    if (costType === "CPC") {
      const total = clicks * v;
      const cvr = clicks > 0 ? (subscribers / clicks) : 0;
      const cpl = cvr > 0 ? v / cvr : 0;
      return [
        `Spend = ${clicks.toLocaleString()} × $${v.toFixed(2)} = ${fmtC(total)}`,
        `CVR = ${subscribers}/${clicks} = ${fmtP(cvr * 100)}`,
        `Real CPL = $${v.toFixed(2)} / ${fmtP(cvr * 100)} = ${fmtC(cpl)}`,
      ];
    }
    if (costType === "CPL") {
      const total = subscribers * v;
      const cvr = clicks > 0 ? (subscribers / clicks) : 0;
      const cpc = cvr > 0 ? v * cvr : 0;
      return [
        `Spend = ${subscribers.toLocaleString()} × $${v.toFixed(2)} = ${fmtC(total)}`,
        `CVR = ${subscribers}/${clicks} = ${fmtP(cvr * 100)}`,
        `Real CPC = $${v.toFixed(2)} × ${fmtP(cvr * 100)} = ${fmtC(cpc)}`,
      ];
    }
    const cpc = clicks > 0 ? v / clicks : 0;
    const cpl = subscribers > 0 ? v / subscribers : 0;
    return [
      `Spend = ${fmtC(v)}`,
      `Real CPC = ${fmtC(v)} / ${clicks} = ${fmtC(cpc)}`,
      `Real CPL = ${fmtC(v)} / ${subscribers} = ${fmtC(cpl)}`,
    ];
  }, [costType, costValue, clicks, subscribers]);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[480px] bg-card border-l border-border z-50 animate-slide-in-right overflow-y-auto">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">Set Spend</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{link.campaign_name || "Unknown"}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Step 1: Spend Type */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Step 1 — Spend Type</label>
            <div className="grid grid-cols-3 gap-2">
              {COST_TYPES.map((ct) => (
                <button
                  key={ct.type}
                  onClick={() => setCostType(ct.type)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    costType === ct.type
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-border bg-secondary hover:border-primary/40"
                  }`}
                >
                  <ct.icon className={`h-5 w-5 mb-2 ${costType === ct.type ? "text-primary" : "text-muted-foreground"}`} />
                  <p className={`text-xs font-bold ${costType === ct.type ? "text-primary" : "text-foreground"}`}>{ct.type}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{ct.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Value Input */}
          {costType && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                Step 2 — {COST_TYPES.find(c => c.type === costType)?.inputLabel}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-lg">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={costValue}
                  onChange={(e) => setCostValue(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-3 bg-secondary border border-border rounded-lg text-lg font-mono text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary transition-all"
                  autoFocus
                />
              </div>
              {costFormula && (
                <div className="mt-2 bg-secondary/50 border border-border rounded-lg p-3 space-y-1">
                  {costFormula.map((line, i) => (
                    <p key={i} className="text-xs font-mono text-muted-foreground">{line}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Full preview */}
          {preview && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Step 3 — Full Preview</label>
              <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div><span className="text-muted-foreground block">Clicks</span><span className="font-mono font-semibold text-foreground">{clicks.toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground block">Subs</span><span className="font-mono font-semibold text-foreground">{subscribers.toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground block">CVR</span><span className="font-mono font-semibold text-foreground">{fmtP(preview.cvr * 100)}</span></div>
                  <div><span className="text-muted-foreground block">LTV</span><span className="font-mono font-semibold text-primary">{fmtC(revenue)}</span></div>
                </div>
                <div className="border-t border-border pt-2 grid grid-cols-4 gap-2 text-xs">
                  <div><span className="text-muted-foreground block">Total Spend</span><span className="font-mono font-semibold text-foreground">{fmtC(preview.cost_total)}</span></div>
                  <div><span className="text-muted-foreground block">CPC</span><span className="font-mono font-semibold text-foreground">{fmtC(preview.cpc_real)}</span></div>
                  <div><span className="text-muted-foreground block">CPL</span><span className="font-mono font-semibold text-foreground">{fmtC(preview.cpl_real)}</span></div>
                  <div><span className="text-muted-foreground block">LTV/Sub</span><span className="font-mono font-semibold text-foreground">{fmtC(preview.arpu)}</span></div>
                </div>
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <div className="text-xs">
                    <span className="text-muted-foreground block">Profit</span>
                    <span className={`font-mono text-sm font-bold ${preview.profit >= 0 ? "text-primary" : "text-destructive"}`}>
                      {preview.profit >= 0 ? "+" : ""}{fmtC(preview.profit)}
                    </span>
                  </div>
                  <div className="text-xs text-right">
                    <span className="text-muted-foreground block">ROI</span>
                    <span className={`font-mono text-sm font-bold ${preview.roi >= 0 ? "text-primary" : "text-destructive"}`}>
                      {fmtP(preview.roi)}
                    </span>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${STATUS_STYLES[preview.status] || ""}`}>
                    {STATUS_EMOJI[preview.status]} {preview.status}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !costType || !costValue || !preview}
            className="w-full px-4 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Spend"}
          </button>
        </div>
      </div>
    </>
  );
}

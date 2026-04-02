import { useState, useEffect, useRef } from "react";
import { Settings2, Lock } from "lucide-react";

// ── KPI Card IDs ──
export type OverviewKpiCardId =
  | "profit_sub" | "ltv_sub" | "avg_cpl" | "subs_day"
  | "unattributed" | "expenses" | "avg_expenses"
  | "total_profit" | "blended_roi" | "active_campaigns"
  | "best_source" | "est_revenue" | "total_ltv" | "ltv_30d_per_model";

// ── Insight Panel IDs ──
export type InsightPanelId =
  | "top_campaigns" | "perf_by_source" | "subs_day_model"
  | "roi_by_source" | "spend_by_source" | "ltv_per_model"
  | "cpl_by_source" | "model_comparison";

// ── Model Comparison Column IDs ──
export type ModelCompColId = "roi" | "subs_day";

interface ItemDef<T extends string> {
  id: T;
  label: string;
  alwaysOn?: boolean;
  defaultOn?: boolean;
}

const KPI_CARDS: ItemDef<OverviewKpiCardId>[] = [
  { id: "profit_sub", label: "Profit/Sub", alwaysOn: true },
  { id: "ltv_sub", label: "LTV/Sub", alwaysOn: true },
  { id: "avg_cpl", label: "Avg CPL", defaultOn: true },
  { id: "subs_day", label: "Subs/Day", defaultOn: true },
  { id: "unattributed", label: "Unattributed Subs %", defaultOn: false },
  { id: "expenses", label: "Expenses", defaultOn: false },
  { id: "avg_expenses", label: "Avg Expenses", defaultOn: false },
  { id: "total_profit", label: "Total Profit", defaultOn: false },
  { id: "blended_roi", label: "ROI", defaultOn: false },
  { id: "active_campaigns", label: "Active Tracking Links", defaultOn: false },
  { id: "best_source", label: "Best Source", defaultOn: false },
  { id: "est_revenue", label: "Est. Revenue", defaultOn: true },
  { id: "total_ltv", label: "LTV", defaultOn: true },
  { id: "ltv_30d_per_model", label: "30D LTV Per Model", defaultOn: false },
];

const INSIGHT_PANELS: ItemDef<InsightPanelId>[] = [
  { id: "top_campaigns", label: "Top Tracking Links", alwaysOn: true },
  { id: "perf_by_source", label: "Performance by Source", alwaysOn: true },
  { id: "subs_day_model", label: "Subs/Day per Model", alwaysOn: true },
  { id: "roi_by_source", label: "ROI by Source", defaultOn: false },
  { id: "spend_by_source", label: "Spend by Source", defaultOn: false },
  { id: "ltv_per_model", label: "LTV per Model", defaultOn: false },
  { id: "cpl_by_source", label: "CPL by Source", defaultOn: false },
  { id: "model_comparison", label: "Model Comparison", defaultOn: false },
];

const MODEL_COMP_COLS: ItemDef<ModelCompColId>[] = [
  { id: "roi", label: "ROI", defaultOn: false },
  { id: "subs_day", label: "Subs/Day", defaultOn: false },
];

const CT_PREFS_KEY = "ct_kpi_preferences";

interface CtPrefs {
  overview_kpi?: string[];
  overview_insights?: string[];
  overview_model_cols?: string[];
  campaigns_kpi?: string[];
}

function loadCtPrefs(): CtPrefs {
  try {
    const raw = localStorage.getItem(CT_PREFS_KEY);
    if (raw) return JSON.parse(raw) as CtPrefs;
  } catch {}
  return {};
}

function saveCtPrefs(prefs: CtPrefs) {
  try { localStorage.setItem(CT_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function loadItems<T extends string>(prefsKey: keyof CtPrefs, defs: ItemDef<T>[]): string[] {
  const alwaysOn = defs.filter(d => d.alwaysOn).map(d => d.id);
  const prefs = loadCtPrefs();
  const saved = prefs[prefsKey];
  if (saved && Array.isArray(saved)) {
    const set = new Set(saved);
    alwaysOn.forEach(id => set.add(id));
    return [...set];
  }
  // Migrate from old keys
  const oldKeyMap: Record<string, string> = {
    overview_kpi: "overview_kpi_cards",
    overview_insights: "overview_insight_panels",
    overview_model_cols: "overview_model_comp_cols",
    campaigns_kpi: "campaigns_kpi_cards",
  };
  try {
    const oldKey = oldKeyMap[prefsKey];
    if (oldKey) {
      const old = localStorage.getItem(oldKey);
      if (old) {
        const parsed = JSON.parse(old) as string[];
        const set = new Set(parsed);
        alwaysOn.forEach(id => set.add(id));
        const result = [...set];
        // Migrate to new key
        const p = loadCtPrefs();
        p[prefsKey] = result;
        saveCtPrefs(p);
        localStorage.removeItem(oldKey);
        return result;
      }
    }
  } catch {}
  return defs.filter(d => d.alwaysOn || d.defaultOn).map(d => d.id);
}

function saveItems(prefsKey: keyof CtPrefs, items: string[]) {
  const prefs = loadCtPrefs();
  prefs[prefsKey] = items;
  saveCtPrefs(prefs);
}

export function useOverviewCustomizer() {
  const [kpiCards, setKpiCards] = useState(() => loadItems("overview_kpi", KPI_CARDS));
  const [insightPanels, setInsightPanels] = useState(() => loadItems("overview_insights", INSIGHT_PANELS));
  const [modelCompCols, setModelCompCols] = useState(() => loadItems("overview_model_cols", MODEL_COMP_COLS));

  const kpiAlwaysOn = KPI_CARDS.filter(d => d.alwaysOn).map(d => d.id);
  const insightAlwaysOn = INSIGHT_PANELS.filter(d => d.alwaysOn).map(d => d.id);

  const toggleKpi = (id: string) => {
    if (kpiAlwaysOn.includes(id as any)) return;
    setKpiCards(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      saveItems("overview_kpi", next);
      return next;
    });
  };

  const toggleInsight = (id: string) => {
    if (insightAlwaysOn.includes(id as any)) return;
    setInsightPanels(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      saveItems("overview_insights", next);
      return next;
    });
  };

  const toggleModelCol = (id: string) => {
    setModelCompCols(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      saveItems("overview_model_cols", next);
      return next;
    });
  };

  return {
    kpiCards, insightPanels, modelCompCols,
    isKpiVisible: (id: string) => kpiCards.includes(id),
    isInsightVisible: (id: string) => insightPanels.includes(id),
    isModelColVisible: (id: string) => modelCompCols.includes(id),
    toggleKpi, toggleInsight, toggleModelCol,
  };
}

export function OverviewCustomizer({
  kpiCards, insightPanels, modelCompCols,
  toggleKpi, toggleInsight, toggleModelCol,
}: {
  kpiCards: string[];
  insightPanels: string[];
  modelCompCols: string[];
  toggleKpi: (id: string) => void;
  toggleInsight: (id: string) => void;
  toggleModelCol: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const renderSection = <T extends string>(
    title: string,
    items: ItemDef<T>[],
    enabled: string[],
    toggle: (id: string) => void,
  ) => (
    <div>
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">{title}</p>
      {items.map(c => (
        <label
          key={c.id}
          className={`flex items-center gap-2.5 px-3 py-1.5 cursor-pointer transition-colors ${
            c.alwaysOn ? "opacity-60" : "hover:bg-secondary/50"
          }`}
        >
          {c.alwaysOn ? (
            <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <input
              type="checkbox"
              checked={enabled.includes(c.id)}
              onChange={() => toggle(c.id)}
              className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-[hsl(var(--primary))]"
            />
          )}
          <span className="text-[11px] text-foreground">{c.label}</span>
          {c.alwaysOn && <span className="text-[9px] text-muted-foreground ml-auto">Always on</span>}
        </label>
      ))}
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/30 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Customize
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-card border border-border rounded-lg shadow-lg py-1.5 max-h-[500px] overflow-y-auto">
          {renderSection("KPI Cards", KPI_CARDS, kpiCards, toggleKpi)}
          <div className="h-px bg-border my-1" />
          {renderSection("Insights", INSIGHT_PANELS, insightPanels, toggleInsight)}
          <div className="h-px bg-border my-1" />
          {renderSection("Model Comparison", MODEL_COMP_COLS, modelCompCols, toggleModelCol)}
        </div>
      )}
    </div>
  );
}

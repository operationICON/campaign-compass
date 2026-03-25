import { useState, useEffect, useRef } from "react";
import { Settings2, Lock } from "lucide-react";

export type DashboardKpiCardId =
  | "profit_sub"
  | "ltv_sub"
  | "avg_cpl"
  | "subs_day"
  | "unattributed"
  | "expenses"
  | "avg_expenses"
  | "total_profit"
  | "blended_roi"
  | "active_campaigns"
  | "best_source"
  | "total_ltv";

export type CampaignKpiCardId =
  | "profit_sub"
  | "avg_cpl"
  | "total_expenses"
  | "total_profit"
  | "active_campaigns"
  | "untagged"
  | "avg_cvr"
  | "best_source_roi"
  | "best_source_profit_sub"
  | "most_profitable_source"
  | "worst_source"
  | "avg_expenses_per_campaign"
  | "blended_roi";

export type AnyKpiCardId = DashboardKpiCardId | CampaignKpiCardId;

const DEFAULT_STORAGE_KEY = "dashboard_kpi_cards";

interface CardDef<T extends string = string> {
  id: T;
  label: string;
  alwaysOn?: boolean;
  defaultOn?: boolean;
}

const DASHBOARD_ALWAYS_ON: DashboardKpiCardId[] = ["profit_sub", "ltv_sub"];

const DASHBOARD_CARDS: CardDef<DashboardKpiCardId>[] = [
  { id: "profit_sub", label: "Profit/Sub", alwaysOn: true },
  { id: "ltv_sub", label: "LTV/Sub", alwaysOn: true },
  { id: "avg_cpl", label: "Avg CPL", defaultOn: true },
  { id: "subs_day", label: "Subs/Day", defaultOn: true },
  { id: "unattributed", label: "Unattributed Subs %", defaultOn: true },
  { id: "expenses", label: "Expenses", defaultOn: false },
  { id: "avg_expenses", label: "Avg Expenses", defaultOn: false },
  { id: "total_profit", label: "Total Profit", defaultOn: false },
  { id: "blended_roi", label: "Blended ROI", defaultOn: false },
  { id: "active_campaigns", label: "Active Campaigns", defaultOn: false },
  { id: "best_source", label: "Best Source", defaultOn: false },
  { id: "total_ltv", label: "Total LTV", defaultOn: false },
];

const CAMPAIGN_ALWAYS_ON: CampaignKpiCardId[] = ["profit_sub", "avg_cpl"];

const CAMPAIGN_CARDS: CardDef<CampaignKpiCardId>[] = [
  { id: "profit_sub", label: "Profit/Sub", alwaysOn: true },
  { id: "avg_cpl", label: "Avg CPL", alwaysOn: true },
  { id: "total_expenses", label: "Total Expenses", defaultOn: true },
  { id: "total_profit", label: "Total Profit", defaultOn: true },
  { id: "active_campaigns", label: "Active Campaigns", defaultOn: true },
  { id: "untagged", label: "Untagged", defaultOn: true },
  { id: "avg_cvr", label: "Avg CVR", defaultOn: false },
  { id: "best_source_roi", label: "Best Source by ROI", defaultOn: false },
  { id: "best_source_profit_sub", label: "Best Source by Profit/Sub", defaultOn: false },
  { id: "most_profitable_source", label: "Most Profitable Source", defaultOn: false },
  { id: "worst_source", label: "Worst Source", defaultOn: false },
  { id: "avg_expenses_per_campaign", label: "Avg Expenses per Campaign", defaultOn: false },
  { id: "blended_roi", label: "Blended ROI", defaultOn: false },
];

type CardVariant = "dashboard" | "campaigns";

function getCardConfig(variant: CardVariant) {
  if (variant === "campaigns") return { cards: CAMPAIGN_CARDS, alwaysOn: CAMPAIGN_ALWAYS_ON as string[] };
  return { cards: DASHBOARD_CARDS, alwaysOn: DASHBOARD_ALWAYS_ON as string[] };
}

function getDefaults(): DashboardKpiCardId[] {
  return ALL_CARDS.filter(c => c.alwaysOn || c.defaultOn).map(c => c.id);
}

function loadEnabledCards(storageKey: string): DashboardKpiCardId[] {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as DashboardKpiCardId[];
      const set = new Set(parsed);
      ALWAYS_ON.forEach(id => set.add(id));
      return [...set];
    }
  } catch {}
  return getDefaults();
}

function saveEnabledCards(storageKey: string, cards: DashboardKpiCardId[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(cards)); } catch {}
}

export function useKpiCardVisibility(storageKey: string = DEFAULT_STORAGE_KEY) {
  const [enabledCards, setEnabledCards] = useState<DashboardKpiCardId[]>(() => loadEnabledCards(storageKey));

  const toggleCard = (id: DashboardKpiCardId) => {
    if (ALWAYS_ON.includes(id)) return;
    setEnabledCards(prev => {
      let next: DashboardKpiCardId[];
      if (prev.includes(id)) {
        next = prev.filter(c => c !== id);
      } else {
        next = [...prev, id];
      }
      saveEnabledCards(storageKey, next);
      return next;
    });
  };

  const isVisible = (id: DashboardKpiCardId) => enabledCards.includes(id);

  return { enabledCards, toggleCard, isVisible };
}

export function KpiCardCustomizer({
  enabledCards,
  toggleCard,
}: {
  enabledCards: DashboardKpiCardId[];
  toggleCard: (id: DashboardKpiCardId) => void;
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
        <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-card border border-border rounded-lg shadow-lg py-1.5 max-h-80 overflow-y-auto">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">KPI Cards</p>
          {ALL_CARDS.map(c => (
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
                  checked={enabledCards.includes(c.id)}
                  onChange={() => toggleCard(c.id)}
                  className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-[hsl(var(--primary))]"
                />
              )}
              <span className="text-[11px] text-foreground">{c.label}</span>
              {c.alwaysOn && <span className="text-[9px] text-muted-foreground ml-auto">Always on</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

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

const STORAGE_KEY = "dashboard_kpi_cards";

const ALWAYS_ON: DashboardKpiCardId[] = ["profit_sub", "ltv_sub"];

interface CardDef {
  id: DashboardKpiCardId;
  label: string;
  alwaysOn?: boolean;
  defaultOn?: boolean;
}

const ALL_CARDS: CardDef[] = [
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

function getDefaults(): DashboardKpiCardId[] {
  return ALL_CARDS.filter(c => c.alwaysOn || c.defaultOn).map(c => c.id);
}

function loadEnabledCards(): DashboardKpiCardId[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DashboardKpiCardId[];
      // Ensure always-on cards are included
      const set = new Set(parsed);
      ALWAYS_ON.forEach(id => set.add(id));
      return [...set];
    }
  } catch {}
  return getDefaults();
}

function saveEnabledCards(cards: DashboardKpiCardId[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cards)); } catch {}
}

export function useKpiCardVisibility() {
  const [enabledCards, setEnabledCards] = useState<DashboardKpiCardId[]>(loadEnabledCards);

  const toggleCard = (id: DashboardKpiCardId) => {
    if (ALWAYS_ON.includes(id)) return;
    setEnabledCards(prev => {
      let next: DashboardKpiCardId[];
      if (prev.includes(id)) {
        next = prev.filter(c => c !== id);
      } else {
        next = [...prev, id];
      }
      saveEnabledCards(next);
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

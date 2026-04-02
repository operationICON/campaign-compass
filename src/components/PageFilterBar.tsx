import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { TIME_PERIODS, type TimePeriod } from "@/hooks/usePageFilters";

interface PageFilterBarProps {
  timePeriod: TimePeriod;
  onTimePeriodChange: (tp: TimePeriod) => void;
  customRange: { from: Date; to: Date } | null;
  onCustomRangeChange: (range: { from: Date; to: Date } | null) => void;
  modelFilter: string;
  onModelFilterChange: (v: string) => void;
  accounts: { id: string; username: string; display_name: string; avatar_thumb_url?: string | null }[];
}

export function PageFilterBar({
  timePeriod,
  onTimePeriodChange,
  customRange,
  onCustomRangeChange,
  modelFilter,
  onModelFilterChange,
  accounts,
}: PageFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <AccountFilterDropdown
        value={modelFilter}
        onChange={onModelFilterChange}
        accounts={accounts}
      />

      <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden">
        {TIME_PERIODS.map((tp) => (
          <button
            key={tp.key}
            onClick={() => {
              onTimePeriodChange(tp.key);
              onCustomRangeChange(null);
            }}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              timePeriod === tp.key && !customRange
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tp.label}
          </button>
        ))}
      </div>

      <DateRangePicker
        value={customRange}
        onChange={(range) => onCustomRangeChange(range)}
      />
    </div>
  );
}

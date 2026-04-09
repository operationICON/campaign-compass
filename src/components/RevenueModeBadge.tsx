import type { RevenueMode } from "@/hooks/usePageFilters";

interface RevenueModeBadgeProps {
  mode: RevenueMode;
}

export function RevenueModeBadge({ mode }: RevenueModeBadgeProps) {
  if (mode === "net") {
    return (
      <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary/15 text-primary">
        NET
      </span>
    );
  }
  return (
    <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-muted text-muted-foreground">
      GROSS
    </span>
  );
}

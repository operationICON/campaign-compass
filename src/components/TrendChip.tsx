import { ArrowDown, ArrowUp } from "lucide-react";

/**
 * TrendChip — green ▲ for growth, red ▼ for decline.
 * `reverse` flips good/bad coloring (for cost-style metrics like CPL/CPC).
 */
export function TrendChip({
  value,
  reverse = false,
  size = "xs",
}: {
  value: number | null;
  reverse?: boolean;
  size?: "xs" | "sm";
}) {
  if (value === null || !isFinite(value)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const up = value > 0;
  const isGood = reverse ? !up : up;
  const cls = isGood ? "text-emerald-500" : "text-destructive";
  const Icon = up ? ArrowUp : ArrowDown;
  const fontSize = size === "sm" ? "text-[11px]" : "text-[10px]";
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${fontSize} ${cls}`}>
      <Icon className={size === "sm" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

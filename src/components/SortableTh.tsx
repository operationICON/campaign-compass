import { ChevronDown, ChevronUp } from "lucide-react";

interface Props<K extends string> {
  label: string;
  sortKey: K;
  activeKey: K;
  asc: boolean;
  onSort: (k: K) => void;
  align?: "left" | "right" | "center";
  className?: string;
  /** Inline styles forwarded to the th (for sticky tables that already use style props). */
  style?: React.CSSProperties;
  /** Optional icon/element rendered before the label (e.g. info badge). */
  prefix?: React.ReactNode;
}

/**
 * Reusable sortable <th> for plain HTML `<table>` headers.
 * Click toggles direction when the header is already active; otherwise activates DESC by default.
 *
 * The same affordance pattern as CampaignsPage SortHeader: dimmed chevron when inactive,
 * primary-tinted chevron up/down when active.
 */
export function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  asc,
  onSort,
  align = "left",
  className = "",
  style,
  prefix,
}: Props<K>) {
  const isActive = activeKey === sortKey;
  const alignCls =
    align === "right" ? "text-right justify-end" : align === "center" ? "text-center justify-center" : "text-left justify-start";

  return (
    <th
      onClick={() => onSort(sortKey)}
      style={style}
      className={`cursor-pointer select-none hover:text-foreground transition-colors ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${alignCls}`}>
        {prefix}
        <span>{label}</span>
        {isActive ? (
          asc ? (
            <ChevronUp className="h-3 w-3 text-primary" />
          ) : (
            <ChevronDown className="h-3 w-3 text-primary" />
          )
        ) : (
          <ChevronDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

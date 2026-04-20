import React from "react";

export type LinkActivityFilterValue = "all" | "active" | "inactive";

interface Props {
  value: LinkActivityFilterValue;
  onChange: (v: LinkActivityFilterValue) => void;
  totalCount: number;
  activeCount: number;
  className?: string;
}

/**
 * Shared "All links / Active / Inactive" filter bar used across every
 * tracking-links table. Active = >= 1 sub/day over last 5 days
 * (delta from cumulative daily_snapshots — see useActiveLinkStatus).
 */
export function LinkActivityFilter({
  value,
  onChange,
  totalCount,
  activeCount,
  className = "",
}: Props) {
  const inactiveCount = Math.max(0, totalCount - activeCount);
  const buttons: { key: LinkActivityFilterValue; label: string }[] = [
    { key: "all", label: `All links (${totalCount})` },
    { key: "active", label: `Active (${activeCount})` },
    { key: "inactive", label: `Inactive (${inactiveCount})` },
  ];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {buttons.map((b) => {
        const selected = value === b.key;
        return (
          <button
            key={b.key}
            onClick={() => onChange(b.key)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
              selected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary/50 dark:bg-secondary text-foreground/80 border-border hover:bg-secondary"
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

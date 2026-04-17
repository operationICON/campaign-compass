interface Props {
  show: boolean;
  className?: string;
}

/**
 * Muted banner shown below date filter pills when a date filter is active.
 * Warns users that period revenue is from daily snapshots; All Time = full accuracy.
 */
export function SnapshotAccuracyNote({ show, className }: Props) {
  if (!show) return null;
  return (
    <p
      className={`text-muted-foreground ${className ?? ""}`}
      style={{ fontSize: 11 }}
    >
      ⓘ Revenue shown for selected period uses daily snapshot data. For full revenue accuracy, use All Time view.
    </p>
  );
}

import { format } from "date-fns";

interface Props {
  earliestSnapshotDate: string | null;
  className?: string;
}

/**
 * Small muted note displayed below date filter pills.
 * Shows the earliest snapshot date so users know the data window.
 */
export function DateAvailabilityNote({ earliestSnapshotDate, className }: Props) {
  if (!earliestSnapshotDate) return null;
  let label: string;
  try {
    label = format(new Date(earliestSnapshotDate + "T00:00:00Z"), "MMM d, yyyy");
  } catch {
    label = earliestSnapshotDate;
  }
  return (
    <p
      className={`text-muted-foreground ${className ?? ""}`}
      style={{ fontSize: 11 }}
    >
      Data available from {label} · All Time figures cover full history
    </p>
  );
}

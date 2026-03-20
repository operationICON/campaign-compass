import { differenceInDays } from "date-fns";
import { format } from "date-fns";

interface CampaignAgePillProps {
  createdAt: string | null;
  lastActivityAt?: string | null;
  clicks?: number;
  revenue?: number;
}

function getAgeBadge(days: number): { label: string; color: string } {
  if (days <= 30) return { label: "New", color: "bg-primary/15 text-primary" };
  if (days <= 90) return { label: "Active", color: "bg-info/15 text-info" };
  if (days <= 180) return { label: "Mature", color: "bg-warning/15 text-warning" };
  return { label: "Old", color: "bg-muted text-muted-foreground" };
}

export function CampaignAgePill({ createdAt, lastActivityAt, clicks = 0, revenue = 0 }: CampaignAgePillProps) {
  if (!createdAt) return <span className="text-muted-foreground text-xs">—</span>;

  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return <span className="text-muted-foreground text-xs">—</span>;

  const daysOld = differenceInDays(new Date(), created);
  const age = getAgeBadge(daysOld);

  // Activity dot: green if had clicks in last 30 days
  const lastAct = lastActivityAt ? new Date(lastActivityAt) : null;
  const daysSinceActivity = lastAct && !isNaN(lastAct.getTime())
    ? differenceInDays(new Date(), lastAct)
    : (clicks > 0 || revenue > 0 ? 0 : 999);
  const isRecentlyActive = daysSinceActivity <= 30;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRecentlyActive ? "bg-primary" : "bg-muted-foreground/40"}`} />
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {format(created, "MMM d, yyyy")}
        </span>
      </div>
      <div className="flex items-center gap-1.5 ml-3">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${age.color}`}>
          {daysOld}d · {age.label}
        </span>
      </div>
    </div>
  );
}

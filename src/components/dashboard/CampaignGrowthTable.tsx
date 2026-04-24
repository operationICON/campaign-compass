import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange } from "@/lib/api";
import { differenceInDays } from "date-fns";

interface Snap {
  snapshot_date: string;
  subscribers: number;
  clicks: number;
}

type PeriodKey = "last_sync" | "7d" | "14d" | "30d";

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: "last_sync", label: "Last Sync", days: null },
  { key: "7d",        label: "7 Days",    days: 7   },
  { key: "14d",       label: "2 Weeks",   days: 14  },
  { key: "30d",       label: "30 Days",   days: 30  },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface PeriodStats {
  subs: number;
  clicks: number;
  days: number;
  actualDays: number;
  hasData: boolean;
  date?: string;
}

function computePeriod(snaps: Snap[], key: PeriodKey): PeriodStats {
  const empty: PeriodStats = { subs: 0, clicks: 0, days: 0, actualDays: 0, hasData: false };
  if (!snaps.length) return empty;

  const sorted = [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const latest = sorted[sorted.length - 1];

  if (key === "last_sync") {
    return {
      subs: Math.max(0, latest.subscribers),
      clicks: Math.max(0, latest.clicks),
      days: 1,
      actualDays: 1,
      hasData: true,
      date: latest.snapshot_date,
    };
  }

  const periodDays = key === "7d" ? 7 : key === "14d" ? 14 : 30;
  const cutoff = isoDaysAgo(periodDays);
  const inWindow = sorted.filter(s => s.snapshot_date >= cutoff);
  const source = inWindow.length ? inWindow : (sorted.length >= 2 ? sorted : null);
  if (!source) return empty;

  return {
    subs: source.reduce((s, r) => s + Math.max(0, r.subscribers), 0),
    clicks: source.reduce((s, r) => s + Math.max(0, r.clicks), 0),
    days: periodDays,
    actualDays: inWindow.length,
    hasData: true,
  };
}

function PeriodCard({
  label, stats, lifetimeCvr, isLastSync, periodDays,
}: {
  label: string;
  stats: PeriodStats;
  lifetimeCvr: number | null;
  isLastSync: boolean;
  periodDays: number | null;
}) {
  const subsPerDay = stats.actualDays > 0 ? stats.subs / stats.actualDays : 0;
  const cvr = stats.clicks > 0 ? (stats.subs / stats.clicks) * 100 : null;
  const hasActivity = stats.subs > 0 || stats.clicks > 0;

  const daysSinceSync = stats.date
    ? differenceInDays(new Date(), new Date(stats.date + "T00:00:00Z"))
    : null;

  const isPartial = !isLastSync && periodDays != null && stats.actualDays < periodDays;

  return (
    <div className="rounded-xl border border-border overflow-hidden flex flex-col" style={{ background: "#0D1117" }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {isLastSync && stats.date && (
            <span className="text-[9px] text-muted-foreground/50 font-mono">
              {daysSinceSync === 0
                ? "today"
                : daysSinceSync === 1
                ? "yesterday"
                : `${daysSinceSync}d ago`}
            </span>
          )}
          {!isLastSync && periodDays != null && stats.hasData && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md border ${
              isPartial
                ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
                : "text-muted-foreground/40 bg-transparent border-transparent"
            }`}>
              {stats.actualDays}/{periodDays}d
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-3 flex flex-col gap-2.5 flex-1">
        {!stats.hasData ? (
          <p className="text-[11px] text-muted-foreground/40 italic text-center py-3">No data</p>
        ) : (
          <>
            {/* Subs + Per Day side by side */}
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">New Subs</p>
                <span className={`text-3xl font-bold font-mono tabular-nums leading-none ${
                  stats.subs > 0 ? "text-emerald-400" : "text-muted-foreground/25"
                }`}>
                  +{stats.subs}
                </span>
              </div>
              <div className="text-right pb-0.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Per Day</p>
                <span className="text-[15px] font-mono font-semibold text-muted-foreground tabular-nums">
                  {subsPerDay < 1 ? subsPerDay.toFixed(2) : subsPerDay.toFixed(1)}
                </span>
              </div>
            </div>

            <div className="border-t border-border/30" />

            {/* Clicks + CVR */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/70">Clicks</span>
                <span className={`text-[12px] font-mono font-semibold tabular-nums ${
                  stats.clicks > 0 ? "text-foreground" : "text-muted-foreground/25"
                }`}>
                  {stats.clicks > 0 ? stats.clicks.toLocaleString() : "—"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/70">CVR</span>
                {cvr != null ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-mono font-semibold text-foreground tabular-nums">
                      {cvr.toFixed(1)}%
                    </span>
                    {lifetimeCvr != null && Math.abs(cvr - lifetimeCvr) > 0.5 && (
                      <span className={`text-[9px] font-bold ${cvr > lifetimeCvr ? "text-emerald-400" : "text-amber-400"}`}>
                        {cvr > lifetimeCvr ? "↑" : "↓"}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[12px] text-muted-foreground/25">—</span>
                )}
              </div>
            </div>

            {isLastSync && !hasActivity && (
              <p className="text-[10px] text-muted-foreground/40 italic">No activity this sync</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function CampaignGrowthTable({
  trackingLinkId,
  lifetimeClicks,
  lifetimeSubs,
  lifetimeRevenue,
}: {
  trackingLinkId: string;
  lifetimeClicks: number;
  lifetimeSubs: number;
  lifetimeRevenue?: number;
}) {
  const { data: snaps = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots_growth_table", trackingLinkId],
    queryFn: async (): Promise<Snap[]> => {
      const rows = await getSnapshotsByDateRange({ tracking_link_ids: [trackingLinkId] });
      return (rows || []).map((r: any) => ({
        snapshot_date: r.snapshot_date,
        subscribers: Number(r.subscribers || 0),
        clicks: Number(r.clicks || 0),
      }));
    },
    enabled: !!trackingLinkId,
  });

  const lifetimeCvr =
    lifetimeClicks > 0 && lifetimeSubs > 0 ? (lifetimeSubs / lifetimeClicks) * 100 : null;

  const stats: Record<PeriodKey, PeriodStats> = {
    last_sync: computePeriod(snaps, "last_sync"),
    "7d":      computePeriod(snaps, "7d"),
    "14d":     computePeriod(snaps, "14d"),
    "30d":     computePeriod(snaps, "30d"),
  };

  return (
    <div className="px-6 py-4 border-t border-border">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Growth
        </span>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {lifetimeRevenue != null && lifetimeRevenue > 0 && (
            <span>
              Revenue:{" "}
              <span className="font-mono font-semibold text-primary">
                ${lifetimeRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </span>
          )}
          <span>
            All-time:{" "}
            <span className="font-mono font-semibold text-foreground">
              {lifetimeSubs.toLocaleString()} subs
            </span>
            {" · "}
            <span className="font-mono font-semibold text-foreground">
              {lifetimeClicks.toLocaleString()} clicks
            </span>
          </span>
        </div>
      </div>

      {/* Period cards */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-2">
          {PERIODS.map(p => (
            <div key={p.key} className="rounded-xl border border-border h-[148px] animate-pulse" style={{ background: "#0D1117" }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {PERIODS.map(p => (
            <PeriodCard
              key={p.key}
              label={p.label}
              stats={stats[p.key]}
              lifetimeCvr={lifetimeCvr}
              isLastSync={p.key === "last_sync"}
              periodDays={p.days}
            />
          ))}
        </div>
      )}

      {snaps.length === 0 && !isLoading && (
        <p className="text-[11px] text-muted-foreground/40 text-center mt-2">
          Run a snapshot sync to populate growth data
        </p>
      )}
    </div>
  );
}

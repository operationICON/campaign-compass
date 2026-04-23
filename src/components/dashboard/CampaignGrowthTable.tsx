import { useQuery } from "@tanstack/react-query";
import { getSnapshotsByDateRange } from "@/lib/api";
import { ArrowUp, ArrowDown } from "lucide-react";

interface Snap {
  snapshot_date: string;
  subscribers: number;
  clicks: number;
  revenue: number;
}

type ColKey = "last_sync" | "7d" | "14d" | "30d";
const COLS: { key: ColKey; label: string }[] = [
  { key: "last_sync", label: "Last Sync" },
  { key: "7d", label: "7 Days" },
  { key: "14d", label: "2 Weeks" },
  { key: "30d", label: "30 Days" },
];

const fmtNum = (n: number) => n.toLocaleString("en-US");
const fmtMoney = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function dayDiff(a: string, b: string): number {
  return Math.max(0, Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000
  ));
}

// Use UTC so the cutoff never drifts by timezone
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface PeriodDelta {
  subs: number;
  clicks: number;
  revenue: number;
  days: number;
  hasData: boolean;
}

function computeDelta(snaps: Snap[], col: ColKey): PeriodDelta {
  const empty: PeriodDelta = { subs: 0, clicks: 0, revenue: 0, days: 0, hasData: false };
  if (!snaps.length) return empty;

  const sorted = [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const latest = sorted[sorted.length - 1];

  if (col === "last_sync") {
    // Each row IS the daily increment — the most recent row is the last sync's value
    if (sorted.length < 1) return empty;
    return {
      subs: Math.max(0, latest.subscribers),
      clicks: Math.max(0, latest.clicks),
      revenue: Math.max(0, latest.revenue),
      days: 1,
      hasData: true,
    };
  }

  const periodDays = col === "7d" ? 7 : col === "14d" ? 14 : 30;
  const cutoff = isoDaysAgo(periodDays);

  // Sum all daily incremental values on or after the cutoff date
  const inWindow = sorted.filter(s => s.snapshot_date >= cutoff);

  if (!inWindow.length) {
    // Fallback: link predates the window; sum everything we have
    if (sorted.length < 2) return empty;
    return {
      subs: sorted.reduce((s, r) => s + Math.max(0, r.subscribers), 0),
      clicks: sorted.reduce((s, r) => s + Math.max(0, r.clicks), 0),
      revenue: sorted.reduce((s, r) => s + Math.max(0, r.revenue), 0),
      days: periodDays,
      hasData: true,
    };
  }

  return {
    subs: inWindow.reduce((s, r) => s + Math.max(0, r.subscribers), 0),
    clicks: inWindow.reduce((s, r) => s + Math.max(0, r.clicks), 0),
    revenue: inWindow.reduce((s, r) => s + Math.max(0, r.revenue), 0),
    days: periodDays,
    hasData: true,
  };
}

export function CampaignGrowthTable({
  trackingLinkId,
  lifetimeClicks,
  lifetimeSubs,
}: {
  trackingLinkId: string;
  lifetimeClicks: number;
  lifetimeSubs: number;
}) {
  const { data: snaps = [], isLoading } = useQuery({
    queryKey: ["daily_snapshots_growth_table", trackingLinkId],
    queryFn: async (): Promise<Snap[]> => {
      const rows = await getSnapshotsByDateRange({ tracking_link_ids: [trackingLinkId] });
      return (rows || []).map((r: any) => ({
        snapshot_date: r.snapshot_date,
        subscribers: Number(r.subscribers || 0),
        clicks: Number(r.clicks || 0),
        revenue: Number(r.revenue || 0),
      }));
    },
    enabled: !!trackingLinkId,
  });

  const lifetimeCvr =
    lifetimeClicks > 0 && lifetimeSubs > 0 ? (lifetimeSubs / lifetimeClicks) * 100 : null;

  const deltas: Record<ColKey, PeriodDelta> = {
    last_sync: computeDelta(snaps, "last_sync"),
    "7d": computeDelta(snaps, "7d"),
    "14d": computeDelta(snaps, "14d"),
    "30d": computeDelta(snaps, "30d"),
  };

  const dash = <span className="text-muted-foreground">—</span>;

  const renderSubs = (d: PeriodDelta) =>
    !d.hasData ? dash : (
      <span className={d.subs > 0 ? "text-emerald-400" : "text-foreground"}>{fmtNum(d.subs)}</span>
    );

  const renderSubsPerDay = (d: PeriodDelta) => {
    if (!d.hasData || d.days <= 0) return dash;
    const v = d.subs / d.days;
    return (
      <span className={v >= 1 ? "text-emerald-400" : "text-foreground"}>{v.toFixed(1)}</span>
    );
  };

  const renderRevenue = (d: PeriodDelta) =>
    !d.hasData ? dash : <span className="text-primary">{fmtMoney(d.revenue)}</span>;

  const renderClicks = (d: PeriodDelta) =>
    !d.hasData ? dash : <span className="text-foreground">{fmtNum(d.clicks)}</span>;

  const renderCvr = (d: PeriodDelta) => {
    if (!d.hasData || d.clicks <= 0) return dash;
    const v = (d.subs / d.clicks) * 100;
    let chip: React.ReactNode = null;
    if (lifetimeCvr != null) {
      if (v > lifetimeCvr) {
        chip = <ArrowUp className="inline h-3 w-3 text-emerald-400 ml-0.5" />;
      } else if (v < lifetimeCvr) {
        chip = <ArrowDown className="inline h-3 w-3 text-amber-400 ml-0.5" />;
      }
    }
    return (
      <span className="text-foreground">
        {v.toFixed(1)}%{chip}
      </span>
    );
  };

  const rows: { label: string; render: (d: PeriodDelta) => React.ReactNode }[] = [
    { label: "Subs Gained", render: renderSubs },
    { label: "Subs/Day", render: renderSubsPerDay },
    { label: "Revenue", render: renderRevenue },
    { label: "Clicks", render: renderClicks },
    { label: "CVR", render: renderCvr },
  ];

  return (
    <div className="px-6 py-4 border-t border-border">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Growth
      </h3>
      <div className="rounded-lg border border-border overflow-hidden" style={{ background: "#0D1117" }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-[160px]">
                Metric
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={COLS.length + 1}
                  className="text-center py-4 text-[11px] text-muted-foreground border-t border-border"
                >
                  Loading…
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">{row.label}</td>
                  {COLS.map((c) => (
                    <td
                      key={c.key}
                      className="px-3 py-2 text-right text-[12px] font-mono font-semibold tabular-nums"
                    >
                      {row.render(deltas[c.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

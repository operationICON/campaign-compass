import { useMemo, useState } from "react";
import { useTagColors } from "@/components/TagBadge";
import { differenceInDays } from "date-fns";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

interface InsightsSectionProps {
  links: any[];
  accounts: any[];
  dailyMetrics: any[];
  groupFilter: string;
  selectedModel: string;
  getAccountCategory: (account: any) => string;
}

type DecisionStatus = "scale" | "watch" | "kill" | "dead";

const STATUS_CONFIG: Record<DecisionStatus, {
  title: string; rule: string; description: string;
  bg: string; border: string; color: string;
}> = {
  scale: { title: "Scale Now", rule: "ROI > 150%", description: "ROI above 150% — increase budget", bg: "#f0fdf4", border: "#bbf7d0", color: "#16a34a" },
  watch: { title: "Watch", rule: "ROI 50–150%", description: "ROI 50–150% — monitor closely", bg: "#eff6ff", border: "#bfdbfe", color: "#0891b2" },
  kill: { title: "Kill", rule: "Negative ROI", description: "Negative ROI — stop spending", bg: "#fef2f2", border: "#fecaca", color: "#dc2626" },
  dead: { title: "Dead", rule: "0 clicks 3d+", description: "No clicks for 3+ days — review or remove", bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280" },
};

export function InsightsSection({
  links, accounts, dailyMetrics, groupFilter, selectedModel, getAccountCategory,
}: InsightsSectionProps) {
  const colorMap = useTagColors();
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<DecisionStatus | null>(null);

  const filteredAccountIds = useMemo(() => {
    let accts = accounts;
    if (selectedModel !== "all") accts = accts.filter((a: any) => a.id === selectedModel);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);
    return new Set(accts.map((a: any) => a.id));
  }, [accounts, selectedModel, groupFilter, getAccountCategory]);

  const filteredLinks = useMemo(() => links.filter((l: any) => filteredAccountIds.has(l.account_id)), [links, filteredAccountIds]);

  const enriched = useMemo(() => filteredLinks.map((l: any) => {
    const spend = Number(l.cost_total || 0);
    const revenue = Number(l.revenue || 0);
    const profit = spend > 0 ? revenue - spend : null;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
    const profitPerSub = (profit !== null && l.subscribers > 0) ? profit / l.subscribers : null;
    return { ...l, spend, profit, roi, profitPerSub };
  }), [filteredLinks]);

  // ── CARD 1: Top 5 by Profit/Sub ──
  const top5ProfitSub = useMemo(() =>
    enriched.filter((l) => l.profitPerSub !== null && l.spend > 0)
      .sort((a, b) => (b.profitPerSub ?? 0) - (a.profitPerSub ?? 0)).slice(0, 5),
    [enriched]);

  // ── CARD 2: By Source · Profit/Sub ──
  const sourcePerf = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; totalProfit: number; totalSubs: number }> = {};
    enriched.forEach((l) => {
      if (!l.source_tag || l.source_tag === "Untagged" || l.spend <= 0) return;
      if (!map[l.source_tag]) map[l.source_tag] = { source: l.source_tag, campaigns: 0, totalProfit: 0, totalSubs: 0 };
      map[l.source_tag].campaigns++;
      map[l.source_tag].totalProfit += l.profit ?? 0;
      map[l.source_tag].totalSubs += l.subscribers || 0;
    });
    return Object.values(map)
      .map((s) => ({ ...s, profitPerSub: s.totalSubs > 0 ? s.totalProfit / s.totalSubs : null }))
      .sort((a, b) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity)).slice(0, 5);
  }, [enriched]);

  // ── CARD 3: Unattributed Subs ──
  const unattr = useMemo(() => {
    const accts = accounts.filter((a: any) => filteredAccountIds.has(a.id) && a.sync_enabled !== false);
    const totalSubs = accts.reduce((s: number, a: any) => s + (a.subscribers_count || 0), 0);
    const attributed = filteredLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
    const unattributed = Math.max(0, totalSubs - attributed);
    const pct = totalSubs > 0 ? (unattributed / totalSubs) * 100 : 0;
    return { totalSubs, attributed, unattributed, pct };
  }, [accounts, filteredLinks, filteredAccountIds]);

  const unaHealth = unattr.pct <= 30 ? { label: "Healthy", color: "text-[hsl(160_84%_39%)]" }
    : unattr.pct <= 40 ? { label: "Monitor", color: "text-[hsl(38_92%_50%)]" }
    : { label: "Check tracking", color: "text-destructive" };
  const unaPctColor = unattr.pct <= 30 ? "text-[hsl(160_84%_39%)]" : unattr.pct <= 40 ? "text-[hsl(38_92%_50%)]" : "text-destructive";

  // ── CARD 4: Subs/Day per model ──
  const MODEL_COLORS: Record<string, string> = {
    "jessie_ca_xo": "#0891b2", "zoey.skyy": "#7c3aed",
    "miakitty.ts": "#ec4899", "ella_cherryy": "#f59e0b", "aylin_bigts": "#ef4444",
  };

  const subsPerDay = useMemo(() => {
    const enabledAccounts = accounts.filter((a: any) => a.sync_enabled !== false && filteredAccountIds.has(a.id));
    return enabledAccounts.map((acc: any) => {
      const accMetrics = dailyMetrics
        .filter((m: any) => m.account_id === acc.id)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (accMetrics.length < 2) return { name: acc.display_name, username: acc.username, value: null };
      const latest = accMetrics[0];
      const prev = accMetrics[1];
      const days = Math.max(1, differenceInDays(new Date(latest.date), new Date(prev.date)));
      const delta = (latest.subscribers || 0) - (prev.subscribers || 0);
      return { name: acc.display_name, username: acc.username, value: delta / days };
    });
  }, [accounts, dailyMetrics, filteredAccountIds]);

  const maxSubsDay = Math.max(1, ...subsPerDay.map((s) => Math.abs(s.value ?? 0)));

  // ── Campaign Decision counts ──
  const decisionCounts = useMemo(() => ({
    scale: enriched.filter((l) => l.roi !== null && l.roi > 150 && (l.profit ?? 0) > 0 && l.spend > 0),
    watch: enriched.filter((l) => l.roi !== null && l.roi >= 50 && l.roi <= 150 && (l.profit ?? 0) > 0 && l.spend > 0),
    kill: enriched.filter((l) => l.roi !== null && l.roi < 0 && l.spend > 0),
    dead: enriched.filter((l) => l.status === "DEAD" || l.status === "Dead"),
  }), [enriched]);

  // Full sorted lists for panel (no limit)
  const panelData = useMemo(() => {
    if (!activePanel) return [];
    const lists: Record<DecisionStatus, any[]> = {
      scale: enriched.filter((l) => l.roi !== null && l.roi > 150 && (l.profit ?? 0) > 0 && l.spend > 0).sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0)),
      watch: enriched.filter((l) => l.roi !== null && l.roi >= 50 && l.roi <= 150 && (l.profit ?? 0) > 0 && l.spend > 0).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)),
      kill: enriched.filter((l) => l.roi !== null && l.roi < 0 && l.spend > 0).sort((a, b) => (a.roi ?? 0) - (b.roi ?? 0)),
      dead: enriched.filter((l) => l.status === "DEAD" || l.status === "Dead").sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    };
    return lists[activePanel];
  }, [activePanel, enriched]);

  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const activeCfg = activePanel ? STATUS_CONFIG[activePanel] : null;

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-2.5">Insights</p>

      {/* ── ROW 1: 4 equal cards ── */}
      <div className="grid grid-cols-4 gap-2.5">
        {/* CARD 1 — Top 5 by Profit/Sub */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium">Top 5 · Profit/Sub</p>
            <p className="text-[10px] text-muted-foreground">Attributed only</p>
          </div>
          {top5ProfitSub.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">Enter spend on campaigns to see top performers</p>
          ) : (
            <div className="divide-y divide-border">
              {top5ProfitSub.map((l, i) => (
                <div key={l.id} className="flex items-start gap-2 py-1.5">
                  <span className="text-[11px] text-muted-foreground min-w-[16px]">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-foreground truncate">{l.campaign_name}</p>
                    <p className="text-[10px] text-muted-foreground">@{l.accounts?.username || "—"}</p>
                  </div>
                  <span className={`text-[12px] font-bold font-mono shrink-0 ${l.profitPerSub >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"}`}>
                    {fmtC(l.profitPerSub)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CARD 2 — By Source · Profit/Sub */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium">By Source · Profit/Sub</p>
            <p className="text-[10px] text-muted-foreground">Tagged campaigns only</p>
          </div>
          {sourcePerf.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">Tag campaigns in Tracking Links to see source performance</p>
          ) : (
            <div className="divide-y divide-border">
              {sourcePerf.map((s) => (
                <div key={s.source} className="flex items-start gap-2 py-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: colorMap[s.source] || "#94a3b8" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-foreground">{s.source}</p>
                    <p className="text-[10px] text-muted-foreground">{s.campaigns} campaign{s.campaigns !== 1 ? "s" : ""}</p>
                  </div>
                  <span className={`text-[12px] font-bold font-mono shrink-0 ${
                    s.profitPerSub === null ? "text-muted-foreground" : s.profitPerSub >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"
                  }`}>
                    {s.profitPerSub !== null ? fmtC(s.profitPerSub) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CARD 3 — Unattributed Subs */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">Unattributed Subs</p>
          <p className={`text-[26px] font-bold font-mono ${unaPctColor}`}>
            {unattr.totalSubs > 0 ? `${unattr.pct.toFixed(1)}%` : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mb-3">Organic + untracked traffic</p>
          <div className="divide-y divide-border text-[11px]">
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">Total account subs</span>
              <span className="font-bold font-mono text-foreground">{unattr.totalSubs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">Via tracking links</span>
              <span className="font-bold font-mono text-primary">{unattr.attributed.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">Unattributed</span>
              <span className="font-bold font-mono text-[hsl(38_92%_50%)]">{unattr.unattributed.toLocaleString()}</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${unattr.pct <= 30 ? "bg-[hsl(160_84%_39%)]" : unattr.pct <= 40 ? "bg-[hsl(38_92%_50%)]" : "bg-destructive"}`} />
            <span className={`text-[11px] font-medium ${unaHealth.color}`}>{unaHealth.label}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">~20% is normal due to OF tracking limits</p>
        </div>

        {/* CARD 4 — Subs/Day per model */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium">Subs/Day · per model</p>
            <p className="text-[10px] text-muted-foreground">Based on last sync delta</p>
          </div>
          <div className="space-y-2.5">
            {subsPerDay.map((m) => {
              const uname = (m.username || "").replace("@", "");
              const barColor = MODEL_COLORS[uname] || "#94a3b8";
              const barWidth = m.value !== null ? Math.max(4, (Math.abs(m.value) / maxSubsDay) * 100) : 0;
              return (
                <div key={m.name} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground min-w-[40px] truncate">{m.name}</span>
                  <div className="flex-1 h-[5px] rounded-[3px] bg-secondary overflow-hidden">
                    {m.value !== null && (
                      <div className="h-full rounded-[3px]" style={{ width: `${barWidth}%`, backgroundColor: barColor }} />
                    )}
                  </div>
                  <span className="text-[11px] font-bold font-mono min-w-[50px] text-right" style={{ color: m.value === null ? "#94a3b8" : m.value < 0 ? "#dc2626" : barColor }}>
                    {m.value !== null ? `${Math.round(m.value)}/day` : "—"}
                  </span>
                </div>
              );
            })}
            {subsPerDay.every((m) => m.value === null) && (
              <p className="text-[10px] text-muted-foreground mt-1">Builds after second sync</p>
            )}
          </div>
        </div>
      </div>

      {/* ── ROW 2: Campaign Decisions — Count Pills ── */}
      <div className="bg-card border border-border rounded-2xl p-4 mt-2.5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium">Campaign Decisions</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(["scale", "watch", "kill", "dead"] as DecisionStatus[]).map((status) => {
            const cfg = STATUS_CONFIG[status];
            const count = decisionCounts[status].length;
            return (
              <button
                key={status}
                onClick={() => setActivePanel(status)}
                className="rounded-2xl p-3.5 text-left cursor-pointer transition-transform duration-150 ease-out hover:scale-[1.02]"
                style={{ backgroundColor: cfg.bg, border: `0.5px solid ${cfg.border}` }}
              >
                <p className="text-[24px] font-bold font-mono" style={{ color: cfg.color }}>{count}</p>
                <p className="text-[11px] font-bold mt-0.5" style={{ color: cfg.color }}>{cfg.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{cfg.rule}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Slide-in Panel ── */}
      {activePanel && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setActivePanel(null)} />

          {/* Panel */}
          <div
            className="fixed top-0 right-0 h-full z-50 bg-card flex flex-col animate-slide-in-right"
            style={{
              width: 480,
              borderLeft: "0.5px solid hsl(var(--border))",
              boxShadow: "-4px 0 12px rgba(0,0,0,0.06)",
            }}
          >
            {/* Panel header */}
            <div className="p-5 pb-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-bold" style={{ color: activeCfg!.color }}>{activeCfg!.title}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${activeCfg!.color}15`, color: activeCfg!.color }}>
                    {panelData.length} campaign{panelData.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button onClick={() => setActivePanel(null)} className="p-1 rounded-lg hover:bg-secondary transition-colors">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{activeCfg!.description}</p>
            </div>

            {/* Panel table */}
            <div className="flex-1 overflow-y-auto p-5">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-2">Campaign</th>
                    <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-2">Model</th>
                    <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-2 text-right">Profit/Sub</th>
                    <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-2 text-right">ROI</th>
                    <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {panelData.map((l) => {
                    const statusBadge = activePanel === "dead"
                      ? { label: "Dead", color: "#6b7280", bg: "#f9fafb" }
                      : activePanel === "scale"
                      ? { label: "Scale", color: "#16a34a", bg: "#f0fdf4" }
                      : activePanel === "watch"
                      ? { label: "Watch", color: "#0891b2", bg: "#eff6ff" }
                      : { label: "Kill", color: "#dc2626", bg: "#fef2f2" };
                    return (
                      <tr key={l.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                        <td className="py-2.5 pr-3">
                          <p className="text-[12px] font-bold text-foreground truncate max-w-[160px]">{l.campaign_name || "—"}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{l.url}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            {l.accounts?.avatar_thumb_url && (
                              <img src={l.accounts.avatar_thumb_url} className="w-5 h-5 rounded-full object-cover" alt="" />
                            )}
                            <span className="text-[11px] text-muted-foreground">@{l.accounts?.username || "—"}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className={`text-[12px] font-bold font-mono ${
                            l.profitPerSub === null ? "text-muted-foreground" : l.profitPerSub >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"
                          }`}>
                            {l.profitPerSub !== null ? fmtC(l.profitPerSub) : "—"}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className={`text-[12px] font-mono ${
                            l.roi === null ? "text-muted-foreground" : l.roi >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"
                          }`}>
                            {l.roi !== null ? `${l.roi.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: statusBadge.bg, color: statusBadge.color }}>
                            {statusBadge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {panelData.length === 0 && (
                <p className="text-[12px] text-muted-foreground text-center py-8">No campaigns in this category</p>
              )}
            </div>

            {/* Panel footer */}
            <div className="p-5 pt-3 border-t border-border shrink-0">
              <button
                onClick={() => { setActivePanel(null); navigate("/tracking-links"); }}
                className="text-[12px] font-medium text-primary hover:underline transition-colors"
              >
                View all in Tracking Links →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

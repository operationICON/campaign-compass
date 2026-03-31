import { useMemo, useState } from "react";
import { useTagColors } from "@/components/TagBadge";
import { differenceInDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Info } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";

interface InsightsSectionProps {
  links: any[];
  accounts: any[];
  dailyMetrics: any[];
  trackingLinkLtv?: any[];
  groupFilter: string;
  selectedModel: string;
  getAccountCategory: (account: any) => string;
  isInsightVisible: (id: string) => boolean;
  isModelColVisible: (id: string) => boolean;
}

const MODEL_COLORS: Record<string, string> = {
  "jessie_ca_xo": "#0891b2", "zoey.skyy": "#7c3aed",
  "miakitty.ts": "#ec4899", "ella_cherryy": "#f59e0b", "aylin_bigts": "#ef4444",
};

export function InsightsSection({
  links, accounts, dailyMetrics, groupFilter, selectedModel, getAccountCategory,
  isInsightVisible, isModelColVisible,
}: InsightsSectionProps) {
  const colorMap = useTagColors();
  const fmtC = (v: number | null | undefined) => `$${(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const filteredAccountIds = useMemo(() => {
    let accts = accounts;
    if (selectedModel !== "all") accts = accts.filter((a: any) => a.id === selectedModel);
    else if (groupFilter !== "all") accts = accts.filter((a: any) => getAccountCategory(a) === groupFilter);
    return new Set(accts.map((a: any) => a.id));
  }, [accounts, selectedModel, groupFilter, getAccountCategory]);

  const filteredLinks = useMemo(() => links.filter((l: any) => filteredAccountIds.has(l.account_id)), [links, filteredAccountIds]);

  const enriched = useMemo(() => filteredLinks.map((l: any) => {
    const spend = Number(l.cost_total || 0);
    const ltvVal = Number(l.ltv || 0);
    const revenue = ltvVal > 0 ? ltvVal : Number(l.revenue || 0);
    const profit = spend > 0 ? revenue - spend : null;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
    const profitPerSub = (profit !== null && l.subscribers > 0) ? profit / l.subscribers : null;
    return { ...l, spend, profit, roi, profitPerSub, effectiveRevenue: revenue };
  }), [filteredLinks]);

  // ── TOP TRACKING LINKS (across ALL accounts, by subscribers desc) ──
  const allEnriched = useMemo(() => links.map((l: any) => {
    const spend = Number(l.cost_total || 0);
    const ltvVal = Number(l.ltv || 0);
    const revenue = ltvVal > 0 ? ltvVal : Number(l.revenue || 0);
    const profit = spend > 0 ? revenue - spend : null;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
    const profitPerSub = (profit !== null && l.subscribers > 0) ? profit / l.subscribers : null;
    return { ...l, spend, profit, roi, profitPerSub, effectiveRevenue: revenue };
  }), [links]);

  const top5 = useMemo(() =>
    allEnriched.filter(l => (l.subscribers || 0) > 0)
      .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0)).slice(0, 3),
    [allEnriched]);

  // ── PERFORMANCE BY SOURCE ──
  const sourcePerf = useMemo(() => {
    const map: Record<string, { source: string; campaigns: number; totalSpend: number; totalProfit: number; totalSubs: number }> = {};
    enriched.forEach(l => {
      if (!l.source_tag || l.source_tag === "Untagged" || l.source_tag.toLowerCase() === "test" || l.spend <= 0) return;
      if (!map[l.source_tag]) map[l.source_tag] = { source: l.source_tag, campaigns: 0, totalSpend: 0, totalProfit: 0, totalSubs: 0 };
      map[l.source_tag].campaigns++;
      map[l.source_tag].totalSpend += l.spend;
      map[l.source_tag].totalProfit += l.profit ?? 0;
      map[l.source_tag].totalSubs += l.subscribers || 0;
    });
    return Object.values(map)
      .map(s => ({ ...s, profitPerSub: s.totalSubs > 0 ? s.totalProfit / s.totalSubs : null }))
      .sort((a, b) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity)).slice(0, 5);
  }, [enriched]);

  // ── SUBS/DAY PER MODEL ──
  const subsPerDay = useMemo(() => {
    const enabledAccts = accounts.filter((a: any) => filteredAccountIds.has(a.id));
    return enabledAccts.map((acc: any) => {
      const accMetrics = dailyMetrics
        .filter((m: any) => m.account_id === acc.id);
      const distinctDates = [...new Set(accMetrics.map((m: any) => m.date))].sort().reverse();
      if (distinctDates.length < 2) return { name: acc.display_name, username: acc.username, value: null };
      const latestDate = distinctDates[0];
      const prevDate = distinctDates[1];
      const latestSubs = accMetrics.filter((m: any) => m.date === latestDate).reduce((s: number, m: any) => s + (m.subscribers || 0), 0);
      const prevSubs = accMetrics.filter((m: any) => m.date === prevDate).reduce((s: number, m: any) => s + (m.subscribers || 0), 0);
      const days = Math.max(1, differenceInDays(new Date(latestDate), new Date(prevDate)));
      const delta = Math.max(0, latestSubs - prevSubs);
      return { name: acc.display_name, username: acc.username, value: delta / days };
    });
  }, [accounts, dailyMetrics, filteredAccountIds]);
  const maxSubsDay = Math.max(1, ...subsPerDay.map(s => Math.abs(s.value ?? 0)));

  // ── ROI BY SOURCE ──
  const roiBySource = useMemo(() => {
    const map: Record<string, { source: string; totalRev: number; totalSpend: number }> = {};
    enriched.forEach(l => {
      if (!l.source_tag || l.source_tag === "Untagged" || l.source_tag.toLowerCase() === "test" || l.spend <= 0) return;
      if (!map[l.source_tag]) map[l.source_tag] = { source: l.source_tag, totalRev: 0, totalSpend: 0 };
      map[l.source_tag].totalRev += l.effectiveRevenue;
      map[l.source_tag].totalSpend += l.spend;
    });
    return Object.values(map)
      .map(s => ({ ...s, roi: s.totalSpend > 0 ? ((s.totalRev - s.totalSpend) / s.totalSpend) * 100 : 0 }))
      .sort((a, b) => b.roi - a.roi);
  }, [enriched]);

  // ── SPEND BY SOURCE ──
  const spendBySource = useMemo(() => {
    const map: Record<string, { source: string; totalSpend: number; campaigns: number }> = {};
    enriched.forEach(l => {
      if (!l.source_tag || l.source_tag === "Untagged" || l.source_tag.toLowerCase() === "test" || l.spend <= 0) return;
      if (!map[l.source_tag]) map[l.source_tag] = { source: l.source_tag, totalSpend: 0, campaigns: 0 };
      map[l.source_tag].totalSpend += l.spend;
      map[l.source_tag].campaigns++;
    });
    return Object.values(map).sort((a, b) => b.totalSpend - a.totalSpend);
  }, [enriched]);

  // ── CPL BY SOURCE ──
  const cplBySource = useMemo(() => {
    const map: Record<string, { source: string; totalSpend: number; totalSubs: number }> = {};
    enriched.forEach(l => {
      if (!l.source_tag || l.source_tag === "Untagged" || l.source_tag.toLowerCase() === "test" || l.spend <= 0) return;
      if (!map[l.source_tag]) map[l.source_tag] = { source: l.source_tag, totalSpend: 0, totalSubs: 0 };
      map[l.source_tag].totalSpend += l.spend;
      map[l.source_tag].totalSubs += l.subscribers || 0;
    });
    return Object.values(map)
      .map(s => ({ ...s, cpl: s.totalSubs > 0 ? s.totalSpend / s.totalSubs : null }))
      .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
  }, [enriched]);

  // ── LTV PER MODEL ──
  const { data: fanCounts = {} } = useQuery({
    queryKey: ["fan_attribution_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fan_attributions").select("account_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => { counts[row.account_id] = (counts[row.account_id] || 0) + 1; });
      return counts;
    },
    staleTime: 60000,
  });

  // ── MODEL COMPARISON ──
  const modelComparison = useMemo(() => {
    const enabledAccts = accounts.filter((a: any) => filteredAccountIds.has(a.id));
    return enabledAccts.map((acc: any) => {
      const accLinks = enriched.filter(l => l.account_id === acc.id);
      const revenue = accLinks.reduce((s: number, l: any) => s + l.effectiveRevenue, 0);
      const ltv = Number(acc.ltv_total || 0);
      const spend = accLinks.reduce((s: number, l: any) => s + l.spend, 0);
      const subs = accLinks.reduce((s: number, l: any) => s + (l.subscribers || 0), 0);
      const profitPerSub = spend > 0 && subs > 0 ? (revenue - spend) / subs : null;
      const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
      // subs/day
      const accMetrics = dailyMetrics.filter((m: any) => m.account_id === acc.id);
      const accDates = [...new Set(accMetrics.map((m: any) => m.date))].sort().reverse();
      let subsDay: number | null = null;
      if (accDates.length >= 2) {
        const latestSubs = accMetrics.filter((m: any) => m.date === accDates[0]).reduce((s: number, m: any) => s + (m.subscribers || 0), 0);
        const prevSubs = accMetrics.filter((m: any) => m.date === accDates[1]).reduce((s: number, m: any) => s + (m.subscribers || 0), 0);
        const days = Math.max(1, differenceInDays(new Date(accDates[0]), new Date(accDates[1])));
        subsDay = Math.max(0, latestSubs - prevSubs) / days;
      }
      return { id: acc.id, name: acc.display_name, username: acc.username, avatar: acc.avatar_thumb_url, revenue, ltv, spend, profitPerSub, roi, subsDay };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [accounts, enriched, dailyMetrics, filteredAccountIds]);

  const visiblePanels: React.ReactNode[] = [];

  // ── PANEL: Top Campaigns ──
  if (isInsightVisible("top_campaigns")) {
    visiblePanels.push(
      <div key="top_campaigns" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">Top Tracking Links</p>
        {top5.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">Enter spend on tracking links to see top performers</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2">Tracking Link</th>
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2">Model</th>
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2">Source</th>
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Profit/Sub</th>
              </tr>
            </thead>
            <tbody>
              {top5.map(l => (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2">
                    <p className="text-[12px] font-bold text-foreground truncate max-w-[140px]">{l.campaign_name || "—"}</p>
                  </td>
                  <td className="py-1.5 pr-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <ModelAvatar avatarUrl={l.accounts?.avatar_thumb_url} name={l.accounts?.username || l.accounts?.display_name || "?"} size={24} />
                      <span>@{l.accounts?.username || "—"}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    {l.source_tag ? (
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorMap[l.source_tag] || "#94a3b8" }} />
                        {l.source_tag}
                      </span>
                    ) : <span className="text-[11px] text-muted-foreground">—</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    <span className={`text-[12px] font-bold font-mono ${(l.profitPerSub ?? 0) >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"}`}>
                      {fmtC(l.profitPerSub!)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // ── PANEL: Performance by Source ──
  if (isInsightVisible("perf_by_source")) {
    visiblePanels.push(
      <div key="perf_by_source" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">Performance by Source</p>
        {sourcePerf.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">Tag tracking links to see source performance</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2">Source</th>
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Links</th>
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Spend</th>
                <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Profit/Sub</th>
              </tr>
            </thead>
            <tbody>
              {sourcePerf.map(s => (
                <tr key={s.source} className="border-b border-border/50">
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-foreground">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorMap[s.source] || "#94a3b8" }} />
                      {s.source}
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-[11px] text-muted-foreground">{s.campaigns}</td>
                  <td className="py-1.5 text-right text-[11px] font-mono text-muted-foreground">{fmtC(s.totalSpend)}</td>
                  <td className="py-1.5 text-right">
                    <span className={`text-[12px] font-bold font-mono ${
                      s.profitPerSub === null ? "text-muted-foreground" : s.profitPerSub >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"
                    }`}>
                      {s.profitPerSub !== null ? fmtC(s.profitPerSub) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // ── PANEL: Subs/Day per Model ──
  if (isInsightVisible("subs_day_model")) {
    visiblePanels.push(
      <div key="subs_day_model" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">Subs/Day per Model</p>
        <div className="space-y-2.5">
          {subsPerDay.map(m => {
            const uname = (m.username || "").replace("@", "");
            const barColor = MODEL_COLORS[uname] || "#94a3b8";
            const barWidth = m.value !== null ? Math.max(4, (Math.abs(m.value) / maxSubsDay) * 100) : 0;
            return (
              <div key={m.name} className="flex items-center gap-2">
                <ModelAvatar avatarUrl={accounts.find((a: any) => a.display_name === m.name)?.avatar_thumb_url} name={m.name} size={24} />
                <span className="text-[11px] text-muted-foreground min-w-[50px] truncate">{m.name}</span>
                <div className="flex-1 h-[5px] rounded-[3px] bg-secondary overflow-hidden">
                  {m.value !== null && <div className="h-full rounded-[3px]" style={{ width: `${barWidth}%`, backgroundColor: barColor }} />}
                </div>
                <span className="text-[11px] font-bold font-mono min-w-[50px] text-right" style={{ color: m.value === null ? "#94a3b8" : barColor }} title={m.value === null ? "Needs 2+ syncs to calculate" : undefined}>
                  {m.value !== null ? `${Math.round(m.value)}/day` : "---"}
                </span>
              </div>
            );
          })}
          {subsPerDay.every(m => m.value === null) && <p className="text-[10px] text-muted-foreground">Builds after second sync</p>}
        </div>
      </div>
    );
  }

  // ── PANEL: ROI by Source ──
  if (isInsightVisible("roi_by_source")) {
    visiblePanels.push(
      <div key="roi_by_source" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">ROI by Source</p>
        {roiBySource.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No source data</p>
        ) : (
          <div className="space-y-2">
            {roiBySource.map(s => (
              <div key={s.source} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorMap[s.source] || "#94a3b8" }} />
                <span className="text-[12px] text-foreground flex-1 truncate">{s.source}</span>
                <span className={`text-[12px] font-bold font-mono ${s.roi >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"}`}>
                  {s.roi.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── PANEL: Spend by Source ──
  if (isInsightVisible("spend_by_source")) {
    visiblePanels.push(
      <div key="spend_by_source" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">Spend by Source</p>
        {spendBySource.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No spend data</p>
        ) : (
          <div className="space-y-2">
            {spendBySource.map(s => (
              <div key={s.source} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorMap[s.source] || "#94a3b8" }} />
                <span className="text-[12px] text-foreground flex-1 truncate">{s.source}</span>
                <span className="text-[11px] text-muted-foreground">{s.campaigns}c</span>
                <span className="text-[12px] font-bold font-mono text-foreground">{fmtC(s.totalSpend)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── PANEL: LTV per Model ──
  if (isInsightVisible("ltv_per_model")) {
    const filteredAccts = accounts.filter((a: any) => filteredAccountIds.has(a.id));
    const sorted = [...filteredAccts].sort((a: any, b: any) => (b.ltv_last_30d ?? 0) - (a.ltv_last_30d ?? 0));
    visiblePanels.push(
      <div key="ltv_per_model" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">LTV per Model (30D)</p>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No models</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((acc: any) => {
              const hasFan = (fanCounts as Record<string, number>)[acc.id] > 0;
              return (
                <div key={acc.id} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                    {acc.avatar_thumb_url ? <img src={acc.avatar_thumb_url} className="w-full h-full object-cover rounded-full" alt="" /> : <span className="text-[9px] font-bold text-muted-foreground">{(acc.display_name || "?")[0]}</span>}
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate flex-1">@{acc.username || acc.display_name}</span>
                  <span className={`text-[12px] font-bold font-mono ${hasFan && acc.ltv_last_30d > 0 ? "text-[#0891b2]" : "text-muted-foreground"}`}>
                    {hasFan ? (acc.ltv_last_30d > 0 ? fmtC(acc.ltv_last_30d) : "$0") : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── PANEL: CPL by Source ──
  if (isInsightVisible("cpl_by_source")) {
    visiblePanels.push(
      <div key="cpl_by_source" className="bg-card border border-border rounded-2xl p-4 flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mb-3">CPL by Source</p>
        {cplBySource.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No source data</p>
        ) : (
          <div className="space-y-2">
            {cplBySource.map(s => (
              <div key={s.source} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorMap[s.source] || "#94a3b8" }} />
                <span className="text-[12px] text-foreground flex-1 truncate">{s.source}</span>
                <span className="text-[12px] font-bold font-mono text-foreground">
                  {s.cpl !== null ? fmtC(s.cpl) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Split into rows of 3
  const insightRows: React.ReactNode[][] = [];
  for (let i = 0; i < visiblePanels.length; i += 3) {
    insightRows.push(visiblePanels.slice(i, i + 3));
  }

  return (
    <div className="space-y-4">
      {/* Insights label */}
      <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium">Insights</p>

      {/* Insight panels in rows of 3 */}
      {insightRows.map((row, i) => (
        <div key={i} className="flex gap-2.5">
          {row}
          {/* Fill remaining space if less than 3 */}
          {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, j) => <div key={`spacer-${j}`} className="flex-1 min-w-0" />)}
        </div>
      ))}

      {/* Model Comparison section */}
      {isInsightVisible("model_comparison") && (
        <>
          <p className="text-[11px] uppercase tracking-[0.07em] text-muted-foreground font-medium mt-2">Model Comparison</p>
          <div className="bg-card border border-border rounded-2xl p-4">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2">Model</th>
                  <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Revenue</th>
                  <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">LTV</th>
                  <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Spend</th>
                  <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Profit/Sub</th>
                  {isModelColVisible("roi") && <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">ROI</th>}
                  {isModelColVisible("subs_day") && <th className="text-[10px] uppercase text-muted-foreground font-medium pb-2 text-right">Subs/Day</th>}
                </tr>
              </thead>
              <tbody>
                {modelComparison.map(m => (
                  <tr key={m.id} className="border-b border-border/50">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                          {m.avatar ? <img src={m.avatar} className="w-full h-full object-cover rounded-full" alt="" /> : <span className="text-[9px] font-bold text-muted-foreground">{(m.name || "?")[0]}</span>}
                        </div>
                        <span className="text-[12px] font-bold text-foreground">{m.name}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right text-[12px] font-mono text-foreground">{fmtC(m.revenue)}</td>
                    <td className="py-2 text-right text-[12px] font-mono text-[#0891b2]">{m.ltv > 0 ? fmtC(m.ltv) : "—"}</td>
                    <td className="py-2 text-right text-[12px] font-mono text-muted-foreground">{m.spend > 0 ? fmtC(m.spend) : "—"}</td>
                    <td className="py-2 text-right">
                      <span className={`text-[12px] font-bold font-mono ${
                        m.profitPerSub === null ? "text-muted-foreground" : m.profitPerSub >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"
                      }`}>
                        {m.profitPerSub !== null ? fmtC(m.profitPerSub) : "—"}
                      </span>
                    </td>
                    {isModelColVisible("roi") && (
                      <td className="py-2 text-right">
                        <span className={`text-[12px] font-mono ${
                          m.roi === null ? "text-muted-foreground" : m.roi >= 0 ? "text-[hsl(160_84%_39%)]" : "text-destructive"
                        }`}>
                          {m.roi !== null ? `${m.roi.toFixed(0)}%` : "—"}
                        </span>
                      </td>
                    )}
                    {isModelColVisible("subs_day") && (
                      <td className="py-2 text-right text-[12px] font-mono text-foreground">
                        {m.subsDay !== null ? `${Math.round(m.subsDay)}/day` : "—"}
                      </td>
                    )}
                  </tr>
                ))}
                {modelComparison.length === 0 && (
                  <tr><td colSpan={5 + (isModelColVisible("roi") ? 1 : 0) + (isModelColVisible("subs_day") ? 1 : 0)} className="py-4 text-center text-xs text-muted-foreground">No models</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

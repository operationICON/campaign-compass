import React, { useState, useMemo } from "react";
import { ArrowLeft, ChevronRight, Zap, Globe, DollarSign, TrendingUp, Users, Percent, BarChart3 } from "lucide-react";
import { getEffectiveSource } from "@/lib/source-helpers";
import { useTagColors } from "@/components/TagBadge";
import { differenceInDays } from "date-fns";
import { TrafficSourceDetail } from "./TrafficSourceDetail";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

interface Props {
  links: any[];
  allLinks: any[];
  onTagLink?: (linkId: string, sourceTag: string) => void;
}

type Category = "OnlyTraffic" | "Manual";

function isOnlyTraffic(link: any): boolean {
  return link.traffic_category === "OnlyTraffic";
}

function isManual(link: any): boolean {
  return link.traffic_category === "Manual";
}

function calcCategoryMetrics(catLinks: any[]) {
  const spend = catLinks
    .filter(l => Number(l.cost_total || 0) > 0)
    .reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const revenue = catLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
  const profit = revenue - spend;
  const subs = catLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const roi = spend > 0 ? (profit / spend) * 100 : null;

  const cplLinks = catLinks.filter(l => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
  const cplSpend = cplLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const cplSubs = cplLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;

  const profitPerSub = spend > 0 && subs > 0 ? profit / subs : null;
  const ltvPerSub = subs > 0 ? revenue / subs : null;

  const ages = catLinks.map(l => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
  const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 1;
  const subsDay = avgAge > 0 ? subs / avgAge : 0;

  const campaigns = catLinks.length;
  const sourceTags = new Set<string>();
  catLinks.forEach(l => {
    const es = getEffectiveSource(l);
    if (es) sourceTags.add(es);
  });
  const activeSources = sourceTags.size;

  return { spend, revenue, profit, roi, avgCpl, profitPerSub, ltvPerSub, subsDay, campaigns, activeSources, subs };
}

function calcSourceMetrics(sourceLinks: any[]) {
  const spend = sourceLinks
    .filter(l => Number(l.cost_total || 0) > 0)
    .reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const revenue = sourceLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
  const profit = revenue - spend;
  const subs = sourceLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const roi = spend > 0 ? (profit / spend) * 100 : null;

  // Subs/Day: subs / avg age in days
  const ages = sourceLinks.map(l => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
  const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 1;
  const subsDay = avgAge > 0 ? subs / avgAge : 0;

  // Avg CPL (CPL only)
  const cplLinks = sourceLinks.filter(l => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
  const cplSpend = cplLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const cplSubs = cplLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;

  const profitPerSub = subs > 0 ? profit / subs : null;
  const ltvPerSub = subs > 0 ? revenue / subs : null;

  const cpcLinks = sourceLinks.filter(l => l.payment_type === "CPC" && Number(l.cost_total || 0) > 0);
  const cpcSpend = cpcLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);

  return { spend, revenue, profit, subs, roi, subsDay, avgCpl, profitPerSub, ltvPerSub, campaigns: sourceLinks.length, cplSpend, cpcSpend };
}

function getRoiBadge(roi: number | null): { label: string; bg: string; text: string } {
  if (roi === null) return { label: "NO SPEND", bg: "hsl(220 9% 46% / 0.15)", text: "hsl(220 9% 46%)" };
  if (roi > 150) return { label: "SCALE", bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 45%)" };
  if (roi >= 50) return { label: "WATCH", bg: "hsl(199 89% 48% / 0.15)", text: "hsl(199 89% 48%)" };
  if (roi >= 0) return { label: "LOW", bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  return { label: "KILL", bg: "hsl(0 84% 60% / 0.15)", text: "hsl(0 84% 60%)" };
}

export function TrafficCategoryNav({ links, allLinks, onTagLink }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const colorMap = useTagColors();

  const otLinks = useMemo(() => allLinks.filter(isOnlyTraffic), [allLinks]);
  const manualLinks = useMemo(() => allLinks.filter(isManual), [allLinks]);

  const otMetrics = useMemo(() => calcCategoryMetrics(otLinks), [otLinks]);
  const manualMetrics = useMemo(() => calcCategoryMetrics(manualLinks), [manualLinks]);

  // Level 2: sources for active category
  const categoryLinks = activeCategory === "OnlyTraffic" ? otLinks : manualLinks;
  const categoryMetrics = activeCategory === "OnlyTraffic" ? otMetrics : manualMetrics;

  const sourceCards = useMemo(() => {
    if (!activeCategory) return [];
    const bySource: Record<string, any[]> = {};
    categoryLinks.forEach(l => {
      const tag = getEffectiveSource(l) || "Untagged";
      if (!bySource[tag]) bySource[tag] = [];
      bySource[tag].push(l);
    });

    return Object.entries(bySource)
      .map(([name, sLinks]) => ({
        name,
        ...calcSourceMetrics(sLinks),
      }))
      .sort((a, b) => (b.ltvPerSub ?? -Infinity) - (a.ltvPerSub ?? -Infinity));
  }, [activeCategory, categoryLinks]);

  // Level 3: links for active source
  const sourceLinks = useMemo(() => {
    if (!activeSource || !activeCategory) return [];
    return categoryLinks.filter(l => {
      const tag = getEffectiveSource(l) || "Untagged";
      return tag === activeSource;
    });
  }, [activeSource, activeCategory, categoryLinks]);

  // Collect all unique source tags for the dropdown
  const sourceTagOptions = useMemo(() => {
    const tags = new Set<string>();
    allLinks.forEach(l => {
      if (l.source_tag) tags.add(l.source_tag);
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [allLinks]);

  // ═══ LEVEL 3 ═══
  if (activeCategory && activeSource) {
    const dotColor = colorMap[activeSource] || "#94a3b8";
    return (
      <TrafficSourceDetail
        sourceName={activeSource}
        sourceColor={dotColor}
        categoryName={activeCategory}
        links={sourceLinks}
        onBack={() => setActiveSource(null)}
        sourceTagOptions={sourceTagOptions}
        onTagLink={onTagLink || (() => {})}
      />
    );
  }

  // ═══ LEVEL 1 ═══
  if (!activeCategory) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground" style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Traffic Categories
        </p>
        <div className="grid grid-cols-2 gap-4">
          {/* OnlyTraffic Card */}
          <button
            onClick={() => setActiveCategory("OnlyTraffic")}
            className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary/40 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-emerald-500" />
              <span className="text-foreground font-bold text-base">OnlyTraffic</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-500">API</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <MetricRow label="Spend" value={fmtC(otMetrics.spend)} />
              <MetricRow label="Revenue" value={fmtC(otMetrics.revenue)} />
              <MetricRow label="Profit" value={fmtC(otMetrics.profit)} color={otMetrics.profit >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))"} />
              <MetricRow label="Avg CPL" value={otMetrics.avgCpl !== null ? fmtC(otMetrics.avgCpl) : "—"} />
              <MetricRow label="ROI" value={otMetrics.roi !== null ? fmtPct(otMetrics.roi) : "—"} color={otMetrics.roi !== null ? (otMetrics.roi >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))") : undefined} />
              <MetricRow label="Campaigns" value={fmtN(otMetrics.campaigns)} />
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{otMetrics.activeSources} active sources</span>
              <span className="text-emerald-500 font-semibold flex items-center gap-0.5 group-hover:gap-1.5 transition-all" style={{ fontSize: "12px" }}>
                View sources <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </button>

          {/* Manual Card */}
          <button
            onClick={() => setActiveCategory("Manual")}
            className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary/40 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-blue-500" />
              <span className="text-foreground font-bold text-base">Manual</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-500">Direct</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <MetricRow label="Spend" value={manualMetrics.spend > 0 ? fmtC(manualMetrics.spend) : "—"} />
              <MetricRow label="Revenue" value={fmtC(manualMetrics.revenue)} />
              <MetricRow label="Profit" value={manualMetrics.spend > 0 ? fmtC(manualMetrics.profit) : "—"} color={manualMetrics.spend > 0 ? (manualMetrics.profit >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))") : undefined} />
              <MetricRow label="Avg CPL" value={manualMetrics.avgCpl !== null ? fmtC(manualMetrics.avgCpl) : "—"} />
              <MetricRow label="ROI" value={manualMetrics.spend > 0 && manualMetrics.roi !== null ? fmtPct(manualMetrics.roi) : "—"} color={manualMetrics.spend > 0 && manualMetrics.roi !== null ? (manualMetrics.roi >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))") : undefined} />
              <MetricRow label="Campaigns" value={fmtN(manualMetrics.campaigns)} />
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{manualMetrics.activeSources} active sources</span>
              <span className="text-blue-500 font-semibold flex items-center gap-0.5 group-hover:gap-1.5 transition-all" style={{ fontSize: "12px" }}>
                View sources <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ═══ LEVEL 2 ═══
  const catColor = activeCategory === "OnlyTraffic" ? "text-emerald-500" : "text-blue-500";
  const catBadgeBg = activeCategory === "OnlyTraffic" ? "bg-emerald-500/15 text-emerald-500" : "bg-blue-500/15 text-blue-500";
  const catBadgeLabel = activeCategory === "OnlyTraffic" ? "API" : "Direct";
  const CatIcon = activeCategory === "OnlyTraffic" ? Zap : Globe;

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={() => setActiveCategory(null)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: "13px", fontWeight: 500 }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Sources
      </button>

      {/* Header */}
      <div className="flex items-center gap-2">
        <CatIcon className={`h-5 w-5 ${catColor}`} />
        <span className="text-foreground font-bold text-lg">{activeCategory}</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${catBadgeBg}`}>{catBadgeLabel}</span>
      </div>

      {/* Sub-KPI row */}
      <div className="grid grid-cols-8 gap-2">
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Spend" value={fmtC(categoryMetrics.spend)} color="#dc2626" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Revenue" value={fmtC(categoryMetrics.revenue)} color="#16a34a" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Profit" value={fmtC(categoryMetrics.profit)} color={categoryMetrics.profit >= 0 ? "#16a34a" : "#dc2626"} />
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Avg CPL" value={categoryMetrics.avgCpl !== null ? fmtC(categoryMetrics.avgCpl) : "—"} color="#0891b2" />
        <SubKpi icon={<Users className="h-3.5 w-3.5" />} label="Profit/Sub" value={categoryMetrics.profitPerSub !== null ? fmtC(categoryMetrics.profitPerSub) : "—"} color={categoryMetrics.profitPerSub !== null ? (categoryMetrics.profitPerSub >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
        <SubKpi icon={<BarChart3 className="h-3.5 w-3.5" />} label="Subs/Day" value={categoryMetrics.subsDay > 0 ? categoryMetrics.subsDay.toFixed(1) : "0"} color="#d97706" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="LTV/Sub" value={categoryMetrics.ltvPerSub !== null ? fmtC(categoryMetrics.ltvPerSub) : "—"} color="#0891b2" />
        <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="ROI" value={categoryMetrics.roi !== null ? fmtPct(categoryMetrics.roi) : "—"} color={categoryMetrics.roi !== null ? (categoryMetrics.roi >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
      </div>

      {/* Source cards grid */}
      <div className="grid grid-cols-3 gap-3">
        {sourceCards.map(src => {
          const badge = getRoiBadge(src.roi);
          const dotColor = colorMap[src.name] || "#94a3b8";
          return (
            <button key={src.name} onClick={() => setActiveSource(src.name)} className="bg-card border border-border rounded-xl p-4 space-y-3 text-left hover:border-primary/40 transition-colors">
              {/* Header */}
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                  <span className="text-foreground" style={{ fontSize: "18px", fontWeight: 600 }}>{src.name}</span>
                </div>
                <span className="text-muted-foreground" style={{ fontSize: "12px" }}>{src.campaigns} campaigns</span>
              </div>

              {/* Metrics grid — 8 KPIs in order */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <div>
                  <MetricRow label="Spend" value={fmtC(src.spend)} />
                  {activeCategory === "OnlyTraffic" && (src.cplSpend > 0 || src.cpcSpend > 0) && (
                    <div className="flex gap-1 mt-0.5 justify-end">
                      {src.cplSpend > 0 && (
                        <span className="px-1.5 py-0 rounded-full font-semibold" style={{ fontSize: "10px", backgroundColor: "hsl(174 60% 51% / 0.2)", color: "hsl(174 60% 41%)" }}>
                          CPL: {fmtC(src.cplSpend)}
                        </span>
                      )}
                      {src.cpcSpend > 0 && (
                        <span className="px-1.5 py-0 rounded-full font-semibold" style={{ fontSize: "10px", backgroundColor: "hsl(38 92% 50% / 0.2)", color: "hsl(38 92% 40%)" }}>
                          CPC: {fmtC(src.cpcSpend)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <MetricRow label="Revenue" value={fmtC(src.revenue)} />
                <MetricRow label="Profit" value={fmtC(src.profit)} color={src.spend > 0 ? (src.profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined} />
                <MetricRow label="Avg CPL" value={src.avgCpl !== null ? fmtC(src.avgCpl) : "—"} />
                <MetricRow label="Profit/Sub" value={src.profitPerSub !== null ? fmtC(src.profitPerSub) : "—"} color={src.profitPerSub !== null ? (src.profitPerSub >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined} />
                <MetricRow label="Subs/Day" value={src.subsDay > 0 ? src.subsDay.toFixed(1) : "0"} />
                <MetricRow label="LTV/Sub" value={src.ltvPerSub !== null ? fmtC(src.ltvPerSub) : "—"} color="#0891b2" />
                <MetricRow label="ROI" value={src.roi !== null ? fmtPct(src.roi) : "—"} color={src.roi !== null ? (src.roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined} />
              </div>

              {/* Badge */}
              <div className="flex items-center justify-end pt-2 border-t border-border">
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: badge.bg, color: badge.text }}
                >
                  {badge.label}
                </span>
              </div>
            </button>
          );
        })}
        {sourceCards.length === 0 && (
          <div className="col-span-3 text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>
            No sources found in this category
          </div>
        )}
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{label}</span>
      <span className="font-mono font-semibold" style={{ fontSize: "12px", color }}>{value}</span>
    </div>
  );
}

function SubKpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border px-2 py-2 rounded-lg" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-1 mb-0.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-muted-foreground" style={{ fontSize: "9px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <p className="font-mono font-bold text-foreground" style={{ fontSize: "13px" }}>{value}</p>
    </div>
  );
}

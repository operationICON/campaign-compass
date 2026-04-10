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
  allLinks: any[]; // unfiltered by time for stable category assignment
}

type Category = "OnlyTraffic" | "Manual";

function isOnlyTraffic(link: any): boolean {
  return link.traffic_category === "OnlyTraffic";
}

function isManual(link: any): boolean {
  return link.traffic_category === "Manual" ||
    (!link.traffic_category && Number(link.cost_total || 0) > 0);
}

function calcCategoryMetrics(catLinks: any[]) {
  const spend = catLinks
    .filter(l => Number(l.cost_total || 0) > 0)
    .reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const revenue = catLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
  const profit = revenue - spend;
  const roi = spend > 0 ? (profit / spend) * 100 : null;

  // Avg CPL: only CPL payment type links
  const cplLinks = catLinks.filter(l => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
  const cplSpend = cplLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const cplSubs = cplLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
  const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;

  const campaigns = catLinks.length;

  // Active sources
  const sourceTags = new Set<string>();
  catLinks.forEach(l => {
    const es = getEffectiveSource(l);
    if (es) sourceTags.add(es);
  });
  const activeSources = sourceTags.size;

  return { spend, revenue, profit, roi, avgCpl, campaigns, activeSources };
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

  return { spend, revenue, profit, subs, roi, subsDay, avgCpl, profitPerSub, campaigns: sourceLinks.length };
}

function getRoiBadge(roi: number | null): { label: string; bg: string; text: string } {
  if (roi === null) return { label: "TEST", bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  if (roi >= 100) return { label: "SCALE", bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 45%)" };
  if (roi >= 0) return { label: "TEST", bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  return { label: "KILL", bg: "hsl(0 84% 60% / 0.15)", text: "hsl(0 84% 60%)" };
}

export function TrafficCategoryNav({ links, allLinks }: Props) {
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
      .sort((a, b) => (b.profitPerSub ?? -Infinity) - (a.profitPerSub ?? -Infinity));
  }, [activeCategory, categoryLinks]);

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
              <MetricRow label="Spend" value={fmtC(manualMetrics.spend)} />
              <MetricRow label="Revenue" value={fmtC(manualMetrics.revenue)} />
              <MetricRow label="Profit" value={fmtC(manualMetrics.profit)} color={manualMetrics.profit >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))"} />
              <MetricRow label="Avg CPL" value={manualMetrics.avgCpl !== null ? fmtC(manualMetrics.avgCpl) : "—"} />
              <MetricRow label="ROI" value={manualMetrics.roi !== null ? fmtPct(manualMetrics.roi) : "—"} color={manualMetrics.roi !== null ? (manualMetrics.roi >= 0 ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))") : undefined} />
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
      <div className="grid grid-cols-5 gap-3">
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Spend" value={fmtC(categoryMetrics.spend)} color="#dc2626" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Revenue" value={fmtC(categoryMetrics.revenue)} color="#16a34a" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Profit" value={fmtC(categoryMetrics.profit)} color={categoryMetrics.profit >= 0 ? "#16a34a" : "#dc2626"} />
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Avg CPL" value={categoryMetrics.avgCpl !== null ? fmtC(categoryMetrics.avgCpl) : "—"} color="#0891b2" />
        <SubKpi icon={<BarChart3 className="h-3.5 w-3.5" />} label="Sources" value={fmtN(categoryMetrics.activeSources)} color="#7c3aed" />
      </div>

      {/* Source cards grid */}
      <div className="grid grid-cols-3 gap-3">
        {sourceCards.map(src => {
          const badge = getRoiBadge(src.roi);
          const dotColor = colorMap[src.name] || "#94a3b8";
          return (
            <div key={src.name} className="bg-card border border-border rounded-xl p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                  <span className="text-foreground font-semibold" style={{ fontSize: "13px" }}>{src.name}</span>
                </div>
                <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{src.campaigns} campaigns</span>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <MetricRow label="Spend" value={fmtC(src.spend)} />
                <MetricRow label="Subs/Day" value={src.subsDay > 0 ? src.subsDay.toFixed(1) : "0"} />
                <MetricRow label="Avg CPL" value={src.avgCpl !== null ? fmtC(src.avgCpl) : "—"} />
                <MetricRow label="ROI" value={src.roi !== null ? fmtPct(src.roi) : "—"} color={src.roi !== null ? (src.roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined} />
              </div>

              {/* Profit/Sub full width */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div>
                  <span className="text-muted-foreground" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Profit/Sub</span>
                  <p className="font-mono font-bold text-foreground" style={{ fontSize: "16px" }}>
                    {src.profitPerSub !== null ? fmtC(src.profitPerSub) : "—"}
                  </p>
                </div>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: badge.bg, color: badge.text }}
                >
                  {badge.label}
                </span>
              </div>
            </div>
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
    <div className="bg-card border border-border px-3 py-2.5 rounded-xl" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-muted-foreground" style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <p className="font-mono font-bold text-foreground" style={{ fontSize: "16px" }}>{value}</p>
    </div>
  );
}

/**
 * Unified calculation helpers for CT Tracker.
 * All profit, ROI, status, and CVR logic goes through these functions.
 */

// ─── Active account filter (single source of truth) ───
// Excludes test/inactive accounts from all aggregates and lists.
export function isActiveAccount(a: any): boolean {
  return Number(a?.subscribers_count || 0) > 0;
}

// ─── Status Types ───
export type LinkStatus = "TESTING" | "INACTIVE" | "SCALE" | "WATCH" | "LOW" | "KILL" | "NO_SPEND";

export const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  TESTING: { bg: "#f3f4f6", text: "#6b7280" },
  INACTIVE: { bg: "#f3f4f6", text: "#6b7280" },
  SCALE: { bg: "#dcfce7", text: "#16a34a" },
  WATCH: { bg: "#dbeafe", text: "#0891b2" },
  LOW: { bg: "#fef9c3", text: "#854d0e" },
  KILL: { bg: "#fee2e2", text: "#dc2626" },
  NO_SPEND: { bg: "#fff7ed", text: "#d97706" },
  "NO SPEND": { bg: "#fff7ed", text: "#d97706" },
  NO_DATA: { bg: "#f9fafb", text: "#94a3b8" },
  DEAD: { bg: "#f3f4f6", text: "#9ca3af" },
  DELETED: { bg: "#f3f4f6", text: "#9ca3af" },
};

export const STATUS_LABELS: Record<string, string> = {
  TESTING: "TESTING",
  INACTIVE: "INACTIVE",
  SCALE: "SCALE",
  WATCH: "WATCH",
  LOW: "LOW",
  KILL: "KILL",
  NO_SPEND: "NO SPEND",
  "NO SPEND": "NO SPEND",
  NO_DATA: "NO DATA",
  DEAD: "DEAD",
};

// ─── Effective Revenue ───
// Returns { value, isEstimate } — isEstimate is true when falling back to revenue
export function getEffectiveRevenue(link: any): { value: number; isEstimate: boolean } {
  const ltv = Number(link.ltv || 0);
  if (ltv > 0) return { value: ltv, isEstimate: false };
  const revenue = Number(link.revenue || 0);
  return { value: revenue, isEstimate: revenue > 0 };
}

// ─── Profit ───
export function calcProfit(link: any): { profit: number | null; isEstimate: boolean } {
  const costTotal = Number(link.cost_total || 0);
  if (costTotal <= 0) return { profit: null, isEstimate: false };
  const { value: effectiveRev, isEstimate } = getEffectiveRevenue(link);
  return { profit: effectiveRev - costTotal, isEstimate };
}

// ─── ROI ───
export function calcRoi(link: any): { roi: number | null; isEstimate: boolean } {
  const costTotal = Number(link.cost_total || 0);
  if (costTotal <= 0) return { roi: null, isEstimate: false };
  const { profit, isEstimate } = calcProfit(link);
  if (profit === null) return { roi: null, isEstimate: false };
  return { roi: (profit / costTotal) * 100, isEstimate };
}

// ─── CVR — only calculate when clicks > 100 ───
export function calcCvr(clicks: number, subscribers: number): number | null {
  if (clicks <= 100) return null;
  return (subscribers / clicks) * 100;
}

// ─── Unified Status ───
export function calcStatus(link: any): LinkStatus {
  const clicks = link.clicks || 0;
  const subscribers = link.subscribers || 0;
  const costTotal = Number(link.cost_total || 0);

  // TESTING: no clicks AND no subscribers
  if (clicks === 0 && subscribers === 0) return "TESTING";

  // Check if active within last 30 days
  const calcDate = link.calculated_at ? new Date(link.calculated_at) : null;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // INACTIVE: has activity but not in last 30 days
  if (calcDate && calcDate < thirtyDaysAgo) return "INACTIVE";
  if (!calcDate) {
    const createdDate = new Date(link.created_at);
    if (createdDate < thirtyDaysAgo) return "INACTIVE";
  }

  // Active within 30 days — check spend-based statuses
  if (costTotal > 0) {
    const { roi } = calcRoi(link);
    if (roi === null) return "NO_SPEND";
    if (roi > 150) return "SCALE";
    if (roi >= 50) return "WATCH";
    if (roi >= 0) return "LOW";
    return "KILL";
  }

  return "NO_SPEND";
}

// ─── Status for inline save (when we know the preview values) ───
export function calcStatusFromRoi(roi: number): LinkStatus {
  if (roi > 150) return "SCALE";
  if (roi >= 50) return "WATCH";
  if (roi >= 0) return "LOW";
  return "KILL";
}

// ─── Agency/Page Totals ───
export interface AgencyTotals {
  totalLtv: number;
  totalSpend: number;
  totalProfit: number;
  avgProfitPerSub: number | null;
  hasSpend: boolean;
  paidSubscribers: number;
  avgCpl: number | null;
  roiPct: number | null;
  isEstimate: boolean; // true when any link used revenue fallback
}

export function calcAgencyTotals(links: any[]): AgencyTotals {
  let totalLtv = 0;
  let totalSpend = 0;
  let paidSubscribers = 0;
  let anyEstimate = false;

  for (const l of links) {
    const { value: effectiveRev, isEstimate } = getEffectiveRevenue(l);
    totalLtv += effectiveRev;
    if (isEstimate) anyEstimate = true;

    const cost = Number(l.cost_total || 0);
    if (cost > 0) {
      totalSpend += cost;
      paidSubscribers += (l.subscribers || 0);
    }
  }

  const hasSpend = totalSpend > 0;
  const totalProfit = totalLtv - totalSpend;
  const roiPct = hasSpend ? (totalProfit / totalSpend) * 100 : null;
  const avgProfitPerSub = hasSpend && paidSubscribers > 0 ? totalProfit / paidSubscribers : null;
  const avgCpl = hasSpend && paidSubscribers > 0 ? totalSpend / paidSubscribers : null;

  return { totalLtv, totalSpend, totalProfit, avgProfitPerSub, hasSpend, paidSubscribers, avgCpl, roiPct, isEstimate: anyEstimate };
}

// ─── Cost Type from Order ID ───
export type CostTypeFromOrder = "CPL" | "CPC";

export function getCostTypeFromOrderId(orderId: string | null | undefined): CostTypeFromOrder | null {
  if (!orderId) return null;
  if (orderId.startsWith("cplo_")) return "CPL";
  if (orderId.startsWith("cpco_")) return "CPC";
  return null;
}

/**
 * Given a set of cost types derived from order IDs, return a display label.
 * - All CPL → "CPL"
 * - All CPC → "CPC"
 * - Mixed → "Mixed"
 * - Empty → null
 */
export function deriveCostLabel(types: Set<CostTypeFromOrder>): "CPL" | "CPC" | "Mixed" | null {
  if (types.size === 0) return null;
  if (types.size === 1) return [...types][0];
  return "Mixed";
}

/**
 * Compute CPL or CPC value based on the derived cost type.
 * CPL = spend / subs, CPC = spend / clicks.
 * For mixed, returns both formatted or null.
 */
export function calcCostMetric(
  costLabel: "CPL" | "CPC" | "Mixed" | null,
  spend: number,
  subs: number,
  clicks: number
): { value: number | null; display: string; label: string } {
  if (!costLabel || spend <= 0) return { value: null, display: "—", label: costLabel || "CPL" };
  const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (costLabel === "CPL") {
    const v = subs > 0 ? spend / subs : null;
    return { value: v, display: v !== null ? fmtC(v) : "—", label: "CPL" };
  }
  if (costLabel === "CPC") {
    const v = clicks > 0 ? spend / clicks : null;
    return { value: v, display: v !== null ? fmtC(v) : "—", label: "CPC" };
  }
  // Mixed: show both if possible
  const cpl = subs > 0 ? spend / subs : null;
  const cpc = clicks > 0 ? spend / clicks : null;
  if (cpl !== null && cpc !== null) return { value: cpl, display: `${fmtC(cpl)} CPL / ${fmtC(cpc)} CPC`, label: "CPL/CPC" };
  if (cpl !== null) return { value: cpl, display: fmtC(cpl), label: "CPL/CPC" };
  if (cpc !== null) return { value: cpc, display: fmtC(cpc), label: "CPL/CPC" };
  return { value: null, display: "—", label: "CPL/CPC" };
}

// ─── Est. Badge component helper (use inline) ───
// Usage: {isEstimate && <EstBadge />}
// The component is defined in React files that import this.

// ─── tracking_link_ltv deleted-link filter ───
// `tracking_link_ltv` has no `deleted_at` column — when a tracking link is
// soft-deleted its LTV row stays behind and inflates aggregates. Always pass
// `tracking_link_ltv` rows through this helper, scoped to the set of currently
// non-deleted tracking_links (which we already fetch via .is("deleted_at", null)).
//
// Usage:
//   const activeIds = buildActiveLinkIdSet(allLinks);
//   const trackingLinkLtv = filterLtvByActiveLinks(rawLtv, activeIds);
//
// See: .lovable/memory/constraints/tracking-links-deleted-filter.md
export function buildActiveLinkIdSet(activeLinks: Array<{ id: string | number }>): Set<string> {
  const s = new Set<string>();
  for (const l of activeLinks) s.add(String(l.id).toLowerCase());
  return s;
}

export function filterLtvByActiveLinks<T extends { tracking_link_id?: string | null }>(
  ltvRows: T[],
  activeLinkIds: Set<string>
): T[] {
  if (activeLinkIds.size === 0) return ltvRows; // nothing to scope against — return raw
  return ltvRows.filter(r =>
    activeLinkIds.has(String(r.tracking_link_id ?? "").toLowerCase())
  );
}

/**
 * Unified calculation helpers for CT Tracker.
 * All profit, ROI, status, and CVR logic goes through these functions.
 */

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
  NO_DATA: "NO SPEND",
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

// ─── Est. Badge component helper (use inline) ───
// Usage: {isEstimate && <EstBadge />}
// The component is defined in React files that import this.

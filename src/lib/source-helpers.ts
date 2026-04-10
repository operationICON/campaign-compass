/**
 * Resolves the effective source name for a tracking link.
 * Priority:
 * 1. source_tag (if not null/empty)
 * 2. onlytraffic_marketer (if traffic_category === 'OnlyTraffic')
 * 3. null (means "Untagged")
 */
export function getEffectiveSource(link: {
  source_tag?: string | null;
  traffic_category?: string | null;
  onlytraffic_marketer?: string | null;
}): string | null {
  if (link.source_tag && link.source_tag.trim()) return link.source_tag;
  return null;
}

/**
 * Returns "OnlyTraffic" | "Manual" | null for the traffic category badge.
 */
export function getTrafficCategoryLabel(trafficCategory: string | null | undefined): string | null {
  if (!trafficCategory) return null;
  if (trafficCategory === "OnlyTraffic") return "OnlyTraffic";
  return "Manual";
}

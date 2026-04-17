---
name: tracking-links-deleted-filter
description: Universal rule — every aggregation across tracking_links and aux tables (tracking_link_ltv, daily_metrics, daily_snapshots) must exclude rows where tracking_links.deleted_at IS NOT NULL.
type: constraint
---
RULE: Every revenue / spend / clicks / subscribers / campaign-count aggregation that
reads from `tracking_links` or any auxiliary table keyed by `tracking_link_id`
(e.g. `tracking_link_ltv`, `daily_metrics`, `daily_snapshots`) MUST exclude rows
whose `tracking_links.deleted_at IS NOT NULL`.

Implementation pattern (frontend-first):
1. Fetch `tracking_links` with `.is("deleted_at", null)` — this is already
   standard across helpers (`fetchTrackingLinks`, page-level queries).
2. For aux tables (`tracking_link_ltv`, `daily_metrics`), filter the fetched rows
   in React against the set of non-deleted link IDs derived from `allLinks`
   before any `.reduce()` / `.filter()` aggregation:

   ```ts
   const activeLinkIdSet = useMemo(() => {
     const s = new Set<string>();
     for (const l of allLinks) s.add(String(l.id).toLowerCase());
     return s;
   }, [allLinks]);
   const trackingLinkLtv = useMemo(() => {
     if (activeLinkIdSet.size === 0) return raw;
     return raw.filter(r => activeLinkIdSet.has(String(r.tracking_link_id).toLowerCase()));
   }, [raw, activeLinkIdSet]);
   ```

Why: deleted tracking links retain their LTV and snapshot history in aux tables,
but those rows are no longer part of the live business view. Aggregating them
inflates revenue, subs, and LTV totals (e.g. Nicole Free showed +$5,729 LTV
and +21 subs from 2 deleted links).

Pages where this is enforced:
- `src/pages/AccountsPage.tsx` (model overview cards + detail KPIs)
- `src/pages/DashboardPage.tsx` (overview KPIs, All Time totals)
- `src/pages/CalculationsPage.tsx` (reconciliation tables)
- `src/pages/CrossPollPage.tsx` (cross-poll LTV listings)
- `src/pages/TrafficSourcesPage.tsx` (already safe — joins via `linkLookup`)

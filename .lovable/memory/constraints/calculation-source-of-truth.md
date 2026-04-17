---
name: calculation-source-of-truth
description: Definitive metric definitions across all pages. Total Revenue=accounts.ltv_total. Tracked Revenue=SUM(tl.revenue WHERE deleted_at IS NULL). Subscribers=accounts.subscribers_count. Always exclude accounts where ltv_total=0 OR subscribers_count=0 via isActiveAccount().
type: constraint
---
SINGLE SOURCE OF TRUTH (use these exact definitions everywhere):

- Total Revenue   = SUM(accounts.ltv_total) — never SUM(tl.revenue)
- Tracked Revenue = SUM(tl.revenue WHERE deleted_at IS NULL)
- Unattributed    = MAX(0, ltv_total - tracked_revenue)
- Unattributed %  = (unattributed / ltv_total) × 100   (NULL if ltv_total<=0)
- Spend           = SUM(tl.cost_total WHERE deleted_at IS NULL)
- Profit          = ltv_total - Spend
- ROI             = (Profit / Spend) × 100   ("—" when Spend=0)
- Subscribers     = accounts.subscribers_count   (NEVER SUM(tl.subscribers))
- LTV/Sub         = ltv_total / subscribers_count
- Profit/Sub      = Profit / subscribers_count
- CPL             = Spend / subscribers_count
- CPC             = Spend / SUM(tl.clicks WHERE deleted_at IS NULL)

EXCLUDE INACTIVE ACCOUNTS (Rule 4):
Use the shared helper `isActiveAccount` from `src/lib/calc-helpers.ts`:
```ts
export function isActiveAccount(a: any): boolean {
  return Number(a?.ltv_total || 0) > 0 && Number(a?.subscribers_count || 0) > 0;
}
```
Apply it to `accounts` BEFORE any aggregate or list. Never use
`a.is_active !== false` or `sync_enabled` for metric aggregations.

NEVER JOIN BEFORE SUMMING ACCOUNT METRICS (Rule 2):
Frontend-first: fetch `accounts` and `tracking_links` separately and reduce in
React. Never SUM(accounts.ltv_total) over a joined row set — it inflates by
the number of links per account.

DELETED LINKS (Rule 1):
Every `tracking_links` aggregation must filter `deleted_at IS NULL`. See
`tracking-links-deleted-filter.md`. Helpers `fetchTrackingLinks` already
apply this; aux tables (tracking_link_ltv, daily_metrics) must be filtered
in React via `activeLinkIdSet`.

REFERENCE VALUES (agency-wide, post-fix):
- Total Revenue:    $2,314,557.92
- Tracked Revenue:  $1,277,063.97
- Unattributed:     $1,037,493.95 (44.8%)
- Total Spend:      $217,378.01
- Subscribers:      311,332
- Clicks:           2,345,766

Nicole Free reference:
- Total Revenue: $890,421.58
- Tracked Revenue: $573,066.79
- Unattributed: $317,354.79 (35.6%)
- Spend: $2,650.90 · Profit: $887,770.68 · Subs: 77,417

Pages enforced:
- DashboardPage (filtAccounts uses isActiveAccount; unattributedStats uses revenue formula)
- AccountsPage (model list filters via isActiveAccount; per-model uses ltv_total - tracked_rev)
- TrafficSourcesPage (KPI label "Tracked Revenue"; subscribers via isActiveAccount)
- All others inherit via fetchTrackingLinks + activeLinkIdSet pattern.

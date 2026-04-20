# Project Memory

## Core
Frontend-First: All calculations & filtering must happen in React. DO NOT modify Supabase Edge Functions/schemas unless explicitly authorized.
Terminology: Strictly use 'Revenue' (Gross/Net). Never use legacy terms like 'Est. Revenue', 'Organic', 'Unaccounted'.
Theme: High-contrast dark UI (bg #0D1117, cards #161B22). Status: teal/cyan (positive/success), red (negative/destructive).
Single source of truth — Total Revenue=accounts.ltv_total; Tracked Revenue=SUM(tl.revenue, deleted_at IS NULL); Subscribers=accounts.subscribers_count; Spend=SUM(tl.cost_total, deleted_at IS NULL).
Always exclude inactive accounts via `isActiveAccount` (ltv_total>0 AND subscribers_count>0). Never use `is_active`/`sync_enabled` for metric aggregation.
Every tracking_links aggregation must filter `deleted_at IS NULL` (helpers + activeLinkIdSet pattern for aux tables).
Revenue Toggle: Default 'Gross'. 'Net' applies a 0.80 multiplier to earnings (after OF 20% platform fee).
Filtering: 'Last Month' is strictly `CURRENT_DATE - 30` to `CURRENT_DATE - 1` (excluding today).
Statistics: Require minimum 5 subscribers for campaign performance rankings to ensure significance.
daily_snapshots store CUMULATIVE TOTALS (running totals as of snapshot_date) — NEVER sum rows; period gains = latest − earliest. Dedup duplicate (link_id,date) by keeping MAX(subscribers).

## Memories
- [Calculation source of truth](mem://constraints/calculation-source-of-truth) — Definitive metric formulas, isActiveAccount, reference values
- [Tracking-links deleted filter](mem://constraints/tracking-links-deleted-filter) — Universal deleted_at IS NULL rule + aux-table pattern
- [Frontend architecture](mem://constraints/frontend-first-architecture) — strict frontend-only modification constraint
- [API direct access](mem://infrastructure/direct-api-access) — Bypass 60s Edge limit for slow OnlyFans endpoints
- [Sync optimization](mem://infrastructure/sync-optimization) — Daily snapshot deltas and inflated logic
- [Batching patterns](mem://infrastructure/data-fetching-patterns) — Recursive Supabase fetching for 1,000 row limits
- [Global filters](mem://infrastructure/global-filter-persistence) — LocalStorage persistence for generic filters
- [Sync concurrency](mem://infrastructure/sync-concurrency-guard) — 5-minute active sync lock in DB
- [Source components](mem://infrastructure/source-management-components) — Native select & drawer actions for source mapping
- [DB Integrity](mem://infrastructure/data-integrity-findings) — Known missing transaction links for $0 rev campaigns
- [Universal filtering](mem://infrastructure/universal-filtering) — Global usePageFilters for date and models
- [OnlyFans API](mem://integrations/onlyfans-api) — Endpoint rules, 5 core models, Bearer auth
- [OF Sync logic](mem://integrations/onlyfans-sync-logic) — Sequential pagination, 300ms delays, upsert strategy
- [OF discovery](mem://integrations/onlyfans-account-discovery) — Upserting new models to DB
- [Model visuals](mem://style/model-visuals) — Circular avatars (24/32/80px) & initial fallbacks
- [Color palette](mem://style/color-palette) — Detailed semantic theme tokens
- [Design language](mem://style/design-language) — Card grid layouts, 8px radius, strict typography
- [Terminology](mem://style/terminology) — Allowed and banned terminology
- [Source visuals](mem://style/source-card-visuals) — Visual hierarchy for Level 2 Source Cards
- [Layout patterns](mem://style/layout-patterns) — Default table sorting (created_at DESC)
- [Link management](mem://features/tracking-link-management) — Exclude @unknown accounts, All Accounts UI
- [Audit rules](mem://features/tracking-link-audit) — The 5 specific tabs for link auditing
- [KPI persistence](mem://features/kpi-persistence) — Preference versioning in local storage
- [Sync Center](mem://features/sync-center) — Real-time workflows and AbortController
- [Status system](mem://features/unified-status-system) — Automated ROI-based statuses
- [Fans dashboard](mem://features/fans-dashboard) — Dual-view list and chats architecture
- [Revenue logic](mem://features/unified-revenue-logic) — Split via LTV total vs period snapshots
- [Cost system](mem://features/cost-system) — `cost_total` totals, ignoring unmatched logic
- [Order history](mem://features/campaign-detail-drawer/order-history-logic) — Table layout and formatting
- [Drawer architecture](mem://features/campaign-detail-drawer/architecture) — 3-column layout, re-fetch triggers
- [Spend management](mem://features/campaign-detail-drawer/spend-management) — 'Clear Spend' reset actions
- [Tagging constraints](mem://features/traffic-source-management/tagging-constraints) — source_tag rules, manual assignment
- [Sources metrics](mem://features/traffic-source-management/sources-metrics) — 8-KPI strict order
- [Table details](mem://features/traffic-source-management/level-3-table-details) — Age pills and payment type badges
- [Side panel](mem://features/traffic-source-management/side-panel-behavior) — Persistently visible source panel
- [Consolidated nav](mem://features/traffic-source-management/sources-navigation-consolidated) — 'Manual' category consolidation
- [Unattributed breakdown](mem://features/dashboard/unattributed-breakdown) — By-type breakdown sourced from transactions, not accounts.ltv_*

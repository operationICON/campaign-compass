---
name: Dashboard Unattributed % breakdown
description: Source-of-truth for the by-type breakdown shown inside the Unattributed % KPI card
type: feature
---
The expandable "By Type" breakdown inside the Dashboard's Unattributed % card sums `transactions.revenue` grouped by `transactions.type`, scoped to accounts where `sync_enabled = true` AND active per `isActiveAccount`, and respecting the current model/group filter.

Type → label mapping:
- `message` → Messages / PPV
- `tip` → Tips
- `new_subscription` + `recurring_subscription` → Subscriptions
- `post` → Posts

Each row displays `$ amount · (amount / SUM(accounts.ltv_total within filter)) %`. The headline Unattributed % itself is unchanged: `max(0, ltv_total − tracked_revenue) / ltv_total`.

The `accounts.ltv_messages/ltv_tips/ltv_subscriptions/ltv_posts` columns are not populated by upstream sync — do NOT use them as the source for this breakdown. Helper: `fetchTransactionTypeTotalsByAccount` in `src/lib/supabase-helpers.ts`.

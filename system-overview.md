# CT Tracker — System Overview

## Purpose

CT Tracker is an internal campaign performance dashboard for **Icon Models Agency**, built to track OnlyFans tracking links, ad spend, revenue (LTV), and fan attribution across multiple models. It provides real-time KPIs, audit tools, and sync automation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| UI Components | shadcn/ui (Radix primitives) |
| State / Data | TanStack React Query |
| Charts | Recharts |
| Routing | React Router v6 |
| Backend | Lovable Cloud (Supabase) — Postgres, Edge Functions, Realtime |

---

## Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | **Overview** | Agency-wide KPIs, model filters, date range, insights, cost/detail slide-ins |
| `/campaigns` | **Tracking Links** | Full tracking link table with sorting, filtering, drag-and-drop columns, inline spend editing, bulk actions, CSV export |
| `/audit` | **Audit** | Tracking link audit with tabs (Zero Activity, Deleted, Review Flag), bulk CSV import/edit |
| `/accounts` | **Models** | Model cards with KPIs (subs, LTV, spend, profit), category tagging (Female/Trans), detailed profile view |
| `/charts` | **Charts** | LTV by model, transaction type breakdown, top campaigns, daily subscribers |
| `/traffic-sources` | **Sources** | Traffic source management, source analysis cards (subs/day, distribution, growth), per-source campaign table |
| `/alerts` | **Alerts** | Unresolved alert list (zero-click, anomalies) |
| `/logs` | **Sync Logs** | Sync history, realtime status, test runner (data health checks), Fan LTV sync trigger |
| `/settings` | **Settings** | Sync interval, API config, sync-enabled toggles |
| `/debug` | **API Debug** | Direct OnlyFans API endpoint tester with credit monitoring and request history |

---

## Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| `accounts` | OnlyFans model accounts with metadata, LTV breakdowns, sync flags |
| `tracking_links` | Core entity — clicks, subs, revenue, spend, ROI, LTV, source tags, status |
| `campaigns` | Groups tracking links by campaign name + account |
| `daily_metrics` | Daily snapshots per tracking link (clicks, revenue, subs, EPC) |
| `ad_spend` | Spend records per campaign/link, supports manual + Airtable sync |
| `transactions` | Individual fan transactions (tips, subs, messages, posts) |
| `fan_attributions` | Fan-to-tracking-link attribution for LTV calculation |
| `fan_spend` | Per-fan revenue totals per tracking link |
| `fan_spenders` | Spender aggregates per tracking link |
| `fan_subscriptions` | Subscription records per fan per tracking link |
| `fan_ltv` | Cross-model fan LTV (cross-pollination tracking) |
| `tracking_link_ltv` | Computed LTV metrics per tracking link (7d, 30d, per-sub, spender %) |
| `traffic_sources` | Named traffic sources with keywords + colors for auto-matching |
| `source_tag_rules` | Manual source tag rules (keyword matching, priority, color) |
| `alerts` | Triggered alerts (zero clicks, anomalies) |
| `sync_logs` | Sync execution history with status, timing, error messages |
| `sync_settings` | Key-value config (sync intervals, API settings) |
| `notifications` | In-app notification feed |
| `manual_notes` | User notes attached to campaigns |
| `bulk_import_logs` | CSV import audit trail |
| `test_logs` | Data health test results |

### View

| View | Purpose |
|------|---------|
| `campaign_performance` | Aggregated campaign-level KPIs (revenue, spend, ROI, EPC) |

### Function

| RPC | Purpose |
|-----|---------|
| `get_ltv_by_period` | Returns LTV breakdown by time period per account |

---

## Edge Functions (Backend)

| Function | Purpose |
|----------|---------|
| `sync-orchestrator` | Master sync — iterates active accounts, calls `sync-account` sequentially, marks stuck syncs, logs results |
| `sync-account` | Per-account sync — fetches tracking links, transactions, fan data from OnlyFans API, computes LTV, creates alerts |
| `sync-tracking` | Per-account tracking link sync with daily metrics and optional LTV calculation |
| `sync-onlyfans` | Full OnlyFans data sync (accounts, links, transactions, fans, LTV) |
| `sync-scheduler` | Cron-style trigger — runs orchestrator if last sync > 72 hours |
| `sync-airtable-expenses` | Pulls expenses from Airtable, upserts `ad_spend`, enriches tracking links |
| `sync-fans` | Fan-level data sync (attributions, spend) |
| `auto-tag-campaigns` | Auto-tags campaigns based on source tag rules |
| `debug-api` | Proxy for testing OnlyFans API endpoints directly |

### Sync Flow

```
sync-scheduler (cron)
  └─► sync-orchestrator
        ├─► sync-account (per model)
        │     ├─ Upsert tracking_links
        │     ├─ Upsert daily_metrics
        │     ├─ Upsert transactions
        │     ├─ Sync fan_attributions + fan_spend (LTV)
        │     └─ Create alerts (zero-click)
        └─► Update sync_logs
```

---

## KPI & Metric Definitions

### Core Terminology

| Term | Definition |
|------|-----------|
| **Revenue** | Gross all-time earnings from OnlyFans API for all subscribers on a tracking link (`tracking_links.revenue`) |
| **LTV** | Lifetime value from **new, non-expired subscribers only** who joined after a tracking link was created. Computed via fan attribution sync (`tracking_links.ltv`). More accurate than Revenue for measuring acquisition value. |
| **Spend** | Total advertising cost assigned to a tracking link (`tracking_links.cost_total`). Can be set via CPC, CPL, or Fixed cost types. |
| **Profit** | `Effective Revenue − Spend`. Where Effective Revenue = LTV if available, else Revenue. |
| **ROI** | `(Profit / Spend) × 100`. Return on investment as a percentage. |

### Revenue vs LTV (Critical Distinction)

```
Revenue = All-time gross earnings from ALL subscribers on a tracking link
LTV     = Revenue from NEW subscribers only (post-link-creation, non-expired)
```

- **Revenue** includes historical/organic fans — overstates acquisition performance
- **LTV** requires a fan attribution sync (`sync-fans`) to populate
- If `ltv > 0`, the system uses LTV for profit/ROI calculations ("LTV-based")
- If `ltv = 0`, the system falls back to Revenue ("Revenue-based estimate")
- A cyan dot (●) indicates LTV-based; gray dot indicates Revenue-based

---

## KPI Card Calculations — Overview Page

### Always-Available Cards

| Card | Formula | Source |
|------|---------|--------|
| **Total Revenue** | `SUM(tracking_links.revenue)` for filtered links | All tracking links |
| **Total LTV** | `SUM(tracking_links.ltv)` for filtered links | Requires fan sync; shows "Fan sync needed" if all zero |
| **30D LTV per Model** | `accounts.ltv_last_30d` per model, sorted descending | `accounts` table, period field mapped by time filter |

### Spend-Dependent Cards

These require at least one tracking link with `cost_total > 0`:

| Card | Formula | Notes |
|------|---------|-------|
| **Profit/Sub** | `(Total Effective Revenue − Total Spend) / Paid Subscribers` | Only shown when ≥10 tracking links have spend. `Paid Subscribers` = sum of subscribers on links that have spend set. |
| **LTV/Sub** | `Total Account LTV / Total Account Subscribers` | Uses `accounts.[ltv_field]` based on time period. Field mapping: `day` → `ltv_last_day`, `week` → `ltv_last_7d`, `month` → `ltv_last_30d`, `all` → `ltv_total`. |
| **Avg CPL** | `Total Spend / Paid Subscribers` | Cost per acquired subscriber across all links with spend |
| **Expenses** | `SUM(cost_total)` for links where `cost_total > 0` | Total spend set across all tracking links |
| **Avg Expenses** | `Total Expenses / Count of links with spend` | Average spend per tracking link |
| **Total Profit** | `Effective Revenue − Total Expenses` | For links with spend only. Effective = LTV if available, else Revenue. |
| **Blended ROI** | `(Total Profit / Total Expenses) × 100` | Agency-wide return on investment |

### Growth & Activity Cards

| Card | Formula | Notes |
|------|---------|-------|
| **Subs/Day** | `(latest_snapshot.subscribers − previous_snapshot.subscribers) / days_between` | Delta-based from `daily_metrics`. Requires ≥2 snapshots. Negative deltas capped at 0. Shows "—" until 2 data points exist. |
| **Active Links** | Count of links where `clicks > 0` AND `calculated_at` within last 30 days | Measures links with recent activity |
| **Best Source** | Source tag with highest ROI among tagged links with spend | `ROI = (Profit / Spend) × 100` per source. Excludes "Untagged". |

### Attribution Card

| Card | Formula | Notes |
|------|---------|-------|
| **Unattributed %** | `(Account Total Subs − Attributed Subs) / Account Total Subs × 100` | `Account Total Subs` = `accounts.subscribers_count`. `Attributed Subs` = `SUM(tracking_links.subscribers)`, capped at account total. ~20% is normal due to OnlyFans tracking limitations. Requires fan sync for accuracy. |

---

## KPI Card Calculations — Tracking Links Page

| Card | Formula | Notes |
|------|---------|-------|
| **Total Revenue** | `SUM(filtered_links.revenue)` | Scoped to current filter state |
| **Total LTV** | `SUM(filtered_links.ltv)` | Scoped to current filter state |
| **Active Links** | Count where `clicks > 0` AND `calculated_at` ≤ 30 days ago | |
| **Avg CVR** | `SUM(subscribers) / SUM(clicks) × 100` | Only for links with `clicks > 100` (qualified) |
| **No Spend** | Count where `cost_total = 0` or null | Links missing cost data |
| **Untagged** | Count where `source_tag` is null | Links without source attribution |
| **Profit/Sub** | `(Effective Revenue − Spend) / Subscribers` for links with spend | Per acquired subscriber |
| **Avg CPL** | `Total Spend / Total Subscribers` for links with spend | Average cost to acquire one subscriber |
| **Tracked %** | `Links with spend / Total links × 100` | Percentage of links with cost data |
| **Best Source (ROI)** | Source with highest `(Profit / Spend) × 100` | Excludes "Untagged" |
| **Best Source (Profit/Sub)** | Source with highest `Profit / Subscribers` | Excludes "Untagged" |
| **Most Profitable** | Source with highest absolute profit | Excludes "Untagged" |
| **Worst Source** | Source with lowest ROI | Excludes "Untagged" |
| **Avg Expenses** | `Total Spend / Count of links with spend` | Per campaign average |
| **Blended ROI** | `(Effective Revenue − Spend) / Spend × 100` | For links with spend only |

---

## Per-Tracking-Link Metrics (Table Columns)

| Column | Formula | Source |
|--------|---------|--------|
| **Clicks** | Raw click count from OnlyFans API | `tracking_links.clicks` |
| **Subscribers** | Total subscribers attributed to link | `tracking_links.subscribers` |
| **CVR** | `Subscribers / Clicks × 100` | Conversion rate |
| **Revenue** | Gross all-time revenue | `tracking_links.revenue` |
| **LTV** | Revenue from new subs only | `tracking_links.ltv` (requires fan sync) |
| **LTV/Sub** | `LTV / Subscribers` | Per-subscriber lifetime value |
| **Spender %** | `Spenders / Subscribers × 100` | Percentage of subs who spent money |
| **Expenses** | Total cost assigned | `tracking_links.cost_total` |
| **Profit** | `Effective Revenue − cost_total` | Effective = LTV if > 0, else Revenue |
| **Profit/Sub** | `Profit / Subscribers` | Per-subscriber profitability |
| **ROI** | `(Profit / cost_total) × 100` | Return on investment |
| **Subs/Day** | `(latest.subscribers − previous.subscribers) / days_between` | From `daily_metrics` snapshots |
| **Avg Expenses** | `cost_total / 1` (per link) | Same as Expenses for single link |

---

## Cost Setting Calculations (CostSettingSlideIn)

Three cost types with different calculation methods:

### Cost Per Sub (CPL) — Recommended
```
cost_total   = subscribers × cost_value
cpc_real     = cost_value × CVR      (where CVR = subscribers / clicks)
cpl_real     = cost_value             (same as input)
```

### Fixed Amount
```
cost_total   = cost_value             (flat fee)
cpc_real     = cost_total / clicks
cpl_real     = cost_total / subscribers
```

### Cost Per Click (CPC) — Warning: may include bot traffic
```
cost_total   = clicks × cost_value
cpc_real     = cost_value             (same as input)
cpl_real     = cost_value / CVR       (where CVR = subscribers / clicks)
```

### Derived Metrics (all cost types)
```
arpu         = revenue / subscribers
profit       = revenue − cost_total
roi          = (profit / cost_total) × 100
```

### Status Assignment
| Condition | Status |
|-----------|--------|
| `clicks = 0` AND `age ≥ 3 days` | DEAD |
| `ROI > 150%` | SCALE |
| `ROI ≥ 50%` | WATCH |
| `ROI ≥ 0%` | LOW |
| `ROI < 0%` | KILL |
| No data | NO_DATA |

### Status Badge Styles
| Status | Color | Emoji |
|--------|-------|-------|
| SCALE | Green (`bg-primary/20`) | 🚀 |
| WATCH | Amber (`bg-warning/20`) | 👀 |
| LOW | Amber (`bg-warning/20`) | 📉 |
| KILL | Red (`bg-destructive/20`) | 🔴 |
| DEAD | Red (`bg-destructive/20`) | 💀 |
| NO_DATA / NO SPEND | Gray (`bg-secondary`) | ⏳ |

---

## Campaign Age Classification

| Age | Label | Color |
|-----|-------|-------|
| ≤ 30 days | New | Green |
| 31–90 days | Active | Blue |
| 91–180 days | Mature | Amber |
| > 180 days | Old | Gray |

---

## Source Performance Calculations (Insights Section)

Source-level KPIs are computed by grouping tracking links by `source_tag`:

| Metric | Formula |
|--------|---------|
| **Source ROI** | `(Source Profit / Source Spend) × 100` |
| **Source CPL** | `Source Spend / Source Subscribers` |
| **Source Profit/Sub** | `Source Profit / Source Subscribers` |
| **Subs/Day per Source** | Delta-based from `daily_metrics` grouped by source |
| **Distribution %** | `Source Subscribers / Total Subscribers × 100` |
| **Growth Trend** | Current period vs same-length previous period comparison |

---

## Agency Totals (useAgencyTotals hook)

Used across pages for consistent aggregate calculations:

```typescript
totalLtv         = SUM(tracking_links.ltv)           // filtered by account
totalSpend       = SUM(tracking_links.cost_total)     // only where cost_total > 0
totalProfit      = totalLtv − totalSpend
paidSubscribers  = SUM(subscribers) for links with cost_total > 0
avgProfitPerSub  = totalProfit / paidSubscribers      // null if no spend
hasSpend         = totalSpend > 0
```

---

## Model Page KPIs (AccountsPage)

Per-model cards display:

| Metric | Source |
|--------|--------|
| **Total Subs (API)** | `accounts.subscribers_count` |
| **Tracked Subs** | `SUM(tracking_links.subscribers)` for model's links |
| **LTV** | `accounts.ltv_total` / `ltv_last_7d` / `ltv_last_30d` based on period |
| **Total Spend** | `SUM(tracking_links.cost_total)` for model's links with spend |
| **Total Revenue** | `SUM(tracking_links.revenue)` for model's links |
| **Profit/Sub** | `(Effective Revenue − Total Spend) / Paid Subscribers` |
| **Blended CVR** | `Total Subscribers / Total Clicks × 100` vs agency average |

---

## Key Frontend Patterns

- **Data fetching**: All via `src/lib/supabase-helpers.ts` → Supabase JS client → React Query
- **Realtime**: Supabase channels on `tracking_links` and `sync_logs` for live dashboard updates
- **Column customization**: Drag-and-drop column ordering via `useColumnOrder` hook, persisted per-page in `localStorage`
- **Theme**: Dark/light mode via `useTheme` hook, CSS variables in `index.css`
- **Layout**: Fixed 220px sidebar (`AppSidebar`) + top header bar (`DashboardLayout`)
- **Terminology**: Revenue → LTV, ARPU → LTV/Sub, Ad Spend → Spend, Campaigns → Tracking Links

---

## External Integrations

| Integration | Method |
|-------------|--------|
| OnlyFans API | Via `https://app.onlyFansapi.com/api` — tracking links, transactions, fans, earnings |
| Airtable | Expenses sync via Airtable REST API (`sync-airtable-expenses`) |

---

## Design System

| Token | Light | Dark |
|-------|-------|------|
| Primary | `hsl(189 94% 37%)` / `#0891b2` | Same |
| Page bg | `#f0f4f8` | `#0F1117` |
| Cards | white | `#1A1D27` |
| Sidebar | `#1a3a4a` teal-navy | Same |
| Success | `#10b981` | Same |
| Warning | `#f59e0b` | Same |
| Danger | `#ef4444` | Same |

Status badges: `SCALE` = green, `WATCH` = amber, `KILL/DEAD` = red, `NO SPEND` = gray

---

## File Structure (Key Directories)

```
src/
├── pages/              # Route-level page components
├── components/
│   ├── layout/         # AppSidebar, DashboardLayout, NotificationBell
│   ├── dashboard/      # Slide-ins, date picker, KPI customizer, insights
│   ├── audit/          # CSV import/export modals
│   ├── debug/          # API debug components
│   └── ui/             # shadcn/ui primitives
├── hooks/              # useTheme, useColumnOrder, useAgencyTotals, useMobile
├── lib/                # supabase-helpers.ts, utils.ts
└── integrations/       # Supabase client + auto-generated types

supabase/
├── functions/          # Edge functions (sync-*, debug-api, auto-tag)
├── config.toml         # Project config
└── migrations/         # Database migrations (read-only)
```

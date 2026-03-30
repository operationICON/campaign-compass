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

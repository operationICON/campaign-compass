import {
  pgTable, text, uuid, boolean, numeric, timestamp, integer, jsonb, date, index, uniqueIndex
} from "drizzle-orm/pg-core";

// ── accounts ──────────────────────────────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  onlyfans_account_id:  text("onlyfans_account_id").notNull().unique(),
  display_name:         text("display_name").notNull(),
  username:             text("username"),
  avatar_url:           text("avatar_url"),
  avatar_thumb_url:     text("avatar_thumb_url"),
  header_url:           text("header_url"),
  gender_identity:      text("gender_identity"),
  subscribers_count:    integer("subscribers_count"),
  performer_top:        numeric("performer_top"),
  subscribe_price:      numeric("subscribe_price"),
  numeric_of_id:        integer("numeric_of_id"),
  ltv_total:            numeric("ltv_total"),
  ltv_last_7d:          numeric("ltv_last_7d"),
  ltv_last_30d:         numeric("ltv_last_30d"),
  ltv_last_day:         numeric("ltv_last_day"),
  ltv_messages:         numeric("ltv_messages"),
  ltv_posts:            numeric("ltv_posts"),
  ltv_subscriptions:    numeric("ltv_subscriptions"),
  ltv_tips:             numeric("ltv_tips"),
  ltv_updated_at:       timestamp("ltv_updated_at", { withTimezone: true }),
  is_active:            boolean("is_active").notNull().default(true),
  sync_enabled:         boolean("sync_enabled").default(true),
  last_seen:            timestamp("last_seen", { withTimezone: true }),
  last_synced_at:       timestamp("last_synced_at", { withTimezone: true }),
  created_at:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── campaigns ─────────────────────────────────────────────────────────────────
export const campaigns = pgTable("campaigns", {
  id:             uuid("id").primaryKey().defaultRandom(),
  account_id:     uuid("account_id").references(() => accounts.id),
  name:           text("name").notNull(),
  status:         text("status").default("active"),
  traffic_source: text("traffic_source"),
  country:        text("country"),
  created_at:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── traffic_sources ───────────────────────────────────────────────────────────
export const traffic_sources = pgTable("traffic_sources", {
  id:             uuid("id").primaryKey().defaultRandom(),
  name:           text("name").notNull(),
  category:       text("category"),
  keywords:       text("keywords").array(),
  color:          text("color"),
  campaign_count: integer("campaign_count").default(0),
  is_archived:    boolean("is_archived").default(false),
  created_at:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── tracking_links ────────────────────────────────────────────────────────────
export const tracking_links = pgTable("tracking_links", {
  id:                        uuid("id").primaryKey().defaultRandom(),
  campaign_id:               uuid("campaign_id").references(() => campaigns.id),
  account_id:                uuid("account_id").references(() => accounts.id),
  traffic_source_id:         uuid("traffic_source_id").references(() => traffic_sources.id),
  url:                       text("url"),
  external_tracking_link_id: text("external_tracking_link_id").unique(),
  campaign_name:             text("campaign_name"),
  clicks:                    integer("clicks").default(0),
  subscribers:               integer("subscribers").default(0),
  spenders:                  integer("spenders").default(0),
  spenders_count:            integer("spenders_count").default(0),
  revenue:                   numeric("revenue").default("0"),
  revenue_per_click:         numeric("revenue_per_click"),
  revenue_per_subscriber:    numeric("revenue_per_subscriber"),
  conversion_rate:           numeric("conversion_rate"),
  cost_total:                numeric("cost_total").default("0"),
  cost_type:                 text("cost_type"),
  cost_value:                numeric("cost_value"),
  capped_spend:              numeric("capped_spend"),
  cost_per_click:            numeric("cost_per_click"),
  cost_per_lead:             numeric("cost_per_lead"),
  payment_type:              text("payment_type"),
  profit:                    numeric("profit"),
  roi:                       numeric("roi"),
  cpc_real:                  numeric("cpc_real"),
  cpl_real:                  numeric("cpl_real"),
  cvr:                       numeric("cvr"),
  arpu:                      numeric("arpu"),
  ltv:                       numeric("ltv"),
  ltv_per_sub:               numeric("ltv_per_sub"),
  spender_rate:              numeric("spender_rate"),
  status:                    text("status"),
  source:                    text("source"),
  source_tag:                text("source_tag"),
  manually_tagged:           boolean("manually_tagged").default(false),
  traffic_category:          text("traffic_category"),
  country:                   text("country"),
  media_buyer:               text("media_buyer"),
  offer_id:                  integer("offer_id"),
  needs_spend:               boolean("needs_spend").default(false),
  needs_full_sync:           boolean("needs_full_sync").default(false),
  review_flag:               boolean("review_flag").default(false),
  onlytraffic_order_id:      text("onlytraffic_order_id"),
  onlytraffic_order_type:    text("onlytraffic_order_type"),
  onlytraffic_status:        text("onlytraffic_status"),
  onlytraffic_marketer:      text("onlytraffic_marketer"),
  notes:                     text("notes"),
  deleted_at:                timestamp("deleted_at", { withTimezone: true }),
  calculated_at:             timestamp("calculated_at", { withTimezone: true }),
  fans_last_synced_at:       timestamp("fans_last_synced_at", { withTimezone: true }),
  created_at:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_tracking_links_account_id").on(t.account_id),
  index("idx_tracking_links_deleted_at").on(t.deleted_at),
]);

// ── daily_metrics ─────────────────────────────────────────────────────────────
export const daily_metrics = pgTable("daily_metrics", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tracking_link_id: uuid("tracking_link_id").references(() => tracking_links.id),
  account_id:       uuid("account_id").references(() => accounts.id),
  date:             date("date").notNull(),
  clicks:           integer("clicks").default(0),
  subscribers:      integer("subscribers").default(0),
  revenue:          numeric("revenue").default("0"),
  spenders:         integer("spenders").default(0),
  new_subscribers:  integer("new_subscribers").default(0),
  new_revenue:      numeric("new_revenue").default("0"),
  conversion_rate:  numeric("conversion_rate"),
  epc:              numeric("epc"),
  created_at:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_daily_metrics_link_date").on(t.tracking_link_id, t.date),
]);

// ── daily_snapshots ───────────────────────────────────────────────────────────
export const daily_snapshots = pgTable("daily_snapshots", {
  id:                        uuid("id").primaryKey().defaultRandom(),
  tracking_link_id:          uuid("tracking_link_id").references(() => tracking_links.id),
  account_id:                uuid("account_id").references(() => accounts.id),
  external_tracking_link_id: text("external_tracking_link_id"),
  snapshot_date:             date("snapshot_date").notNull(),
  clicks:                    integer("clicks").default(0),
  subscribers:               integer("subscribers").default(0),
  revenue:                   numeric("revenue").default("0"),
  raw_clicks:                integer("raw_clicks"),
  raw_subscribers:           integer("raw_subscribers"),
  raw_revenue:               numeric("raw_revenue"),
  cost_total:                numeric("cost_total"),
  cost_per_lead:             numeric("cost_per_lead"),
  payment_type:              text("payment_type"),
  synced_at:                 timestamp("synced_at", { withTimezone: true }),
  created_at:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_daily_snapshots_link_date").on(t.tracking_link_id, t.snapshot_date),
]);

// ── tracking_link_ltv ─────────────────────────────────────────────────────────
export const tracking_link_ltv = pgTable("tracking_link_ltv", {
  id:                        uuid("id").primaryKey().defaultRandom(),
  tracking_link_id:          text("tracking_link_id").notNull().unique(),
  external_tracking_link_id: text("external_tracking_link_id"),
  account_id:                text("account_id"),
  new_subs_total:            integer("new_subs_total").default(0),
  new_subs_last_7d:          integer("new_subs_last_7d").default(0),
  new_subs_last_30d:         integer("new_subs_last_30d").default(0),
  spenders_count:            integer("spenders_count").default(0),
  spender_pct:               numeric("spender_pct"),
  total_ltv:                 numeric("total_ltv").default("0"),
  ltv_per_sub:               numeric("ltv_per_sub"),
  ltv_last_7d:               numeric("ltv_last_7d"),
  ltv_last_30d:              numeric("ltv_last_30d"),
  cross_poll_fans:           integer("cross_poll_fans").default(0),
  cross_poll_revenue:        numeric("cross_poll_revenue").default("0"),
  cross_poll_avg_per_fan:    numeric("cross_poll_avg_per_fan"),
  cross_poll_conversion_pct: numeric("cross_poll_conversion_pct"),
  is_estimated:              boolean("is_estimated").default(false),
  updated_at:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── transactions ──────────────────────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  account_id:             uuid("account_id").references(() => accounts.id),
  user_id:                text("user_id"),
  fan_id:                 text("fan_id"),
  fan_username:           text("fan_username"),
  date:                   date("date"),
  type:                   text("type"),
  revenue:                numeric("revenue").default("0"),
  revenue_net:            numeric("revenue_net"),
  fee:                    numeric("fee"),
  currency:               text("currency").default("USD"),
  status:                 text("status"),
  external_transaction_id: text("external_transaction_id").unique(),
  created_at:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_transactions_account_id").on(t.account_id),
  index("idx_transactions_date").on(t.date),
]);

// ── sync_logs ─────────────────────────────────────────────────────────────────
export const sync_logs = pgTable("sync_logs", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  account_id:           uuid("account_id").references(() => accounts.id),
  status:               text("status").notNull().default("running"),
  success:              boolean("success").default(false),
  message:              text("message"),
  error_message:        text("error_message"),
  started_at:           timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finished_at:          timestamp("finished_at", { withTimezone: true }),
  completed_at:         timestamp("completed_at", { withTimezone: true }),
  details:              jsonb("details"),
  records_processed:    integer("records_processed").default(0),
  accounts_synced:      integer("accounts_synced"),
  tracking_links_synced: integer("tracking_links_synced"),
  triggered_by:         text("triggered_by"),
  created_at:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── sync_settings ─────────────────────────────────────────────────────────────
export const sync_settings = pgTable("sync_settings", {
  id:         uuid("id").primaryKey().defaultRandom(),
  key:        text("key").notNull().unique(),
  value:      text("value"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── alerts ────────────────────────────────────────────────────────────────────
export const alerts = pgTable("alerts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  account_id:       uuid("account_id").references(() => accounts.id),
  tracking_link_id: uuid("tracking_link_id").references(() => tracking_links.id),
  type:             text("type"),
  message:          text("message"),
  account_name:     text("account_name"),
  campaign_name:    text("campaign_name"),
  triggered_at:     timestamp("triggered_at", { withTimezone: true }).defaultNow(),
  resolved:         boolean("resolved").default(false),
  resolved_at:      timestamp("resolved_at", { withTimezone: true }),
  created_at:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── notifications ─────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id:         uuid("id").primaryKey().defaultRandom(),
  type:       text("type"),
  message:    text("message"),
  read:       boolean("read").default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── manual_notes ──────────────────────────────────────────────────────────────
export const manual_notes = pgTable("manual_notes", {
  id:            uuid("id").primaryKey().defaultRandom(),
  account_id:    uuid("account_id").references(() => accounts.id),
  campaign_id:   uuid("campaign_id").references(() => campaigns.id),
  campaign_name: text("campaign_name"),
  content:       text("content"),
  note:          text("note"),
  created_by:    text("created_by"),
  created_at:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── ad_spend ──────────────────────────────────────────────────────────────────
export const ad_spend = pgTable("ad_spend", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  campaign_id:        uuid("campaign_id").references(() => campaigns.id).notNull(),
  tracking_link_id:   uuid("tracking_link_id").references(() => tracking_links.id),
  account_id:         uuid("account_id").references(() => accounts.id),
  date:               date("date").notNull(),
  amount:             numeric("amount").notNull(),
  traffic_source:     text("traffic_source"),
  spend_type:         text("spend_type"),
  cost_type:          text("cost_type"),
  cost_value:         numeric("cost_value"),
  source_tag:         text("source_tag"),
  media_buyer:        text("media_buyer"),
  notes:              text("notes"),
  airtable_record_id: text("airtable_record_id"),
  sync_source:        text("sync_source").notNull().default("manual"),
  created_at:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── source_tag_rules ──────────────────────────────────────────────────────────
export const source_tag_rules = pgTable("source_tag_rules", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tag_name:   text("tag_name").notNull(),
  keywords:   text("keywords").array(),
  color:      text("color"),
  priority:   integer("priority").default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── onlytraffic_orders ────────────────────────────────────────────────────────
export const onlytraffic_orders = pgTable("onlytraffic_orders", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  order_id:            text("order_id").notNull().unique(),
  order_number:        text("order_number"),
  order_type:          text("order_type"),
  status:              text("status"),
  source:              text("source"),
  tracking_link_id:    uuid("tracking_link_id").references(() => tracking_links.id),
  marketer:            text("marketer"),
  offer_id:            text("offer_id"),
  offer_marketer_uuid: text("offer_marketer_uuid"),
  of_account_id:       text("of_account_id"),
  price_per_unit:      numeric("price_per_unit"),
  quantity_ordered:    integer("quantity_ordered"),
  quantity_delivered:  integer("quantity_delivered"),
  total_spent:         numeric("total_spent"),
  order_created_at:    timestamp("order_created_at", { withTimezone: true }),
  order_completed_at:  timestamp("order_completed_at", { withTimezone: true }),
  synced_at:           timestamp("synced_at", { withTimezone: true }),
});

// ── onlytraffic_unmatched_orders ──────────────────────────────────────────────
export const onlytraffic_unmatched_orders = pgTable("onlytraffic_unmatched_orders", {
  id:           uuid("id").primaryKey().defaultRandom(),
  order_id:     text("order_id"),
  order_type:   text("order_type"),
  status:       text("status"),
  source:       text("source"),
  marketer:     text("marketer"),
  campaign_url: text("campaign_url"),
  total_spent:  numeric("total_spent"),
  created_at:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── fans ──────────────────────────────────────────────────────────────────────
export const fans = pgTable("fans", {
  id:                        uuid("id").primaryKey().defaultRandom(),
  fan_id:                    text("fan_id").notNull().unique(),
  first_subscribe_account:   text("first_subscribe_account"),
  first_subscribe_date:      date("first_subscribe_date"),
  first_subscribe_link_id:   uuid("first_subscribe_link_id").references(() => tracking_links.id),
  is_new_fan:                boolean("is_new_fan"),
  join_date:                 date("join_date"),
  sub_history_checked_at:    timestamp("sub_history_checked_at", { withTimezone: true }),
  // enriched fields populated by fan sync/bootstrap
  username:                  text("username"),
  display_name:              text("display_name"),
  avatar_url:                text("avatar_url"),
  status:                    text("status"),
  tags:                      text("tags").array(),
  notes:                     text("notes"),
  total_revenue:             numeric("total_revenue"),
  total_transactions:        integer("total_transactions"),
  first_transaction_at:      timestamp("first_transaction_at", { withTimezone: true }),
  last_transaction_at:       timestamp("last_transaction_at", { withTimezone: true }),
  is_cross_poll:             boolean("is_cross_poll"),
  acquired_via_account_id:   uuid("acquired_via_account_id").references(() => accounts.id),
  created_at:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── fan_account_stats ─────────────────────────────────────────────────────────
export const fan_account_stats = pgTable("fan_account_stats", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  fan_id:               uuid("fan_id").references(() => fans.id).notNull(),
  account_id:           uuid("account_id").references(() => accounts.id).notNull(),
  total_revenue:        numeric("total_revenue").default("0"),
  total_transactions:   integer("total_transactions").default(0),
  subscription_revenue: numeric("subscription_revenue").default("0"),
  tip_revenue:          numeric("tip_revenue").default("0"),
  message_revenue:      numeric("message_revenue").default("0"),
  post_revenue:         numeric("post_revenue").default("0"),
  first_transaction_at: timestamp("first_transaction_at", { withTimezone: true }),
  last_transaction_at:  timestamp("last_transaction_at", { withTimezone: true }),
  updated_at:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_fan_account_stats").on(t.fan_id, t.account_id),
]);

// ── fan_attributions ──────────────────────────────────────────────────────────
export const fan_attributions = pgTable("fan_attributions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  fan_id:               text("fan_id").notNull(),
  fan_username:         text("fan_username"),
  tracking_link_id:     uuid("tracking_link_id").references(() => tracking_links.id),
  account_id:           uuid("account_id").references(() => accounts.id),
  source:               text("source"),
  subscribe_date_approx: date("subscribe_date_approx"),
  subscribed_on_duration: text("subscribed_on_duration"),
  is_active:            boolean("is_active").default(true),
  is_expired:           boolean("is_expired").default(false),
  created_at:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── fan_spend ─────────────────────────────────────────────────────────────────
export const fan_spend = pgTable("fan_spend", {
  id:               uuid("id").primaryKey().defaultRandom(),
  fan_id:           text("fan_id").notNull(),
  tracking_link_id: uuid("tracking_link_id").references(() => tracking_links.id),
  account_id:       uuid("account_id").references(() => accounts.id),
  source:           text("source"),
  revenue:          numeric("revenue").default("0"),
  calculated_at:    timestamp("calculated_at", { withTimezone: true }),
  created_at:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── bulk_import_logs ──────────────────────────────────────────────────────────
export const bulk_import_logs = pgTable("bulk_import_logs", {
  id:            uuid("id").primaryKey().defaultRandom(),
  imported_by:   text("imported_by"),
  total_rows:    integer("total_rows"),
  created:       integer("created"),
  matched:       integer("matched"),
  deleted:       integer("deleted"),
  errors:        integer("errors"),
  error_details: jsonb("error_details"),
  created_at:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── users ─────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:             uuid("id").primaryKey().defaultRandom(),
  email:          text("email").notNull().unique(),
  password_hash:  text("password_hash").notNull(),
  name:           text("name").notNull(),
  role:           text("role").notNull().default("user"),
  created_at:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_login_at:  timestamp("last_login_at", { withTimezone: true }),
});

// ── test_logs ─────────────────────────────────────────────────────────────────
export const test_logs = pgTable("test_logs", {
  id:               uuid("id").primaryKey().defaultRandom(),
  test_name:        text("test_name"),
  status:           text("status"),
  message:          text("message"),
  response_time_ms: integer("response_time_ms"),
  account_username: text("account_username"),
  run_at:           timestamp("run_at", { withTimezone: true }),
  created_at:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

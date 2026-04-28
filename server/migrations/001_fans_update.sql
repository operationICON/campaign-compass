-- Migration: add enriched columns to fans table + new fan_account_stats table
-- Run once on Railway Postgres before deploying the updated backend

ALTER TABLE fans ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE fans ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS total_revenue NUMERIC;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS total_transactions INTEGER;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS first_transaction_at TIMESTAMPTZ;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS last_transaction_at TIMESTAMPTZ;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS is_cross_poll BOOLEAN;
ALTER TABLE fans ADD COLUMN IF NOT EXISTS acquired_via_account_id UUID REFERENCES accounts(id);

CREATE TABLE IF NOT EXISTS fan_account_stats (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id               UUID NOT NULL REFERENCES fans(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  total_revenue        NUMERIC DEFAULT '0',
  total_transactions   INTEGER DEFAULT 0,
  subscription_revenue NUMERIC DEFAULT '0',
  tip_revenue          NUMERIC DEFAULT '0',
  message_revenue      NUMERIC DEFAULT '0',
  post_revenue         NUMERIC DEFAULT '0',
  first_transaction_at TIMESTAMPTZ,
  last_transaction_at  TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(fan_id, account_id)
);

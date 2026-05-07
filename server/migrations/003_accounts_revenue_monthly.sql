-- Migration: add revenue_monthly to accounts for All Time chart
-- Run once on Railway Postgres before deploying the updated backend

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS revenue_monthly JSONB;

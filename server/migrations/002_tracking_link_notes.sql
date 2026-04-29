-- Migration: add notes column to tracking_links
-- Run once on Railway Postgres before deploying the updated backend

ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS notes TEXT;

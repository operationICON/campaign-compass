ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS subscribers_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performer_top numeric,
  ADD COLUMN IF NOT EXISTS subscribe_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen timestamp with time zone;
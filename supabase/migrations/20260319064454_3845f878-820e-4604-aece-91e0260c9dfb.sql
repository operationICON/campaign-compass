ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS revenue_net numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fan_id text,
  ADD COLUMN IF NOT EXISTS fan_username text,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS status text;
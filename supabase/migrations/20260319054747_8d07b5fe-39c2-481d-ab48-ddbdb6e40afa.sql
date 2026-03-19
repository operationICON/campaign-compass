
-- Create transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_transaction_id text UNIQUE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id text,
  revenue numeric NOT NULL DEFAULT 0,
  type text,
  date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage transactions"
  ON public.transactions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Add missing columns to tracking_links
ALTER TABLE public.tracking_links
  ADD COLUMN IF NOT EXISTS campaign_name text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS country text;

-- Add missing columns to ad_spend
ALTER TABLE public.ad_spend
  ADD COLUMN IF NOT EXISTS media_buyer text,
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- Add missing columns to sync_logs
ALTER TABLE public.sync_logs
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS success boolean,
  ADD COLUMN IF NOT EXISTS error_message text;

-- Add missing columns to manual_notes
ALTER TABLE public.manual_notes
  ADD COLUMN IF NOT EXISTS campaign_name text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_by text;

-- Add unique constraint on daily_metrics (tracking_link_id, date) if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_metrics_tracking_link_id_date_key'
  ) THEN
    ALTER TABLE public.daily_metrics ADD CONSTRAINT daily_metrics_tracking_link_id_date_key UNIQUE (tracking_link_id, date);
  END IF;
END $$;

-- Add account_id to daily_metrics if missing
ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS epc numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric DEFAULT 0;

-- Enable realtime for transactions
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;

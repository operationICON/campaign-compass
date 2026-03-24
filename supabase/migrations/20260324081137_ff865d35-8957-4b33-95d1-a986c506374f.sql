
ALTER TABLE public.sync_logs 
ADD COLUMN IF NOT EXISTS accounts_synced integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS tracking_links_synced integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS triggered_by text DEFAULT 'manual';

-- Add username and last_synced_at to accounts
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;

-- Add external_tracking_link_id to tracking_links
ALTER TABLE public.tracking_links ADD COLUMN IF NOT EXISTS external_tracking_link_id text;
ALTER TABLE public.tracking_links ADD CONSTRAINT tracking_links_external_id_key UNIQUE (external_tracking_link_id);

-- Add records_processed to sync_logs
ALTER TABLE public.sync_logs ADD COLUMN IF NOT EXISTS records_processed integer NOT NULL DEFAULT 0;
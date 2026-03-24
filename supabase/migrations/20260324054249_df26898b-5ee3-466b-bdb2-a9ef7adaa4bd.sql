ALTER TABLE public.ad_spend ADD COLUMN IF NOT EXISTS sync_source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.ad_spend ADD COLUMN IF NOT EXISTS airtable_record_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_airtable_record_id_key ON public.ad_spend (airtable_record_id) WHERE airtable_record_id IS NOT NULL;
ALTER TABLE public.ad_spend ADD COLUMN IF NOT EXISTS tracking_link_id uuid REFERENCES public.tracking_links(id);
ALTER TABLE public.ad_spend ADD COLUMN IF NOT EXISTS spend_type text;
ALTER TABLE public.ad_spend ADD COLUMN IF NOT EXISTS source_tag text;

-- Source tag rules table
CREATE TABLE public.source_tag_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_name text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  color text NOT NULL DEFAULT '#0891b2',
  priority integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.source_tag_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read source_tag_rules" ON public.source_tag_rules FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated manage source_tag_rules" ON public.source_tag_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add manually_tagged column to tracking_links
ALTER TABLE public.tracking_links ADD COLUMN IF NOT EXISTS manually_tagged boolean NOT NULL DEFAULT false;

-- Add source_tag column to tracking_links (separate from existing source column)
ALTER TABLE public.tracking_links ADD COLUMN IF NOT EXISTS source_tag text;

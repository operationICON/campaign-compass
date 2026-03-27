
CREATE TABLE public.traffic_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'Direct' CHECK (category IN ('Direct', 'OnlyTraffic')),
  keywords text[] NOT NULL DEFAULT '{}'::text[],
  color text NOT NULL DEFAULT '#0891b2',
  campaign_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.traffic_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read traffic_sources" ON public.traffic_sources FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated manage traffic_sources" ON public.traffic_sources FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.tracking_links ADD COLUMN IF NOT EXISTS traffic_source_id uuid REFERENCES public.traffic_sources(id);

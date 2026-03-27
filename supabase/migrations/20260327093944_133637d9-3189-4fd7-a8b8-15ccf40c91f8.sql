ALTER TABLE public.traffic_sources DROP CONSTRAINT traffic_sources_category_check;
ALTER TABLE public.traffic_sources ADD CONSTRAINT traffic_sources_category_check CHECK (category = ANY (ARRAY['Direct'::text, 'OnlyTraffic'::text, 'Manual'::text]));
UPDATE public.traffic_sources SET category = 'Manual' WHERE category = 'Direct';
ALTER TABLE public.traffic_sources ALTER COLUMN category SET DEFAULT 'Manual';
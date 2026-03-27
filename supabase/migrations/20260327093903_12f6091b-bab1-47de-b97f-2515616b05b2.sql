
CREATE POLICY "Allow anon insert traffic_sources"
ON public.traffic_sources
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon update traffic_sources"
ON public.traffic_sources
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anon delete traffic_sources"
ON public.traffic_sources
FOR DELETE
TO anon
USING (true);

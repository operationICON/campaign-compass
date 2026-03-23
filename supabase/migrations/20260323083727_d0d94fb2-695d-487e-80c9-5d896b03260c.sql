CREATE POLICY "Allow public update tracking_links"
ON public.tracking_links
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public insert ad_spend"
ON public.ad_spend
FOR INSERT
TO anon
WITH CHECK (true);
CREATE POLICY "Allow public delete ad_spend"
ON public.ad_spend
FOR DELETE
TO anon
USING (true);
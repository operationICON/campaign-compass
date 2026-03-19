
CREATE POLICY "Allow public read access to tracking_links"
  ON public.tracking_links FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public read access to accounts"
  ON public.accounts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public read access to campaigns"
  ON public.campaigns FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public read access to ad_spend"
  ON public.ad_spend FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public read access to transactions"
  ON public.transactions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public read access to sync_logs"
  ON public.sync_logs FOR SELECT
  TO anon
  USING (true);

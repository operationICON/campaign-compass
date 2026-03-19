
-- Alerts table for zero-click and other campaign alerts
CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name text,
  account_name text,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  tracking_link_id uuid REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'zero_clicks',
  message text,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to alerts" ON public.alerts FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated users can manage alerts" ON public.alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Sync settings table for configurable sync frequency
CREATE TABLE public.sync_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to sync_settings" ON public.sync_settings FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated users can manage sync_settings" ON public.sync_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Insert default sync frequency (3 days)
INSERT INTO public.sync_settings (key, value) VALUES ('sync_frequency_days', '3');

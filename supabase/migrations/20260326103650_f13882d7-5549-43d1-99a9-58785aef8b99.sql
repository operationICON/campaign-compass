
-- Create fan_attributions table
CREATE TABLE public.fan_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id TEXT NOT NULL,
  fan_username TEXT,
  tracking_link_id UUID REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  subscribed_on_duration TEXT,
  subscribe_date_approx DATE,
  is_active BOOLEAN DEFAULT true,
  is_expired BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fan_id, tracking_link_id)
);

-- Create fan_spend table
CREATE TABLE public.fan_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id TEXT NOT NULL,
  tracking_link_id UUID REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  revenue DECIMAL(12,2) DEFAULT 0,
  calculated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fan_id, tracking_link_id)
);

-- Add new LTV columns to tracking_links
ALTER TABLE public.tracking_links
  ADD COLUMN IF NOT EXISTS ltv DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ltv_per_sub DECIMAL(12,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spenders_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spender_rate DECIMAL(8,2) DEFAULT 0;

-- Enable RLS on new tables
ALTER TABLE public.fan_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_spend ENABLE ROW LEVEL SECURITY;

-- RLS policies for fan_attributions
CREATE POLICY "Allow public read fan_attributions" ON public.fan_attributions FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated manage fan_attributions" ON public.fan_attributions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- RLS policies for fan_spend
CREATE POLICY "Allow public read fan_spend" ON public.fan_spend FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated manage fan_spend" ON public.fan_spend FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime for fan tables (optional, for future use)
ALTER PUBLICATION supabase_realtime ADD TABLE public.fan_attributions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fan_spend;

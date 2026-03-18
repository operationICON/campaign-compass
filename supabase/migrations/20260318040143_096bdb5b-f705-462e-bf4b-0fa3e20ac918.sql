
-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Accounts table
CREATE TABLE public.accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  onlyfans_account_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read accounts" ON public.accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert accounts" ON public.accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update accounts" ON public.accounts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete accounts" ON public.accounts FOR DELETE TO authenticated USING (true);
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Campaigns table
CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  traffic_source TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage campaigns" ON public.campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tracking links table
CREATE TABLE public.tracking_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  subscribers INTEGER NOT NULL DEFAULT 0,
  spenders INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_per_click NUMERIC(12,4) NOT NULL DEFAULT 0,
  revenue_per_subscriber NUMERIC(12,4) NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tracking_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage tracking_links" ON public.tracking_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_tracking_links_updated_at BEFORE UPDATE ON public.tracking_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Daily metrics table
CREATE TABLE public.daily_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tracking_link_id UUID NOT NULL REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  subscribers INTEGER NOT NULL DEFAULT 0,
  spenders INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tracking_link_id, date)
);
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage daily_metrics" ON public.daily_metrics FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ad spend table
CREATE TABLE public.ad_spend (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  traffic_source TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage ad_spend" ON public.ad_spend FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_ad_spend_updated_at BEFORE UPDATE ON public.ad_spend FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Manual notes table
CREATE TABLE public.manual_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage manual_notes" ON public.manual_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_manual_notes_updated_at BEFORE UPDATE ON public.manual_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sync logs table
CREATE TABLE public.sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  details JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage sync_logs" ON public.sync_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add conversion_rate column to tracking_links
ALTER TABLE public.tracking_links ADD COLUMN IF NOT EXISTS conversion_rate numeric NOT NULL DEFAULT 0;

-- Create a view for campaign-level performance with ad spend, profit, ROI
CREATE OR REPLACE VIEW public.campaign_performance AS
SELECT
  c.id AS campaign_id,
  c.name AS campaign_name,
  c.account_id,
  a.display_name AS account_name,
  c.traffic_source,
  c.country,
  COALESCE(SUM(tl.clicks), 0) AS total_clicks,
  COALESCE(SUM(tl.subscribers), 0) AS total_subscribers,
  COALESCE(SUM(tl.spenders), 0) AS total_spenders,
  COALESCE(SUM(tl.revenue), 0) AS total_revenue,
  CASE WHEN SUM(tl.clicks) > 0 THEN SUM(tl.revenue) / SUM(tl.clicks) ELSE 0 END AS epc,
  CASE WHEN SUM(tl.clicks) > 0 THEN (SUM(tl.subscribers)::numeric / SUM(tl.clicks)) * 100 ELSE 0 END AS conversion_rate,
  CASE WHEN SUM(tl.subscribers) > 0 THEN SUM(tl.revenue) / SUM(tl.subscribers) ELSE 0 END AS revenue_per_subscriber,
  COALESCE(ad.total_ad_spend, 0) AS total_ad_spend,
  COALESCE(SUM(tl.revenue), 0) - COALESCE(ad.total_ad_spend, 0) AS profit,
  CASE WHEN COALESCE(ad.total_ad_spend, 0) > 0
    THEN ((COALESCE(SUM(tl.revenue), 0) - COALESCE(ad.total_ad_spend, 0)) / ad.total_ad_spend) * 100
    ELSE 0 END AS roi
FROM public.campaigns c
LEFT JOIN public.accounts a ON a.id = c.account_id
LEFT JOIN public.tracking_links tl ON tl.campaign_id = c.id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount), 0) AS total_ad_spend
  FROM public.ad_spend
  WHERE campaign_id = c.id
) ad ON true
GROUP BY c.id, c.name, c.account_id, a.display_name, c.traffic_source, c.country, ad.total_ad_spend;
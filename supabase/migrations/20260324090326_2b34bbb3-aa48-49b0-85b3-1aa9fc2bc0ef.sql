
-- Add new columns to daily_metrics for delta tracking
ALTER TABLE public.daily_metrics 
  ADD COLUMN IF NOT EXISTS new_subscribers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_revenue numeric NOT NULL DEFAULT 0;

-- Add indexes for efficient time-period queries
CREATE INDEX IF NOT EXISTS idx_daily_metrics_account_date ON public.daily_metrics (account_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_link_date ON public.daily_metrics (tracking_link_id, date);

-- Create get_ltv_by_period function
CREATE OR REPLACE FUNCTION public.get_ltv_by_period(
  p_period text,
  p_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_total_ltv numeric := 0;
  v_total_new_subs bigint := 0;
  v_ltv_per_sub numeric := 0;
  v_data_available boolean := false;
  v_snapshot_count bigint := 0;
BEGIN
  -- Check data availability
  SELECT COUNT(DISTINCT date) INTO v_snapshot_count FROM daily_metrics
    WHERE (p_account_id IS NULL OR account_id = p_account_id);
  
  v_data_available := v_snapshot_count >= 2;

  IF p_period = 'all_time' THEN
    SELECT COALESCE(SUM(revenue), 0), COALESCE(SUM(subscribers), 0)
    INTO v_total_ltv, v_total_new_subs
    FROM tracking_links
    WHERE (p_account_id IS NULL OR account_id = p_account_id);
  
  ELSIF p_period = 'last_day' THEN
    SELECT COALESCE(SUM(new_revenue), 0), COALESCE(SUM(new_subscribers), 0)
    INTO v_total_ltv, v_total_new_subs
    FROM daily_metrics
    WHERE date = current_date
      AND (p_account_id IS NULL OR account_id = p_account_id);

  ELSIF p_period = 'last_week' THEN
    SELECT COALESCE(SUM(new_revenue), 0), COALESCE(SUM(new_subscribers), 0)
    INTO v_total_ltv, v_total_new_subs
    FROM daily_metrics
    WHERE date >= current_date - 7
      AND (p_account_id IS NULL OR account_id = p_account_id);

  ELSIF p_period = 'since_last_sync' THEN
    SELECT COALESCE(SUM(new_revenue), 0), COALESCE(SUM(new_subscribers), 0)
    INTO v_total_ltv, v_total_new_subs
    FROM daily_metrics
    WHERE date = (SELECT MAX(date) FROM daily_metrics)
      AND (p_account_id IS NULL OR account_id = p_account_id);

  ELSIF p_period = 'last_month' THEN
    SELECT COALESCE(SUM(new_revenue), 0), COALESCE(SUM(new_subscribers), 0)
    INTO v_total_ltv, v_total_new_subs
    FROM daily_metrics
    WHERE date >= current_date - 30
      AND (p_account_id IS NULL OR account_id = p_account_id);

  ELSIF p_period = 'prev_month' THEN
    SELECT COALESCE(SUM(new_revenue), 0), COALESCE(SUM(new_subscribers), 0)
    INTO v_total_ltv, v_total_new_subs
    FROM daily_metrics
    WHERE date BETWEEN current_date - 60 AND current_date - 30
      AND (p_account_id IS NULL OR account_id = p_account_id);
  END IF;

  IF v_total_new_subs > 0 THEN
    v_ltv_per_sub := v_total_ltv / v_total_new_subs;
  END IF;

  result := jsonb_build_object(
    'period', p_period,
    'total_ltv', v_total_ltv,
    'total_new_subs', v_total_new_subs,
    'ltv_per_sub', v_ltv_per_sub,
    'data_available', v_data_available
  );

  RETURN result;
END;
$$;

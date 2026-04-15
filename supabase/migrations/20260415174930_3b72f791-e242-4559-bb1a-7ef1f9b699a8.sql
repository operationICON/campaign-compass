
CREATE TRIGGER trg_recalculate_tracking_link_metrics
  BEFORE INSERT OR UPDATE ON public.tracking_links
  FOR EACH ROW
  EXECUTE FUNCTION public.recalculate_tracking_link_metrics();

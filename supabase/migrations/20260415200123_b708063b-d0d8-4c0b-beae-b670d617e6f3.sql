CREATE TRIGGER recalculate_tracking_link_metrics_trigger
BEFORE INSERT OR UPDATE ON public.tracking_links
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_tracking_link_metrics();
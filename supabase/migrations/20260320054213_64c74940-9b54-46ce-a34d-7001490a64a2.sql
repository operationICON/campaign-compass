CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to notifications" ON public.notifications FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert to notifications" ON public.notifications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Authenticated users can manage notifications" ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
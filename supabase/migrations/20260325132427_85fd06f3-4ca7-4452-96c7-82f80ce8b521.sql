CREATE TABLE public.test_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamp with time zone NOT NULL DEFAULT now(),
  test_name text NOT NULL,
  status text NOT NULL DEFAULT 'pass',
  message text,
  response_time_ms integer,
  account_username text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.test_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read test_logs" ON public.test_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert test_logs" ON public.test_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public delete test_logs" ON public.test_logs FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated manage test_logs" ON public.test_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
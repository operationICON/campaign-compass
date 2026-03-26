
ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS bulk_import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by TEXT DEFAULT 'manual',
  total_rows INTEGER DEFAULT 0,
  matched INTEGER DEFAULT 0,
  created INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bulk_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read bulk_import_logs" ON bulk_import_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated manage bulk_import_logs" ON bulk_import_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon insert bulk_import_logs" ON bulk_import_logs FOR INSERT TO anon WITH CHECK (true);

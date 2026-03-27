
ALTER TABLE tracking_links
ADD COLUMN IF NOT EXISTS fans_last_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS needs_full_sync BOOLEAN DEFAULT true;

ALTER TABLE fan_attributions
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'api',
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE fan_spend
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'api',
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add unique constraints for upsert conflict targets
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fan_attributions_fan_id_tracking_link_id_key') THEN
    ALTER TABLE fan_attributions ADD CONSTRAINT fan_attributions_fan_id_tracking_link_id_key UNIQUE (fan_id, tracking_link_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fan_spend_fan_id_tracking_link_id_key') THEN
    ALTER TABLE fan_spend ADD CONSTRAINT fan_spend_fan_id_tracking_link_id_key UNIQUE (fan_id, tracking_link_id);
  END IF;
END $$;

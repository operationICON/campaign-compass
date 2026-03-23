ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS avatar_thumb_url TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS header_url TEXT;
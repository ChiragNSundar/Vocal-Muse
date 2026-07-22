
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.tracks ALTER COLUMN user_id DROP NOT NULL;
DROP POLICY IF EXISTS "Users delete own tracks" ON public.tracks;
DROP POLICY IF EXISTS "Users insert own tracks" ON public.tracks;
DROP POLICY IF EXISTS "Users update own tracks" ON public.tracks;
DROP POLICY IF EXISTS "Users view own tracks" ON public.tracks;
ALTER TABLE public.tracks DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS tracks_device_id_idx ON public.tracks (device_id, created_at DESC);


ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tracks TO service_role;
REVOKE ALL ON public.tracks FROM anon, authenticated;

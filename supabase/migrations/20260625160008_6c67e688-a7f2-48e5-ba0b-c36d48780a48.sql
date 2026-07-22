
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS style_brief jsonb,
  ADD COLUMN IF NOT EXISTS cadence_map jsonb,
  ADD COLUMN IF NOT EXISTS quality jsonb;

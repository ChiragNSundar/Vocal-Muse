# Pillar: Live Punch-In Mode

A dedicated studio screen where the artist hits record, hears a click/beat, and watches lyrics assemble bar-by-bar as they freestyle. No "stop → upload → wait" loop. Built on the existing pipeline (cadence map → write → critic) but driven by streaming chunks.

## New route

`src/routes/_app/live.$id.tsx` (also reachable as `/live` for an unsaved scratch session). Nav entry added to `src/routes/_app.tsx` next to **New**.

## UI (one screen, three lanes)

```text
┌──────────────────────────────────────────────────────────┐
│  ●REC  00:42   BPM 92  ▮▮▯▯  Bar 6/16   Take 2  ⏎ Punch │  ← transport
├──────────────────────────────────────────────────────────┤
│  Beat:  ▁▂▅█▅▂▁  (waveform + click dots on every beat)   │  ← timeline
│  Mic:   ░░▒▓█▓▒  (live VU + 8s scrolling oscilloscope)   │
├──────────────────────────────────────────────────────────┤
│  Bar 4  "rolling through the city in a foreign whip"  ✓ │  ← bar stream
│  Bar 5  "diamonds on my pinky leave a corner lit"     ✓ │
│  Bar 6  …mumble mumble pocket…                    ◐ live│
└──────────────────────────────────────────────────────────┘
```

- **Transport**: record / pause / punch-in (re-record current bar only) / take. Space = rec, P = punch, ⌘↵ = commit take.
- **Click track**: WebAudio metronome, optional beat upload (drag-drop mp3/wav), tap-tempo to set BPM.
- **Bar stream**: each finalized bar drops in with the same `BarRow` UI from `track.$id.tsx` — instant rewrite/alternates/lock without leaving the live screen.
- **Take stack**: every record pass is saved as a `Take`; switch takes in the sidebar to A/B flows on the same beat.

## Capture pipeline (browser)

`src/lib/live-capture.ts`

- WebAudio `AudioWorklet` → Float32 PCM ring buffer (16 kHz mono).
- Bar segmenter slices the buffer on beat boundaries derived from BPM + first downbeat (default = 4 beats / bar, configurable 2/3/4/6/8).
- Each bar window (≈2.6 s @ 92 BPM) is encoded to a complete WAV via `encodeWav()` — never `MediaRecorder` timeslice (header-only fragments fail STT).
- Silence guard: bars under an RMS floor or < 2 kB are skipped, not sent.
- Cache key = sha256(pcm) → reuses transcripts via existing `src/lib/cache.ts` `transcribe` namespace, so re-takes of identical audio are free.

## Streaming transcription

`src/lib/tracks.functions.ts` → new `transcribeBarStream` server fn.

- Forwards `multipart/form-data` to `https://ai.gateway.lovable.dev/v1/audio/transcriptions` with `model: openai/gpt-4o-mini-transcribe`, `stream: "true"`, and pipes the SSE body back to the client unchanged (`Content-Type: text/event-stream`).
- Client reads `transcript.text.delta` events to paint the partial mumble under the "live" bar, then `transcript.text.done` to lock the bar text and trigger lyric generation.
- Local mode: routes to `src/lib/local-transcribe.ts` (`faster-whisper-server`) with the same chunk-per-bar contract.

## Bar-streaming lyric generation

`src/lib/live-pipeline.ts`

- For each finalized bar transcript, run a slim 2-pass pipeline: **cadence-lock rewrite** → **single-critic pocket score**. Full 4-pass council only runs on `Commit take`.
- Uses existing `loadMemory()` few-shots + `recallSimilar()` embeddings for context, and the burned-vowel set so consecutive live bars don't all end on the same nucleus.
- Bounded concurrency (3 in flight) so a long freestyle doesn't stall the gateway.

## Take persistence

DB migration `add_takes_to_tracks`:

```sql
CREATE TABLE public.takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  device_id text NOT NULL,
  bpm int,
  beat_path text,
  bars jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{idx, audioPath, transcript, lyric, score}]
  duration_ms int,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.takes TO authenticated;
GRANT ALL ON public.takes TO service_role;
ALTER TABLE public.takes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "device owns take" ON public.takes
  FOR ALL USING (true) WITH CHECK (true);  -- device_id scoped in queries (matches existing tracks model)
```

Bar audio chunks upload to the existing storage bucket under `takes/<takeId>/bar-<idx>.wav`. The full mixdown (beat + mic) is rendered on `Commit take` and saved as the track's audio.

## Shortcuts (carry the track-screen muscle memory)

- `Space` record/pause · `P` punch current bar · `⌘↵` commit take · `T` new take · `[`/`]` BPM −/+ · `M` mute click · `R` rewrite live bar · `L` lock bar.

## Files added/changed

- New: `src/routes/_app/live.$id.tsx`, `src/routes/_app/live.tsx` (scratch), `src/lib/live-capture.ts`, `src/lib/live-pipeline.ts`, `src/lib/wav.ts`, `src/components/LiveTransport.tsx`, `src/components/BarStream.tsx`, `src/components/Metronome.tsx`, `src/components/TakeSidebar.tsx`, `src/lib/takes.functions.ts`.
- Changed: `src/routes/_app.tsx` (nav), `src/lib/tracks.functions.ts` (streaming STT fn), `src/lib/local-transcribe.ts` (chunk contract), `src/routes/_app/track.$id.tsx` ("Open in Live" button).
- Migration: `takes` table + storage path convention.

## Out of scope this round

Beat-stem separation, per-bar pitch correction, multi-user collab, mobile PWA install (separate pillar).

## Build order

1. Capture + metronome + WAV chunker (no AI yet) → verify bar boundaries against an uploaded beat.
2. Streaming STT server fn + SSE wiring → live partial text under bar.
3. Live 2-pass lyric pipeline + `BarRow` reuse.
4. Takes persistence + sidebar + commit-to-track flow.
5. Shortcuts, polish, tests (`live-capture` bar-slicer unit test; `live-pipeline` concurrency test).
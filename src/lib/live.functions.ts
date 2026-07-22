// Server functions for the Live Punch-In Mode.
//
// `transcribeBar` — per-bar STT for short (~2-3s) WAV chunks. Uses the
//   gateway's openai/gpt-4o-mini-transcribe non-streaming endpoint (bar
//   windows are too short for streaming to matter, and SSE through TanStack
//   server fns adds plumbing without payoff for sub-3s chunks).
// `generateLiveBar` — turns one finalized mumble bar into a finished line
//   via the same `rewriteSingleBar` ghostwriter the bar editor uses.
// `commitLiveTake` — uploads the final mixdown WAV and persists the take
//   as a regular track (status='done'), bypassing the heavy 4-pass
//   pipeline since the bars are already locked in.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { countSyllables, endRhymeKey, type CadenceMap, type StyleBrief, type QualityScore } from "./lyrics-analysis";

const DeviceId = z.string().min(8).max(128);

const StyleBriefSchema = z.object({
  genre: z.string().optional(),
  attitude: z.array(z.string()).optional(),
  rhymeDensity: z.number().min(1).max(5).optional(),
  slangRegion: z.string().optional(),
  customSlang: z.string().optional(),
  topic: z.string().optional(),
  avoid: z.string().optional(),
  explicit: z.boolean().optional(),
  structuralRules: z.string().optional(),
  fingerprint: z.any().optional().nullable(),
}).optional();

// ---------- transcribeBar ----------
const TranscribeInput = z.object({
  deviceId: DeviceId,
  base64: z.string().min(1),
  mime: z.string().min(1).max(60),
  filename: z.string().min(1).max(120),
});

export const transcribeBar = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TranscribeInput.parse(input))
  .handler(async ({ data }): Promise<{ text: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const binary = Buffer.from(data.base64, "base64");
    if (binary.length < 256) return { text: "" }; // silence guard
    if (binary.length > 3 * 1024 * 1024) throw new Error("Bar chunk too large");
    const blob = new Blob([new Uint8Array(binary)], { type: data.mime });
    const { transcribeAudio } = await import("./ai-gateway.server");
    const text = await transcribeAudio(apiKey, blob, data.filename);
    return { text: (text || "").trim() };
  });

// ---------- generateLiveBar ----------
const GenerateBarInput = z.object({
  deviceId: DeviceId,
  mumble: z.string().min(1).max(400),
  brief: StyleBriefSchema,
  neighborsBefore: z.array(z.string().max(200)).max(3).optional(),
  burnedPhrases: z.array(z.string().max(120)).max(40).optional(),
  burnedVowels: z.array(z.string().max(20)).max(30).optional(),
});

export const generateLiveBar = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => GenerateBarInput.parse(input))
  .handler(async ({ data }): Promise<{ line: string; syllables: number; endSound: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const { rewriteSingleBar } = await import("./critics");

    const targetSyllables = Math.max(2, countSyllables(data.mumble));
    const targetEndSound = endRhymeKey(data.mumble) || "ah";

    const line = await rewriteSingleBar(apiKey, {
      original: data.mumble, // mumble doubles as the placeholder line
      sourceMumble: data.mumble,
      targetSyllables,
      targetEndSound,
      section: "verse",
      brief: data.brief as StyleBrief | undefined,
      options: {},
      burnedPhrases: data.burnedPhrases ?? [],
      burnedVowels: data.burnedVowels ?? [],
      neighborsBefore: data.neighborsBefore ?? [],
      neighborsAfter: [],
    });
    return { line, syllables: targetSyllables, endSound: targetEndSound };
  });

// ---------- commitLiveTake ----------
const CommitBar = z.object({
  index: z.number().int().min(0),
  transcript: z.string().max(400),
  line: z.string().min(1).max(400),
  syllables: z.number().int().min(1).max(64),
  endSound: z.string().max(20),
});

const CommitInput = z.object({
  deviceId: DeviceId,
  bars: z.array(CommitBar).min(1).max(128),
  bpm: z.number().int().min(40).max(220),
  title: z.string().max(80).optional(),
  brief: StyleBriefSchema,
  // Final mixed WAV (mic + click optional) for playback in the track view.
  base64: z.string().min(1),
  mime: z.string().min(1).max(60),
  filename: z.string().min(1).max(120),
});

export const commitLiveTake = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CommitInput.parse(input))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const binary = Buffer.from(data.base64, "base64");
    if (binary.length === 0) throw new Error("Empty mixdown");
    if (binary.length > 25 * 1024 * 1024) throw new Error("Mixdown too large (max 25 MB)");
    const ext = (data.filename.split(".").pop() || "wav").toLowerCase();
    const path = `${data.deviceId}/live-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("vocals")
      .upload(path, binary, { contentType: data.mime, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const cadence: CadenceMap = {
      bars: data.bars.map((b, i) => ({
        index: i + 1,
        syllables: b.syllables,
        endSound: b.endSound || "ah",
        section: "verse",
        text: b.transcript || "—",
      })),
      detectedVibe: "live",
      detectedKeyPhrases: [],
    };

    const lines = data.bars.map((b) => b.line);
    const lyrics = {
      title: (data.title || "Live take").slice(0, 80),
      sections: [{ type: "verse", lines }],
    };

    const quality: QualityScore & { drakeScore?: number; live?: boolean } = {
      cadenceMatch: 1,
      rhymeDensity: 0,
      clicheCount: 0,
      vibeConsistency: 4,
      barCount: lines.length,
      drakeScore: 0,
      live: true,
    };

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("tracks")
      .insert({
        device_id: data.deviceId,
        audio_path: path,
        status: "done",
        title: lyrics.title,
        raw_transcript: data.bars.map((b) => b.transcript).filter(Boolean).join("\n"),
        lyrics: JSON.parse(JSON.stringify(lyrics)),
        cadence_map: JSON.parse(JSON.stringify(cadence)),
        quality: JSON.parse(JSON.stringify(quality)),
        style_brief: data.brief ? JSON.parse(JSON.stringify(data.brief)) : null,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`DB insert failed: ${insErr.message}`);
    return { id: inserted.id as string };
  });

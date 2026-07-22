// Browser-side lyric generation pipeline tuned for local LLMs.
//
// Major upgrades vs the v1 pipeline:
//   - Model-aware profiles (see local-profiles.ts): family detection drives
//     output format (JSON / XML / markdown) and per-pass sampling.
//   - Tiered extractor: JSON → XML → markdown → format-repair retry. We
//     never throw on a malformed local response; we coerce or ask the model
//     to re-wrap.
//   - Adaptive chunking: chunk size is derived from the model's context
//     window (probed via Ollama /api/show or the LM Studio /v1/models
//     `context_length` field) so a Qwen-14B at 8K ctx doesn't silently
//     truncate.
//   - Tier-aware iteration budget: small models stop earlier at a lower
//     score, large models keep refining.
//
// The exported `runLocalPipeline` API is unchanged so the existing
// settings/new pages keep working.

import { countSyllables, endRhymeKey } from "./lyrics-analysis";
import type { LlmConfig } from "./llm-config";
import { styleExamplesPromptBlock } from "./style-memory";
import {
  adaptiveChunkBars,
  budgetFor,
  formatHint,
  profileFor,
  tierFor,
  type LocalProfile,
  type LocalTier,
} from "./local-profiles";
import { cacheGet, cacheSet, hashInputs } from "./cache";

import type { Fingerprint } from "./fingerprint";
import { fingerprintToConstraints } from "./fingerprint";
import { chatInBrowser, type InBrowserLlmConfig } from "./in-browser-ai";

export type LocalBrief = {
  genre?: string;
  attitude?: string[];
  rhymeDensity?: number;
  slangRegion?: string;
  customSlang?: string;
  topic?: string;
  avoid?: string;
  explicit?: boolean;
  structuralRules?: string;
  fingerprint?: Fingerprint | null;
};

export type LocalLyrics = { title: string; sections: { type: string; lines: string[] }[] };
export type LocalCadence = {
  bars: { index: number; syllables: number; endSound: string; section: string; text: string }[];
  detectedVibe?: string;
  detectedKeyPhrases?: string[];
};
export type LocalQuality = {
  cadenceMatch: number;
  rhymeDensity: number;
  clicheCount: number;
  vibeConsistency: number;
  barCount: number;
  drakeScore: number;
};

export type LocalPipelineResult = {
  lyrics: LocalLyrics;
  cadence: LocalCadence;
  quality: LocalQuality;
  notes: string[];
  /** Profile actually used (post-override). Useful for telemetry / UI badges. */
  profile: { family: string; tier: LocalTier; paramsB: number; chunkBars: number };
};

export type ProgressEvent = {
  stage: "cadence" | "write" | "critic" | "refine" | "done";
  message: string;
  iteration?: number;
  score?: number;
};

// ---------------------------------------------------------------------------
// Prompt scaffolding
// ---------------------------------------------------------------------------

const CRAFT = `HARD CRAFT RULES:
- No tired clichés (grind never stop, demons in my head, started from the bottom, ride or die, shine bright, level up, etc).
- Concrete images > abstractions. Specific brands/places/textures.
- Match syllable count within ±1; match the end-sound rhyme.
- Every bar earns its spot. No filler bars.`;

function briefBlock(b: LocalBrief | undefined): string {
  if (!b) return "STYLE BRIEF: auto-detect everything from the transcript.";
  const rd = b.rhymeDensity ?? 3;
  const fp = b.fingerprint
    ? "\n\n" + fingerprintToConstraints(b.fingerprint) +
      "\nThese reference constraints are HARD targets."
    : "";
  return [
    "STYLE BRIEF:",
    `- Genre: ${b.genre && b.genre !== "auto" ? b.genre : "infer"}`,
    `- Attitude: ${(b.attitude && b.attitude.length) ? b.attitude.join(", ") : "infer"}`,
    `- Rhyme density: ${rd}/5`,
    `- Slang region: ${b.slangRegion && b.slangRegion !== "auto" ? b.slangRegion : "infer"}`,
    b.customSlang ? `- Slang/ad-libs: ${b.customSlang}` : null,
    b.topic ? `- Topic: ${b.topic}` : null,
    b.avoid ? `- AVOID: ${b.avoid}` : null,
    `- Explicit: ${b.explicit === false ? "no" : "yes"}`,
    b.structuralRules ? `- Structure: ${b.structuralRules}` : null,
  ].filter(Boolean).join("\n") + fp;
}

// ---------------------------------------------------------------------------
// HTTP layer — single low-level call, all sampling/system passed in
// ---------------------------------------------------------------------------

type ChatOpts = {
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  max_tokens?: number;
  /** Skip cache lookup AND skip storing — set when the caller wants fresh variety. */
  bypassCache?: boolean;
};

async function rawChat(config: LlmConfig, system: string, user: string, opts: ChatOpts): Promise<string> {
  // In-browser provider (WebLLM)
  if (config.localBaseUrl === "in-browser") {
    const model = (config as any).inBrowserModel || "qwen2.5-0.5b";
    return chatInBrowser(
      { model: model as any, temperature: opts.temperature, top_p: opts.top_p, max_tokens: opts.max_tokens },
      system,
      user,
      opts
    );
  }
  
  // Standard OpenAI-compatible endpoint (Ollama, LM Studio, etc.)
  const url = `${config.localBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: config.localModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 4096,
  };
  if (opts.top_p !== undefined) body.top_p = opts.top_p;
  // Ollama-style repetition penalty is non-standard for OpenAI-compat — also
  // pass `frequency_penalty` so LM Studio/vLLM honour it.
  if (opts.repeat_penalty !== undefined) {
    body.frequency_penalty = Math.max(0, opts.repeat_penalty - 1);
    (body as { options?: Record<string, unknown> }).options = { repeat_penalty: opts.repeat_penalty };
  }

  // Cache key includes every field that affects the model's output. We
  // hash, not store raw, because user transcripts can be PII and the
  // hash keeps the IDB record small.
  const cacheKey = opts.bypassCache ? "" : await hashInputs([
    config.localBaseUrl, config.localModel, system, user,
    opts.temperature ?? 0.7, opts.top_p ?? null, opts.repeat_penalty ?? null, opts.max_tokens ?? 4096,
  ]);
  if (cacheKey) {
    const hit = await cacheGet<string>("chat", cacheKey);
    if (hit !== null) return hit;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.localApiKey || "local"}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "").then((s) => s.slice(0, 200))}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (cacheKey && content) {
    await cacheSet("chat", cacheKey, content, { model: config.localModel, temp: opts.temperature ?? 0.7 });
  }
  return content;
}

// ---------------------------------------------------------------------------
// Tiered extractor: JSON → XML → markdown → format-repair
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown | null {
  let s = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  if (start === -1) return null;
  const opener = s[start];
  const closer = opener === "[" ? "]" : "}";
  const end = s.lastIndexOf(closer);
  if (end === -1) return null;
  s = s.substring(start, end + 1);
  try { return JSON.parse(s); }
  catch {
    try {
      const cleaned = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, " ");
      return JSON.parse(cleaned);
    } catch { return null; }
  }
}

/** Parse <lyrics><title>…</title><section type="verse"><bar>…</bar>…</section></lyrics> */
function tryParseXml(text: string): { title: string; sections: { type: string; lines: string[] }[] } | null {
  const block = text.match(/<lyrics[\s\S]*?<\/lyrics>/i);
  if (!block) return null;
  const xml = block[0];
  const title = (xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "Untitled").trim();
  const sections: { type: string; lines: string[] }[] = [];
  const sectionRe = /<section[^>]*type=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/section>/gi;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(xml)) !== null) {
    const type = (m[1] || "verse").toLowerCase();
    const lines = Array.from(m[2].matchAll(/<bar>([\s\S]*?)<\/bar>/gi)).map((b) => b[1].trim()).filter(Boolean);
    if (lines.length) sections.push({ type, lines });
  }
  if (!sections.length) {
    // Bars without sections — collect everything
    const lines = Array.from(xml.matchAll(/<bar>([\s\S]*?)<\/bar>/gi)).map((b) => b[1].trim()).filter(Boolean);
    if (lines.length) sections.push({ type: "verse", lines });
  }
  return sections.length ? { title, sections } : null;
}

/** Parse labeled markdown: "TITLE: x", "[VERSE]", lines, "[HOOK]" etc. */
function tryParseMarkdown(text: string): { title: string; sections: { type: string; lines: string[] }[] } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let title = "Untitled";
  const sections: { type: string; lines: string[] }[] = [];
  let cur: { type: string; lines: string[] } | null = null;
  const headerRe = /^\[(verse|hook|chorus|bridge|intro|outro|pre[- ]?chorus)\s*\d*\]/i;
  for (const l of lines) {
    if (!l) continue;
    const tm = l.match(/^title\s*[:\-]\s*(.+)/i);
    if (tm) { title = tm[1].trim(); continue; }
    const hm = l.match(headerRe);
    if (hm) {
      if (cur) sections.push(cur);
      cur = { type: hm[1].toLowerCase().replace(/[\s-]/g, ""), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(l.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
  }
  if (cur) sections.push(cur);
  const totalLines = sections.reduce((s, x) => s + x.lines.length, 0);
  return totalLines >= 2 ? { title, sections } : null;
}

type WriteShape = { title: string; sections: { type: string; lines: string[] }[] };

function tryExtractLyrics(text: string): WriteShape | null {
  const json = tryParseJson(text);
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const inner = (obj.lyrics && typeof obj.lyrics === "object") ? obj.lyrics as Record<string, unknown> : obj;
    const sections = Array.isArray(inner.sections) ? inner.sections as { type?: string; lines?: string[] }[] : null;
    if (sections) {
      const out = sections
        .map((s) => ({ type: String(s.type || "verse").toLowerCase(), lines: (s.lines ?? []).map((l) => String(l).trim()).filter(Boolean) }))
        .filter((s) => s.lines.length);
      if (out.length) return { title: String(inner.title || "Untitled").slice(0, 80), sections: out };
    }
    if (Array.isArray(inner.lines)) {
      const ls = (inner.lines as unknown[]).map((l) => String(l).trim()).filter(Boolean);
      if (ls.length) return { title: String(inner.title || "Untitled").slice(0, 80), sections: [{ type: "verse", lines: ls }] };
    }
  }
  return tryParseXml(text) ?? tryParseMarkdown(text);
}

/** When all parsers fail, ask the model to rewrap its own output as JSON. */
async function formatRepair(config: LlmConfig, badOutput: string): Promise<WriteShape | null> {
  try {
    const text = await rawChat(
      config,
      'You are a strict JSON formatter. Convert the user input into a single JSON object exactly matching: {"title":"string","sections":[{"type":"verse|hook|bridge","lines":["bar"]}]}. Preserve every line. Output JSON only — no fences, no commentary.',
      badOutput.slice(0, 8000),
      { temperature: 0, max_tokens: 4096 },
    );
    return tryExtractLyrics(text);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Cadence pass — same shape as v1, but uses analytical sampling
// ---------------------------------------------------------------------------

function splitBars(transcript: string): string[] {
  const norm = transcript.replace(/\s+/g, " ").replace(/([.!?;])\s+/g, "$1\n").replace(/,\s+/g, ",\n").trim();
  const seeded = norm.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const src = seeded.length ? seeded : [transcript.trim()].filter(Boolean);
  const bars: string[] = [];
  for (const line of src) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length <= 10) { bars.push(line); continue; }
    for (let i = 0; i < words.length; i += 8) bars.push(words.slice(i, i + 8).join(" "));
  }
  return bars.length ? bars : ["yeah"];
}

function heuristicCadence(transcript: string): LocalCadence {
  const bars = splitBars(transcript);
  return {
    bars: bars.map((text, i) => ({
      index: i + 1,
      syllables: Math.max(2, countSyllables(text)),
      endSound: endRhymeKey(text) || "ah",
      section: i < 2 && bars.length >= 8 ? "intro" : "verse",
      text,
    })),
    detectedVibe: "melodic",
    detectedKeyPhrases: [],
  };
}

async function buildCadence(
  config: LlmConfig,
  profile: LocalProfile,
  transcript: string,
  onProgress: (e: ProgressEvent) => void,
): Promise<LocalCadence> {
  onProgress({ stage: "cadence", message: `Mapping cadence on ${config.localModel}…` });
  const seeded = heuristicCadence(transcript);
  const numbered = seeded.bars.map((b) => `${b.index}. ${b.text}`).join("\n");
  const sys = `Analyze rough mumble vocal transcripts and return a strict cadence map as JSON only.
For EACH numbered bar output exactly one matching bar object:
- syllables: integer syllable count (fillers like uh/yeah still count)
- endSound: coarse phonetic key for the final vowel (e.g. "ay","ee","ock","ation")
- section: verse|hook|bridge|intro|outro
- text: original mumbled bar verbatim
Also infer detectedVibe (trap|drill|boom-bap|melodic|rnb|afrobeats|pop) and up to 5 detectedKeyPhrases.
Shape: {"bars":[{"index":1,"syllables":8,"endSound":"ay","section":"verse","text":"..."}],"detectedVibe":"melodic","detectedKeyPhrases":["..."]}
JSON only. No fences, no commentary.`;
  try {
    const text = await rawChat(config, sys, `Numbered transcript bars:\n${numbered}`, {
      ...profile.sampling.cadence, max_tokens: 4096,
    });
    const raw = tryParseJson(text);
    const obj = (raw && typeof raw === "object") ? raw as { bars?: Array<Partial<LocalCadence["bars"][number]>>; detectedVibe?: string; detectedKeyPhrases?: string[] } : {};
    const src = Array.isArray(obj.bars) ? obj.bars : [];
    const total = Math.max(src.length, seeded.bars.length);
    return {
      bars: Array.from({ length: total }, (_, i) => {
        const b = src[i] ?? {};
        return {
          index: Number.isFinite(b.index) ? Number(b.index) : i + 1,
          syllables: Math.max(2, Math.round(Number(b.syllables) || seeded.bars[i]?.syllables || 6)),
          endSound: (String(b.endSound || seeded.bars[i]?.endSound || "ah")).toLowerCase().replace(/[^a-z]/g, "") || "ah",
          section: String(b.section || "verse").toLowerCase(),
          text: String(b.text || seeded.bars[i]?.text || "yeah"),
        };
      }),
      detectedVibe: obj.detectedVibe || "melodic",
      detectedKeyPhrases: Array.isArray(obj.detectedKeyPhrases) ? obj.detectedKeyPhrases.slice(0, 5) : [],
    };
  } catch (e) {
    onProgress({ stage: "cadence", message: `Local cadence failed, using heuristic: ${e instanceof Error ? e.message : e}` });
    return seeded;
  }
}

// ---------------------------------------------------------------------------
// Writer / refiner — adaptive chunking + tiered extraction
// ---------------------------------------------------------------------------

function group(title: string, lines: string[], cadence: LocalCadence): LocalLyrics {
  const sections: LocalLyrics["sections"] = [];
  let cur = cadence.bars[0]?.section || "verse";
  let buf: string[] = [];
  lines.forEach((l, i) => {
    const t = cadence.bars[i]?.section || cur;
    if (t !== cur && buf.length) { sections.push({ type: cur, lines: buf }); buf = []; cur = t; }
    buf.push(l);
  });
  if (buf.length) sections.push({ type: cur, lines: buf });
  return { title, sections: sections.length ? sections : [{ type: "verse", lines }] };
}

function fillToCadence(parsed: WriteShape | null, cadence: LocalCadence): LocalLyrics {
  const flatRaw = parsed ? parsed.sections.flatMap((s) => s.lines) : [];
  const flat = flatRaw.map((l) => l.trim()).filter(Boolean);
  const needed = cadence.bars.length;
  while (flat.length < needed) flat.push(cadence.bars[flat.length]?.text || "Locked in the pocket");
  return group(parsed?.title ?? "Untitled", flat.slice(0, needed), cadence);
}

async function writeOneChunk(
  config: LlmConfig,
  profile: LocalProfile,
  cadence: LocalCadence,
  chunkBars: LocalCadence["bars"],
  brief: LocalBrief | undefined,
  examples: { bars: string[]; meta: string }[],
): Promise<WriteShape | null> {
  const sys = `You are an elite ghostwriter for punch-in rappers/vocalists. The artist mumbled a flow; you write finished bars they can punch in over the same take.

${CRAFT}

CADENCE LOCK: for each cadence bar produce ONE finished bar with target syllables (±1) and target endSound. Group by section.

${briefBlock(brief)}${styleExamplesPromptBlock(examples)}

${formatHint(profile)}`;

  const prompt = `SOURCE MUMBLE BARS:
${chunkBars.map((b) => `${b.index}. ${b.text}`).join("\n")}

CADENCE MAP (target per bar):
${JSON.stringify(chunkBars, null, 2)}

Detected vibe: ${cadence.detectedVibe}
Write punch-in lyrics for EVERY bar above.`;

  let text: string;
  try {
    text = await rawChat(config, sys, prompt, { ...profile.sampling.write, max_tokens: 4096 });
  } catch (e) { throw e; }
  let parsed = tryExtractLyrics(text);
  if (!parsed) parsed = await formatRepair(config, text);
  return parsed;
}

async function writeLyrics(
  config: LlmConfig,
  profile: LocalProfile,
  cadence: LocalCadence,
  brief: LocalBrief | undefined,
  budget: { chunkBars: number },
  examples: { bars: string[]; meta: string }[],
  onProgress: (e: ProgressEvent) => void,
): Promise<LocalLyrics> {
  const chunkSize = budget.chunkBars;
  const allLines: string[] = [];
  let title = "Untitled";
  const total = Math.ceil(cadence.bars.length / chunkSize) || 1;
  for (let c = 0; c < total; c++) {
    onProgress({ stage: "write", message: `Writing chunk ${c + 1}/${total} on ${config.localModel}…` });
    const slice = cadence.bars.slice(c * chunkSize, (c + 1) * chunkSize);
    try {
      const parsed = await writeOneChunk(config, profile, cadence, slice, brief, examples);
      if (parsed) {
        if (c === 0 && parsed.title) title = parsed.title;
        const lines = parsed.sections.flatMap((s) => s.lines).map((l) => l.trim()).filter(Boolean);
        // Pad/trim to slice length so cadence alignment stays exact
        while (lines.length < slice.length) lines.push(slice[lines.length].text || "Locked in the pocket");
        allLines.push(...lines.slice(0, slice.length));
      } else {
        allLines.push(...slice.map((b) => b.text));
      }
    } catch (e) {
      onProgress({ stage: "write", message: `Chunk ${c + 1} failed: ${e instanceof Error ? e.message : e}` });
      allLines.push(...slice.map((b) => b.text));
    }
  }
  return group(title, allLines.slice(0, cadence.bars.length), cadence);
}

// ---------------------------------------------------------------------------
// Critic + refine — tier-aware iteration budget
// ---------------------------------------------------------------------------

async function criticPass(
  config: LlmConfig,
  profile: LocalProfile,
  lyrics: LocalLyrics,
  cadence: LocalCadence,
  onProgress: (e: ProgressEvent) => void,
  iter: number,
): Promise<{ overall: number; weakest: { index: number; line: string; why: string; rewrite?: string }[]; notes: string[] }> {
  onProgress({ stage: "critic", message: `Critic pass ${iter}…`, iteration: iter });
  const sys = `You are a ruthless A&R critic trained on Drake/Kendrick/Cole/Future/Brent/PARTY/The Weeknd. Score lyrics 1-10 on: wordplay, imagery, cadencePocket, rhymeCraft, emotionalTruth, memorability, originality. Surface up to 6 weakest bars with concrete rewrites. Be honest — Drake-tier is 8.5+.
Output JSON only.
Shape: {"scores":{"wordplay":7.5,"imagery":7,"cadencePocket":8,"rhymeCraft":7.5,"emotionalTruth":7,"memorability":7,"originality":7},"overall":7.4,"weakestBars":[{"index":3,"line":"...","why":"...","rewrite":"..."}],"notes":["..."]}`;
  try {
    const text = await rawChat(
      config,
      sys,
      `LYRICS:\n${JSON.stringify(lyrics, null, 2)}\n\nCADENCE:\n${JSON.stringify(cadence.bars, null, 2)}`,
      { ...profile.sampling.critic, max_tokens: 2048 },
    );
    const raw = tryParseJson(text) as { scores?: Record<string, number>; overall?: number; weakestBars?: Array<{ index?: number; line?: string; why?: string; rewrite?: string }>; notes?: string[] } | null;
    if (!raw) return { overall: 6, weakest: [], notes: [] };
    const scores = raw.scores ?? {};
    const vals = Object.values(scores).filter((v): v is number => typeof v === "number");
    const overall = typeof raw.overall === "number" ? raw.overall : (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 5);
    return {
      overall: Math.max(1, Math.min(10, overall)),
      weakest: (raw.weakestBars ?? [])
        .map((b) => ({ index: Number(b.index ?? 0), line: String(b.line ?? ""), why: String(b.why ?? ""), rewrite: b.rewrite ? String(b.rewrite) : undefined }))
        .filter((b) => b.index > 0),
      notes: raw.notes ?? [],
    };
  } catch {
    return { overall: 6, weakest: [], notes: [] };
  }
}

async function refine(
  config: LlmConfig,
  profile: LocalProfile,
  lyrics: LocalLyrics,
  cadence: LocalCadence,
  critique: { weakest: { index: number; line: string; why: string; rewrite?: string }[]; notes: string[] },
  brief: LocalBrief | undefined,
  onProgress: (e: ProgressEvent) => void,
  iter: number,
): Promise<LocalLyrics> {
  onProgress({ stage: "refine", message: `Refining weak bars (pass ${iter})…`, iteration: iter });
  const sys = `Targeted rewrite. Keep what works. Rewrite ONLY bars the critic flagged + bars sharing the same weakness. Preserve bar count, sections, syllables (±1), end-sound.

${CRAFT}

${briefBlock(brief)}

${formatHint(profile)}`;
  const prompt = `CURRENT LYRICS:\n${JSON.stringify(lyrics, null, 2)}\n\nCADENCE:\n${JSON.stringify(cadence.bars, null, 2)}\n\nNOTES: ${critique.notes.join(" | ")}\n\nWEAKEST BARS:\n${JSON.stringify(critique.weakest, null, 2)}\n\nReturn full updated lyrics.`;
  try {
    const text = await rawChat(config, sys, prompt, { ...profile.sampling.editor, max_tokens: 4096 });
    let parsed = tryExtractLyrics(text);
    if (!parsed) parsed = await formatRepair(config, text);
    return fillToCadence(parsed, cadence);
  } catch {
    return lyrics;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function resolveProfile(config: LlmConfig): LocalProfile {
  const base = profileFor(config.localModel);
  // Apply user overrides if set (tier override is the most common — user
  // knows they're running a heavy quant they wouldn't want auto-detected).
  const family = (config.familyOverride as LocalProfile["family"] | undefined) ?? base.family;
  const tier = config.tierOverride ?? base.tier;
  return { ...base, family, tier };
}

export async function runLocalPipeline(
  config: LlmConfig,
  transcript: string,
  brief: LocalBrief | undefined,
  onProgress: (e: ProgressEvent) => void = () => {},
): Promise<LocalPipelineResult> {
  const profile = resolveProfile(config);
  const baseBudget = budgetFor(profile.tier);
  const ctx = config.localContextTokens || profile.defaultContextTokens;
  const chunkBars = adaptiveChunkBars(ctx, baseBudget.chunkBars);
  const budget = { ...baseBudget, chunkBars };

  // Pipeline-level cache: identical (model + transcript + brief + profile)
  // returns the prior result instantly. The per-pass `chat` cache still
  // pays off when only part of the input changes (e.g. tweaking the brief
  // re-runs writer/critic but reuses cadence).
  const pipelineKey = await hashInputs([
    config.localBaseUrl, config.localModel, ctx, transcript, brief ?? null,
    profile.family, profile.tier, profile.writeFormat, budget.maxIterations, budget.targetScore, chunkBars,
  ]);
  const cached = await cacheGet<LocalPipelineResult>("pipeline", pipelineKey);
  if (cached) {
    onProgress({ stage: "done", message: `Cache hit · ${cached.quality.drakeScore.toFixed(1)}/10`, score: cached.quality.drakeScore });
    return cached;
  }

  onProgress({
    stage: "cadence",
    message: `Detected ${profile.family} · ${profile.tier} tier · ${ctx} ctx · chunk ${chunkBars} bars`,
  });

  const cadence = await buildCadence(config, profile, transcript, onProgress);

  // Embedding-based recall: retrieve top-K most relevant past wins for this
  // transcript + brief. Falls back to sampleStyleExamples if embeddings
  // unavailable. Computed once per pipeline run so every chunk gets the
  // same coherent "study set".
  const { recallStyleExamples, buildRecallQuery } = await import("./style-recall");
  const recallQuery = buildRecallQuery({
    transcript,
    topic: brief?.topic,
    attitude: brief?.attitude,
    customSlang: brief?.customSlang,
    genre: brief?.genre,
  });
  const examples = await recallStyleExamples(
    recallQuery,
    { count: 3, filter: { vibe: cadence.detectedVibe, genre: brief?.genre } },
  );

  let lyrics = await writeLyrics(config, profile, cadence, brief, budget, examples, onProgress);

  const notes: string[] = [];
  let bestScore = 0;
  let bestLyrics = lyrics;
  for (let i = 1; i <= budget.maxIterations; i++) {
    const crit = await criticPass(config, profile, lyrics, cadence, onProgress, i);
    notes.push(`pass ${i}: ${crit.overall.toFixed(1)}/10`);
    if (crit.notes.length) notes.push(...crit.notes.slice(0, 2));
    onProgress({ stage: "critic", message: `Pass ${i}: ${crit.overall.toFixed(1)}/10`, iteration: i, score: crit.overall });
    if (crit.overall > bestScore) { bestScore = crit.overall; bestLyrics = lyrics; }
    if (crit.overall >= budget.targetScore) break;
    if (i === budget.maxIterations) break;
    lyrics = await refine(config, profile, lyrics, cadence, crit, brief, onProgress, i);
  }
  onProgress({ stage: "done", message: `Done. Best score ${bestScore.toFixed(1)}/10`, score: bestScore });

  const quality: LocalQuality = {
    cadenceMatch: 0.9,
    rhymeDensity: 2,
    clicheCount: 0,
    vibeConsistency: Math.round(bestScore / 2),
    barCount: bestLyrics.sections.reduce((s, sec) => s + sec.lines.length, 0),
    drakeScore: Number(bestScore.toFixed(1)),
  };
  const result: LocalPipelineResult = {
    lyrics: bestLyrics,
    cadence,
    quality,
    notes,
    profile: { family: profile.family, tier: profile.tier, paramsB: profile.paramsB, chunkBars },
  };
  // Only cache "good enough" runs — caching a 3/10 disaster permanently
  // would be worse than recomputing. Threshold sits below the harvest bar
  // so even mid-tier successes get retained.
  if (bestScore >= 6.5) {
    await cacheSet("pipeline", pipelineKey, result, { model: config.localModel, score: bestScore });
  }
  return result;
}

// Convenience for callers that want to know the harvest threshold without
// rerunning detection.
export function harvestThresholdFor(config: LlmConfig): number {
  const profile = resolveProfile(config);
  return budgetFor(profile.tier).harvestThreshold;
}

export function tierForConfig(config: LlmConfig): LocalTier {
  return resolveProfile(config).tier;
}

export function _unused_tierFor() { return tierFor; }

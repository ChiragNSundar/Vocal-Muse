import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  countSyllables,
  endRhymeKey,
  countCliches,
  scoreCadenceMatch,
  avgRhymeChainSyllables,
  rhymeScheme,
  type CadenceMap,
  type StyleBrief,
  type QualityScore,
} from "./lyrics-analysis";
import { fingerprintToConstraints } from "./fingerprint";

const LyricsSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      type: z.string(),
      lines: z.array(z.string()),
    }),
  ),
});

// Loose intake schema — what the model might actually return. Normalized into Lyrics.
const LyricsIntakeSchema = z.object({
  title: z.string().optional(),
  sections: z.array(
    z.object({
      type: z.string().optional(),
      lines: z.array(z.string()).optional(),
    }),
  ).optional(),
  lines: z.array(z.string()).optional(),
  lyrics: z.unknown().optional(),
}).passthrough();



export type Lyrics = z.infer<typeof LyricsSchema>;

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

const CRAFT_GUARDRAILS = `
HARD CRAFT RULES (non-negotiable):
- No tired clichés. Banned phrases: "grind never stop", "feel so right / in the night", "demons in my head", "started from the bottom", "moonlight / spotlight on me", "rags to riches", "haters gonna hate", "live my best life", "shine bright", "chasing dreams", "ride or die", "trust the process", "blood sweat tears", generic "level up", reflexive "on god on god".
- No therapy-speak unless attitude includes "reflective".
- No emoji, no stage directions, no "[beat drops]", no producer tags.
- Don't reuse the same end-rhyme sound for 3+ bars in a row unless rhyme density is 5.
- Match the artist's pronoun count from the transcript — if they said "we" a lot, don't switch to "I".
- Don't mix regional slang (e.g. UK drill terms in a US South track) unless the brief says so.
- Concrete images > abstractions. Specific brand/place/object > generic noun.
- Every bar must earn its spot — no filler bars that only restate the previous one.
`;

const LYRIC_CHUNK_SIZE = 16;
const EDIT_CHUNK_SIZE = 20;

function briefToPromptBlock(b: StyleBrief | undefined): string {
  if (!b) return "STYLE BRIEF: auto-detect everything from the transcript.";
  const rd = b.rhymeDensity ?? 3;
  const rdDesc = [
    "simple end-rhymes only",
    "light multis here and there",
    "consistent multis on most bars",
    "dense multis, internal rhymes common",
    "chain rhymes + internal rhymes on EVERY bar",
  ][rd - 1];
  const fpBlock = b.fingerprint
    ? "\n\n" + fingerprintToConstraints(b.fingerprint) +
      "\nThese reference constraints are HARD targets — treat the syllable range, vowel palette, and rhyme families as locked rails."
    : "";
  return [
    "STYLE BRIEF:",
    `- Genre: ${b.genre && b.genre !== "auto" ? b.genre : "infer from transcript"}`,
    `- Attitude: ${(b.attitude && b.attitude.length) ? b.attitude.join(", ") : "infer from transcript"}`,
    `- Rhyme density: ${rd}/5 — ${rdDesc}`,
    `- Slang region: ${b.slangRegion && b.slangRegion !== "auto" ? b.slangRegion : "infer from transcript"}`,
    b.customSlang ? `- Artist-specific slang/ad-libs to use naturally: ${b.customSlang}` : null,
    b.topic ? `- Song is about: ${b.topic}` : null,
    b.avoid ? `- AVOID these words/phrases entirely: ${b.avoid}` : null,
    `- Explicit language: ${b.explicit === false ? "NOT allowed — keep clean" : "allowed"}`,
    b.structuralRules ? `- Structural rules: ${b.structuralRules}` : null,
  ].filter(Boolean).join("\n") + fpBlock;
}

// ---------- Pass A: cadence map ----------
const CadenceMapSchema = z.object({
  bars: z.array(z.object({
    index: z.number().optional(),
    syllables: z.number().optional(),
    endSound: z.string().optional(),
    section: z.string().optional(),
    text: z.string().optional(),
  })),
  detectedVibe: z.string().optional(),
  detectedKeyPhrases: z.array(z.string()).optional(),
});

function extractJson(text: string): unknown {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found in model response");
  const opener = cleaned[start];
  const closer = opener === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(closer);
  if (end === -1) throw new Error("Truncated JSON in model response");
  cleaned = cleaned.substring(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    cleaned = cleaned
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, " ");
    return JSON.parse(cleaned);
  }
}

async function callGemini<T>(
  apiKey: string,
  schema: z.ZodSchema<T>,
  system: string,
  prompt: string,
  jsonShape = "Return a JSON object with the fields requested in the system prompt.",
): Promise<T> {
  const { createLovableGateway } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  const gateway = createLovableGateway(apiKey);
  const schemaHint = `\n\nReturn ONLY one valid JSON object. No markdown, no code fences, no commentary. ${jsonShape}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: system + schemaHint,
        prompt,
        maxOutputTokens: 8192,
      });
      const text = (result as unknown as { text: string }).text;
      const parsed = extractJson(text);
      return schema.parse(parsed);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Model failed to return valid structured output: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

function splitTranscriptIntoBars(transcript: string): string[] {
  const normalized = transcript
    .replace(/\s+/g, " ")
    .replace(/([.!?;])\s+/g, "$1\n")
    .replace(/,\s+/g, ",\n")
    .trim();
  const seeded = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const source = seeded.length ? seeded : [transcript.trim()].filter(Boolean);
  const bars: string[] = [];

  for (const line of source) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length <= 10) {
      bars.push(line);
      continue;
    }
    for (let i = 0; i < words.length; i += 8) {
      bars.push(words.slice(i, i + 8).join(" "));
    }
  }

  return bars.length ? bars : ["yeah"];
}

function normalizeSection(section: string | undefined, index: number, total: number): string {
  const s = (section ?? "").toLowerCase();
  if (["intro", "hook", "verse", "bridge", "outro"].includes(s)) return s;
  if (total >= 8 && (index < 2 || index >= total - 2)) return index < 2 ? "intro" : "outro";
  return "verse";
}

function heuristicCadenceMap(transcript: string): CadenceMap {
  const bars = splitTranscriptIntoBars(transcript);
  return {
    bars: bars.map((text, index) => ({
      index: index + 1,
      syllables: Math.max(2, countSyllables(text)),
      endSound: endRhymeKey(text) || "ah",
      section: normalizeSection(undefined, index, bars.length),
      text,
    })),
    detectedVibe: "melodic",
    detectedKeyPhrases: bars
      .join(" ")
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 5),
  };
}

function normalizeCadenceMap(map: { bars: Array<Partial<CadenceMap["bars"][number]>>; detectedVibe?: string; detectedKeyPhrases?: string[] }, transcript: string): CadenceMap {
  const fallback = heuristicCadenceMap(transcript);
  const source = Array.isArray(map.bars) && map.bars.length ? map.bars : [];
  const total = Math.max(source.length, fallback.bars.length);
  return {
    bars: Array.from({ length: total }, (_, i) => {
      const bar = source[i] ?? {};
      return {
      index: Number.isFinite(bar.index) ? (bar.index as number) : i + 1,
      syllables: Math.max(2, Number.isFinite(bar.syllables) ? Math.round(bar.syllables as number) : fallback.bars[i]?.syllables ?? 6),
      endSound: (bar.endSound || fallback.bars[i]?.endSound || "ah").toLowerCase().replace(/[^a-z]/g, "") || "ah",
      section: normalizeSection(bar.section, i, total),
      text: bar.text || fallback.bars[i]?.text || "yeah",
      };
    }),
    detectedVibe: map.detectedVibe || fallback.detectedVibe,
    detectedKeyPhrases: Array.isArray(map.detectedKeyPhrases) ? map.detectedKeyPhrases.slice(0, 5) : fallback.detectedKeyPhrases,
  };
}

async function buildCadenceMap(apiKey: string, transcript: string): Promise<CadenceMap> {
  const seededMap = heuristicCadenceMap(transcript);
  const numberedBars = seededMap.bars.map((bar) => `${bar.index}. ${bar.text}`).join("\n");
  const system = `You analyze rough freestyle/mumble vocal transcripts and return a strict cadence map.
You will receive NUMBERED transcript bars that already cover the whole performance.
For EACH numbered input bar output exactly one matching bar object. Do not skip, merge, summarize, or stop early.
- syllables: count syllables in the mumble as if it were sung (filler "uh / yeah / like" still counts as a syllable slot).
- endSound: a coarse phonetic key for the final vowel sound — examples: "ay", "ee", "oh", "ine", "ock", "ation". Lowercase only.
- section: "verse", "hook", "bridge", "intro", or "outro". Detect repeated/melodic patterns as "hook".
- text: the original mumbled bar, verbatim.
Also infer detectedVibe (one of: trap, drill, boom-bap, melodic, rnb, afrobeats, pop) and detectedKeyPhrases (up to 5 meaningful fragments you could hear).`;
  try {
    const map = await callGemini(
      apiKey,
      CadenceMapSchema,
      system,
      `Numbered transcript bars:\n${numberedBars}`,
      `Shape: {"bars":[{"index":1,"syllables":8,"endSound":"ay","section":"verse","text":"original words"}],"detectedVibe":"melodic","detectedKeyPhrases":["phrase"]}`,
    );
    return normalizeCadenceMap(map, transcript);
  } catch (error) {
    console.warn("Cadence AI pass failed; using local cadence map", error);
    return heuristicCadenceMap(transcript);
  }
}

function groupBarsIntoLyrics(title: string, lines: string[], cadence: CadenceMap): Lyrics {
  const sections: Lyrics["sections"] = [];
  let currentType = cadence.bars[0]?.section || "verse";
  let currentLines: string[] = [];

  lines.forEach((line, i) => {
    const type = cadence.bars[i]?.section || currentType;
    if (type !== currentType && currentLines.length) {
      sections.push({ type: currentType, lines: currentLines });
      currentLines = [];
      currentType = type;
    }
    currentLines.push(line);
  });

  if (currentLines.length) sections.push({ type: currentType, lines: currentLines });
  return { title, sections: sections.length ? sections : [{ type: "verse", lines }] };
}

function fallbackLyricLines(transcript: string, cadence: CadenceMap, brief: StyleBrief | undefined): string[] {
  const words = transcript.toLowerCase().split(/\s+/).filter(Boolean);
  const topic = brief?.topic?.trim();
  const attitude = brief?.attitude?.[0] || "locked-in";
  const region = brief?.slangRegion && brief.slangRegion !== "auto" ? brief.slangRegion : "";
  const cleanSeed = words.filter((word) => !/^(uh+|um+|yeah|like|you|know|i|a|the)$/i.test(word)).slice(0, 12);
  const image = topic || cleanSeed.slice(0, 3).join(" ") || "this motion";
  const slang = brief?.customSlang?.split(/[,.\n]/).map((s) => s.trim()).filter(Boolean)[0] || region;
  const endings = ["again", "lane", "rain", "frame", "name", "same", "flame", "claim"];

  return cadence.bars.map((bar, i) => {
    const end = bar.endSound && bar.endSound.length > 1 ? bar.endSound : endings[i % endings.length];
    const hook = i % 4;
    const tag = slang ? ` ${slang}` : "";
    if (hook === 0) return `I caught the ${image} and bent it back ${end}${tag}`.trim();
    if (hook === 1) return `Pocket sitting ${attitude}, every syllable ${end}`.trim();
    if (hook === 2) return `Turn the rough take clean, put the truth in the ${end}`.trim();
    return `No wasted breath now, I land where the drums ${end}`.trim();
  });
}

function fallbackLyrics(transcript: string, cadence: CadenceMap, brief: StyleBrief | undefined): Lyrics {
  const topic = brief?.topic?.trim();
  const lines = fallbackLyricLines(transcript, cadence, brief);

  return groupBarsIntoLyrics(topic ? topic.slice(0, 40) : "Locked In", lines, cadence);
}

function coerceLyrics(raw: unknown): { title?: string; sections?: { type?: string; lines?: string[] }[]; lines?: string[] } {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  // Unwrap if the model nested under { lyrics: {...} }
  if (obj.lyrics && typeof obj.lyrics === "object" && !Array.isArray(obj.lyrics)) {
    return coerceLyrics(obj.lyrics);
  }
  return obj as { title?: string; sections?: { type?: string; lines?: string[] }[]; lines?: string[] };
}

function normalizeLyrics(raw: unknown, cadence: CadenceMap, fillerLines: string[] = []): Lyrics {
  const lyrics = coerceLyrics(raw);
  const sections = Array.isArray(lyrics.sections) ? lyrics.sections : [];
  let flat = sections.flatMap((section) => (section?.lines ?? []) as string[]);
  if (!flat.length && Array.isArray(lyrics.lines)) flat = lyrics.lines as string[];
  flat = flat.map((line) => String(line || "").trim()).filter(Boolean);
  const needed = cadence.bars.length;
  const fixedLines = flat.slice(0, needed);
  while (fixedLines.length < needed) {
    const bar = cadence.bars[fixedLines.length];
    fixedLines.push(fillerLines[fixedLines.length] || (bar?.text ? bar.text : "Locked in the pocket"));
  }
  return groupBarsIntoLyrics((lyrics.title || "Untitled").slice(0, 80), fixedLines, cadence);
}

function flattenLyricsLines(lyrics: Lyrics): string[] {
  return lyrics.sections.flatMap((section) => section.lines);
}

function sliceCadenceMap(cadence: CadenceMap, start: number, end: number): CadenceMap {
  return {
    bars: cadence.bars.slice(start, end),
    detectedVibe: cadence.detectedVibe,
    detectedKeyPhrases: cadence.detectedKeyPhrases,
  };
}

function sourceBarsBlock(cadence: CadenceMap): string {
  return cadence.bars.map((bar) => `${bar.index}. ${bar.text}`).join("\n");
}


// ---------- Pass B: write lyrics with cadence ----------
async function writeLyrics(
  apiKey: string,
  transcript: string,
  cadence: CadenceMap,
  brief: StyleBrief | undefined,
  styleExamples: { bars: string[]; meta: string }[] = [],
  burnedPhrases: string[] = [],
  burnedVowels: string[] = [],
): Promise<Lyrics> {
  const examplesBlock = styleExamples.length
    ? `\n\nSTUDY THESE EXAMPLES — bars from past generations that scored Drake-tier. Match this level of specificity, multis, and pocket. Do NOT copy them; absorb the standard.\n\n` +
      styleExamples.map((ex, i) => `EXAMPLE ${i + 1} (${ex.meta}):\n${ex.bars.map((b) => `  ${b}`).join("\n")}`).join("\n\n")
    : "";

  const burnedBlock = burnedPhrases.length
    ? `\n\nANTI-REPEAT LIST — these end-words and stems were used in this artist's recent catalog. Do NOT reuse them as end-rhymes or hook phrases:\n${burnedPhrases.slice(0, 40).map((p) => `- ${p}`).join("\n")}`
    : "";

  const burnedVowelsBlock = burnedVowels.length
    ? `\n\nBURNED END-RIMES — these rime sounds are over-used in this artist's recent catalog. Pick fresh end-sounds where the cadence map allows (i.e. when multiple rimes would satisfy the target endSound, do NOT default to these):\n${burnedVowels.slice(0, 30).map((v) => `- "${v}"`).join("\n")}`
    : "";

  const system = `You are an elite ghostwriter for "punch-in" rappers and vocalists. The artist freestyled/mumbled a flow over a beat. You write finished lyrics they can PUNCH IN over the same take.

${CRAFT_GUARDRAILS}

CADENCE LOCK:
- For every cadence bar, produce ONE finished bar.
- Match the target syllable count within ±1.
- Match the target endSound (the final vowel of the bar must rhyme with the cadence endSound).
- Treat filler slots ("uh / yeah / like / you know") as rhythm placeholders — replace them with real words that hit the same beat, never delete them.
- Pocket lock: stress the same syllables the mumble stressed.
- Group bars by their section ("hook" bars become a hook section; "verse" bars become a verse).

${briefToPromptBlock(brief)}${examplesBlock}${burnedBlock}${burnedVowelsBlock}

Output one section per detected section type, in transcript order. Give a short evocative title (max 5 words). No commentary outside the lyrics.`;

  const allLines: string[] = [];
  let title = "Untitled";

  for (let start = 0; start < cadence.bars.length; start += LYRIC_CHUNK_SIZE) {
    const chunk = sliceCadenceMap(cadence, start, start + LYRIC_CHUNK_SIZE);
    const transcriptChunk = chunk.bars.map((bar) => bar.text).join("\n");
    const fallbackLines = fallbackLyricLines(transcriptChunk, chunk, brief);
    const prompt = `SOURCE MUMBLE BARS FOR THIS CHUNK:
${sourceBarsBlock(chunk)}

CADENCE MAP (target for each finished bar):
${JSON.stringify(chunk.bars, null, 2)}

Detected vibe: ${cadence.detectedVibe ?? "unknown"}
Key phrases heard: ${(cadence.detectedKeyPhrases ?? []).join(" | ") || "—"}

Write punch-in-ready lyrics for EVERY bar in this chunk, from bar ${chunk.bars[0]?.index ?? start + 1} through bar ${chunk.bars.at(-1)?.index ?? start + chunk.bars.length}.`;

    try {
      const lyrics = await callGemini(
        apiKey,
        LyricsIntakeSchema,
        system,
        prompt,
        `Shape: {"title":"Short Title","sections":[{"type":"verse","lines":["finished bar one","finished bar two"]}]}`,
      );
      const normalized = normalizeLyrics(lyrics, chunk, fallbackLines);
      if (start === 0 && normalized.title) title = normalized.title;
      allLines.push(...flattenLyricsLines(normalized));
    } catch (error) {
      console.warn("Lyric AI chunk failed; using safe lyric fallback", error);
      allLines.push(...fallbackLines);
    }
  }

  return groupBarsIntoLyrics(title, allLines, cadence);
}

// ---------- Pass C: editor pass ----------
const EditorResultSchema = z.object({
  lyrics: LyricsIntakeSchema.optional(),
  title: z.string().optional(),
  sections: z.array(z.object({ type: z.string().optional(), lines: z.array(z.string()).optional() })).optional(),
  vibeConsistency: z.number().min(1).max(5).optional(),
  editorNotes: z.array(z.string()).optional(),
}).passthrough();


async function editorPass(
  apiKey: string,
  lyrics: Lyrics,
  cadence: CadenceMap,
  brief: StyleBrief | undefined,
): Promise<{ lyrics: Lyrics; vibeConsistency: number; editorNotes: string[] }> {
  const system = `You are a top-tier rap/R&B EDITOR. You receive a draft of finished lyrics and the original cadence map. Your job:
1. Hunt clichés and weak bars. Rewrite them stronger — concrete images, specific nouns, surprising verbs.
2. Tighten any bar that misses its target syllable count or end-sound.
3. Ensure the attitude/vibe stays consistent across the whole song.
4. Confirm the hook is a hook (repeatable, memorable, hits the same image).
5. NEVER lengthen the song. Same section structure, same bar count.

${CRAFT_GUARDRAILS}

${briefToPromptBlock(brief)}

Return the polished lyrics plus a 1–5 vibeConsistency self-rating and up to 3 short editor notes (what you changed/why).`;

  const draftLines = flattenLyricsLines(lyrics);
  const editedLines: string[] = [];
  const notes: string[] = [];
  const vibeScores: number[] = [];

  for (let start = 0; start < cadence.bars.length; start += EDIT_CHUNK_SIZE) {
    const chunk = sliceCadenceMap(cadence, start, start + EDIT_CHUNK_SIZE);
    const draftChunk = groupBarsIntoLyrics(lyrics.title, draftLines.slice(start, start + chunk.bars.length), chunk);
    const fillerLines = flattenLyricsLines(draftChunk);
    const prompt = `DRAFT LYRICS FOR THIS CHUNK:
${JSON.stringify(draftChunk, null, 2)}

CADENCE TARGETS:
${JSON.stringify(chunk.bars, null, 2)}

Edit every bar in this chunk. Return the same ${chunk.bars.length} bars in the same order.`;

    try {
      const r = await callGemini(
        apiKey,
        EditorResultSchema,
        system,
        prompt,
        `Shape: {"lyrics":{"title":"Short Title","sections":[{"type":"verse","lines":["bar"]}]},"vibeConsistency":4,"editorNotes":["tightened cadence"]}`,
      );
      const normalized = normalizeLyrics(r.lyrics ?? r, chunk, fillerLines);
      editedLines.push(...flattenLyricsLines(normalized));
      vibeScores.push(Math.max(1, Math.min(5, Math.round(r.vibeConsistency || 3))));
      notes.push(...(r.editorNotes ?? []));
    } catch (error) {
      console.warn("Editor AI chunk failed; keeping draft lyrics", error);
      editedLines.push(...fillerLines);
      vibeScores.push(3);
    }
  }

  const avgVibe = vibeScores.length
    ? Math.max(1, Math.min(5, Math.round(vibeScores.reduce((sum, value) => sum + value, 0) / vibeScores.length)))
    : 3;
  return {
    lyrics: groupBarsIntoLyrics(lyrics.title, editedLines, cadence),
    vibeConsistency: avgVibe,
    editorNotes: notes.slice(0, 3),
  };
}

function computeQuality(
  lyrics: Lyrics,
  cadence: CadenceMap,
  brief: StyleBrief | undefined,
  vibeConsistency: number,
): QualityScore {
  const flatLines = lyrics.sections.flatMap((s) => s.lines);
  const cadenceMatch = scoreCadenceMatch(cadence, flatLines);
  const rhymeDensity = avgRhymeChainSyllables(flatLines);
  const banned = (brief?.avoid ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const clicheCount = countCliches(flatLines, banned);
  return {
    cadenceMatch: Number(cadenceMatch.toFixed(2)),
    rhymeDensity,
    clicheCount,
    vibeConsistency,
    barCount: flatLines.length,
  };
}

// Sanity: enforce ±1 syllable on bars that drift wildly by re-padding/trimming
// trailing ad-libs only when we can do it safely. Soft correction.
function softTrim(lyrics: Lyrics, cadence: CadenceMap): Lyrics {
  const flat: string[] = [];
  const sectionsMap: { type: string; lineCount: number }[] = [];
  for (const s of lyrics.sections) {
    sectionsMap.push({ type: s.type, lineCount: s.lines.length });
    for (const l of s.lines) flat.push(l);
  }
  for (let i = 0; i < flat.length && i < cadence.bars.length; i++) {
    const target = cadence.bars[i].syllables;
    let line = flat[i];
    let got = countSyllables(line);
    // If 2+ over, try chopping a trailing parenthetical ad-lib
    while (got - target >= 2) {
      const stripped = line.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (stripped === line) break;
      line = stripped;
      got = countSyllables(line);
    }
    flat[i] = line;
  }
  const out: Lyrics = { title: lyrics.title, sections: [] };
  let idx = 0;
  for (const sm of sectionsMap) {
    out.sections.push({ type: sm.type, lines: flat.slice(idx, idx + sm.lineCount) });
    idx += sm.lineCount;
  }
  return out;
}

// ---------- Pass D: Multi-critic council + targeted refine ----------
// (legacy single-critic helpers removed in favour of `runCriticCouncil`
// from `./critics`, which scores Pocket / Wordplay / Authenticity in
// parallel and surfaces the union of weakest bars.)

async function refineWithCritique(
  apiKey: string,
  lyrics: Lyrics,
  cadence: CadenceMap,
  brief: StyleBrief | undefined,
  critique: { overall: number; weakestBars: { index: number; line: string; why: string; rewrite?: string }[]; notes: string[]; weakestRole?: string },
): Promise<Lyrics> {
  if (!critique.weakestBars.length && !critique.notes.length) return lyrics;

  const focus = critique.weakestRole
    ? `\nFOCUS: the ${critique.weakestRole.toUpperCase()} dimension scored lowest. Fix that specifically across the flagged bars.`
    : "";

  const system = `You are an elite ghostwriter doing a TARGETED REWRITE pass. Keep what works. Rewrite ONLY the bars the critic council flagged (and other bars that share the same weakness). Preserve bar count, sections, syllable count (±1), and end-sound per the cadence map.${focus}

${CRAFT_GUARDRAILS}

${briefToPromptBlock(brief)}

Aim for Drake-tier: specific imagery, multis, real emotional pivots, quotable lines.`;

  const prompt = `CURRENT LYRICS:
${JSON.stringify(lyrics, null, 2)}

CADENCE TARGETS:
${JSON.stringify(cadence.bars, null, 2)}

CRITIC NOTES: ${critique.notes.join(" | ") || "—"}

WEAKEST BARS TO REWRITE (use the suggested rewrite as a starting point, then push further):
${JSON.stringify(critique.weakestBars, null, 2)}

Return the FULL updated lyrics in the same shape, same bar count, same section structure.`;

  try {
    const r = await callGemini(
      apiKey,
      LyricsIntakeSchema,
      system,
      prompt,
      `Shape: {"title":"Short Title","sections":[{"type":"verse","lines":["bar"]}]}`,
    );
    return normalizeLyrics(r, cadence, flattenLyricsLines(lyrics));
  } catch (error) {
    console.warn("Refine pass failed; keeping current lyrics", error);
    return lyrics;
  }
}

const DRAKE_TARGET = 8.5;
const MAX_REFINE_ITERATIONS = 4;

async function runPipeline(
  transcript: string,
  brief: StyleBrief | undefined,
  styleExamples: { bars: string[]; meta: string }[] = [],
  burnedPhrases: string[] = [],
  burnedVowels: string[] = [],
): Promise<{ lyrics: Lyrics; cadence: CadenceMap; quality: QualityScore; notes: string[] }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

  const cadence = await buildCadenceMap(apiKey, transcript);
  const draft = await writeLyrics(apiKey, transcript, cadence, brief, styleExamples, burnedPhrases, burnedVowels);
  const edited = await editorPass(apiKey, draft, cadence, brief);
  let lyrics = softTrim(edited.lyrics, cadence);
  const allNotes: string[] = [...edited.editorNotes];

  // Multi-critic council → targeted refine loop. Pocket / Wordplay /
  // Authenticity score in parallel; the lowest-scoring dimension picks
  // which weak bars get rewritten next pass. Keep the best-scoring version.
  const { runCriticCouncil } = await import("./critics");
  let bestLyrics = lyrics;
  let bestScore = 0;
  let bestByRole: Record<string, number> | undefined;
  let bestScores: Record<string, number> | undefined;
  for (let i = 0; i < MAX_REFINE_ITERATIONS; i++) {
    const verdict = await runCriticCouncil(apiKey, lyrics, cadence, brief);
    allNotes.push(`pass ${i + 1}: ${verdict.overall.toFixed(1)}/10 (weakest: ${verdict.weakestRole})`);
    if (verdict.notes.length) allNotes.push(...verdict.notes.slice(0, 2));
    if (verdict.overall > bestScore) {
      bestScore = verdict.overall;
      bestLyrics = lyrics;
      bestByRole = verdict.byRole;
      bestScores = verdict.scores;
    }
    if (verdict.overall >= DRAKE_TARGET) break;
    const refined = await refineWithCritique(apiKey, lyrics, cadence, brief, {
      overall: verdict.overall,
      weakestBars: verdict.weakestBars,
      notes: verdict.notes,
      weakestRole: verdict.weakestRole,
    });
    lyrics = softTrim(refined, cadence);
  }

  const quality = computeQuality(bestLyrics, cadence, brief, edited.vibeConsistency);
  const enrichedQuality = {
    ...quality,
    drakeScore: Number(bestScore.toFixed(1)),
    councilByRole: bestByRole,
    councilScores: bestScores,
  } as QualityScore & { drakeScore: number; councilByRole?: Record<string, number>; councilScores?: Record<string, number> };
  return { lyrics: bestLyrics, cadence, quality: enrichedQuality, notes: allNotes.slice(0, 8) };
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const StyleExampleSchema = z.object({
  bars: z.array(z.string()).max(20),
  meta: z.string().max(200),
});

const CreateTrackInput = z.object({
  deviceId: DeviceId,
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  base64: z.string().min(1),
  styleBrief: StyleBriefSchema,
  styleExamples: z.array(StyleExampleSchema).max(5).optional(),
  burnedPhrases: z.array(z.string().max(120)).max(60).optional(),
  burnedVowels: z.array(z.string().max(20)).max(60).optional(),
});

export const createTrack = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateTrackInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const binary = Buffer.from(data.base64, "base64");
    if (binary.length === 0) throw new Error("Empty audio file");
    if (binary.length > 25 * 1024 * 1024) throw new Error("Audio file too large (max 25 MB)");

    const ext = data.filename.split(".").pop()?.toLowerCase() || "webm";
    const path = `${data.deviceId}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("vocals")
      .upload(path, binary, { contentType: data.mimeType, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: inserted, error: insErr } = await supabase
      .from("tracks")
      .insert({
        device_id: data.deviceId,
        audio_path: path,
        status: "transcribing",
        style_brief: data.styleBrief ? (JSON.parse(JSON.stringify(data.styleBrief))) : null,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`DB insert failed: ${insErr.message}`);
    const trackId = inserted.id;

    try {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
      const { transcribeAudio } = await import("./ai-gateway.server");
      const audioBlob = new Blob([new Uint8Array(binary)], { type: data.mimeType });
      const transcript = await transcribeAudio(apiKey, audioBlob, data.filename);

      await supabase
        .from("tracks")
        .update({ raw_transcript: transcript, status: "writing" })
        .eq("id", trackId);

      const { lyrics, cadence, quality } = await runPipeline(transcript, data.styleBrief, data.styleExamples ?? [], data.burnedPhrases ?? [], data.burnedVowels ?? []);

      await supabase
        .from("tracks")
        .update({
          lyrics: JSON.parse(JSON.stringify(lyrics)),
          cadence_map: JSON.parse(JSON.stringify(cadence)),
          quality: JSON.parse(JSON.stringify(quality)),
          title: lyrics.title || "Untitled",
          status: "done",
        })
        .eq("id", trackId);

      return { id: trackId as string };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("tracks").update({ status: "error", error: msg }).eq("id", trackId);
      throw new Error(msg);
    }
  });

const RegenInput = z.object({
  deviceId: DeviceId,
  trackId: z.string().uuid(),
  styleBrief: StyleBriefSchema,
  styleExamples: z.array(StyleExampleSchema).max(5).optional(),
  burnedPhrases: z.array(z.string().max(120)).max(60).optional(),
  burnedVowels: z.array(z.string().max(20)).max(60).optional(),
});

export const regenerateLyrics = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RegenInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: track, error } = await supabase
      .from("tracks")
      .select("raw_transcript, device_id, style_brief, audio_path")
      .eq("id", data.trackId)
      .single();
    if (error || !track) throw new Error("Track not found");
    if (track.device_id !== data.deviceId) throw new Error("Not your track");

    const briefToUse = (data.styleBrief ?? (track.style_brief as StyleBrief | null) ?? undefined) as StyleBrief | undefined;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    try {
      let transcript = track.raw_transcript as string | null;

      // Re-transcribe from stored audio if the original transcription failed
      if (!transcript || !transcript.trim()) {
        if (!track.audio_path) throw new Error("No audio file stored for this track");
        await supabase.from("tracks").update({ status: "transcribing", error: null }).eq("id", data.trackId);

        const { data: dl, error: dlErr } = await supabase.storage.from("vocals").download(track.audio_path);
        if (dlErr || !dl) throw new Error(`Could not load audio: ${dlErr?.message ?? "unknown"}`);
        const ab = await dl.arrayBuffer();
        const mime = (dl as Blob).type || "audio/webm";
        const filename = track.audio_path.split("/").pop() || "audio.webm";
        const blob = new Blob([new Uint8Array(ab)], { type: mime });

        const { transcribeAudio } = await import("./ai-gateway.server");
        transcript = await transcribeAudio(apiKey, blob, filename);
        if (!transcript || !transcript.trim()) throw new Error("Transcription returned empty");

        await supabase.from("tracks").update({ raw_transcript: transcript }).eq("id", data.trackId);
      }

      await supabase.from("tracks").update({
        status: "writing",
        error: null,
        style_brief: briefToUse ? (JSON.parse(JSON.stringify(briefToUse))) : null,
      }).eq("id", data.trackId);

      const { lyrics, cadence, quality } = await runPipeline(transcript, briefToUse, data.styleExamples ?? [], data.burnedPhrases ?? [], data.burnedVowels ?? []);
      await supabase
        .from("tracks")
        .update({
          lyrics: JSON.parse(JSON.stringify(lyrics)),
          cadence_map: JSON.parse(JSON.stringify(cadence)),
          quality: JSON.parse(JSON.stringify(quality)),
          title: lyrics.title || "Untitled",
          status: "done",
        })
        .eq("id", data.trackId);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("tracks").update({ status: "error", error: msg }).eq("id", data.trackId);
      throw new Error(msg);
    }
  });


export const listTracks = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ deviceId: DeviceId }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: rows, error } = await supabase
      .from("tracks")
      .select("id, title, status, created_at")
      .eq("device_id", data.deviceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows;
  });

export const getTrack = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ deviceId: DeviceId, id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: track, error } = await supabase
      .from("tracks")
      .select("id, title, status, error, raw_transcript, lyrics, cadence_map, quality, style_brief, audio_path, device_id, created_at")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    if (track.device_id !== data.deviceId) throw new Error("Not your track");

    const { data: signed } = await supabase.storage
      .from("vocals")
      .createSignedUrl(track.audio_path, 60 * 60);

    return { ...track, audio_url: signed?.signedUrl ?? null };
  });

export const deleteTrack = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ deviceId: DeviceId, id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: track } = await supabase
      .from("tracks")
      .select("audio_path, device_id")
      .eq("id", data.id)
      .single();
    if (track && track.device_id !== data.deviceId) throw new Error("Not your track");
    if (track?.audio_path) {
      await supabase.storage.from("vocals").remove([track.audio_path]);
    }
    const { error } = await supabase.from("tracks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Cloud-mode Train: runs the full pipeline on a transcript without persisting a track.
// Returns the lyrics + score so the client can harvest into style memory.
const TrainInput = z.object({
  transcript: z.string().min(10).max(8000),
  styleBrief: StyleBriefSchema,
  styleExamples: z.array(StyleExampleSchema).max(5).optional(),
});

export const trainRound = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TrainInput.parse(input))
  .handler(async ({ data }) => {
    const { lyrics, cadence, quality, notes } = await runPipeline(
      data.transcript,
      data.styleBrief,
      data.styleExamples ?? [],
    );
    return { lyrics, cadence, quality, notes };
  });

// ---------- Bar-level rewrite + persist single-bar edits ----------

const BarRewriteInput = z.object({
  deviceId: DeviceId,
  trackId: z.string().uuid(),
  barIndex: z.number().int().min(0),
  count: z.number().int().min(1).max(4).optional(),
  options: z.object({
    keepEndSound: z.boolean().optional(),
    swapMetaphor: z.boolean().optional(),
    raiseDensity: z.boolean().optional(),
    custom: z.string().max(400).optional(),
  }),
  burnedPhrases: z.array(z.string().max(120)).max(60).optional(),
  burnedVowels: z.array(z.string().max(20)).max(60).optional(),
});

export const rewriteBar = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BarRewriteInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: track, error } = await supabase
      .from("tracks")
      .select("device_id, lyrics, cadence_map, style_brief")
      .eq("id", data.trackId)
      .single();
    if (error || !track) throw new Error("Track not found");
    if (track.device_id !== data.deviceId) throw new Error("Not your track");

    const lyrics = track.lyrics as Lyrics | null;
    if (!lyrics) throw new Error("No lyrics yet");
    const flat = lyrics.sections.flatMap((s) => s.lines);
    if (data.barIndex >= flat.length) throw new Error("Bar out of range");

    const cadence = (track.cadence_map as CadenceMap | null) ?? null;
    const bar = cadence?.bars?.[data.barIndex];

    let sectionBars: string[] = flat;
    let relIdx = data.barIndex;
    {
      let cursor = 0;
      for (const sec of lyrics.sections) {
        if (data.barIndex < cursor + sec.lines.length) {
          sectionBars = sec.lines;
          relIdx = data.barIndex - cursor;
          break;
        }
        cursor += sec.lines.length;
      }
    }
    const neighborsBefore = sectionBars.slice(Math.max(0, relIdx - 2), relIdx);
    const neighborsAfter = sectionBars.slice(relIdx + 1, relIdx + 3);
    const sectionScheme = rhymeScheme(sectionBars).slice(0, 16);
    const schemeLetter = sectionScheme[relIdx] || undefined;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const { rewriteSingleBar } = await import("./critics");

    const count = Math.max(1, Math.min(4, data.count ?? 1));
    const baseArgs = {
      original: flat[data.barIndex],
      sourceMumble: bar?.text,
      targetSyllables: bar?.syllables,
      targetEndSound: bar?.endSound,
      section: bar?.section,
      brief: (track.style_brief as StyleBrief | null) ?? undefined,
      burnedPhrases: data.burnedPhrases ?? [],
      burnedVowels: data.burnedVowels ?? [],
      neighborsBefore,
      neighborsAfter,
      sectionScheme,
      schemeLetter,
    };

    // Per-alternate nudge so multiple proposals diverge instead of collapsing
    // to the same line.
    const variants = [
      "",
      "Take a different angle than the obvious read.",
      "Lead with a concrete proper noun, brand, or place if it fits.",
      "Try a slant rhyme + internal echo instead of a clean end rhyme.",
    ];

    const proposalsRaw = await Promise.all(
      Array.from({ length: count }, (_, i) => {
        const extra = variants[i] || "";
        const custom = [data.options.custom?.trim(), extra].filter(Boolean).join(" ").trim();
        return rewriteSingleBar(apiKey, {
          ...baseArgs,
          options: { ...data.options, custom: custom || undefined },
        });
      }),
    );

    const seen = new Set<string>();
    const proposals: string[] = [];
    for (const p of proposalsRaw) {
      const key = p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        proposals.push(p);
      }
    }
    if (!proposals.length) proposals.push(proposalsRaw[0] ?? flat[data.barIndex]);

    return { proposal: proposals[0], proposals };
  });

const UpdateBarInput = z.object({
  deviceId: DeviceId,
  trackId: z.string().uuid(),
  barIndex: z.number().int().min(0),
  text: z.string().min(1).max(400),
});

export const updateBar = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => UpdateBarInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: track, error } = await supabase
      .from("tracks")
      .select("device_id, lyrics")
      .eq("id", data.trackId)
      .single();
    if (error || !track) throw new Error("Track not found");
    if (track.device_id !== data.deviceId) throw new Error("Not your track");

    const lyrics = track.lyrics as Lyrics | null;
    if (!lyrics) throw new Error("No lyrics yet");

    let idx = 0;
    const next: Lyrics = {
      title: lyrics.title,
      sections: lyrics.sections.map((s) => ({
        type: s.type,
        lines: s.lines.map((line) => {
          const isTarget = idx === data.barIndex;
          idx++;
          return isTarget ? data.text.trim() : line;
        }),
      })),
    };

    const { error: upErr } = await supabase
      .from("tracks")
      .update({ lyrics: JSON.parse(JSON.stringify(next)) })
      .eq("id", data.trackId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });


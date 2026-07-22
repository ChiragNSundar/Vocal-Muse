// Multi-critic council. Three critics with distinct rubrics run in parallel
// against the same draft; the aggregator picks the worst dimension and
// surfaces the offending bars so a targeted rewrite pass can fix only those.
// Each critic returns a 1-10 score per dimension and up to 6 weakest bars.
//
// Server-only: imported from tracks.functions.ts handlers.

import { z } from "zod";
import type { CadenceMap, StyleBrief } from "./lyrics-analysis";
import { fingerprintToConstraints } from "./fingerprint";

export type Lyrics = { title: string; sections: { type: string; lines: string[] }[] };

export type WeakBar = { index: number; line: string; why: string; rewrite?: string };

export type CriticResult = {
  role: "pocket" | "wordplay" | "authenticity";
  overall: number;
  scores: Record<string, number>;
  weakest: WeakBar[];
  notes: string[];
};

const CriticResponseSchema = z.object({
  scores: z.record(z.string(), z.number().min(1).max(10)).optional(),
  overall: z.number().min(1).max(10).optional(),
  weakestBars: z.array(z.object({
    index: z.number().optional(),
    line: z.string().optional(),
    why: z.string().optional(),
    rewrite: z.string().optional(),
  })).optional(),
  notes: z.array(z.string()).optional(),
}).passthrough();

function briefBlock(b: StyleBrief | undefined): string {
  if (!b) return "STYLE BRIEF: infer from transcript.";
  const parts: string[] = [];
  if (b.genre && b.genre !== "auto") parts.push(`Genre: ${b.genre}`);
  if (b.attitude?.length) parts.push(`Attitude: ${b.attitude.join(", ")}`);
  if (typeof b.rhymeDensity === "number") parts.push(`Rhyme density: ${b.rhymeDensity}/5`);
  if (b.slangRegion && b.slangRegion !== "auto") parts.push(`Slang region: ${b.slangRegion}`);
  if (b.topic) parts.push(`Topic: ${b.topic}`);
  if (b.avoid) parts.push(`Avoid: ${b.avoid}`);
  const base = parts.length ? `STYLE BRIEF: ${parts.join(" · ")}` : "STYLE BRIEF: infer.";
  return b.fingerprint
    ? base + "\n\n" + fingerprintToConstraints(b.fingerprint)
    : base;
}

const CRITICS = {
  pocket: {
    role: "pocket" as const,
    system: (brief: StyleBrief | undefined) => `You are the POCKET CRITIC. You only care about cadence, syllable count, stress placement, breath, and whether the bar SITS on the beat the artist mumbled.

${briefBlock(brief)}

Score 1-10 on:
- syllableLock: every bar within ±1 of cadence target
- stressPocket: stressed syllables land where the mumble stressed
- breath: lines are speakable in one breath, no jaw-breakers
- flowVariety: avoids monotone same-cadence-every-bar trap
Return up to 6 weakestBars where cadence breaks. Rewrites MUST preserve end-sound + section.`,
  },
  wordplay: {
    role: "wordplay" as const,
    system: (brief: StyleBrief | undefined) => `You are the WORDPLAY CRITIC. You only care about rhyme craft, multi-syllable chains, internal rhymes, slant rhymes, double-entendre, callbacks, and surprise.

${briefBlock(brief)}

Score 1-10 on:
- multiSyllableRhyme: 2-3 syllable end-rhymes vs lazy one-syllable
- internalRhyme: rhymes inside the bar, not just at the end
- doubleEntendre: lines with two readings
- imagery: specific concrete pictures vs abstractions
Return up to 6 weakestBars where rhyme/wordplay is weakest. Rewrites MUST keep syllable target ±1.`,
  },
  authenticity: {
    role: "authenticity" as const,
    system: (brief: StyleBrief | undefined) => `You are the AUTHENTICITY CRITIC. You hunt clichés, AI-tells, generic motivational filler, region/slang mismatches, and attitude inconsistency. You hold the bar to a real human artist's voice — not a chatbot's.

${briefBlock(brief)}

Score 1-10 on:
- noCliche: zero tired rap tropes (grind, demons, level up, ride or die, etc.)
- slangFit: slang matches the declared region, never mixed
- attitudeConsistency: tone holds across the song
- humanVoice: sounds like a person, not an algorithm
Return up to 6 weakestBars where authenticity slips. Rewrites must keep section + end-sound.`,
  },
};

async function callCriticGemini(
  apiKey: string,
  system: string,
  prompt: string,
): Promise<z.infer<typeof CriticResponseSchema>> {
  const { createLovableGateway } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  const gateway = createLovableGateway(apiKey);
  const hint = "\n\nReturn ONLY one valid JSON object. No markdown, no fences. Shape: {\"scores\":{\"foo\":7},\"overall\":7.5,\"weakestBars\":[{\"index\":3,\"line\":\"...\",\"why\":\"...\",\"rewrite\":\"...\"}],\"notes\":[\"...\"]}";

  // Critics use the cheap/fast model — they only score, never write the song.
  const result = await generateText({
    model: gateway("google/gemini-3.1-flash-lite"),
    system: system + hint,
    prompt,
    maxOutputTokens: 4096,
  });
  const text = (result as unknown as { text: string }).text;
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const s = cleaned.search(/[{[]/);
  const e = cleaned.lastIndexOf("}");
  if (s !== -1 && e !== -1) cleaned = cleaned.slice(s, e + 1);
  try {
    return CriticResponseSchema.parse(JSON.parse(cleaned));
  } catch {
    return { overall: 6, weakestBars: [], notes: [], scores: {} };
  }
}

async function runOneCritic(
  apiKey: string,
  role: keyof typeof CRITICS,
  lyrics: Lyrics,
  cadence: CadenceMap,
  brief: StyleBrief | undefined,
): Promise<CriticResult> {
  const def = CRITICS[role];
  // Bar-numbered render so the critic returns matching indices.
  const flat = lyrics.sections.flatMap((s) => s.lines);
  const numbered = flat.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const prompt = `BARS:\n${numbered}\n\nCADENCE TARGETS:\n${JSON.stringify(cadence.bars.map((b) => ({ i: b.index, syl: b.syllables, end: b.endSound, sec: b.section })), null, 0)}`;

  try {
    const r = await callCriticGemini(apiKey, def.system(brief), prompt);
    const scoreVals = Object.values(r.scores ?? {});
    const overall = typeof r.overall === "number"
      ? r.overall
      : (scoreVals.length ? scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length : 6);
    const weakest: WeakBar[] = (r.weakestBars ?? [])
      .map((b) => ({
        index: Number(b.index ?? 0),
        line: String(b.line ?? ""),
        why: String(b.why ?? ""),
        rewrite: b.rewrite ? String(b.rewrite) : undefined,
      }))
      .filter((b) => b.index > 0 && b.index <= flat.length);
    return {
      role: def.role,
      overall: Math.max(1, Math.min(10, overall)),
      scores: r.scores ?? {},
      weakest,
      notes: (r.notes ?? []).slice(0, 3),
    };
  } catch (error) {
    console.warn(`Critic ${role} failed`, error);
    return { role: def.role, overall: 6, scores: {}, weakest: [], notes: [] };
  }
}

export type CouncilVerdict = {
  overall: number; // average across critics
  byRole: Record<string, number>;
  weakestRole: "pocket" | "wordplay" | "authenticity";
  weakestBars: WeakBar[];
  notes: string[];
  scores: Record<string, number>;
};

export async function runCriticCouncil(
  apiKey: string,
  lyrics: Lyrics,
  cadence: CadenceMap,
  brief: StyleBrief | undefined,
): Promise<CouncilVerdict> {
  const [pocket, wordplay, auth] = await Promise.all([
    runOneCritic(apiKey, "pocket", lyrics, cadence, brief),
    runOneCritic(apiKey, "wordplay", lyrics, cadence, brief),
    runOneCritic(apiKey, "authenticity", lyrics, cadence, brief),
  ]);

  const all = [pocket, wordplay, auth];
  const overall = all.reduce((a, c) => a + c.overall, 0) / all.length;
  const byRole = Object.fromEntries(all.map((c) => [c.role, Number(c.overall.toFixed(1))]));

  // Lowest-scoring critic decides the rewrite focus.
  const weakest = all.reduce((min, c) => (c.overall < min.overall ? c : min), all[0]);

  // Merge all weakBars by index (union, prefer rewrite from the weakest critic).
  const merged = new Map<number, WeakBar>();
  for (const c of all) {
    for (const b of c.weakest) {
      const existing = merged.get(b.index);
      if (!existing) merged.set(b.index, b);
      else if (c.role === weakest.role && b.rewrite) merged.set(b.index, b);
    }
  }

  const allScores: Record<string, number> = {};
  for (const c of all) {
    for (const [k, v] of Object.entries(c.scores)) {
      allScores[`${c.role}.${k}`] = v;
    }
  }

  return {
    overall: Number(overall.toFixed(2)),
    byRole,
    weakestRole: weakest.role,
    weakestBars: Array.from(merged.values()).slice(0, 8),
    notes: all.flatMap((c) => c.notes).slice(0, 5),
    scores: allScores,
  };
}

// ---- Bar-level rewrite (single bar, constrained) ----------------------

const BarRewriteSchema = z.object({
  line: z.string().optional(),
  rewrite: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

export type BarRewriteOptions = {
  keepEndSound?: boolean;
  swapMetaphor?: boolean;
  raiseDensity?: boolean;
  custom?: string;
};

export async function rewriteSingleBar(
  apiKey: string,
  args: {
    original: string;
    sourceMumble?: string;
    targetSyllables?: number;
    targetEndSound?: string;
    section?: string;
    brief: StyleBrief | undefined;
    options: BarRewriteOptions;
    burnedPhrases?: string[];
    burnedVowels?: string[];
    // ±2 neighbor bars + the surrounding scheme letters so the rewrite
    // doesn't break callbacks or flip a perfect AABB into ABCB.
    neighborsBefore?: string[];
    neighborsAfter?: string[];
    sectionScheme?: string;
    schemeLetter?: string;
  },
): Promise<string> {
  const { createLovableGateway } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  const gateway = createLovableGateway(apiKey);

  const constraints: string[] = [];
  if (args.targetSyllables) constraints.push(`Syllables: exactly ${args.targetSyllables} (±1)`);
  if (args.options.keepEndSound && args.targetEndSound) {
    constraints.push(`End sound MUST stay "${args.targetEndSound}"`);
  } else if (args.targetEndSound) {
    constraints.push(`Original end sound was "${args.targetEndSound}" — free to change`);
  }
  if (args.options.swapMetaphor) constraints.push("Swap the central metaphor/image for a fresh one.");
  if (args.options.raiseDensity) constraints.push("Push rhyme density: add a multi-syllable end-rhyme or internal rhyme.");
  if (args.options.custom?.trim()) constraints.push(`User direction: ${args.options.custom.trim()}`);
  if (args.section) constraints.push(`Section: ${args.section}`);
  if (args.sectionScheme && args.schemeLetter) {
    constraints.push(
      `Section rhyme scheme is "${args.sectionScheme}" — this bar is the "${args.schemeLetter}" slot. Preserve that slot so the scheme survives.`,
    );
  }

  const burned = (args.burnedPhrases ?? []).slice(0, 30);
  const burnedV = (args.burnedVowels ?? []).slice(0, 20);
  const burnedBlock = burned.length
    ? `\nANTI-REPEAT LIST (do NOT reuse these end-words, hooks, or stems — recently used across this artist's catalog):\n${burned.map((p) => `- ${p}`).join("\n")}`
    : "";
  const burnedVowelsBlock = burnedV.length
    ? `\nBURNED END-RIMES (do NOT default to these rime sounds unless required by the cadence end-sound above):\n${burnedV.map((v) => `- "${v}"`).join("\n")}`
    : "";

  const before = (args.neighborsBefore ?? []).filter(Boolean);
  const after = (args.neighborsAfter ?? []).filter(Boolean);
  const neighborsBlock = (before.length || after.length)
    ? `\nNEIGHBORING BARS (do NOT contradict imagery, callbacks, or pronouns):\n${
        [
          ...before.map((b, i) => `  prev-${before.length - i}: ${b}`),
          `  >>> THIS BAR (rewrite this one only): ${args.original}`,
          ...after.map((b, i) => `  next+${i + 1}: ${b}`),
        ].join("\n")
      }`
    : "";

  const system = `You are an elite ghostwriter. Rewrite ONE bar of rap/R&B lyrics. Output only the rewritten bar — no quotes, no commentary, no JSON keys, no list bullets. Just the bar text.

NON-NEGOTIABLE:
- One single line.
- Stronger than the original: more specific, more pocket, fewer clichés.
- No emoji, no producer tags, no stage directions.
- Must sit naturally between the neighbor bars without breaking their imagery or rhyme scheme.
${briefBlock(args.brief)}${burnedBlock}${burnedVowelsBlock}`;

  const prompt = `ORIGINAL BAR: ${args.original}
${args.sourceMumble ? `SOURCE MUMBLE: ${args.sourceMumble}\n` : ""}${neighborsBlock}

CONSTRAINTS:
${constraints.map((c) => `- ${c}`).join("\n")}

Return ONLY the new bar text.`;

  try {
    const result = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system,
      prompt,
      maxOutputTokens: 256,
    });
    const text = (result as unknown as { text: string }).text || "";
    // Strip stray quotes / JSON wrapping if the model relapsed.
    let line = text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (line.startsWith("{")) {
      try {
        const obj = BarRewriteSchema.parse(JSON.parse(line));
        line = (obj.line || obj.rewrite || obj.text || "").trim();
      } catch { /* keep raw */ }
    }
    // Take first non-empty line only.
    line = line.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
    return line || args.original;
  } catch (error) {
    console.warn("rewriteSingleBar failed", error);
    return args.original;
  }
}

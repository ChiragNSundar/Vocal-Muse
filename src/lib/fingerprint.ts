// Reference-track style fingerprinting. Pure, client-safe. Used by the
// Style Brief picker and by the writer pipeline as hard constraints.

import { countSyllables } from "./phonetics";
import { vowelHistogram, rhymeFamily, internalRhymeScore, type VowelBucket } from "./phonemes";

export type Fingerprint = {
  id: string;
  name: string;
  // structural
  avgSyllablesPerBar: number;
  syllableVariance: number;
  barCount: number;
  // rhyme
  vowelHistogram: Record<VowelBucket, number>;
  internalRhymeDensity: number; // 0..1
  endRhymeFamilies: string[]; // top families used
  // texture
  slangBag: string[];
  punchInMarkers: number; // count of "uh", "yeah", "—", repeats
  // meta
  source?: string; // url / "manual" / track id
  createdAt: number;
};

const SLANG_HINTS = [
  "finna","bro","gang","ops","drip","slatt","bussin","fr","ngl","bet",
  "lowkey","highkey","bag","racks","whip","plug","shawty","trill","wave",
];

const PUNCH_RE = /\b(uh|yeah|ay|woo|huh)\b|—|\.{2,}|\([^)]+\)/gi;

export function buildFingerprint(name: string, lines: string[], source = "manual"): Fingerprint {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const syls = clean.map(countSyllables);
  const avg = syls.length ? syls.reduce((a, b) => a + b, 0) / syls.length : 0;
  const variance = syls.length
    ? syls.reduce((a, b) => a + (b - avg) ** 2, 0) / syls.length
    : 0;

  const families = new Map<string, number>();
  for (const l of clean) {
    const f = rhymeFamily(l, 2);
    families.set(f, (families.get(f) || 0) + 1);
  }
  const topFamilies = [...families.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  const internal =
    clean.reduce((a, l) => a + internalRhymeScore(l), 0) / Math.max(1, clean.length);

  const corpus = clean.join(" ").toLowerCase();
  const slangBag = SLANG_HINTS.filter((s) => corpus.includes(s));
  const punchInMarkers = (corpus.match(PUNCH_RE) || []).length;

  return {
    id: `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    avgSyllablesPerBar: Number(avg.toFixed(2)),
    syllableVariance: Number(variance.toFixed(2)),
    barCount: clean.length,
    vowelHistogram: vowelHistogram(clean),
    internalRhymeDensity: Number(internal.toFixed(3)),
    endRhymeFamilies: topFamilies,
    slangBag,
    punchInMarkers,
    source,
    createdAt: Date.now(),
  };
}

// Render a fingerprint as a compact constraint block for LLM prompts.
export function fingerprintToConstraints(fp: Fingerprint): string {
  const sylLow = Math.max(4, Math.round(fp.avgSyllablesPerBar - 1));
  const sylHigh = Math.round(fp.avgSyllablesPerBar + 1);
  const vowels = Object.entries(fp.vowelHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k}(${(v * 100).toFixed(0)}%)`)
    .join(", ");
  const fams = fp.endRhymeFamilies.slice(0, 4).join(" / ");
  const slang = fp.slangBag.slice(0, 8).join(", ") || "—";
  const density = fp.internalRhymeDensity > 0.15 ? "HIGH" : fp.internalRhymeDensity > 0.07 ? "MEDIUM" : "LOW";
  return [
    `REFERENCE STYLE: ${fp.name}`,
    `Target syllables/bar: ${sylLow}-${sylHigh} (avg ${fp.avgSyllablesPerBar})`,
    `Vowel palette (rank): ${vowels}`,
    `Preferred end-rhyme families: ${fams}`,
    `Internal-rhyme density: ${density}`,
    `Slang to lean on: ${slang}`,
    fp.punchInMarkers > 4 ? `Use punch-in ad-libs sparingly (uh / yeah)` : "",
  ].filter(Boolean).join("\n");
}

const FP_KEY = "voxscript.fingerprints";

export function loadFingerprints(): Fingerprint[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(FP_KEY) || "[]"); } catch { return []; }
}
export function saveFingerprints(list: Fingerprint[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FP_KEY, JSON.stringify(list));
}
export function upsertFingerprint(fp: Fingerprint) {
  const list = loadFingerprints();
  const idx = list.findIndex((x) => x.id === fp.id);
  if (idx >= 0) list[idx] = fp; else list.unshift(fp);
  saveFingerprints(list.slice(0, 50));
}
export function removeFingerprint(id: string) {
  saveFingerprints(loadFingerprints().filter((x) => x.id !== id));
}

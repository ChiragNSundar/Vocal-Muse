// Client-safe pure helpers used both server-side (post-validate / scoring)
// and on the client (bar inspector tooltips). The phonetic primitives now
// live in `./phonetics`; this module re-exports them so existing imports
// keep working and adds the brief/quality types and cliché list.

export {
  countSyllables,
  endRhymeKey,
  multiRimeKey,
  rhymeStrength,
  rhymeScheme,
  classifyScheme,
  avgRhymeChainSyllables,
} from "./phonetics";
import { countSyllables } from "./phonetics";

export const CLICHES: string[] = [
  "grind never stop", "feel so right", "in the night",
  "demons in my head", "started from the bottom", "moonlight",
  "spotlight on me", "back against the wall", "blood sweat tears",
  "rags to riches", "haters gonna hate", "live my best life",
  "shine bright", "chasing dreams", "ride or die",
  "trust the process", "level up", "no cap on god on god",
];

export function countCliches(lines: string[], extraBanned: string[] = []): number {
  const text = lines.join(" \n ").toLowerCase();
  let n = 0;
  for (const c of CLICHES) if (text.includes(c)) n++;
  for (const c of extraBanned) {
    const t = c.trim().toLowerCase();
    if (t && text.includes(t)) n++;
  }
  return n;
}

export type QualityScore = {
  cadenceMatch: number; // 0..1
  rhymeDensity: number; // avg rhyming syllables/bar (approx 0..4)
  clicheCount: number;
  vibeConsistency: number; // 1..5 from editor
  barCount: number;
};

export type CadenceBar = {
  index: number;
  syllables: number;
  endSound: string;
  section: string;
  text: string;
};

export type CadenceMap = {
  bars: CadenceBar[];
  detectedVibe?: string;
  detectedKeyPhrases?: string[];
};

export function scoreCadenceMatch(map: CadenceMap, lines: string[]): number {
  if (!map.bars.length || !lines.length) return 0;
  const n = Math.min(map.bars.length, lines.length);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const target = map.bars[i].syllables;
    const got = countSyllables(lines[i]);
    if (Math.abs(target - got) <= 1) hit++;
  }
  return hit / n;
}


import type { Fingerprint } from "./fingerprint";

export type StyleBrief = {
  genre?: string;
  attitude?: string[];
  rhymeDensity?: number; // 1..5
  slangRegion?: string;
  customSlang?: string;
  topic?: string;
  avoid?: string;
  explicit?: boolean;
  structuralRules?: string;
  fingerprint?: Fingerprint | null;
};

export const DEFAULT_BRIEF: StyleBrief = {
  genre: "auto",
  attitude: [],
  rhymeDensity: 3,
  slangRegion: "auto",
  customSlang: "",
  topic: "",
  avoid: "",
  explicit: true,
  structuralRules: "",
  fingerprint: null,
};

// Per-track quality guards. Pure client-side; runs on every lyric render so
// the user sees a warning chip the moment a regen produces repetitive bars.

import { endRhymeKey } from "./lyrics-analysis";
import { rhymeFamily } from "./phonemes";

export type RepetitionWarning = {
  type: "end-rhyme-streak" | "vowel-dominance" | "line-dupe";
  message: string;
  badBarIndices: number[];
};

export function analyzeRepetition(lines: string[], maxStreak = 3): RepetitionWarning[] {
  const out: RepetitionWarning[] = [];
  if (lines.length < maxStreak) return out;

  // 1. End-rhyme streaks (>= maxStreak+1 consecutive identical end-sounds)
  let streakStart = 0;
  let streakKey = endRhymeKey(lines[0]);
  for (let i = 1; i <= lines.length; i++) {
    const k = i < lines.length ? endRhymeKey(lines[i]) : "__END__";
    if (k !== streakKey) {
      const len = i - streakStart;
      if (len > maxStreak && streakKey) {
        out.push({
          type: "end-rhyme-streak",
          message: `${len} bars in a row end on "${streakKey}" — vary the rhyme.`,
          badBarIndices: Array.from({ length: len }, (_, k2) => streakStart + k2),
        });
      }
      streakStart = i;
      streakKey = k;
    }
  }

  // 2. Vowel-bucket dominance — one rhyme-family > 45% of all bars
  const fams = lines.map((l) => rhymeFamily(l));
  const counts = new Map<string, number[]>();
  fams.forEach((f, i) => {
    if (!f || f === "_") return;
    const arr = counts.get(f) ?? [];
    arr.push(i);
    counts.set(f, arr);
  });
  for (const [fam, idxs] of counts) {
    if (idxs.length / lines.length > 0.45 && idxs.length >= 4) {
      out.push({
        type: "vowel-dominance",
        message: `Rhyme family "${fam}" hits ${idxs.length}/${lines.length} bars — feels monotone.`,
        badBarIndices: idxs,
      });
    }
  }

  // 3. Exact line duplicates outside a hook section (the caller passes only one
  // section at a time when they care). Cheap O(n^2) — bar counts are small.
  const seen = new Map<string, number>();
  lines.forEach((l, i) => {
    const norm = l.trim().toLowerCase();
    if (!norm) return;
    const prev = seen.get(norm);
    if (prev !== undefined) {
      out.push({
        type: "line-dupe",
        message: `Bars ${prev + 1} and ${i + 1} are identical.`,
        badBarIndices: [prev, i],
      });
    } else {
      seen.set(norm, i);
    }
  });

  return out;
}

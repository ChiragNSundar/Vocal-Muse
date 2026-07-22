// Lightweight phonetic engine used by both the writer pipeline and the
// bar inspector. Heuristic-only (no CMU dict to keep the bundle slim) but
// upgraded over the original ad-hoc approach:
//  - syllable count handles silent-e, diphthongs, common -le endings
//  - extracts the last stressed vowel cluster + trailing consonants (the "rime")
//  - rhyme strength = how many phonetic units two rimes share
//  - chain scorer counts multi-syllable end-rhyme runs
//  - scheme labeler returns "AABB" / "ABAB" / "freeform"

const VOWELS = "aeiouy";

function cleanWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z']/g, "");
}

export function syllablesInWord(word: string): number {
  const w = cleanWord(word).replace(/'/g, "");
  if (!w) return 0;
  if (w.length <= 2) return 1;

  // silent trailing e (but not "le" after a consonant)
  let s = w;
  if (s.endsWith("e") && !s.endsWith("le")) s = s.slice(0, -1);

  // remove final "es" / "ed" when preceded by consonant (silent)
  if (/[^aeiouy](?:es|ed)$/.test(s)) s = s.slice(0, -2);

  // collapse diphthongs
  const groups = s.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;

  // "le" after a consonant adds a syllable (e.g. "table")
  if (/[^aeiouy]le$/.test(w)) n++;

  return Math.max(1, n);
}

export function countSyllables(line: string): number {
  if (!line) return 0;
  const cleaned = line
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // strip parenthetical ad-libs
    .replace(/[^a-z'\s-]/g, " ");
  let total = 0;
  for (const raw of cleaned.split(/\s+/)) {
    for (const part of raw.split("-")) {
      if (part) total += syllablesInWord(part);
    }
  }
  return total;
}

// Last word of a line, cleaned. Skips parenthetical ad-libs at the end.
function lastWord(line: string): string {
  const cleaned = line
    .toLowerCase()
    .replace(/\([^)]*\)\s*$/g, "")
    .replace(/[^a-z'\s]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words[words.length - 1] || "";
}

// Coarse phonetic key for the trailing word: last vowel cluster + everything after.
export function endRhymeKey(line: string): string {
  const last = lastWord(line);
  const m = last.match(/[aeiouy]+[^aeiouy]*$/);
  return m ? m[0] : last.slice(-2);
}

// Multi-syllable rime: try to capture the last TWO vowel clusters with their
// surrounding consonants — that's what makes "different mission" rhyme with
// "kitchen cousin". Falls back to single-vowel rime.
export function multiRimeKey(line: string): string {
  const last = lastWord(line);
  if (!last) return "";
  const matches = [...last.matchAll(/[aeiouy]+[^aeiouy]*/g)];
  if (matches.length >= 2) {
    return matches.slice(-2).map((m) => m[0]).join("");
  }
  return matches.length ? matches[0][0] : last.slice(-2);
}

// Score how strongly two end-rimes rhyme: 0 (no), 0.5 (vowel only),
// 1 (single perfect), 1.5+ (multi-syllable match).
export function rhymeStrength(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aV = a.match(/[aeiouy]+/g)?.join("") ?? "";
  const bV = b.match(/[aeiouy]+/g)?.join("") ?? "";
  if (!aV || !bV) return 0;
  if (aV === bV) {
    const tailA = a.replace(/^.*[aeiouy]/, "");
    const tailB = b.replace(/^.*[aeiouy]/, "");
    return tailA && tailA === tailB ? 1 : 0.6;
  }
  // share last vowel only
  if (aV.slice(-1) === bV.slice(-1)) return 0.4;
  return 0;
}

// Average rhyme density across consecutive bar pairs, weighted by strength
// and rewarded for multi-syllable matches. Roughly 0..2.5.
export function avgRhymeChainSyllables(lines: string[]): number {
  if (lines.length < 2) return 0;
  const keys = lines.map(endRhymeKey);
  const multis = lines.map(multiRimeKey);
  let total = 0;
  for (let i = 1; i < keys.length; i++) {
    const single = rhymeStrength(keys[i], keys[i - 1]);
    const multi = multis[i] && multis[i] === multis[i - 1] ? 1 : 0;
    total += single + multi;
  }
  return Number((total / lines.length).toFixed(2));
}

// Label the rhyme scheme of a section using A/B/C... per unique rime.
export function rhymeScheme(lines: string[]): string {
  if (!lines.length) return "";
  const seen = new Map<string, string>();
  let next = 0;
  const letters: string[] = [];
  for (const l of lines) {
    const key = endRhymeKey(l) || "_";
    if (!seen.has(key)) {
      seen.set(key, String.fromCharCode(65 + (next++ % 26)));
    }
    letters.push(seen.get(key)!);
  }
  return letters.join("");
}

export function classifyScheme(scheme: string): "AABB" | "ABAB" | "AAAA" | "freeform" {
  if (!scheme) return "freeform";
  // First 4 letters give a strong signal.
  const head = scheme.slice(0, 4);
  if (/^A{4,}/.test(scheme)) return "AAAA";
  if (head === "AABB") return "AABB";
  if (head === "ABAB") return "ABAB";
  return "freeform";
}

// Extract vowel nuclei (sequence of vowel clusters) across a line for mumble matching
export function extractVowelNuclei(line: string): string[] {
  if (!line) return [];
  const cleaned = line
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s]/g, " ");
  const matches = cleaned.match(/[aeiouy]+/g);
  return matches ? matches.map((v) => v.toUpperCase()) : [];
}

// Compare how closely two vowel sequences resonate (0..1.0)
export function vowelResonanceScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let matches = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i] || a[i].slice(0, 1) === b[i].slice(0, 1)) {
      matches++;
    }
  }
  return Number((matches / Math.max(a.length, b.length)).toFixed(2));
}

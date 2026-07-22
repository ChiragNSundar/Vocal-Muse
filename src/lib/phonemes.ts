// Compact phoneme engine — heuristic G2P that returns ARPAbet-ish vowel
// nuclei (no consonant detail) plus stress estimation. We avoid bundling
// the 3MB CMU dict; instead we map English spelling clusters to one of
// 15 canonical vowel buckets. Good enough for rhyme-family detection,
// vowel histograms, and multisyllabic matching used by the ghostwriter.

export type VowelBucket =
  | "AA" | "AE" | "AH" | "AO" | "AW" | "AY"
  | "EH" | "ER" | "EY"
  | "IH" | "IY"
  | "OW" | "OY"
  | "UH" | "UW";

export const VOWEL_BUCKETS: VowelBucket[] = [
  "AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW",
];

// Ordered: longer clusters first so multi-letter graphemes win.
const G2P: Array<[RegExp, VowelBucket]> = [
  [/^air|^are$|^ear[^aeiou]/, "EH"],
  [/^aw|^au/, "AO"],
  [/^ay|^ai|^ey|^ei/, "EY"],
  [/^ou|^ow/, "AW"],     // crowd, town — rough
  [/^oi|^oy/, "OY"],
  [/^oo/, "UW"],
  [/^ee|^ea|^ie/, "IY"],
  [/^igh|^y$|^ye/, "AY"],
  [/^ir|^ur|^er|^or[^aeiou]?$/, "ER"],
  [/^oa|^o[^aeiou]?e$|^ow$/, "OW"],
  [/^a/, "AE"],
  [/^e/, "EH"],
  [/^i/, "IH"],
  [/^o/, "AA"],
  [/^u/, "AH"],
];

const VOWEL_RE = /[aeiouy]+/g;

function toPhonemes(word: string): VowelBucket[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return [];
  const out: VowelBucket[] = [];
  let i = 0;
  while (i < w.length) {
    // skip consonants
    while (i < w.length && !"aeiouy".includes(w[i])) i++;
    if (i >= w.length) break;
    // grab vowel cluster + a peek
    let end = i;
    while (end < w.length && "aeiouy".includes(w[end])) end++;
    const cluster = w.slice(i, Math.min(end + 2, w.length));
    let matched: VowelBucket | null = null;
    for (const [re, v] of G2P) {
      if (re.test(cluster)) { matched = v; break; }
    }
    out.push(matched ?? "AH");
    i = end;
  }
  return out;
}

function lastWord(line: string): string {
  const cleaned = line.toLowerCase().replace(/\([^)]*\)\s*$/g, "").replace(/[^a-z'\s]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

// Last N stressed vowels (we treat the final vowel as primary stress;
// secondary stress = the vowel two syllables back).
export function endNuclei(line: string, n = 2): VowelBucket[] {
  const last = lastWord(line);
  const ph = toPhonemes(last);
  return ph.slice(-n);
}

// Stable rhyme-family key: joined end nuclei.
export function rhymeFamily(line: string, depth = 2): string {
  return endNuclei(line, depth).join("-") || "_";
}

// Internal-rhyme score: count vowel-bucket repeats inside a line, excluding
// the final nucleus (which is the end rhyme).
export function internalRhymeScore(line: string): number {
  const words = line.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2) return 0;
  const allNuclei = words.flatMap((w) => toPhonemes(w));
  if (allNuclei.length < 3) return 0;
  const interior = allNuclei.slice(0, -1);
  const counts = new Map<string, number>();
  for (const v of interior) counts.set(v, (counts.get(v) || 0) + 1);
  let repeats = 0;
  for (const c of counts.values()) if (c >= 2) repeats += c - 1;
  return Number((repeats / Math.max(1, interior.length)).toFixed(2));
}

// Vowel histogram across a corpus of lines (for fingerprinting). Returns
// normalized frequency per bucket, summing to 1.
export function vowelHistogram(lines: string[]): Record<VowelBucket, number> {
  const counts = Object.fromEntries(VOWEL_BUCKETS.map((v) => [v, 0])) as Record<VowelBucket, number>;
  for (const line of lines) {
    for (const v of endNuclei(line, 2)) counts[v]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  for (const k of VOWEL_BUCKETS) counts[k] = Number((counts[k] / total).toFixed(3));
  return counts;
}

// Burned-vowel filter: returns the buckets currently over-represented in
// recent history, so the writer can be told to avoid them.
export function overusedBuckets(hist: Record<VowelBucket, number>, threshold = 0.18): VowelBucket[] {
  return VOWEL_BUCKETS.filter((v) => hist[v] >= threshold);
}

export { toPhonemes };

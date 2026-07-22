// Style memory: a growing few-shot library of bars the critic loved.
// Auto-harvested from any track that scored >= 8/10, plus manual imports
// from the web/text harvester. Injected into the writer's system prompt so
// future generations learn from past wins. Lives entirely in localStorage.

export type StyleMemoryEntry = {
  id: string;
  title: string;
  drakeScore: number;
  vibe?: string;
  genre?: string;
  attitude?: string[];
  bars: string[];
  createdAt: number;
  source?: "self-play" | "track" | "web" | "paste" | "import";
  sourceUrl?: string;
};

export type TrainRunRecord = {
  id: string;
  startedAt: number;
  endedAt: number;
  mode: "cloud" | "local";
  rounds: number;
  completed: number;
  harvested: number;
  avgScore: number;
  topScore: number;
};

const KEY = "voxscript:style-memory";
const HISTORY_KEY = "voxscript:train-history";
const LIMITS_KEY = "voxscript:memory-limits";
// Runtime-tunable so local mode can grow the few-shot library beyond the
// cloud cap (locals don't pay per token of context). Cloud mode keeps the
// conservative default to stay under request size limits.
let MAX_ENTRIES = 200;
const MAX_HISTORY = 50;
let MIN_SCORE = 8.0;

(function loadLimits() {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LIMITS_KEY);
    if (!raw) return;
    const j = JSON.parse(raw) as { maxEntries?: number; minScore?: number };
    if (typeof j.maxEntries === "number" && j.maxEntries > 0) MAX_ENTRIES = Math.min(20_000, Math.max(50, Math.floor(j.maxEntries)));
    if (typeof j.minScore === "number") MIN_SCORE = Math.max(0, Math.min(10, j.minScore));
  } catch { /* ignore */ }
})();

export function setMemoryLimits(limits: { maxEntries?: number; minScore?: number }) {
  if (typeof limits.maxEntries === "number" && limits.maxEntries > 0) {
    MAX_ENTRIES = Math.min(20_000, Math.max(50, Math.floor(limits.maxEntries)));
  }
  if (typeof limits.minScore === "number") {
    MIN_SCORE = Math.max(0, Math.min(10, limits.minScore));
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LIMITS_KEY, JSON.stringify({ maxEntries: MAX_ENTRIES, minScore: MIN_SCORE }));
  }
}

export function getMemoryLimits() {
  return { maxEntries: MAX_ENTRIES, minScore: MIN_SCORE };
}

export function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export const DEFAULT_STYLE_SEEDS: StyleMemoryEntry[] = [
  {
    id: "seed-lyrical-1",
    title: "Midnight Notebooks (Lyrical Pocket)",
    drakeScore: 9.4,
    vibe: "boom-bap",
    genre: "hip-hop",
    attitude: ["reflective", "sharp"],
    bars: [
      "walking through Brooklyn with the tape deck humming",
      "copped the vintage leather jacket just to match the autumn",
      "every notebook holds a winter that I barely got through",
      "pencil smudges on the margin where the truth was drawn through",
      "mama told me keep the faith when the budget got thin",
      "now the stadium seats filled up to the brim"
    ],
    createdAt: 1770000000000,
    source: "self-play"
  },
  {
    id: "seed-trap-1",
    title: "Penthouse Curtains (Late Night Trap)",
    drakeScore: 9.2,
    vibe: "trap",
    genre: "trap",
    attitude: ["paranoid", "boss"],
    bars: [
      "penthouse view but the curtains pulled tight",
      "counting up the backend twice through the night",
      "phone stay silent on airplane mode",
      "brothers in the city got the whole street sold",
      "never needed praise from a man in a suit",
      "we was in the basement putting work in the root"
    ],
    createdAt: 1770000000000,
    source: "self-play"
  },
  {
    id: "seed-rnb-1",
    title: "3 AM Toronto (Melodic Soul)",
    drakeScore: 9.5,
    vibe: "rnb",
    genre: "r&b",
    attitude: ["vulnerable", "smooth"],
    bars: [
      "3 AM in Toronto with the fog on the glass",
      "left your silver ring sitting right beside the key pass",
      "every song I write still sounding like your middle name",
      "trying not to call when the rain hit the windowpane",
      "we gave it all away just to buy a little peace",
      "now I'm sleeping in a bed where the silence don't cease"
    ],
    createdAt: 1770000000000,
    source: "self-play"
  },
  {
    id: "seed-drill-1",
    title: "Cold Pressure (Drill Pocket)",
    drakeScore: 9.1,
    vibe: "drill",
    genre: "drill",
    attitude: ["focused", "loyal"],
    bars: [
      "lights down low when we sliding through the block",
      "day one bro got the key to the lock",
      "no fake love when the pressure getting heavy",
      "built this foundation, hands stayed steady",
      "talking out of turn get you left on read",
      "we just stack the paper, keep the family fed"
    ],
    createdAt: 1770000000000,
    source: "self-play"
  }
];

export function loadStyleMemory(): StyleMemoryEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(entries: StyleMemoryEntry[]) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* quota — ignore */
  }
}

export function addToStyleMemory(entry: Omit<StyleMemoryEntry, "id" | "createdAt">) {
  if (!isBrowser()) return;
  if (entry.drakeScore < MIN_SCORE) return;
  if (!entry.bars.length) return;
  const all = loadStyleMemory();
  const filtered = all.filter(
    (e) => !(e.title === entry.title && Math.abs(e.drakeScore - entry.drakeScore) < 0.05),
  );
  filtered.unshift({
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  });
  filtered.sort((a, b) => b.drakeScore - a.drakeScore);
  saveAll(filtered.slice(0, MAX_ENTRIES));
}

export function clearStyleMemory() {
  if (!isBrowser()) return;
  localStorage.removeItem(KEY);
}

export function removeStyleMemoryEntry(id: string) {
  saveAll(loadStyleMemory().filter((e) => e.id !== id));
}

// ---- Anti-cliché burned-phrases list ---------------------------------
// Every accepted bar contributes its end-word + a 2-3 word stem to a
// per-device "do not reuse" list. The writer + bar-rewriter consume it to
// avoid self-repetition across the artist's catalog. We also track the
// end-rime VOWEL keys (e.g. "ay", "ine", "ock") so the model can't just
// swap one cliché end-word for another that rhymes the same way — this
// is what stops every track defaulting to the same scheme.
import { endRhymeKey } from "./phonetics";

const BURNED_KEY = "voxscript:burned-phrases";
const BURNED_VOWELS_KEY = "voxscript:burned-vowels";
const MAX_BURNED = 200;
const MAX_BURNED_VOWELS = 60;

export function loadBurnedPhrases(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(BURNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function loadBurnedVowels(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(BURNED_VOWELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function addBurnedPhrasesFromBars(bars: string[]) {
  if (!isBrowser() || !bars.length) return;
  const fresh = new Set<string>();
  const vowels = new Set<string>();
  for (const bar of bars) {
    const words = bar
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z'\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) continue;
    fresh.add(words[words.length - 1]); // end-word
    if (words.length >= 3) fresh.add(words.slice(-3).join(" "));
    const rime = endRhymeKey(bar);
    if (rime) vowels.add(rime);
  }
  const merged = Array.from(new Set([...fresh, ...loadBurnedPhrases()])).slice(0, MAX_BURNED);
  // Vowel list keeps insertion-order with most-recent first so we naturally
  // age out: only the last ~60 end-rimes block reuse, older ones recycle.
  const mergedVowels = Array.from(new Set([...vowels, ...loadBurnedVowels()])).slice(0, MAX_BURNED_VOWELS);
  try {
    localStorage.setItem(BURNED_KEY, JSON.stringify(merged));
    localStorage.setItem(BURNED_VOWELS_KEY, JSON.stringify(mergedVowels));
  } catch { /* quota */ }
}

export function clearBurnedPhrases() {
  if (!isBrowser()) return;
  localStorage.removeItem(BURNED_KEY);
  localStorage.removeItem(BURNED_VOWELS_KEY);
}

export function sampleStyleExamples(
  count = 3,
  filter?: { vibe?: string; genre?: string },
): { bars: string[]; meta: string }[] {
  let all = loadStyleMemory();
  if (!all.length) all = DEFAULT_STYLE_SEEDS;
  let pool = all;
  if (filter?.vibe) pool = pool.filter((e) => e.vibe === filter.vibe);
  if (filter?.genre) pool = pool.filter((e) => e.genre === filter.genre);
  if (pool.length < count) pool = all;
  const topHalf = pool.slice(0, Math.max(count * 3, Math.ceil(pool.length / 2)));
  const shuffled = [...topHalf].sort(() => Math.random() - 0.5).slice(0, count);
  return shuffled.map((e) => ({
    bars: e.bars.slice(0, 8),
    meta: [
      e.vibe ? `vibe: ${e.vibe}` : null,
      e.genre ? `genre: ${e.genre}` : null,
      e.attitude?.length ? `attitude: ${e.attitude.join("/")}` : null,
      `score: ${e.drakeScore.toFixed(1)}/10`,
    ].filter(Boolean).join(" · "),
  }));
}

export function styleExamplesPromptBlock(examples: { bars: string[]; meta: string }[]): string {
  if (!examples.length) return "";
  const blocks = examples.map((ex, i) =>
    `EXAMPLE ${i + 1} (${ex.meta}):\n${ex.bars.map((b) => `  ${b}`).join("\n")}`,
  ).join("\n\n");
  return `\n\nSTUDY THESE EXAMPLES — they are bars from past wins that scored at the Drake-tier ceiling. Match this level of specificity, multis, and pocket. Do NOT copy them; absorb the standard.\n\n${blocks}`;
}

export function styleMemoryStats() {
  const all = loadStyleMemory();
  if (!all.length) {
    return {
      count: 0,
      avgScore: 0,
      topScore: 0,
      totalBars: 0,
      vibeBreakdown: [] as { vibe: string; count: number }[],
      sourceBreakdown: [] as { source: string; count: number }[],
      scoreBuckets: [] as { bucket: string; count: number }[],
    };
  }
  const sum = all.reduce((s, e) => s + e.drakeScore, 0);
  const totalBars = all.reduce((s, e) => s + e.bars.length, 0);

  const vibeMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  for (const e of all) {
    const v = e.vibe ?? "unspecified";
    vibeMap.set(v, (vibeMap.get(v) ?? 0) + 1);
    const s = e.source ?? "track";
    sourceMap.set(s, (sourceMap.get(s) ?? 0) + 1);
  }

  const buckets = [
    { bucket: "8.0–8.4", min: 8.0, max: 8.5 },
    { bucket: "8.5–8.9", min: 8.5, max: 9.0 },
    { bucket: "9.0–9.4", min: 9.0, max: 9.5 },
    { bucket: "9.5–10", min: 9.5, max: 10.01 },
  ].map((b) => ({
    bucket: b.bucket,
    count: all.filter((e) => e.drakeScore >= b.min && e.drakeScore < b.max).length,
  }));

  return {
    count: all.length,
    avgScore: sum / all.length,
    topScore: Math.max(...all.map((e) => e.drakeScore)),
    totalBars,
    vibeBreakdown: [...vibeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([vibe, count]) => ({ vibe, count })),
    sourceBreakdown: [...sourceMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
    scoreBuckets: buckets,
  };
}

// ---- Export / Import ----

export function exportStyleMemory(): string {
  const payload = {
    schema: "voxscript-style-memory",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: loadStyleMemory(),
    history: loadTrainHistory(),
  };
  return JSON.stringify(payload, null, 2);
}

export function importStyleMemory(
  jsonText: string,
  mode: "merge" | "replace" = "merge",
): { added: number; total: number } {
  const plan = analyzeImport(jsonText);
  const choices: Record<string, ImportChoice> = {};
  for (const item of plan.items) {
    if (mode === "replace") choices[item.key] = "theirs";
    else if (item.status === "new") choices[item.key] = "theirs";
    else if (item.status === "duplicate") choices[item.key] = "skip";
    else choices[item.key] = item.incoming.createdAt >= (item.existing?.createdAt ?? 0) ? "theirs" : "mine";
  }
  const r = applyImportPlan(plan, choices, mode === "replace");
  return { added: r.added + r.updated, total: r.total };
}

// ---- Merge analysis with duplicate detection + version conflicts ----

export type ImportChoice = "mine" | "theirs" | "both" | "skip";
export type ImportStatus = "new" | "duplicate" | "conflict";

export type ImportDiffItem = {
  key: string;
  status: ImportStatus;
  incoming: StyleMemoryEntry;
  existing?: StyleMemoryEntry;
  changedFields: string[];
};

export type ImportPlan = {
  items: ImportDiffItem[];
  incomingTotal: number;
  existingTotal: number;
  counts: { new: number; duplicate: number; conflict: number };
  meta: { schema?: string; version?: number; exportedAt?: string };
};

function hashBars(bars: string[]): string {
  const s = bars.map((b) => b.trim().toLowerCase()).join("\n");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

function normalizeIncoming(raw: unknown): StyleMemoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<StyleMemoryEntry>;
  if (!Array.isArray(e.bars)) return null;
  const bars = e.bars.map((b) => String(b)).filter(Boolean);
  if (!bars.length) return null;
  return {
    id: typeof e.id === "string" ? e.id : crypto.randomUUID(),
    title: String(e.title ?? "Imported"),
    drakeScore: typeof e.drakeScore === "number" ? e.drakeScore : 8.0,
    vibe: e.vibe,
    genre: e.genre,
    attitude: Array.isArray(e.attitude) ? e.attitude : undefined,
    bars,
    createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now(),
    source: e.source ?? "import",
    sourceUrl: e.sourceUrl,
  };
}

function diffFields(a: StyleMemoryEntry, b: StyleMemoryEntry): string[] {
  const changed: string[] = [];
  if (a.title !== b.title) changed.push("title");
  if (Math.abs(a.drakeScore - b.drakeScore) >= 0.05) changed.push("drakeScore");
  if ((a.vibe ?? "") !== (b.vibe ?? "")) changed.push("vibe");
  if ((a.genre ?? "") !== (b.genre ?? "")) changed.push("genre");
  if (hashBars(a.bars) !== hashBars(b.bars) || a.bars.length !== b.bars.length) changed.push("bars");
  return changed;
}

export function analyzeImport(jsonText: string): ImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON file");
  }
  const root = parsed as { entries?: unknown; schema?: string; version?: number; exportedAt?: string };
  const incomingRaw = Array.isArray(root.entries) ? (root.entries as unknown[]) : [];
  if (!incomingRaw.length) throw new Error("No memory entries found in file");

  const incoming = incomingRaw
    .map(normalizeIncoming)
    .filter((e): e is StyleMemoryEntry => Boolean(e));

  const existing = loadStyleMemory();
  const byId = new Map<string, StyleMemoryEntry>(existing.map((e) => [e.id, e]));
  const byContent = new Map<string, StyleMemoryEntry>(
    existing.map((e) => [`${e.title.toLowerCase()}::${hashBars(e.bars)}`, e]),
  );

  const items: ImportDiffItem[] = incoming.map((inc, i) => {
    const contentKey = `${inc.title.toLowerCase()}::${hashBars(inc.bars)}`;
    const contentMatch = byContent.get(contentKey);
    const idMatch = byId.get(inc.id);
    const match = contentMatch ?? idMatch;
    if (!match) return { key: `${i}-${inc.id}`, status: "new", incoming: inc, changedFields: [] };
    const changed = diffFields(match, inc);
    return {
      key: `${i}-${inc.id}`,
      status: changed.length === 0 ? "duplicate" : "conflict",
      incoming: inc,
      existing: match,
      changedFields: changed,
    };
  });

  const counts = { new: 0, duplicate: 0, conflict: 0 };
  for (const it of items) counts[it.status] += 1;

  return {
    items,
    incomingTotal: incoming.length,
    existingTotal: existing.length,
    counts,
    meta: { schema: root.schema, version: root.version, exportedAt: root.exportedAt },
  };
}

export function applyImportPlan(
  plan: ImportPlan,
  choices: Record<string, ImportChoice>,
  replaceAll = false,
): { added: number; updated: number; kept: number; total: number } {
  const existing = replaceAll ? [] : loadStyleMemory();
  const byId = new Map<string, StyleMemoryEntry>(existing.map((e) => [e.id, e]));

  let added = 0;
  let updated = 0;
  let kept = 0;

  for (const item of plan.items) {
    const choice: ImportChoice = choices[item.key] ?? (item.status === "new" ? "theirs" : "skip");
    if (choice === "skip" || choice === "mine") {
      if (item.existing) kept += 1;
      continue;
    }
    if (choice === "both") {
      const clone: StyleMemoryEntry = { ...item.incoming, id: crypto.randomUUID() };
      byId.set(clone.id, clone);
      added += 1;
      if (item.existing) kept += 1;
      continue;
    }
    if (item.existing && byId.has(item.existing.id)) {
      byId.set(item.existing.id, { ...item.incoming, id: item.existing.id });
      updated += 1;
    } else {
      byId.set(item.incoming.id, item.incoming);
      added += 1;
    }
  }

  const merged = [...byId.values()]
    .sort((a, b) => b.drakeScore - a.drakeScore)
    .slice(0, MAX_ENTRIES);
  saveAll(merged);
  return { added, updated, kept, total: merged.length };
}

// ---- Manual / web harvesting ----

export function addHarvestedBars(input: {
  title: string;
  bars: string[];
  vibe?: string;
  source: "web" | "paste";
  sourceUrl?: string;
  assumedScore?: number;
}) {
  const score = input.assumedScore ?? 8.5;
  const bars = input.bars
    .map((b) => b.trim())
    .filter((b) => b.length >= 8 && b.length <= 240);
  if (!bars.length) return 0;
  // Chunk into groups of 8 so each "example" is a coherent verse-sized slice.
  const chunks: string[][] = [];
  for (let i = 0; i < bars.length; i += 8) chunks.push(bars.slice(i, i + 8));
  for (let i = 0; i < chunks.length; i++) {
    addToStyleMemory({
      title: chunks.length > 1 ? `${input.title} (pt ${i + 1})` : input.title,
      drakeScore: score,
      vibe: input.vibe,
      bars: chunks[i],
      source: input.source,
      sourceUrl: input.sourceUrl,
    });
  }
  return bars.length;
}

// ---- Training history ----

export function loadTrainHistory(): TrainRunRecord[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordTrainRun(run: Omit<TrainRunRecord, "id">) {
  if (!isBrowser()) return;
  const all = loadTrainHistory();
  all.unshift({ ...run, id: crypto.randomUUID() });
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

export function clearTrainHistory() {
  if (!isBrowser()) return;
  localStorage.removeItem(HISTORY_KEY);
}

// Rhyme intelligence — pluggable providers, cached results.
//
// Primary provider: Datamuse (https://www.datamuse.com/api/) — free, no key,
// CORS-friendly, ships perfect/near/consonant rhymes, sound-alikes, and
// meaning-related words. Ideal offline-friendly companion because it can be
// mirrored behind a tiny local proxy if the user goes fully offline.
//
// RhymeWave (https://www.rhymewave.com/) has no public API — it's a
// client-side app. We deep-link into its UI so a single click opens the
// user's target word there for deeper phonetic exploration.
//
// Provider slots are also open for local Ollama/LM Studio: any endpoint
// returning `{ rhymes: string[] }` for a POST `{ word }` can be plugged in
// via Settings. That keeps the door open for RhymeWave-style intelligence
// even in a fully-offline setup.
//
// CMUdict provider: Local phonetic rhyming using bundled CMUdict subset.
// Works completely offline, no network required.

import { cacheGet, cacheSet, hashInputs } from "./cache";
import { findRhymes as cmudictFindRhymes, type CmudictRhymeHit } from "./cmudict-rhymes";

export type RhymeKind = "perfect" | "near" | "consonant" | "sound-like" | "related";

export type RhymeHit = {
  word: string;
  score: number;
  syllables?: number;
  kind: RhymeKind;
};

export type RhymeProviderId = "datamuse" | "custom" | "cmudict";

export type RhymeProviderConfig = {
  id: RhymeProviderId;
  /** For "custom": OpenAI-style POST endpoint returning `{ rhymes: string[] }`. */
  endpoint?: string;
  apiKey?: string;
};

const DEFAULT_CFG_KEY = "voxscript:rhyme-provider";

export function loadRhymeProvider(): RhymeProviderConfig {
  if (typeof localStorage === "undefined") return { id: "datamuse" };
  try {
    const raw = localStorage.getItem(DEFAULT_CFG_KEY);
    if (!raw) return { id: "datamuse" };
    return { id: "datamuse", ...JSON.parse(raw) };
  } catch { return { id: "datamuse" }; }
}

export function saveRhymeProvider(cfg: RhymeProviderConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEFAULT_CFG_KEY, JSON.stringify(cfg));
}

// ---------- Datamuse ----------

type DatamuseHit = { word: string; score?: number; numSyllables?: number };

async function datamuse(rel: string, word: string, max = 30): Promise<DatamuseHit[]> {
  const url = `https://api.datamuse.com/words?${rel}=${encodeURIComponent(word)}&md=s&max=${max}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Datamuse ${rel} failed: ${res.status}`);
  return res.json();
}

function toHits(hits: DatamuseHit[], kind: RhymeKind): RhymeHit[] {
  return hits.map((h) => ({
    word: h.word,
    score: h.score ?? 0,
    syllables: h.numSyllables,
    kind,
  }));
}

async function datamuseLookup(word: string): Promise<RhymeHit[]> {
  const [perfect, near, sound, related] = await Promise.all([
    datamuse("rel_rhy", word, 40).catch(() => []),
    datamuse("rel_nry", word, 30).catch(() => []),
    datamuse("sl", word, 20).catch(() => []),
    datamuse("ml", word, 15).catch(() => []),
  ]);
  return [
    ...toHits(perfect, "perfect"),
    ...toHits(near, "near"),
    ...toHits(sound, "sound-like"),
    ...toHits(related, "related"),
  ];
}

// ---------- Custom local provider ----------

async function customLookup(word: string, cfg: RhymeProviderConfig): Promise<RhymeHit[]> {
  if (!cfg.endpoint) throw new Error("Custom rhyme provider requires an endpoint");
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ word }),
  });
  if (!res.ok) throw new Error(`Custom rhyme provider failed: ${res.status}`);
  const json = (await res.json()) as { rhymes?: (string | { word: string; score?: number; kind?: RhymeKind })[] };
  const out: RhymeHit[] = [];
  for (const r of json.rhymes ?? []) {
    if (typeof r === "string") out.push({ word: r, score: 0, kind: "perfect" });
    else out.push({ word: r.word, score: r.score ?? 0, kind: (r.kind as RhymeKind) ?? "perfect" });
  }
  return out;
}

// ---------- CMUdict local provider ----------

async function cmudictLookup(word: string): Promise<RhymeHit[]> {
  const hits = await cmudictFindRhymes(word, { maxResults: 50 });
  return hits.map((h: CmudictRhymeHit) => ({
    word: h.word,
    score: h.score,
    syllables: h.syllables,
    kind: h.kind,
  }));
}

// ---------- Public API ----------

export async function lookupRhymes(word: string, cfg: RhymeProviderConfig = loadRhymeProvider()): Promise<RhymeHit[]> {
  const clean = word.trim().toLowerCase().replace(/[^a-z' -]/g, "");
  if (!clean) return [];
  const key = await hashInputs(["rhyme", cfg.id, cfg.endpoint ?? "", clean]);
  const cached = await cacheGet<RhymeHit[]>("chat", key);
  if (cached) return cached;
  let hits: RhymeHit[];
  if (cfg.id === "custom") {
    hits = await customLookup(clean, cfg);
  } else if (cfg.id === "cmudict") {
    hits = await cmudictLookup(clean);
  } else {
    hits = await datamuseLookup(clean);
  }
  await cacheSet("chat", key, hits, { kind: "rhymes", word: clean });
  return hits;
}

/** Deep-link into RhymeWave's search UI for a given word. */
export function rhymeWaveUrl(word: string): string {
  return `https://www.rhymewave.com/#/${encodeURIComponent(word.trim())}`;
}

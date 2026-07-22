// Embedding-based style-memory recall.
//
// `sampleStyleExamples` (the prior recall path) picks top-scoring entries at
// random with a coarse vibe/genre filter. That works, but it serves the
// *same* high-scoring bars regardless of what the artist actually mumbled.
//
// `recallStyleExamples` upgrades this to retrieval-by-meaning:
//   1. Embed the query (transcript + brief topic/attitude when available).
//   2. Embed each style-memory entry's bars (cached forever — entries are
//      immutable once stored).
//   3. Score by cosine similarity, blend with the entry's drakeScore so a
//      mediocre-but-on-topic example doesn't beat a great-and-on-topic one.
//   4. Return the top K in the same shape `sampleStyleExamples` returns.
//
// Falls back transparently to `sampleStyleExamples` when the embedding
// endpoint is unavailable (no credits, local Ollama missing the embed model,
// network error). The writer never sees the difference.

import { loadStyleMemory, sampleStyleExamples, DEFAULT_STYLE_SEEDS, type StyleMemoryEntry } from "./style-memory";
import { embedMany, embedOne, cosineSim, resolveEmbedContext, type EmbedContext } from "./embeddings";

export type RecalledExample = { bars: string[]; meta: string };

export type RecallOptions = {
  count?: number;
  filter?: { vibe?: string; genre?: string };
  /** When set, blends similarity with normalized drakeScore. 0..1, default 0.25. */
  qualityWeight?: number;
  /** Hard cap on entries scored — keeps recall O(K) even with 5k+ memories. */
  candidatePool?: number;
};

function entryRepresentation(e: StyleMemoryEntry): string {
  // Bars carry the actual phonetic + semantic signal we want to retrieve on.
  // Title gives a topic anchor; vibe/genre help disambiguate. Cap length so
  // a giant verse doesn't dominate the embedding budget.
  const head = [e.title, e.vibe, e.genre].filter(Boolean).join(" · ");
  const bars = e.bars.slice(0, 10).join(" / ");
  return `${head}\n${bars}`.slice(0, 4000);
}

function exampleFromEntry(e: StyleMemoryEntry, similarity: number): RecalledExample {
  return {
    bars: e.bars.slice(0, 8),
    meta: [
      e.vibe ? `vibe: ${e.vibe}` : null,
      e.genre ? `genre: ${e.genre}` : null,
      e.attitude?.length ? `attitude: ${e.attitude.join("/")}` : null,
      `score: ${e.drakeScore.toFixed(1)}/10`,
      `match: ${(similarity * 100).toFixed(0)}%`,
    ].filter(Boolean).join(" · "),
  };
}

export async function recallStyleExamples(
  query: string,
  opts: RecallOptions = {},
  ctx?: EmbedContext,
): Promise<RecalledExample[]> {
  const count = Math.max(1, opts.count ?? 3);
  const trimmedQuery = (query || "").trim();
  let memory = loadStyleMemory();
  if (!memory.length) memory = DEFAULT_STYLE_SEEDS;

  // Apply coarse filter first to keep embedding cost low.
  let pool = memory;
  if (opts.filter?.vibe) pool = pool.filter((e) => e.vibe === opts.filter!.vibe);
  if (opts.filter?.genre) pool = pool.filter((e) => e.genre === opts.filter!.genre);
  if (pool.length < count) pool = memory;

  // Trim to candidate pool by drakeScore (best first) so we never embed 5k
  // entries when only the top ~80 matter for selection quality.
  const candidates = [...pool]
    .sort((a, b) => b.drakeScore - a.drakeScore)
    .slice(0, Math.max(count * 8, opts.candidatePool ?? 80));

  // No query → fall back to the legacy sampler. Same applies if every
  // candidate has trivially empty content.
  if (!trimmedQuery) {
    return sampleStyleExamples(count, opts.filter);
  }

  try {
    const context = ctx ?? resolveEmbedContext();
    const [queryVec, entryVecs] = await Promise.all([
      embedOne(trimmedQuery.slice(0, 4000), context),
      embedMany(candidates.map(entryRepresentation), context),
    ]);

    const qWeight = Math.min(1, Math.max(0, opts.qualityWeight ?? 0.25));
    const scored = candidates.map((entry, i) => {
      const sim = cosineSim(queryVec, entryVecs[i]);
      // Normalize drakeScore (~8..10 range) into roughly 0..1.
      const qualityBoost = Math.min(1, Math.max(0, (entry.drakeScore - 7) / 3));
      const blended = sim * (1 - qWeight) + qualityBoost * qWeight;
      return { entry, sim, blended };
    });
    scored.sort((a, b) => b.blended - a.blended);
    const top = scored.slice(0, count);
    if (!top.length) return sampleStyleExamples(count, opts.filter);
    return top.map(({ entry, sim }) => exampleFromEntry(entry, sim));
  } catch (e) {
    // Embedding endpoint unavailable — fall through to the random sampler.
    if (typeof console !== "undefined") {
      console.warn("[style-recall] embedding fallback:", e instanceof Error ? e.message : e);
    }
    return sampleStyleExamples(count, opts.filter);
  }
}

/**
 * Build a recall query from whatever signal is available at call time.
 * Transcript is the strongest signal; brief.topic/attitude are useful when
 * the transcript hasn't been produced yet (cloud path runs transcription
 * server-side, so the client only has the brief at submit time).
 */
export function buildRecallQuery(parts: {
  transcript?: string;
  topic?: string;
  attitude?: string[];
  customSlang?: string;
  genre?: string;
}): string {
  const chunks: string[] = [];
  if (parts.topic) chunks.push(`Topic: ${parts.topic}`);
  if (parts.attitude?.length) chunks.push(`Attitude: ${parts.attitude.join(", ")}`);
  if (parts.genre && parts.genre !== "auto") chunks.push(`Genre: ${parts.genre}`);
  if (parts.customSlang) chunks.push(`Slang: ${parts.customSlang}`);
  if (parts.transcript) {
    // Take a 1500-char window — the embedding model gets the most signal
    // from a representative slice, not the full mumble.
    const t = parts.transcript.trim();
    chunks.push(t.length > 1500 ? t.slice(0, 1500) : t);
  }
  return chunks.join("\n");
}

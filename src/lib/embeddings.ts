// Client-side embedding facade with persistent cache.
//
// Two backends:
//   - "cloud" → calls the `embedTexts` server function (Lovable AI Gateway,
//     gemini-embedding-001 by default, 3072 dims).
//   - "local" → POSTs to the user's local OpenAI-compatible /v1/embeddings
//     endpoint (Ollama, LM Studio). Default model: nomic-embed-text (768 dims).
//
// All callers go through `embedMany` / `embedOne`, which dedupes the request,
// checks the IDB cache for each text, fetches only the misses in one batch,
// and writes them back. The cache key is (backend + baseUrl + model + text)
// so swapping models or hosts doesn't return stale vectors.

import { cacheGet, cacheSet, hashInputs } from "./cache";
import { loadLlmConfig, type LlmConfig } from "./llm-config";

export type EmbedBackend = "cloud" | "local";

export type EmbedContext = {
  backend: EmbedBackend;
  model: string;
  baseUrl?: string; // local only
  apiKey?: string; // local only
};

const CLOUD_DEFAULT_MODEL = "google/gemini-embedding-001";
const LOCAL_DEFAULT_MODEL = "nomic-embed-text";

export function resolveEmbedContext(config: LlmConfig = loadLlmConfig()): EmbedContext {
  if (config.mode === "local") {
    return {
      backend: "local",
      model: LOCAL_DEFAULT_MODEL,
      baseUrl: config.localBaseUrl,
      apiKey: config.localApiKey || "local",
    };
  }
  return { backend: "cloud", model: CLOUD_DEFAULT_MODEL };
}

async function keyFor(ctx: EmbedContext, text: string): Promise<string> {
  return hashInputs([ctx.backend, ctx.baseUrl ?? "cloud", ctx.model, text]);
}

async function callLocal(ctx: EmbedContext, texts: string[]): Promise<number[][]> {
  const url = `${(ctx.baseUrl ?? "").replace(/\/+$/, "")}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.apiKey || "local"}`,
    },
    body: JSON.stringify({ model: ctx.model, input: texts }),
  });
  if (!res.ok) throw new Error(`Local embed failed (${res.status})`);
  const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
  const items = json.data ?? [];
  return texts.map((_, i) => {
    const it = items.find((x) => x.index === i) ?? items[i];
    if (!it?.embedding) throw new Error(`Missing local embedding at index ${i}`);
    return it.embedding;
  });
}

async function callCloud(texts: string[], model: string): Promise<number[][]> {
  // Dynamic import so this client file is safe to bundle without dragging
  // server-fn module shapes in unexpected places.
  const { embedTexts } = await import("./embeddings.functions");
  const out = await embedTexts({ data: { texts, model } });
  return out.vectors;
}

export async function embedMany(texts: string[], ctx?: EmbedContext): Promise<number[][]> {
  const context = ctx ?? resolveEmbedContext();
  if (!texts.length) return [];

  // Dedupe + cache lookup
  const cleaned = texts.map((t) => t.trim()).map((t) => (t.length > 6000 ? t.slice(0, 6000) : t));
  const keys = await Promise.all(cleaned.map((t) => keyFor(context, t)));
  const hits = await Promise.all(keys.map((k) => cacheGet<number[]>("embeddings", k)));

  const missesIdx: number[] = [];
  const missesText: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (!hits[i]) {
      missesIdx.push(i);
      missesText.push(cleaned[i]);
    }
  }

  let fresh: number[][] = [];
  if (missesText.length) {
    // Batch — cap at 32 per call to stay polite with both providers.
    const BATCH = 32;
    for (let i = 0; i < missesText.length; i += BATCH) {
      const slice = missesText.slice(i, i + BATCH);
      const vecs = context.backend === "local"
        ? await callLocal(context, slice)
        : await callCloud(slice, context.model);
      fresh.push(...vecs);
    }
    // Persist
    await Promise.all(
      missesIdx.map((origIdx, j) =>
        cacheSet("embeddings", keys[origIdx], fresh[j], { model: context.model, backend: context.backend }),
      ),
    );
  }

  // Assemble final ordered list
  const out: number[][] = new Array(cleaned.length);
  let missCursor = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (hits[i]) out[i] = hits[i] as number[];
    else out[i] = fresh[missCursor++];
  }
  return out;
}

export async function embedOne(text: string, ctx?: EmbedContext): Promise<number[]> {
  const [v] = await embedMany([text], ctx);
  return v;
}

export function cosineSim(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Lightweight availability probe — used to short-circuit recall when the
 * local user hasn't pulled an embedding model yet. Cloud is always available
 * when credits exist, so we just return true for cloud without a roundtrip.
 */
export async function embeddingsAvailable(config: LlmConfig = loadLlmConfig()): Promise<boolean> {
  if (config.mode === "cloud") return true;
  try {
    await embedOne("ping", resolveEmbedContext(config));
    return true;
  } catch {
    return false;
  }
}

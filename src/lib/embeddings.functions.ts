// Cloud embedding server function — calls Lovable AI Gateway's OpenAI-compatible
// /v1/embeddings endpoint. Used by style-memory recall when the user is in
// cloud LLM mode. We batch up to 32 strings per call; the client de-dupes
// and caches results in IndexedDB, so a typical recall round-trip embeds
// only the entries that changed since last time + the query itself.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  texts: z.array(z.string().min(1).max(8000)).min(1).max(64),
  model: z.string().max(120).optional(),
});

export const embedTexts = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<{ model: string; vectors: number[][] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const model = data.model || "google/gemini-embedding-001";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: data.texts }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Embedding failed (${res.status}): ${txt.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      data?: { index?: number; embedding?: number[] }[];
      model?: string;
    };
    const items = json.data ?? [];
    // Preserve input order — providers usually return sorted-by-index but
    // belt-and-suspenders for safety.
    const vectors: number[][] = data.texts.map((_, i) => {
      const item = items.find((x) => x.index === i) ?? items[i];
      if (!item?.embedding) throw new Error(`Missing embedding at index ${i}`);
      return item.embedding;
    });
    return { model: json.model ?? model, vectors };
  });

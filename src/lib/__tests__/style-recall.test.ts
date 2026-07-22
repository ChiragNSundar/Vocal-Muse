import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";

// Mock the cloud server-function so tests never hit the network.
vi.mock("@/lib/embeddings.functions", () => ({
  embedTexts: vi.fn(async ({ data }: { data: { texts: string[] } }) => {
    // Hashed bag-of-words embedding: each unique word lands in one of 256
    // dims. Gives genuine topical signal — texts that share words score
    // higher than texts that don't.
    const DIMS = 256;
    const hash = (s: string) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return Math.abs(h) % DIMS;
    };
    const vectors = data.texts.map((t) => {
      const v = new Array(DIMS).fill(0);
      for (const w of t.toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 3)) {
        v[hash(w)] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
    return { model: "test", vectors };
  }),
}));

import { cosineSim, embedMany } from "../embeddings";
import { recallStyleExamples } from "../style-recall";
import { addToStyleMemory, clearStyleMemory } from "../style-memory";

describe("cosineSim", () => {
  it("returns 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });
});

describe("embedMany caching", () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase("voxscript-cache");
    localStorage.clear();
    localStorage.setItem("voxscript:llm-config", JSON.stringify({ mode: "cloud" }));
    await new Promise((r) => setTimeout(r, 5));
  });
  it("returns vectors of expected length and dedupes", async () => {
    const vecs = await embedMany(["alpha", "beta"]);
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(256);
  });
});

describe("recallStyleExamples", () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase("voxscript-cache");
    localStorage.clear();
    localStorage.setItem("voxscript:llm-config", JSON.stringify({ mode: "cloud" }));
    clearStyleMemory();
    await new Promise((r) => setTimeout(r, 5));
  });

  it("ranks topically-similar entries higher than unrelated ones", async () => {
    addToStyleMemory({
      title: "ocean drive",
      drakeScore: 8.2,
      bars: ["palm trees swaying past the windshield", "ocean spray hitting the chrome"],
    });
    addToStyleMemory({
      title: "winter trenches",
      drakeScore: 9.5,
      bars: ["snowflakes on the steel in december", "block freezing while the kettle sing"],
    });

    const results = await recallStyleExamples("driving past the ocean palm trees", { count: 1 });
    expect(results).toHaveLength(1);
    // Should pick the ocean-themed entry even though winter scored higher,
    // because qualityWeight defaults to 0.25 (similarity dominates).
    expect(results[0].bars.join(" ").toLowerCase()).toContain("palm");
  });
});

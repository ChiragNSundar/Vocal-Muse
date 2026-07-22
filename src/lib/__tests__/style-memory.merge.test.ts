import { beforeEach, describe, expect, it } from "vitest";
import {
  analyzeImport,
  applyImportPlan,
  addToStyleMemory,
  clearStyleMemory,
  loadStyleMemory,
  type StyleMemoryEntry,
} from "@/lib/style-memory";

function makeExport(entries: Partial<StyleMemoryEntry>[]): string {
  return JSON.stringify({
    schema: "voxscript-style-memory",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: entries.map((e, i) => ({
      id: e.id ?? `id-${i}`,
      title: e.title ?? `Track ${i}`,
      drakeScore: e.drakeScore ?? 8.5,
      bars: e.bars ?? ["bar one alpha", "bar two beta"],
      createdAt: e.createdAt ?? Date.now(),
      source: e.source ?? "import",
      ...e,
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  clearStyleMemory();
});

describe("analyzeImport — duplicate detection", () => {
  it("marks identical entries (same title + same bars) as duplicate", () => {
    addToStyleMemory({ title: "Night Drive", drakeScore: 8.7, bars: ["one", "two", "three"], source: "track" });
    const json = makeExport([{ id: "different-id", title: "Night Drive", drakeScore: 8.7, bars: ["one", "two", "three"] }]);
    const plan = analyzeImport(json);
    expect(plan.counts).toMatchObject({ duplicate: 1, new: 0, conflict: 0 });
    expect(plan.items[0].status).toBe("duplicate");
    expect(plan.items[0].changedFields).toEqual([]);
  });

  it("matches duplicates by content hash even when ids differ", () => {
    addToStyleMemory({ title: "Same Vibe", drakeScore: 9.0, bars: ["a b c d e", "x y z"], source: "track" });
    const json = makeExport([{ id: "totally-new", title: "Same Vibe", drakeScore: 9.0, bars: ["a b c d e", "x y z"] }]);
    expect(analyzeImport(json).counts.duplicate).toBe(1);
  });

  it("classifies brand-new entries as new", () => {
    const json = makeExport([{ id: "fresh", title: "Brand New", bars: ["never seen"] }]);
    const plan = analyzeImport(json);
    expect(plan.counts.new).toBe(1);
    expect(plan.items[0].status).toBe("new");
  });

  it("ignores bar order/whitespace differences in title casing but flags real differences", () => {
    addToStyleMemory({ title: "Mixed", drakeScore: 8.5, bars: ["alpha", "beta"], source: "track" });
    // Same title (case-insensitive match), different bars → conflict
    const json = makeExport([{ id: "x", title: "MIXED", drakeScore: 8.5, bars: ["alpha", "gamma"] }]);
    const plan = analyzeImport(json);
    expect(plan.counts.conflict + plan.counts.new).toBe(1);
    // Title differs in case → either way it isn't a clean duplicate
    expect(plan.counts.duplicate).toBe(0);
  });
});

describe("analyzeImport — version conflicts", () => {
  it("flags entries with same id but different score as conflict", () => {
    const existing = loadStyleMemory();
    expect(existing.length).toBe(0);
    addToStyleMemory({ title: "Evolving", drakeScore: 8.2, bars: ["one", "two"], source: "track" });
    const mine = loadStyleMemory()[0];
    const json = makeExport([{ id: mine.id, title: "Evolving", drakeScore: 9.4, bars: ["one", "two"] }]);
    const plan = analyzeImport(json);
    expect(plan.counts.conflict).toBe(1);
    expect(plan.items[0].changedFields).toContain("drakeScore");
  });

  it("captures bar-content drift in changedFields", () => {
    addToStyleMemory({ title: "Drift", drakeScore: 8.5, bars: ["original line one"], source: "track" });
    const mine = loadStyleMemory()[0];
    const json = makeExport([{ id: mine.id, title: "Drift", drakeScore: 8.5, bars: ["rewritten line one", "added line"] }]);
    const plan = analyzeImport(json);
    expect(plan.items[0].status).toBe("conflict");
    expect(plan.items[0].changedFields).toContain("bars");
  });

  it("detects vibe + genre + title changes independently", () => {
    addToStyleMemory({ title: "Old Title", drakeScore: 8.5, vibe: "trap", genre: "rap", bars: ["x"], source: "track" });
    const mine = loadStyleMemory()[0];
    const json = makeExport([{
      id: mine.id, title: "New Title", drakeScore: 8.5, vibe: "rnb", genre: "soul", bars: ["x"],
    }]);
    const plan = analyzeImport(json);
    expect(plan.items[0].changedFields.sort()).toEqual(["genre", "title", "vibe"]);
  });

  it("rejects malformed JSON", () => {
    expect(() => analyzeImport("{not json")).toThrow(/Invalid JSON/);
  });

  it("rejects payloads without entries", () => {
    expect(() => analyzeImport(JSON.stringify({ schema: "x" }))).toThrow(/No memory entries/);
  });
});

describe("applyImportPlan — conflict resolution choices", () => {
  it("'theirs' overwrites the existing entry by id", () => {
    addToStyleMemory({ title: "Apply Theirs", drakeScore: 8.2, bars: ["mine"], source: "track" });
    const mine = loadStyleMemory()[0];
    const plan = analyzeImport(makeExport([
      { id: mine.id, title: "Apply Theirs", drakeScore: 9.1, bars: ["theirs"] },
    ]));
    const r = applyImportPlan(plan, { [plan.items[0].key]: "theirs" });
    expect(r.updated).toBe(1);
    expect(loadStyleMemory()[0].bars).toEqual(["theirs"]);
    expect(loadStyleMemory()[0].drakeScore).toBeCloseTo(9.1);
    expect(loadStyleMemory()[0].id).toBe(mine.id);
  });

  it("'mine' keeps existing untouched", () => {
    addToStyleMemory({ title: "Keep Mine", drakeScore: 8.2, bars: ["mine"], source: "track" });
    const mine = loadStyleMemory()[0];
    const plan = analyzeImport(makeExport([{ id: mine.id, title: "Keep Mine", drakeScore: 9.1, bars: ["theirs"] }]));
    const r = applyImportPlan(plan, { [plan.items[0].key]: "mine" });
    expect(r.updated).toBe(0);
    expect(r.kept).toBe(1);
    expect(loadStyleMemory()[0].bars).toEqual(["mine"]);
  });

  it("'both' clones incoming under a new id, keeping the original", () => {
    addToStyleMemory({ title: "Both", drakeScore: 8.2, bars: ["mine"], source: "track" });
    const mine = loadStyleMemory()[0];
    const plan = analyzeImport(makeExport([{ id: mine.id, title: "Both", drakeScore: 9.1, bars: ["theirs"] }]));
    const r = applyImportPlan(plan, { [plan.items[0].key]: "both" });
    expect(r.added).toBe(1);
    const mem = loadStyleMemory();
    expect(mem).toHaveLength(2);
    expect(mem.some((e) => e.bars[0] === "mine")).toBe(true);
    expect(mem.some((e) => e.bars[0] === "theirs")).toBe(true);
  });

  it("'skip' on a duplicate adds nothing", () => {
    addToStyleMemory({ title: "Dup", drakeScore: 8.5, bars: ["x", "y"], source: "track" });
    const plan = analyzeImport(makeExport([{ title: "Dup", drakeScore: 8.5, bars: ["x", "y"] }]));
    const r = applyImportPlan(plan, { [plan.items[0].key]: "skip" });
    expect(r.added).toBe(0);
    expect(r.updated).toBe(0);
    expect(loadStyleMemory()).toHaveLength(1);
  });

  it("replaceAll wipes existing memory before applying", () => {
    addToStyleMemory({ title: "Old", drakeScore: 9.5, bars: ["keep?"], source: "track" });
    const plan = analyzeImport(makeExport([{ title: "Fresh", drakeScore: 8.5, bars: ["new"] }]));
    const r = applyImportPlan(plan, { [plan.items[0].key]: "theirs" }, true);
    expect(r.total).toBe(1);
    expect(loadStyleMemory()[0].title).toBe("Fresh");
  });

  it("default choice for 'new' items is to add them", () => {
    const plan = analyzeImport(makeExport([{ title: "Auto Add", bars: ["fresh"] }]));
    const r = applyImportPlan(plan, {});
    expect(r.added).toBe(1);
  });

  it("default choice for 'duplicate' items is to skip", () => {
    addToStyleMemory({ title: "AutoSkip", drakeScore: 8.5, bars: ["x"], source: "track" });
    const plan = analyzeImport(makeExport([{ title: "AutoSkip", drakeScore: 8.5, bars: ["x"] }]));
    const r = applyImportPlan(plan, {});
    expect(r.added).toBe(0);
    expect(r.updated).toBe(0);
  });
});

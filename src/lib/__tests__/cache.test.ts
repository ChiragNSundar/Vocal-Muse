import { describe, expect, it, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { cacheGet, cacheSet, withCache, hashInputs, clearCache, cacheStats } from "../cache";

describe("cache", () => {
  beforeEach(async () => {
    await clearCache();
  });

  it("stores and retrieves a value by key", async () => {
    const k = await hashInputs(["model-a", "hello"]);
    await cacheSet("chat", k, "world");
    expect(await cacheGet<string>("chat", k)).toBe("world");
  });

  it("misses when any input changes", async () => {
    const k1 = await hashInputs(["model-a", "hello"]);
    const k2 = await hashInputs(["model-a", "Hello"]);
    await cacheSet("chat", k1, "world");
    expect(await cacheGet<string>("chat", k2)).toBeNull();
  });

  it("withCache computes once, returns cache on second call", async () => {
    let calls = 0;
    const compute = async () => { calls++; return "computed"; };
    const k = await hashInputs(["x"]);
    const r1 = await withCache("pipeline", k, compute);
    const r2 = await withCache("pipeline", k, compute);
    expect(r1).toEqual({ value: "computed", fromCache: false });
    expect(r2).toEqual({ value: "computed", fromCache: true });
    expect(calls).toBe(1);
  });

  it("hashInputs is stable across key order", async () => {
    const a = await hashInputs([{ b: 2, a: 1 }]);
    const b = await hashInputs([{ a: 1, b: 2 }]);
    expect(a).toBe(b);
  });

  it("clearCache wipes a namespace", async () => {
    const k = await hashInputs(["x"]);
    await cacheSet("transcribe", k, "t");
    await clearCache("transcribe");
    expect(await cacheGet<string>("transcribe", k)).toBeNull();
  });

  it("cacheStats reports per-namespace counts", async () => {
    await cacheSet("chat", "k1", "v1");
    await cacheSet("chat", "k2", "v2");
    await cacheSet("pipeline", "k3", { a: 1 });
    const stats = await cacheStats();
    const chat = stats.find((s) => s.namespace === "chat")!;
    const pipe = stats.find((s) => s.namespace === "pipeline")!;
    expect(chat.entries).toBe(2);
    expect(pipe.entries).toBe(1);
  });
});

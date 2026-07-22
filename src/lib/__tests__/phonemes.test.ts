import { describe, it, expect } from "vitest";
import { rhymeFamily, vowelHistogram, internalRhymeScore, endNuclei } from "../phonemes";
import { buildFingerprint, fingerprintToConstraints } from "../fingerprint";

describe("phoneme engine", () => {
  it("returns end nuclei for common words", () => {
    expect(endNuclei("walking down the street", 2).length).toBeGreaterThan(0);
  });
  it("produces stable family keys", () => {
    const a = rhymeFamily("rolling down the lane");
    const b = rhymeFamily("riding in the rain");
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // same call → same result (determinism)
    expect(rhymeFamily("rolling down the lane")).toBe(a);
  });
  it("vowel histogram sums to ~1", () => {
    const h = vowelHistogram(["this is a test line", "another line of text"]);
    const sum = Object.values(h).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.9);
    expect(sum).toBeLessThan(1.1);
  });
  it("internal-rhyme score is non-negative", () => {
    expect(internalRhymeScore("the rain in spain stays plain")).toBeGreaterThan(0);
    expect(internalRhymeScore("hi")).toBe(0);
  });
});

describe("fingerprint", () => {
  const lines = [
    "rolling through the city in a foreign whip",
    "diamonds on my pinky leave a corner lit",
    "told her keep it solid never warning slick",
    "money on my mind every morning quick",
  ];
  it("builds a fingerprint with sane fields", () => {
    const fp = buildFingerprint("test", lines);
    expect(fp.barCount).toBe(4);
    expect(fp.avgSyllablesPerBar).toBeGreaterThan(6);
    expect(fp.endRhymeFamilies.length).toBeGreaterThan(0);
  });
  it("renders a constraint block", () => {
    const fp = buildFingerprint("test", lines);
    const txt = fingerprintToConstraints(fp);
    expect(txt).toContain("REFERENCE STYLE: test");
    expect(txt).toContain("Target syllables/bar");
  });
});

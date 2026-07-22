import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImportMergeDialog } from "@/components/ImportMergeDialog";
import {
  analyzeImport,
  clearStyleMemory,
  loadStyleMemory,
  type StyleMemoryEntry,
} from "@/lib/style-memory";

// Budgets are intentionally generous because JSDOM is ~10-20x slower than a
// real browser. The point is to catch order-of-magnitude regressions
// (accidental O(n²) work, full-tree rerenders on every keystroke), not to
// benchmark wall-clock UI performance. Tune via env when running locally.
const BUDGET_ANALYZE_MS = Number(process.env.PERF_BUDGET_ANALYZE_MS ?? 5000);
const BUDGET_RENDER_MS = Number(process.env.PERF_BUDGET_RENDER_MS ?? 12000);
const BUDGET_TOGGLE_MS = Number(process.env.PERF_BUDGET_TOGGLE_MS ?? 2500);
const BUDGET_STRATEGY_MS = Number(process.env.PERF_BUDGET_STRATEGY_MS ?? 12000);

// Pure-JS stress dataset size (analyzeImport).
const STRESS_N = Number(process.env.PERF_STRESS_N ?? 10_000);
// Render dataset size. JSDOM has to layout every node and the dialog does not
// virtualize, so we keep this much smaller than STRESS_N. The render budget
// is what proves the diff UI stays *responsive* — recompute work per
// interaction must scale linearly, not quadratically.
const RENDER_N = Number(process.env.PERF_RENDER_N ?? 600);

const STYLE_MEMORY_KEY = "voxscript:style-memory";

function makeBars(i: number): string[] {
  return [`bar ${i} alpha line`, `bar ${i} beta line`, `bar ${i} gamma line`];
}

function incomingScoreFor(i: number): number {
  return 8 + (i % 20) / 10;
}

function seedAndBuildExport(n: number) {
  // To exercise all three classifications at scale we seed the existing
  // library directly (bypassing addToStyleMemory's MIN_SCORE filter and
  // MAX_ENTRIES cap) so a deterministic slice of incoming rows resolves to
  // duplicate / conflict regardless of n.
  const seedCount = Math.min(80, Math.max(20, Math.floor(n / 50)));
  const seeds: StyleMemoryEntry[] = [];
  for (let k = 0; k < seedCount; k++) {
    const i = k; // deterministic indices that exist in the incoming set
    const conflict = k % 2 === 0;
    seeds.push({
      id: `seed-${i}`,
      title: `Track ${i}`,
      drakeScore: conflict ? 8.0 : incomingScoreFor(i),
      vibe: conflict ? "trap" : i % 2 ? "trap" : "rnb",
      bars: makeBars(i),
      createdAt: Date.now() - 10_000,
      source: "track",
    });
  }
  localStorage.setItem(STYLE_MEMORY_KEY, JSON.stringify(seeds));

  const entries: Partial<StyleMemoryEntry>[] = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      id: `import-${i}`,
      title: `Track ${i}`,
      drakeScore: incomingScoreFor(i),
      vibe: i % 2 ? "trap" : "rnb",
      bars: makeBars(i),
      createdAt: Date.now() + i,
      source: "import",
    });
  }
  return JSON.stringify({
    schema: "voxscript-style-memory",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  });
}

function elapsed<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

beforeEach(() => {
  localStorage.clear();
  clearStyleMemory();
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    });
  }
});

describe("ImportMergeDialog — stress / perf", () => {
  it(
    `analyzeImport classifies ${STRESS_N} entries under ${BUDGET_ANALYZE_MS}ms`,
    () => {
      const json = seedAndBuildExport(STRESS_N);
      expect(loadStyleMemory().length).toBeGreaterThan(0);

      const { ms, value: plan } = elapsed(() => analyzeImport(json));

      expect(plan.incomingTotal).toBe(STRESS_N);
      expect(plan.counts.new + plan.counts.duplicate + plan.counts.conflict).toBe(STRESS_N);
      // Every classification bucket is exercised at scale.
      expect(plan.counts.conflict).toBeGreaterThan(0);
      expect(plan.counts.duplicate).toBeGreaterThan(0);
      expect(plan.counts.new).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.info(`[perf] analyzeImport(${STRESS_N}) took ${ms.toFixed(0)}ms`);
      expect(ms).toBeLessThan(BUDGET_ANALYZE_MS);
    },
    BUDGET_ANALYZE_MS + 10_000,
  );

  it(
    `renders ${RENDER_N}-row dialog and keeps diff interactions responsive`,
    () => {
      const json = seedAndBuildExport(RENDER_N);
      const plan = analyzeImport(json);

      const { ms: renderMs } = elapsed(() =>
        render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={() => {}} />),
      );
      // eslint-disable-next-line no-console
      console.info(`[perf] initial render(${RENDER_N}) took ${renderMs.toFixed(0)}ms`);
      expect(renderMs).toBeLessThan(BUDGET_RENDER_MS);

      // Summary still correct at scale.
      const summary = screen.getByTestId("import-summary").textContent ?? "";
      expect(summary).toMatch(new RegExp(`${RENDER_N} incoming`));

      // Toggling a single diff panel must not redo work for every other row.
      const showButtons = screen.getAllByText("show changes");
      expect(showButtons.length).toBeGreaterThan(0);
      const { ms: toggleMs } = elapsed(() => {
        act(() => {
          fireEvent.click(showButtons[0]);
        });
      });
      // eslint-disable-next-line no-console
      console.info(`[perf] toggle diff (1 of ${RENDER_N}) took ${toggleMs.toFixed(0)}ms`);
      expect(screen.getByTestId("diff-panel")).toBeInTheDocument();
      expect(toggleMs).toBeLessThan(BUDGET_TOGGLE_MS);

      // Switching the global strategy is the worst-case interaction: it
      // recomputes a choice for every row. Must still finish under budget —
      // a regression to non-linear work shows up here first.
      const { ms: strategyMs } = elapsed(() => {
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /Prefer incoming/ }));
        });
      });
      // eslint-disable-next-line no-console
      console.info(`[perf] strategy switch (${RENDER_N} rows) took ${strategyMs.toFixed(0)}ms`);
      expect(strategyMs).toBeLessThan(BUDGET_STRATEGY_MS);
    },
    BUDGET_RENDER_MS + BUDGET_TOGGLE_MS + BUDGET_STRATEGY_MS + 15_000,
  );
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportMergeDialog } from "@/components/ImportMergeDialog";
import { addToStyleMemory, analyzeImport, clearStyleMemory, loadStyleMemory, type StyleMemoryEntry } from "@/lib/style-memory";

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

function buildPlanWithMix() {
  addToStyleMemory({ title: "Conflict Track", drakeScore: 8.2, vibe: "trap", bars: ["original alpha", "original beta"], source: "track" });
  addToStyleMemory({ title: "Duplicate Track", drakeScore: 8.5, vibe: "rnb", bars: ["same one", "same two"], source: "track" });
  const existing = loadStyleMemory();
  const conflictId = existing.find((e) => e.title === "Conflict Track")!.id;

  const payload: { entries: Partial<StyleMemoryEntry>[]; schema: string; version: number; exportedAt: string } = {
    schema: "voxscript-style-memory",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: [
      { id: conflictId, title: "Conflict Track", drakeScore: 9.4, vibe: "trap", bars: ["new alpha", "new beta", "new gamma"], createdAt: Date.now() },
      { id: "dup-id", title: "Duplicate Track", drakeScore: 8.5, vibe: "rnb", bars: ["same one", "same two"], createdAt: Date.now() },
      { id: "new-id", title: "Fresh Bars", drakeScore: 8.8, vibe: "drill", bars: ["never seen this before"], createdAt: Date.now() },
    ],
  };
  return analyzeImport(JSON.stringify(payload));
}

describe("ImportMergeDialog — diff rendering", () => {
  it("renders header counts for new / duplicate / conflict", () => {
    const plan = buildPlanWithMix();
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={() => {}} />);
    expect(screen.getByTestId("count-new").textContent).toBe("1");
    expect(screen.getByTestId("count-duplicate").textContent).toBe("1");
    expect(screen.getByTestId("count-conflict").textContent).toBe("1");
    expect(screen.getByTestId("import-summary").textContent).toMatch(/3 incoming/);
  });

  it("shows a status badge for every item", () => {
    const plan = buildPlanWithMix();
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={() => {}} />);
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText("duplicate")).toBeInTheDocument();
    expect(screen.getByText("conflict")).toBeInTheDocument();
  });

  it("'show changes' reveals a field diff with mine/incoming columns for the conflict", async () => {
    const user = userEvent.setup();
    const plan = buildPlanWithMix();
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={() => {}} />);

    expect(screen.queryByTestId("diff-panel")).not.toBeInTheDocument();

    const showButtons = screen.getAllByText("show changes");
    await user.click(showButtons[0]);

    const panel = screen.getByTestId("diff-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("diff-col-mine")).toBeInTheDocument();
    expect(screen.getByTestId("diff-col-incoming")).toBeInTheDocument();
    expect(panel.textContent).toMatch(/8\.20/);
    expect(panel.textContent).toMatch(/9\.40/);
    expect(panel.textContent).toMatch(/original alpha/);
    expect(panel.textContent).toMatch(/new alpha/);
  });

  it("changedFields badges name every drifted field on a conflict row", () => {
    addToStyleMemory({ title: "MultiDrift", drakeScore: 8.0, vibe: "trap", bars: ["one"], source: "track" });
    const id = loadStyleMemory()[0].id;
    const plan = analyzeImport(JSON.stringify({
      entries: [{ id, title: "MultiDrift v2", drakeScore: 9.2, vibe: "rnb", bars: ["two", "three"], createdAt: Date.now() }],
    }));
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={() => {}} />);
    expect(screen.getByText("title changed")).toBeInTheDocument();
    expect(screen.getByText("drakeScore changed")).toBeInTheDocument();
    expect(screen.getByText("vibe changed")).toBeInTheDocument();
    expect(screen.getByText("bars changed")).toBeInTheDocument();
  });

  it("Apply button calls onApplied with the right totals using default Smart strategy", () => {
    const plan = buildPlanWithMix();
    const onApplied = vi.fn();
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={onApplied} />);

    fireEvent.click(screen.getByRole("button", { name: /Apply \(/ }));

    expect(onApplied).toHaveBeenCalledTimes(1);
    const result = onApplied.mock.calls[0][0];
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("strategy 'Keep both' converts conflicts into duplicate clones", async () => {
    const user = userEvent.setup();
    const plan = buildPlanWithMix();
    const onApplied = vi.fn();
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={onApplied} />);

    // Click the strategy preset button. There's also "Keep both" per-row option,
    // but those only render for conflicts (item.existing exists). The strategy
    // button is the first match on the page.
    const keepBothButtons = screen.getAllByRole("button", { name: /^Keep both$/ });
    await user.click(keepBothButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: /Apply \(/ }));

    const result = onApplied.mock.calls[0][0];
    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);
  });

  it("per-row override beats the global strategy", async () => {
    const user = userEvent.setup();
    const plan = buildPlanWithMix();
    const onApplied = vi.fn();
    render(<ImportMergeDialog plan={plan} onClose={() => {}} onApplied={onApplied} />);

    const keepMineButtons = screen.getAllByRole("button", { name: /^Keep mine$/ });
    await user.click(keepMineButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: /Apply \(/ }));
    const result = onApplied.mock.calls[0][0];
    expect(result.updated).toBe(0);
    expect(result.added).toBe(1);
    expect(result.kept).toBeGreaterThanOrEqual(1);
  });
});

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { applyImportPlan, type ImportChoice, type ImportPlan, type StyleMemoryEntry } from "@/lib/style-memory";
import { AlertTriangle, GitMerge, Plus, Copy, FileWarning, Check } from "lucide-react";

type Strategy = "smart" | "theirs" | "mine" | "both" | "manual";

function FieldDiff({ label, mine, theirs }: { label: string; mine: string; theirs: string }) {
  const same = mine === theirs;
  return (
    <div className="grid grid-cols-[80px_1fr_1fr] gap-2 text-[11px] py-1 border-t border-border/50 first:border-t-0">
      <span className="text-muted-foreground pt-0.5">{label}</span>
      <span className={same ? "text-muted-foreground" : "text-destructive line-through"}>{mine || "—"}</span>
      <span className={same ? "text-muted-foreground" : "text-emerald-500"}>{theirs || "—"}</span>
    </div>
  );
}

function entryFieldVal(e: StyleMemoryEntry | undefined, f: string): string {
  if (!e) return "";
  switch (f) {
    case "title": return e.title;
    case "drakeScore": return e.drakeScore.toFixed(2);
    case "vibe": return e.vibe ?? "";
    case "genre": return e.genre ?? "";
    case "bars": return `${e.bars.length} bars`;
    default: return "";
  }
}

export function ImportMergeDialog({
  plan,
  onClose,
  onApplied,
}: {
  plan: ImportPlan | null;
  onClose: () => void;
  onApplied: (result: { added: number; updated: number; kept: number; total: number }) => void;
}) {
  const [strategy, setStrategy] = useState<Strategy>("smart");
  const [overrides, setOverrides] = useState<Record<string, ImportChoice>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const choices = useMemo<Record<string, ImportChoice>>(() => {
    if (!plan) return {};
    const out: Record<string, ImportChoice> = {};
    for (const item of plan.items) {
      if (overrides[item.key]) {
        out[item.key] = overrides[item.key];
        continue;
      }
      if (item.status === "new") {
        out[item.key] = strategy === "mine" ? "skip" : "theirs";
      } else if (item.status === "duplicate") {
        out[item.key] = "skip";
      } else {
        // conflict
        if (strategy === "theirs") out[item.key] = "theirs";
        else if (strategy === "mine") out[item.key] = "mine";
        else if (strategy === "both") out[item.key] = "both";
        else if (strategy === "smart") {
          out[item.key] = item.incoming.createdAt >= (item.existing?.createdAt ?? 0) ? "theirs" : "mine";
        } else out[item.key] = "skip";
      }
    }
    return out;
  }, [plan, strategy, overrides]);

  if (!plan) return null;

  const summary = { add: 0, update: 0, keep: 0, both: 0, skip: 0 };
  for (const item of plan.items) {
    const c = choices[item.key];
    if (c === "theirs") item.existing ? summary.update++ : summary.add++;
    else if (c === "both") summary.both++;
    else if (c === "mine") summary.keep++;
    else summary.skip++;
  }

  function apply() {
    const r = applyImportPlan(plan!, choices, false);
    onApplied(r);
  }

  function setOverride(key: string, choice: ImportChoice) {
    setOverrides((o) => ({ ...o, [key]: choice }));
  }

  return (
    <Dialog open={!!plan} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-primary" /> Review import
          </DialogTitle>
          <DialogDescription data-testid="import-summary">
            {plan.incomingTotal} incoming · {plan.existingTotal} existing ·
            <span className="ml-1"><b data-testid="count-new">{plan.counts.new}</b> new,</span>
            <span className="ml-1"><b data-testid="count-duplicate">{plan.counts.duplicate}</b> duplicates,</span>
            <span className="ml-1 text-amber-500"><b data-testid="count-conflict">{plan.counts.conflict}</b> conflicts</span>
            {plan.meta.exportedAt && <span className="block text-[11px] mt-0.5">Exported {new Date(plan.meta.exportedAt).toLocaleString()} · schema v{plan.meta.version ?? "?"}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["smart", "Smart (newer wins)"],
              ["theirs", "Prefer incoming"],
              ["mine", "Prefer mine"],
              ["both", "Keep both"],
              ["manual", "Manual"],
            ] as [Strategy, string][]).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={strategy === k ? "default" : "outline"}
                onClick={() => { setStrategy(k); setOverrides({}); }}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary"><Plus className="h-3 w-3 mr-1" />{summary.add} add</Badge>
            <Badge variant="secondary"><Check className="h-3 w-3 mr-1" />{summary.update} update</Badge>
            <Badge variant="outline"><Copy className="h-3 w-3 mr-1" />{summary.both} keep both</Badge>
            <Badge variant="outline">{summary.keep} keep mine</Badge>
            <Badge variant="outline">{summary.skip} skip</Badge>
          </div>

          <ScrollArea className="h-[380px] rounded-md border border-border">
            <div className="divide-y divide-border">
              {plan.items.map((item) => {
                const c = choices[item.key];
                const isOpen = expanded[item.key];
                const statusColor =
                  item.status === "new" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                  : item.status === "duplicate" ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/15 text-amber-500 border-amber-500/30";
                return (
                  <div key={item.key} className="p-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${statusColor}`}>
                        {item.status === "conflict" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {item.status === "duplicate" && <FileWarning className="h-3 w-3 mr-1" />}
                        {item.status === "new" && <Plus className="h-3 w-3 mr-1" />}
                        {item.status}
                      </Badge>
                      <span className="font-semibold truncate flex-1">{item.incoming.title}</span>
                      {item.incoming.vibe && <Badge variant="outline" className="text-[10px]">{item.incoming.vibe}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{item.incoming.drakeScore.toFixed(1)}</Badge>
                      {item.status !== "new" && (
                        <button
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => setExpanded((e) => ({ ...e, [item.key]: !e[item.key] }))}
                        >
                          {isOpen ? "hide diff" : "show changes"}
                        </button>
                      )}
                    </div>

                    {item.status === "conflict" && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.changedFields.map((f) => (
                          <Badge key={f} variant="outline" className="text-[10px]">{f} changed</Badge>
                        ))}
                      </div>
                    )}

                    {isOpen && item.existing && (
                      <div className="mt-2 rounded bg-muted/30 p-2" data-testid="diff-panel">
                        <div className="grid grid-cols-[80px_1fr_1fr] gap-2 text-[10px] uppercase text-muted-foreground pb-1">
                          <span>Field</span><span data-testid="diff-col-mine">Mine</span><span data-testid="diff-col-incoming">Incoming</span>
                        </div>
                        {["title", "drakeScore", "vibe", "genre", "bars"].map((f) => (
                          <FieldDiff
                            key={f}
                            label={f}
                            mine={entryFieldVal(item.existing, f)}
                            theirs={entryFieldVal(item.incoming, f)}
                          />
                        ))}
                        {item.changedFields.includes("bars") && (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                            <pre className="bg-background p-1.5 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                              {item.existing.bars.slice(0, 6).join("\n")}
                            </pre>
                            <pre className="bg-background p-1.5 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                              {item.incoming.bars.slice(0, 6).join("\n")}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1">
                      {(["theirs", "mine", "both", "skip"] as ImportChoice[]).map((opt) => {
                        if (opt === "mine" && !item.existing) return null;
                        if (opt === "both" && !item.existing) return null;
                        const label = opt === "theirs" ? (item.existing ? "Use incoming" : "Add")
                          : opt === "mine" ? "Keep mine"
                          : opt === "both" ? "Keep both"
                          : "Skip";
                        return (
                          <Button
                            key={opt}
                            size="sm"
                            variant={c === opt ? "default" : "outline"}
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setOverride(item.key, opt)}
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={apply}>
            Apply ({summary.add + summary.update + summary.both} change{summary.add + summary.update + summary.both === 1 ? "" : "s"})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

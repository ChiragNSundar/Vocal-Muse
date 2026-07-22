import { useState } from "react";
import { SHORTCUTS } from "@/hooks/use-shortcuts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Keyboard } from "lucide-react";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border border-border bg-muted text-[11px] font-mono font-medium text-muted-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function formatKeys(s: (typeof SHORTCUTS)[number]) {
  const parts: string[] = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.alt) parts.push("Alt");
  if (s.shift) parts.push("Shift");
  // Prettify the key name
  const keyLabel =
    s.key === "," ? "," :
    s.key === "/" ? "/" :
    s.key === "?" ? "?" :
    s.key.toUpperCase();
  parts.push(keyLabel);
  return parts;
}

const groups = ["Global", "Studio", "Live", "Editor"] as const;

export function KeyboardShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const grouped = groups
    .map((g) => ({
      name: g,
      items: SHORTCUTS.filter((s) => s.group === g),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Press <Kbd>?</Kbd> anywhere to toggle this overlay.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {grouped.map((g) => (
            <div key={g.name}>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                {g.name}
              </h3>
              <div className="space-y-1.5">
                {g.items.map((s) => {
                  const keys = formatKeys(s);
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm text-foreground">{s.label}</span>
                      <div className="flex items-center gap-1">
                        {keys.map((k, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            <Kbd>{k}</Kbd>
                            {i < keys.length - 1 && (
                              <span className="text-muted-foreground text-[10px]">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

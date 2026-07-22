import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getBarHistory, type BarVersion } from "@/lib/bar-history";
import { History, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BarTimelineProps {
  /** Unique bar ID (e.g. trackId:barIndex) */
  barId: string;
  /** Callback when user restores a version */
  onRestore?: (version: BarVersion) => void;
  /** CSS class */
  className?: string;
}

const SOURCE_LABELS: Record<BarVersion["source"], { label: string; color: string }> = {
  "original":     { label: "Original",   color: "text-muted-foreground" },
  "ai-rewrite":   { label: "AI Rewrite", color: "text-amber-400" },
  "manual-edit":  { label: "Manual",     color: "text-sky-400" },
  "ghost-accept": { label: "Ghost",      color: "text-violet-400" },
  "restored":     { label: "Restored",   color: "text-emerald-400" },
};

/**
 * Horizontal timeline showing all versions of a bar.
 * Click a dot to preview, click "Restore" to revert.
 */
export function BarTimeline({ barId, onRestore, className = "" }: BarTimelineProps) {
  const versions = useMemo(() => getBarHistory(barId), [barId]);
  const [selected, setSelected] = useState<number | null>(null);

  if (versions.length <= 1) return null; // No history to show

  const selectedVersion = selected !== null ? versions[selected] : null;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        <span>{versions.length} versions</span>
      </div>

      {/* Timeline dots */}
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={200}>
          {versions.map((v, i) => {
            const isActive = i === selected;
            const isLatest = i === versions.length - 1;
            const { color } = SOURCE_LABELS[v.source];

            return (
              <Tooltip key={v.version}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSelected(isActive ? null : i)}
                    className={`relative flex items-center justify-center transition-all ${
                      isActive
                        ? "w-5 h-5 rounded-full ring-2 ring-primary"
                        : "w-3 h-3 rounded-full hover:scale-125"
                    }`}
                  >
                    <div
                      className={`w-full h-full rounded-full ${
                        isActive
                          ? "bg-primary"
                          : isLatest
                            ? "bg-primary/70"
                            : "bg-muted-foreground/40"
                      }`}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <div>v{v.version} · {SOURCE_LABELS[v.source].label}</div>
                  <div className="text-muted-foreground">
                    {formatDistanceToNow(new Date(v.timestamp), { addSuffix: true })}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>

        {/* Connecting lines between dots */}
        <div className="flex-1" />
      </div>

      {/* Selected version preview */}
      {selectedVersion && (
        <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-[10px] ${SOURCE_LABELS[selectedVersion.source].color}`}>
                v{selectedVersion.version} · {SOURCE_LABELS[selectedVersion.source].label}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(selectedVersion.timestamp), { addSuffix: true })}
              </span>
            </div>
            {selected !== versions.length - 1 && onRestore && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                onClick={() => onRestore(selectedVersion)}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Restore
              </Button>
            )}
          </div>
          <div className="text-sm font-mono leading-relaxed">{selectedVersion.text}</div>
        </div>
      )}
    </div>
  );
}

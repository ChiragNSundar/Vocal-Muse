import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sparkles, Mic, Activity } from "lucide-react";
import { endRhymeKey, countSyllables, classifyScheme, rhymeScheme } from "@/lib/phonetics";

export type BarPocketItem = {
  index: number;
  text: string;
  syllables?: number;
  endSound?: string;
};

type PocketGridProps = {
  bars: BarPocketItem[];
  targetSyllables?: number;
  title?: string;
};

// Map end-rhyme rimes to consistent badge colors
const COLOR_PALETTE = [
  "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "bg-rose-500/15 text-rose-400 border-rose-500/30",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  "bg-orange-500/15 text-orange-400 border-orange-500/30",
];

export function PocketGrid({ bars, targetSyllables = 8, title = "Pocket & Flow Visualizer" }: PocketGridProps) {
  if (!bars.length) return null;

  const lines = bars.map((b) => b.text);
  const schemeStr = rhymeScheme(lines);
  const schemeType = classifyScheme(schemeStr);

  const rimeColorMap = new Map<string, string>();
  let paletteIdx = 0;

  const items = bars.map((b) => {
    const syl = b.syllables ?? countSyllables(b.text);
    const rime = b.endSound ?? endRhymeKey(b.text) ?? "free";

    if (!rimeColorMap.has(rime)) {
      rimeColorMap.set(rime, COLOR_PALETTE[paletteIdx % COLOR_PALETTE.length]);
      paletteIdx++;
    }

    const colorClass = rimeColorMap.get(rime)!;
    const diff = Math.abs(syl - targetSyllables);
    const inPocket = diff <= 1;

    return { ...b, syl, rime, colorClass, inPocket };
  });

  const inPocketCount = items.filter((i) => i.inPocket).length;
  const pocketMatchPct = Math.round((inPocketCount / items.length) * 100);

  return (
    <Card className="p-4 space-y-3 bg-card/60 backdrop-blur-sm border-border/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px] gap-1">
            <Sparkles className="h-3 w-3 text-amber-400" />
            Pocket: <span className="font-mono text-primary">{pocketMatchPct}%</span>
          </Badge>
          <Badge variant="secondary" className="text-[11px] font-mono">
            {schemeType} ({schemeStr.slice(0, 8)})
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {items.map((item) => (
          <div
            key={item.index}
            className="flex items-center justify-between p-2 rounded border bg-background/50 hover:bg-background/80 transition-colors text-xs font-mono"
          >
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <span className="text-muted-foreground/60 w-5 text-right flex-shrink-0">
                #{item.index + 1}
              </span>
              <span className="truncate text-foreground font-sans text-xs">{item.text}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  item.inPocket ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"
                }`}
                title={`Target: ${targetSyllables} syl`}
              >
                {item.syl} syl
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${item.colorClass}`}>
                -{item.rime}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

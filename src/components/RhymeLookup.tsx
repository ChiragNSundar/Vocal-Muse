// Compact rhyme popover — click, type a word, see perfect / near /
// sound-alike / semantic hits. Powered by Datamuse (free) or a custom
// local endpoint. Also deep-links to RhymeWave for phonetic exploration.

import { useState, useMemo } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Music2, ExternalLink, Loader2 } from "lucide-react";
import { lookupRhymes, rhymeWaveUrl, type RhymeHit } from "@/lib/rhymes";

export function RhymeLookup({ trigger, defaultWord = "" }: { trigger?: React.ReactNode; defaultWord?: string }) {
  const [word, setWord] = useState(defaultWord);
  const [hits, setHits] = useState<RhymeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(w: string) {
    const q = w.trim();
    if (!q) return;
    setLoading(true);
    setErr(null);
    try {
      const out = await lookupRhymes(q);
      setHits(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, RhymeHit[]> = { perfect: [], near: [], "sound-like": [], related: [] };
    for (const h of hits) (g[h.kind] ??= []).push(h);
    for (const k of Object.keys(g)) g[k].sort((a, b) => b.score - a.score);
    return g;
  }, [hits]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Music2 className="h-4 w-4 mr-1.5" /> Rhymes
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="p-3 border-b flex gap-2">
          <Input
            autoFocus
            placeholder="Type a word…"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(word); }}
          />
          <Button size="sm" onClick={() => run(word)} disabled={loading || !word.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Go"}
          </Button>
        </div>
        <div className="p-3 max-h-80 overflow-auto text-sm space-y-3">
          {err && <div className="text-destructive text-xs">{err}</div>}
          {!hits.length && !loading && !err && (
            <div className="text-xs text-muted-foreground">
              Enter a word to see perfect, near, and sound-alike rhymes. Datamuse-powered, cached locally.
            </div>
          )}
          {(["perfect", "near", "sound-like", "related"] as const).map((k) =>
            grouped[k]?.length ? (
              <div key={k}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{k}</div>
                <div className="flex flex-wrap gap-1">
                  {grouped[k].slice(0, 25).map((h) => (
                    <Badge key={`${k}-${h.word}`} variant="secondary" className="font-mono text-[11px]">
                      {h.word}
                      {h.syllables ? <span className="opacity-60 ml-1">·{h.syllables}</span> : null}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
        <div className="p-2 border-t bg-muted/30 flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">Datamuse · cached · offline-safe</span>
          <a
            href={rhymeWaveUrl(word || "flow")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
          >
            Open in RhymeWave <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

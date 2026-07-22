import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cacheStats, clearCache, formatBytes, type CacheNamespace, type CacheStats } from "@/lib/cache";

const LABELS: Record<CacheNamespace, { title: string; hint: string }> = {
  transcribe: { title: "Transcription", hint: "Local Whisper results, keyed by audio hash" },
  chat: { title: "LLM passes", hint: "Per-pass model calls (cadence, write, critic, refine)" },
  pipeline: { title: "Full pipeline", hint: "Top-level result for (transcript + brief + model)" },
  embeddings: { title: "Embeddings", hint: "Vector cache for style-memory recall (query + entry)" },
};

export function CachePanel() {
  const [stats, setStats] = useState<CacheStats[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStats(await cacheStats());
    } catch {
      setStats([]);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function clearOne(ns?: CacheNamespace) {
    if (!confirm(ns ? `Clear ${LABELS[ns].title} cache?` : "Clear all caches?")) return;
    setBusy(true);
    try {
      await clearCache(ns);
      await refresh();
      toast.success(ns ? `${LABELS[ns].title} cache cleared` : "All caches cleared");
    } finally {
      setBusy(false);
    }
  }

  const totalEntries = stats.reduce((s, x) => s + x.entries, 0);
  const totalBytes = stats.reduce((s, x) => s + x.bytes, 0);
  const totalHits = stats.reduce((s, x) => s + x.hits, 0);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Local cache</h2>
          <Badge variant="secondary" className="text-[11px]">
            {totalEntries} entries · {formatBytes(totalBytes)} · {totalHits} hits
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearOne()} disabled={busy || totalEntries === 0}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            Clear all
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Identical re-runs skip the model. Local Whisper transcripts hash on audio bytes, so a re-upload of the same recording is instant. LLM passes hash on (model + system + user + sampling), so tweaking only the style brief reuses cadence + critic.
      </p>

      <div className="grid gap-2">
        {stats.map((s) => {
          const label = LABELS[s.namespace];
          return (
            <div key={s.namespace} className="rounded-md border bg-muted/20 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{label.title}</div>
                <div className="text-xs text-muted-foreground">{label.hint}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {s.entries} entries · {formatBytes(s.bytes)} · {s.hits} hits
                  {s.newest ? ` · last ${new Date(s.newest).toLocaleString()}` : ""}
                </div>
              </div>
              <Button size="sm" variant="ghost" disabled={busy || s.entries === 0} onClick={() => clearOne(s.namespace)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

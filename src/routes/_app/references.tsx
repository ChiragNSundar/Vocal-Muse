import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  buildFingerprint,
  fingerprintToConstraints,
  loadFingerprints,
  upsertFingerprint,
  removeFingerprint,
  type Fingerprint,
} from "@/lib/fingerprint";
import {
  addToStyleMemory,
  loadStyleMemory,
  removeStyleMemoryEntry,
  clearStyleMemory,
  type StyleMemoryEntry,
} from "@/lib/style-memory";
import { searchWebLyrics, type WebLyricsResult } from "@/lib/lyrics-fetcher";
import { toast } from "sonner";
import { Trash2, Sparkles, FileText, Search, Globe, Check, Loader2, Music, Brain, Target, Zap } from "lucide-react";

export const Route = createFileRoute("/_app/references")({
  head: () => ({
    meta: [
      { title: "Reference & Style Intelligence — VoxScript" },
      { name: "description", content: "Fetch reference track lyrics from the web — extract cadence fingerprints and ingest into AI style memory." },
    ],
  }),
  component: ReferencesPage,
});

function ReferencesPage() {
  const [fingerprints, setFingerprints] = useState<Fingerprint[]>(() => loadFingerprints());
  const [styleMemory, setStyleMemory] = useState<StyleMemoryEntry[]>(() => loadStyleMemory());
  
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<WebLyricsResult[]>([]);
  
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [vibeTag, setVibeTag] = useState("");
  const [preview, setPreview] = useState<Fingerprint | null>(null);
  const [selectedResult, setSelectedResult] = useState<WebLyricsResult | null>(null);

  async function handleWebSearch() {
    if (!searchQuery.trim()) {
      toast.error("Enter a song title or artist name");
      return;
    }
    setSearching(true);
    setSearchResults([]);
    try {
      const results = await searchWebLyrics(searchQuery);
      if (!results.length) {
        toast.error("No lyrics found for that query. Try adding artist name.");
      } else {
        setSearchResults(results);
        toast.success(`Found ${results.length} result(s)`);
      }
    } catch {
      toast.error("Failed to fetch web lyrics");
    } finally {
      setSearching(false);
    }
  }

  function handleSelectResult(res: WebLyricsResult) {
    setSelectedResult(res);
    const fpName = `${res.artistName} - ${res.trackName}`;
    setName(fpName);
    setText(res.lyrics);
    const fp = buildFingerprint(fpName, res.lines);
    setPreview(fp);
  }

  function handleDirectIngestMemory(res: WebLyricsResult) {
    if (!res.lines.length) return;
    addToStyleMemory({
      title: `${res.artistName} — ${res.trackName}`,
      drakeScore: 8.5,
      vibe: vibeTag.trim() || undefined,
      bars: res.lines,
      source: "web-search",
    });
    setStyleMemory(loadStyleMemory());
    toast.success(`Ingested ${res.lines.length} bars from "${res.trackName}" into permanent style memory!`);
  }

  function handleIngestBoth(res: WebLyricsResult) {
    // 1. Fingerprint
    const fpName = `${res.artistName} - ${res.trackName}`;
    const fp = buildFingerprint(fpName, res.lines);
    upsertFingerprint(fp);
    setFingerprints(loadFingerprints());

    // 2. Style Memory
    addToStyleMemory({
      title: `${res.artistName} — ${res.trackName}`,
      drakeScore: 8.5,
      vibe: vibeTag.trim() || undefined,
      bars: res.lines,
      source: "web-search",
    });
    setStyleMemory(loadStyleMemory());
    toast.success(`Saved cadence fingerprint & ingested into style memory!`);
  }

  function analyzeManual() {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 4) {
      toast.error("Paste at least 4 lines of reference lyrics");
      return;
    }
    const fp = buildFingerprint(name.trim() || "Untitled reference", lines);
    setPreview(fp);
  }

  function saveFingerprintOnly() {
    if (!preview) return;
    upsertFingerprint(preview);
    setFingerprints(loadFingerprints());
    toast.success("Cadence fingerprint saved!");
    resetForm();
  }

  function saveToStyleMemoryOnly() {
    if (!text.trim()) return;
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    addToStyleMemory({
      title: name.trim() || "Manual reference",
      drakeScore: 8.5,
      vibe: vibeTag.trim() || undefined,
      bars: lines,
      source: "manual",
    });
    setStyleMemory(loadStyleMemory());
    toast.success("Added to permanent style memory!");
    resetForm();
  }

  function resetForm() {
    setPreview(null);
    setSelectedResult(null);
    setName("");
    setText("");
    setVibeTag("");
    setSearchResults([]);
    setSearchQuery("");
  }

  function deleteFp(id: string) {
    removeFingerprint(id);
    setFingerprints(loadFingerprints());
  }

  function deleteMemoryItem(id: string) {
    removeStyleMemoryEntry(id);
    setStyleMemory(loadStyleMemory());
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-bold">Reference & Style Intelligence</h1>
        <p className="text-muted-foreground mt-1">
          Search any track on the web or paste lyrics. Extract structural **Cadence Fingerprints** for single tracks or **Ingest into Style Memory** to train your AI ghostwriter permanently.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <Tabs defaultValue="web">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="web" className="gap-2">
              <Globe className="h-4 w-4 text-primary" /> Fetch from Web (Auto)
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="h-4 w-4" /> Manual Paste
            </TabsTrigger>
          </TabsList>

          {/* Web Search Tab */}
          <TabsContent value="web" className="space-y-4 pt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Type song title or artist (e.g. Kendrick Lamar - Euphoria, Drake - First Person Shooter)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleWebSearch()}
              />
              <Button onClick={handleWebSearch} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Fetch Lyrics
              </Button>
            </div>

            {searchResults.length > 0 && !preview && (
              <div className="space-y-2 pt-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Select a song to ingest</div>
                <div className="grid gap-2">
                  {searchResults.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-background/60 hover:bg-accent/40 transition-colors"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="font-semibold text-sm flex items-center gap-2">
                          <Music className="h-4 w-4 text-primary shrink-0" />
                          <span className="truncate">{r.trackName}</span>
                          <span className="text-muted-foreground font-normal">by {r.artistName}</span>
                        </div>
                        {r.albumName && <div className="text-xs text-muted-foreground truncate">{r.albumName}</div>}
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{r.lines.length} lines extracted</div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => handleSelectResult(r)}>
                          <Target className="h-3.5 w-3.5 mr-1 text-primary" />
                          Analyze Pocket
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleDirectIngestMemory(r)}>
                          <Brain className="h-3.5 w-3.5 mr-1 text-amber-400" />
                          Ingest Memory
                        </Button>
                        <Button size="sm" onClick={() => handleIngestBoth(r)}>
                          <Zap className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                          Both
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Manual Paste Tab */}
          <TabsContent value="manual" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder="Reference title (e.g. Drake - Take Care)" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="Vibe tag (e.g. trap, melodic, drill)" value={vibeTag} onChange={(e) => setVibeTag(e.target.value)} />
            </div>
            <Textarea
              placeholder="Paste 4+ bars of reference lyrics here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
            <div className="flex gap-2 justify-end">
              <Button onClick={analyzeManual} variant="outline">
                <Target className="h-4 w-4 mr-1.5" />
                Analyze Cadence
              </Button>
              <Button onClick={saveToStyleMemoryOnly} variant="secondary">
                <Brain className="h-4 w-4 mr-1.5" />
                Add to Style Memory
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Confirmation & Fingerprint Preview Card */}
        {preview && (
          <div className="rounded-lg border bg-primary/5 p-4 space-y-3 border-primary/30 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm font-display">Fingerprint Preview: {preview.name}</span>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                Target: {preview.avgSyllablesPerBar} syl/bar
              </Badge>
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed bg-background/80 p-3 rounded border border-border/50 max-h-48 overflow-y-auto">
{fingerprintToConstraints(preview)}
            </pre>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={saveFingerprintOnly}>
                <Target className="h-4 w-4 mr-1.5" /> Save Cadence Fingerprint
              </Button>
              {selectedResult && (
                <Button size="sm" variant="secondary" onClick={() => handleIngestBoth(selectedResult)}>
                  <Zap className="h-4 w-4 mr-1.5" /> Save Both (Fingerprint + Memory)
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Main Tabbed Knowledge & Fingerprint Bank */}
      <Tabs defaultValue="fingerprints" className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="fingerprints" className="gap-2">
              <Target className="h-4 w-4" /> Cadence Fingerprints ({fingerprints.length})
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-2">
              <Brain className="h-4 w-4" /> Permanent Style Memory ({styleMemory.length})
            </TabsTrigger>
          </TabsList>
          <Link to="/new" className="text-xs text-primary hover:underline font-medium">
            Use in new track →
          </Link>
        </div>

        {/* Tab 1: Saved Cadence Fingerprints */}
        <TabsContent value="fingerprints">
          {fingerprints.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground text-sm space-y-2">
              <Target className="h-8 w-8 mx-auto opacity-50 text-primary" />
              <div>No cadence fingerprints saved yet. Search any song above to extract its flow.</div>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {fingerprints.map((fp) => (
                <Card key={fp.id} className="p-4 space-y-2 flex flex-col justify-between border-border/70 hover:border-primary/50 transition-colors">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm truncate">{fp.name}</h3>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => deleteFp(fp.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {fp.avgSyllablesPerBar} syl/bar
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        vowels: {Object.keys(fp.vowelHistogram || {}).slice(0, 4).join(", ")}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground/80 font-mono truncate pt-2 border-t border-border/40">
                    {fp.barCount} bars analyzed
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Permanent Style Memory */}
        <TabsContent value="memory">
          {styleMemory.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground text-sm space-y-2">
              <Brain className="h-8 w-8 mx-auto opacity-50 text-amber-400" />
              <div>No style memory entries stored yet. Ingest songs above to teach your AI ghostwriter!</div>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {styleMemory.map((item) => (
                <Card key={item.id} className="p-4 space-y-2 flex flex-col justify-between border-border/70 hover:border-amber-500/40 transition-colors">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm truncate">{item.title}</h3>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => deleteMemoryItem(item.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {item.bars.length} bars
                      </Badge>
                      {item.vibe && (
                        <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                          vibe: {item.vibe}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {item.drakeScore.toFixed(1)}/10 tier
                      </Badge>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground/80 font-mono truncate pt-2 border-t border-border/40">
                    "{item.bars[0] || ""}"
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

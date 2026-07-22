import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  buildFingerprint,
  fingerprintToConstraints,
  loadFingerprints,
  upsertFingerprint,
  removeFingerprint,
  type Fingerprint,
} from "@/lib/fingerprint";
import { toast } from "sonner";
import { Trash2, Sparkles, FileText } from "lucide-react";

export const Route = createFileRoute("/_app/references")({
  head: () => ({
    meta: [
      { title: "Reference Fingerprints — VoxScript" },
      { name: "description", content: "Save reference style fingerprints — vowel palette, syllable target, slang — and steer the ghostwriter toward them." },
    ],
  }),
  component: ReferencesPage,
});

function ReferencesPage() {
  const [list, setList] = useState<Fingerprint[]>(() => loadFingerprints());
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Fingerprint | null>(null);

  function analyze() {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 4) {
      toast.error("Paste at least 4 lines of reference lyrics");
      return;
    }
    const fp = buildFingerprint(name.trim() || "Untitled reference", lines);
    setPreview(fp);
  }

  function save() {
    if (!preview) return;
    upsertFingerprint(preview);
    setList(loadFingerprints());
    setPreview(null);
    setName("");
    setText("");
    toast.success("Fingerprint saved");
  }

  function remove(id: string) {
    removeFingerprint(id);
    setList(loadFingerprints());
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Reference fingerprints</h1>
        <p className="text-muted-foreground mt-1">
          Drop in lyrics from a track whose pocket you love. We extract the syllable target,
          vowel palette, slang, and rhyme families — then steer every new generation toward it.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex gap-3">
          <Input placeholder="Name (e.g. Drake-night, Future-tight)" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={analyze} variant="secondary">
            <Sparkles className="h-4 w-4 mr-1.5" />
            Analyze
          </Button>
        </div>
        <Textarea
          placeholder="Paste 4+ bars of reference lyrics here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="font-mono text-sm"
        />
        {preview && (
          <div className="rounded-md border bg-muted/30 p-4 space-y-3">
            <div className="text-sm font-semibold">Preview</div>
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
{fingerprintToConstraints(preview)}
            </pre>
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>Save fingerprint</Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Discard</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Saved ({list.length})</h2>
          <Link to="/new"><Button variant="ghost" size="sm">Use in new track →</Button></Link>
        </div>
        {list.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            <FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />
            No fingerprints yet. Paste a reference above to start.
          </Card>
        )}
        <div className="grid gap-3">
          {list.map((fp) => (
            <Card key={fp.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold">{fp.name}</span>
                    <Badge variant="secondary">{fp.avgSyllablesPerBar} syl/bar</Badge>
                    <Badge variant="outline">{fp.barCount} bars analyzed</Badge>
                    {fp.internalRhymeDensity > 0.15 && <Badge>dense internal</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    Top families: {fp.endRhymeFamilies.slice(0, 4).join(" · ") || "—"}
                  </div>
                  {fp.slangBag.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Slang: {fp.slangBag.slice(0, 6).join(", ")}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(fp.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

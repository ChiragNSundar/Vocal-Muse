import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Cpu,
  Cloud,
  Brain,
  Trash2,
  Play,
  Square,
  Check,
  X,
  Loader2,
  GraduationCap,
  BarChart3,
  Globe,
  Download,
  Upload,
  History,
  Sparkles,
  Database,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { trainRound } from "@/lib/tracks.functions";
import { harvestFromUrl } from "@/lib/harvest.functions";
import { DEFAULT_LLM_CONFIG, loadLlmConfig, pingLocalLlm, saveLlmConfig, type LlmConfig } from "@/lib/llm-config";
import {
  addToStyleMemory,
  addHarvestedBars,
  analyzeImport,
  clearStyleMemory,
  clearTrainHistory,
  exportStyleMemory,
  loadStyleMemory,
  loadTrainHistory,
  recordTrainRun,
  removeStyleMemoryEntry,
  sampleStyleExamples,
  styleMemoryStats,
  type ImportPlan,
  type StyleMemoryEntry,
  type TrainRunRecord,
} from "@/lib/style-memory";
import { ImportMergeDialog } from "@/components/ImportMergeDialog";
import { CachePanel } from "@/components/CachePanel";

import { runLocalPipeline, harvestThresholdFor } from "@/lib/local-pipeline";
import { isLocalOnly, setLocalOnly, estimateStorage } from "@/lib/local-store";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · VoxScript" }] }),
  component: SettingsPage,
});

// Seed mumble transcripts used for synthetic self-play training rounds.
// Wide pool across vibes/topics/attitudes so style memory builds genuine variety.
const TRAINING_SEEDS: { vibe: string; topic?: string; transcript: string }[] = [
  // === TRAP ===
  { vibe: "trap", topic: "late-night city money", transcript: "uh, yeah, I'm in the city late night driving, palm trees blurring past the windshield, uh phone keep ringing won't pick up, money on my mind got the city talking yeah, like, like, just signed the deal got my mama crying, brothers calling me from blocks I left behind yeah, uh, the same ones doubted now they hitting up, told 'em watch me work, watch me lock the pocket up" },
  { vibe: "trap", topic: "paranoia at the top", transcript: "yeah, can't sleep in the penthouse, glass too thin, every shadow on the wall feel like an old friend, uh, count the bands twice then I count 'em again, can't tell who real when the bag get this big, mm, mama keep praying, daddy keep saying watch your six, brother keep texting need a favor from me quick, I just want a quiet night, ice in the glass, but the game don't give you quiet when the money pass" },
  { vibe: "trap", topic: "flex / wins", transcript: "AP wet like the rain on the windshield uh, chain so cold make the AC feel mild yeah, just dropped a hundred on the rookie I'm wild, mama in Bel Air now she finally smile, uh, brother on the jet, sister own a brand, every Sunday family dinner in the islands man, I remember ramen noodles in the dark, now my dog the size of a Tesla in the yard" },

  // === DRILL ===
  { vibe: "drill", topic: "block politics", transcript: "yeah, on the block where the lights stay low, opps on the other side they know, gripping on the steel when the wind blow, money over everything, gotta let 'em know, uh, can't trust the bro that smile too wide, can't trust the night when the streets too quiet, we riding through the city with the motion, gotta keep the family in protection" },
  { vibe: "drill", topic: "loyalty", transcript: "uh, day one bro he ain't ask for a thing, we was eating off one plate when the pot was thin, now the chain on his neck got him singing, every move we make get the city ringing, mm, ain't no industry friend in the trenches, just the bros that was there when the rent was menace, we made it out but the block still feel close, every dub still go through the same door" },
  { vibe: "drill", topic: "ambition", transcript: "yeah I want it all, the house, the cars, the foreign plates, can't waste another summer on a small wage, uh, watching my city burn for a small page, every winter I add up another raised stake, the bro them counting on me to come through, the moms them counting on me to come through, can't fold, can't slow, can't switch, every door I open I drag the family in" },

  // === BOOM-BAP / LYRICAL ===
  { vibe: "boom-bap", topic: "city walking", transcript: "yo, walking through Brooklyn with the headphones on, beats in my chest from the morning long, sun cracking through the project glass, kids on the corner that grew up too fast, uh, every block tell a different story, every face hold a piece of the glory, I write what I see, I see what I know, the city my pen and the streets my flow" },
  { vibe: "boom-bap", topic: "father absence", transcript: "mm, pops left a number I never dialed, raised by a woman that worked through every cold, uh, learned to fix a tire from a YouTube clip, learned to tie a tie in the bathroom mirror, every man I became I stitched together, every lesson came late but I caught the weather, I don't hate him no more, I just don't know him, that's the line I been writing my whole life poem" },
  { vibe: "boom-bap", topic: "writing as therapy", transcript: "uh, this pen the only therapist I trust, ink the only friend that don't switch up, every notebook a year I survived, every bar a moment I kept inside, mm, my mama think I'm fine 'cause the songs sound smooth, my girl think I'm fine 'cause I show up on cue, but the booth know the truth I been holding in, that's the man you don't meet at the noise, just the page" },

  // === MELODIC RAP ===
  { vibe: "melodic", topic: "lonely fame", transcript: "I been chasing the sound in my head, fading lights, hotel beds, the world keep moving I'm standing still, writing songs nobody hear yet, mm, my reflection don't know my face, every city feel like the same place, I tell my mom I'm okay but my hands shake, I tell my friends I'm okay but my heart break" },
  { vibe: "melodic", topic: "growing apart", transcript: "yeah, we don't talk like we used to, you on a different time, I'm on a different mood, the group chat went quiet around June, everybody chasing somebody new, mm, I miss the nights we ain't have nothing to do, parking lot music, gas station food, now we just liking each other's posts, that's the love you keep when the love get ghost" },
  { vibe: "melodic", topic: "moving home", transcript: "drove past my old high school yesterday, parking lot empty, sky kind of grey, mm, thought about the kid I was at sixteen, scared of everybody, dreaming everything, yeah, told him in my head it gets better slow, told him in my head he was right to go, every dream he had I been holding for him, every promise I made I been folding in" },

  // === R&B ===
  { vibe: "rnb", topic: "after the breakup", transcript: "I been thinking about you, can't sleep at all, the way you left, the way I called, mm, the perfume on the pillow still, your shadow at the door, mm yeah, I drive past your block at 4 am, headlights low, hoping you'd come down again, yeah, this love a slow burn, but I keep coming back, I keep coming back" },
  { vibe: "rnb", topic: "new flame", transcript: "first time I saw you the room got slow, candle light moving on your collarbone, mm, you laughed at a joke that wasn't even mine, I knew right there I was running out of time, yeah, you the kind of woman make a grown man text twice, make a grown man rewrite the same line right, I been careful with my heart for a long year, you the first reason I been careless this year" },
  { vibe: "rnb", topic: "infidelity confession", transcript: "I been lying to you 'bout the late nights, I been lying to me 'bout the late nights, mm, she don't mean nothing but she mean the wrong thing, you the home I keep leaving in my own ring, yeah, I don't deserve the way you still wait up, I don't deserve the breakfast on the same cup, but you stay 'cause you love me through the worst me, I gotta become the man you been deserving" },

  // === AFROBEATS / DANCEHALL CROSSOVER ===
  { vibe: "afrobeats", topic: "dancefloor love", transcript: "girl you move like the drum tell you what to do, hips talking language only I can pursue, mm, Lagos to London the night still ours, sweat on the skin and the moon on the cars, yeah, baby don't think, baby don't blink, baby just follow the bassline I bring, every step you take got the floor underneath, every smile you make got the crew on repeat" },
  { vibe: "afrobeats", topic: "long distance", transcript: "you in Accra, I'm in Toronto cold, the time zone fighting every story told, mm, FaceTime grainy but your laugh stay loud, you the only weather I miss in the crowd, yeah, six more weeks till I land on your side, six more weeks till the wait turn alive, every flight delay feel like a heart attack, baby hold on, I'm coming, I'm coming back" },

  // === POP / RADIO ===
  { vibe: "pop", topic: "summer crush", transcript: "yeah it's only June and I'm already gone, every song on the radio sound like our song, mm, you in the passenger laughing too hard, windows down on the highway too far, yeah, I don't know where we going but I don't care, sunburned shoulders and salt in your hair, this the kind of summer I tell my kids about, this the kind of love I been writing without" },
  { vibe: "pop", topic: "comeback / glow up", transcript: "they ain't think I was coming back this year, they ain't think I was sounding this clear, mm, took a whole winter to find my voice, took a whole heartbreak to make the choice, yeah, every door they closed I built a new wall, every name they called I rewrote it all, this the album I been holding for a long time, this the version of me that finally feel mine" },

  // === HOOKS / CHANTABLE ===
  { vibe: "trap", topic: "hook-style chant", transcript: "all my brothers eating now, all my brothers eating now, told 'em hold on, hold on, hold on, all my brothers eating now, uh, mama crying happy tears, mama crying happy tears, told her hold on, hold on, hold on, mama crying happy tears, yeah, we ain't never going back, we ain't never going back, told 'em watch me, watch me, watch me, we ain't never going back" },
  { vibe: "rnb", topic: "hook-style chant", transcript: "stay with me, stay with me, the morning don't gotta come yet, stay with me, stay with me, the world outside can wait, mm, hold me close, hold me close, the rest of my life can start tomorrow, hold me close, hold me close, tonight you all I know, oh, just stay" },
];


function SettingsPage() {
  const trainServer = useServerFn(trainRound);
  const harvestServer = useServerFn(harvestFromUrl);
  const [config, setConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);
  const [memory, setMemory] = useState<StyleMemoryEntry[]>([]);
  const [history, setHistory] = useState<TrainRunRecord[]>([]);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [training, setTraining] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [trainProgress, setTrainProgress] = useState({ current: 0, total: 0, lastScore: 0, lastMessage: "" });
  const [trainRounds, setTrainRounds] = useState(10);
  const [localOnly, setLocalOnly] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState<{ usedBytes: number; quotaBytes: number }>({ usedBytes: 0, quotaBytes: 0 });
  // Harvest state
  const [harvestUrl, setHarvestUrl] = useState("");
  const [harvestVibe, setHarvestVibe] = useState("");
  const [harvesting, setHarvesting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteVibe, setPasteVibe] = useState("");
  const [pasteText, setPasteText] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);

  useEffect(() => {
    setConfig(loadLlmConfig());
    setMemory(loadStyleMemory());
    setHistory(loadTrainHistory());
    setLocalOnly(isLocalOnly());
    // Auto-detect: if no Supabase env vars, default to local mode
    const hasSupabase = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (!hasSupabase && !isLocalOnly()) {
      setLocalOnly(true);
      setLocalOnly(true);
    }
    // Load storage estimate
    estimateStorage().then(setStorageEstimate);
  }, []);

  function update<K extends keyof LlmConfig>(key: K, value: LlmConfig[K]) {
    const next = { ...config, [key]: value };
    setConfig(next);
    saveLlmConfig(next);
  }

  function toggleLocalOnly(enabled: boolean) {
    setLocalOnly(enabled);
    setLocalOnly(enabled);
  }

  async function testConnection() {
    setPinging(true);
    setPingResult(null);
    const r = await pingLocalLlm(config);
    setPingResult(r);
    setPinging(false);
  }


  async function runTraining() {
    setTraining(true);
    setStopRequested(false);
    setTrainProgress({ current: 0, total: trainRounds, lastScore: 0, lastMessage: "Starting…" });
    const startedAt = Date.now();
    let harvested = 0;
    let totalScore = 0;
    let scoredRounds = 0;
    let topScore = 0;
    let completed = 0;

    const shuffled = [...TRAINING_SEEDS].sort(() => Math.random() - 0.5);
    for (let i = 0; i < trainRounds; i++) {
      if (stopRequested) break;
      const seed = shuffled[i % shuffled.length];
      setTrainProgress({
        current: i,
        total: trainRounds,
        lastScore: 0,
        lastMessage: `Round ${i + 1}/${trainRounds} (${seed.vibe})…`,
      });
      try {
        const examples = sampleStyleExamples(3, { vibe: seed.vibe });
        let result;
        if (config.mode === "local") {
          result = await runLocalPipeline(config, seed.transcript, undefined, (e) =>
            setTrainProgress((p) => ({ ...p, lastMessage: `Round ${i + 1}/${trainRounds}: ${e.message}` })),
          );
        } else {
          const r = await trainServer({
            data: { transcript: seed.transcript, styleBrief: undefined, styleExamples: examples },
          });
          result = r;
        }
        const score = (result.quality as { drakeScore?: number }).drakeScore ?? 0;
        totalScore += score;
        scoredRounds += 1;
        if (score > topScore) topScore = score;
        completed += 1;
        const bars = result.lyrics.sections.flatMap((s) => s.lines);
        const minThreshold = config.mode === "local" ? harvestThresholdFor(config) : 8.0;
        if (score >= minThreshold) {
          addToStyleMemory({
            title: result.lyrics.title,
            drakeScore: score,
            vibe: seed.vibe,
            bars,
            source: "self-play",
          });
          harvested += 1;
          setMemory(loadStyleMemory());
        }
        setTrainProgress({
          current: i + 1,
          total: trainRounds,
          lastScore: score,
          lastMessage: `Round ${i + 1}: ${score.toFixed(1)}/10 ${score >= minThreshold ? "✓ saved" : `(below ${minThreshold.toFixed(1)} threshold)`}`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTrainProgress((p) => ({ ...p, current: i + 1, lastMessage: `Round ${i + 1} failed: ${msg}` }));
      }
    }

    setTraining(false);
    const avg = scoredRounds ? totalScore / scoredRounds : 0;
    recordTrainRun({
      startedAt,
      endedAt: Date.now(),
      mode: config.mode,
      rounds: trainRounds,
      completed,
      harvested,
      avgScore: avg,
      topScore,
    });
    setHistory(loadTrainHistory());
    toast.success(
      `Training done. Harvested ${harvested} new examples · avg score ${avg.toFixed(1)}/10`,
    );
  }

  function deleteMemory(id: string) {
    removeStyleMemoryEntry(id);
    setMemory(loadStyleMemory());
  }

  function clearAll() {
    if (!confirm("Clear all style memory? This cannot be undone.")) return;
    clearStyleMemory();
    setMemory([]);
    toast.success("Style memory cleared");
  }

  async function runHarvest() {
    if (!harvestUrl.trim()) return;
    setHarvesting(true);
    try {
      let r;
      try {
        r = await harvestServer({ data: { url: harvestUrl.trim() } });
      } catch (err) {
        // Client-side fallback if server function fails or hits CORS/User-Agent restrictions
        const proxyRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(harvestUrl.trim())}`);
        if (!proxyRes.ok) throw err;
        const proxyJson = await proxyRes.json();
        const html = proxyJson.contents;
        if (!html) throw err;
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim().slice(0, 120) || new URL(harvestUrl.trim()).hostname;
        const cleanText = html.replace(/<(script|style|nav|header|footer|aside|noscript)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&");
        const lines = cleanText.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length >= 6 && l.length <= 220 && !/^\[.*\]$/.test(l));
        if (lines.length < 4) throw err;
        r = { title, sourceUrl: harvestUrl.trim(), bars: lines.slice(0, 200), totalFound: lines.length };
      }
      const added = addHarvestedBars({
        title: r.title,
        bars: r.bars,
        vibe: harvestVibe.trim() || undefined,
        source: "web",
        sourceUrl: r.sourceUrl,
      });
      setMemory(loadStyleMemory());
      toast.success(`Harvested ${added} bars from "${r.title}"`);
      setHarvestUrl("");
    } catch (e) {
      toast.error((e as Error).message || "Harvest failed");
    } finally {
      setHarvesting(false);
    }
  }

  function ingestPaste() {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast.error("Paste at least a couple of lines");
      return;
    }
    const added = addHarvestedBars({
      title: pasteTitle.trim() || "Pasted reference",
      bars: lines,
      vibe: pasteVibe.trim() || undefined,
      source: "paste",
    });
    setMemory(loadStyleMemory());
    toast.success(`Added ${added} bars to memory`);
    setPasteText("");
    setPasteTitle("");
  }

  function doExport() {
    const json = exportStyleMemory();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voxscript-memory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Memory exported");
  }

  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const plan = analyzeImport(String(reader.result || ""));
        setImportPlan(plan);
      } catch (e) {
        toast.error((e as Error).message);
      }
    };
    reader.readAsText(file);
  }

  function clearHistoryAll() {
    if (!confirm("Clear training history?")) return;
    clearTrainHistory();
    setHistory([]);
  }

  const stats = styleMemoryStats();
  const maxBucket = Math.max(1, ...stats.scoreBuckets.map((b) => b.count));
  const maxVibe = Math.max(1, ...stats.vibeBreakdown.map((v) => v.count));



  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your AI backend and grow your ghostwriter's style memory.
        </p>
      </div>

      {/* LLM Backend */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Local AI Backend</h2>
        </div>

        <div className="space-y-4 pt-2">
          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">Setup (one time):</p>
            <p>1. Install <a href="https://ollama.com" target="_blank" rel="noreferrer" className="text-primary underline">Ollama</a> or LM Studio.</p>
            <p>2. Pull a capable model: <code className="bg-background px-1 rounded">ollama pull llama3.1:8b</code> (or qwen2.5:14b, mistral-small)</p>
            <p>3. Allow this site to call your LLM:<br/><code className="bg-background px-1 rounded">OLLAMA_ORIGINS=&apos;*&apos; ollama serve</code></p>
            <p>4. Test the connection below.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">Endpoint URL</Label>
            <Input
              id="url"
              value={config.localBaseUrl}
              onChange={(e) => update("localBaseUrl", e.target.value)}
              placeholder="http://localhost:1234/v1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="model">Model name</Label>
              <Input
                id="model"
                value={config.localModel}
                onChange={(e) => update("localModel", e.target.value)}
                placeholder="local-model"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key">API key (if required)</Label>
              <Input
                id="key"
                value={config.localApiKey}
                onChange={(e) => update("localApiKey", e.target.value)}
                placeholder="lm-studio"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={testConnection} disabled={pinging} variant="outline">
              {pinging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Test connection
            </Button>
            {pingResult && (
              <div className={`text-xs flex items-center gap-1 ${pingResult.ok ? "text-emerald-500" : "text-destructive"}`}>
                {pingResult.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                <span className="truncate max-w-md">{pingResult.message}</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Local Persistence */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Local Storage (IndexedDB & OPFS)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Store tracks, audio takes, and style memory entirely in your browser. No cloud required.
          Works offline and survives browser restarts.
        </p>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Local storage mode</p>
            <p className="text-xs text-muted-foreground">
              Enabled — all data stored locally in IndexedDB & OPFS
            </p>
          </div>
          <Switch
            checked={localOnly}
            onCheckedChange={toggleLocalOnly}
            disabled={false}
          />
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Storage used: {(storageEstimate.usedBytes / 1024 / 1024).toFixed(1)} MB / {(storageEstimate.quotaBytes / 1024 / 1024).toFixed(0)} MB</p>
        </div>
      </Card>

      <CachePanel />

      {/* Training Dashboard */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Training Dashboard</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={doExport} disabled={!stats.count}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Import
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                onImportFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">Examples</div>
            <div className="font-display text-2xl font-semibold">{stats.count}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">Total bars</div>
            <div className="font-display text-2xl font-semibold">{stats.totalBars}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">Avg score</div>
            <div className="font-display text-2xl font-semibold">{stats.avgScore.toFixed(1)}<span className="text-sm text-muted-foreground">/10</span></div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">Top score</div>
            <div className="font-display text-2xl font-semibold">{stats.topScore.toFixed(1)}<span className="text-sm text-muted-foreground">/10</span></div>
          </div>
        </div>

        {stats.count > 0 && (
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <h3 className="font-display text-sm font-semibold mb-2">Score distribution</h3>
              <div className="space-y-1.5">
                {stats.scoreBuckets.map((b) => (
                  <div key={b.bucket} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-muted-foreground">{b.bucket}</span>
                    <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${(b.count / maxBucket) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-display text-sm font-semibold mb-2">By vibe</h3>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {stats.vibeBreakdown.map((v) => (
                  <div key={v.vibe} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted-foreground truncate">{v.vibe}</span>
                    <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${(v.count / maxVibe) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums">{v.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {stats.count > 0 && stats.sourceBreakdown.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stats.sourceBreakdown.map((s) => (
              <Badge key={s.source} variant="outline" className="text-xs">
                {s.source}: {s.count}
              </Badge>
            ))}
          </div>
        )}

        {/* Training history */}
        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4" /> Recent training runs
            </h3>
            {history.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearHistoryAll}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No runs yet. Hit Train below to start a session.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {history.slice(0, 20).map((h) => {
                const mins = Math.max(1, Math.round((h.endedAt - h.startedAt) / 60000));
                return (
                  <div key={h.id} className="flex items-center gap-3 text-xs p-2 rounded border border-border">
                    <Badge variant={h.mode === "local" ? "outline" : "secondary"} className="text-[10px]">
                      {h.mode}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(h.startedAt).toLocaleString()}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {h.completed}/{h.rounds} rounds · {h.harvested} saved · avg {h.avgScore.toFixed(1)} · top {h.topScore.toFixed(1)} · {mins}m
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Learn from the Web */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Learn from the Web</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Point at a page with lyrics or flows you want the ghostwriter to absorb — your own published
          lyrics, public domain works, Creative Commons sources, or text you have rights to use. We fetch
          the page, extract lyric-like lines, and add them to memory as Drake-tier reference (8.5/10).
        </p>
        <p className="text-[11px] text-muted-foreground">
          ⚠ Respect copyright. Only ingest sources you have rights to. We don't crawl at scale.
        </p>

        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[260px] space-y-2">
            <Label htmlFor="harvest-url">Source URL</Label>
            <Input
              id="harvest-url"
              value={harvestUrl}
              onChange={(e) => setHarvestUrl(e.target.value)}
              placeholder="https://example.com/my-lyrics-page"
              disabled={harvesting}
            />
          </div>
          <div className="w-40 space-y-2">
            <Label htmlFor="harvest-vibe">Vibe tag (optional)</Label>
            <Input
              id="harvest-vibe"
              value={harvestVibe}
              onChange={(e) => setHarvestVibe(e.target.value)}
              placeholder="trap, rnb…"
              disabled={harvesting}
            />
          </div>
          <Button onClick={runHarvest} disabled={harvesting || !harvestUrl.trim()}>
            {harvesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Harvest
          </Button>
        </div>

        <div className="pt-3 border-t border-border space-y-2">
          <Label className="font-display">Or paste lyrics directly</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Reference title (e.g. 'Drake — Take Care')"
            />
            <Input
              value={pasteVibe}
              onChange={(e) => setPasteVibe(e.target.value)}
              placeholder="Vibe tag (optional)"
            />
          </div>
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder="Paste lyrics, one bar per line…"
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={ingestPaste} disabled={!pasteText.trim()}>
              <Sparkles className="h-4 w-4 mr-2" />
              Add to memory
            </Button>
          </div>
        </div>
      </Card>

      {/* Style Memory + Train */}
      <Card className="p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Self-Training</h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{stats.count} examples</Badge>
            {stats.count > 0 && (
              <Badge variant="outline">avg {stats.avgScore.toFixed(1)}/10</Badge>
            )}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          The ghostwriter learns from its own best work. Every track that scores 8.0+ gets saved here
          and is injected as a few-shot example into future generations. Click <strong>Train</strong> to
          run synthetic rounds and grow the library on autopilot.
        </p>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-2 flex-1 max-w-[160px]">
            <Label htmlFor="rounds">Rounds</Label>
            <Input
              id="rounds"
              type="number"
              min={1}
              max={500}
              value={trainRounds}
              onChange={(e) => setTrainRounds(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              disabled={training}
            />
          </div>
          {training ? (
            <Button variant="destructive" onClick={() => setStopRequested(true)}>
              <Square className="h-4 w-4 mr-2 fill-current" />
              Stop after current round
            </Button>
          ) : (
            <>
              <Button onClick={runTraining}>
                <Play className="h-4 w-4 mr-2" />
                Train ({config.mode === "local" ? "Local LLM" : "Cloud"})
              </Button>
              <Button variant="secondary" onClick={() => { setTrainRounds(25); setTimeout(runTraining, 0); }}>
                Quick · 25
              </Button>
              <Button variant="secondary" onClick={() => { setTrainRounds(100); setTimeout(runTraining, 0); }}>
                Heavy · 100
              </Button>
              <Button variant="secondary" onClick={() => { setTrainRounds(250); setTimeout(runTraining, 0); }}>
                Marathon · 250
              </Button>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Heavy/Marathon runs across {TRAINING_SEEDS.length} shuffled seeds (trap, drill, R&B, melodic, boom-bap, afrobeats, pop, hooks). Only bars scoring ≥8.0/10 are harvested into memory. Cloud mode burns credits per round — Local LLM mode is free.
        </p>

        {training && (
          <div className="space-y-2">
            <Progress value={(trainProgress.current / Math.max(1, trainProgress.total)) * 100} />
            <p className="text-xs text-muted-foreground">{trainProgress.lastMessage}</p>
          </div>
        )}

        {memory.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Memory library</h3>
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear all
              </Button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {memory.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 p-3 rounded-md border border-border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold text-sm truncate">{e.title}</span>
                      <Badge variant="secondary" className="text-xs">{e.drakeScore.toFixed(1)}/10</Badge>
                      {e.vibe && <Badge variant="outline" className="text-xs">{e.vibe}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {e.bars.slice(0, 2).join(" / ")}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteMemory(e.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <ImportMergeDialog
        plan={importPlan}
        onClose={() => setImportPlan(null)}
        onApplied={(r) => {
          setImportPlan(null);
          setMemory(loadStyleMemory());
          toast.success(`+${r.added} added · ${r.updated} updated · ${r.kept} kept · ${r.total} total`);
        }}
      />
    </div>
  );
}

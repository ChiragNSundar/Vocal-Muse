// Live Punch-In Mode — the studio screen.
//
// Hit record → metronome ticks → each bar window streams to STT and the
// ghostwriter, finished line drops into the bar stream as you keep flowing.
// On commit, the full mixdown + bars persist as a regular track.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Mic, Square, Save, Loader2, Music, Volume2, Sparkles, Activity } from "lucide-react";
import { toast } from "sonner";
import { LiveCapture } from "@/lib/live-capture";
import { encodeWav, blobToBase64 } from "@/lib/wav";
import { transcribeBar, generateLiveBar, commitLiveTake } from "@/lib/live.functions";
import { getDeviceId } from "@/lib/device-id";
import { DEFAULT_BRIEF, type StyleBrief } from "@/lib/lyrics-analysis";
import { loadBurnedPhrases, loadBurnedVowels } from "@/lib/style-memory";
import {
  loadCalibratedLatencyMs, saveCalibratedLatencyMs, clearCalibratedLatencyMs,
  calibrateWithRetry, MIN_CONFIDENCE,
} from "@/lib/latency-calibration";
import { RhymeLookup } from "@/components/RhymeLookup";
import { isLocalOnly, putTrack, putBars, putBlob, getDeviceId as getLocalDeviceId, loadLlmConfig } from "@/lib/local-store";
import { transcribeLocal } from "@/lib/local-transcribe";
import { runLocalPipeline, type LocalPipelineResult } from "@/lib/local-pipeline";


export const Route = createFileRoute("/_app/live")({
  head: () => ({ meta: [{ title: "Live punch-in · VoxScript" }] }),
  component: LivePage,
});

type BarRow = {
  index: number;
  status: "recording" | "transcribing" | "writing" | "done" | "skipped";
  transcript?: string;
  line?: string;
  syllables?: number;
  endSound?: string;
};

const BRIEF_KEY = "voxscript:style-brief";

function LivePage() {
  const navigate = useNavigate();
  const transcribeFn = useServerFn(transcribeBar);
  const generateFn = useServerFn(generateLiveBar);
  const commitFn = useServerFn(commitLiveTake);

  const [bpm, setBpm] = useState(92);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [click, setClick] = useState(true);
  const [running, setRunning] = useState(false);
  const [bars, setBars] = useState<BarRow[]>([]);
  const [level, setLevel] = useState(0);
  const [beat, setBeat] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [brief, setBrief] = useState<StyleBrief>(DEFAULT_BRIEF);
  const [latencyMs, setLatencyMs] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  const [calibProgress, setCalibProgress] = useState<{ done: number; total: number; attempt: number; totalAttempts: number } | null>(null);
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    setLocalMode(isLocalOnly());
  }, []);

  const captureRef = useRef<LiveCapture | null>(null);
  const mixChunksRef = useRef<Float32Array[]>([]);
  const mixSampleRateRef = useRef(16000);
  const inflightRef = useRef(0);
  const barsRef = useRef<BarRow[]>([]);
  barsRef.current = bars;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(BRIEF_KEY);
      if (saved) setBrief({ ...DEFAULT_BRIEF, ...JSON.parse(saved) });
    } catch { /* ignore */ }
    setLatencyMs(loadCalibratedLatencyMs());
  }, []);

  async function runCalibration() {
    if (running) { toast.error("Stop recording before calibrating."); return; }
    setCalibrating(true);
    setCalibProgress({ done: 0, total: 6, attempt: 1, totalAttempts: 3 });
    try {
      toast.info("Calibrating — keep the room quiet and turn up your speakers.");
      const { result, attempts, acceptable } = await calibrateWithRetry({
        maxAttempts: 3,
        onAttempt: (attempt, totalAttempts) =>
          setCalibProgress((p) => ({ done: 0, total: p?.total ?? 6, attempt, totalAttempts })),
        onProgress: (done, total) =>
          setCalibProgress((p) => ({
            done, total,
            attempt: p?.attempt ?? 1,
            totalAttempts: p?.totalAttempts ?? 3,
          })),
      });
      saveCalibratedLatencyMs(result.latencyMs);
      setLatencyMs(result.latencyMs);
      setConfidence(result.confidence);
      const conf = Math.round(result.confidence * 100);
      const detail = `${result.latencyMs}ms · ±${result.jitterMs}ms · ${result.detectedClicks}/${result.expectedClicks} clicks · ${conf}% conf${attempts > 1 ? ` (after ${attempts} tries)` : ""}`;
      if (acceptable) toast.success(`Calibrated — ${detail}`);
      else toast.warning(`Low confidence calibration — ${detail}. Stored anyway; recalibrate in a quieter room for better results.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Calibration failed");
    } finally {
      setCalibrating(false);
      setCalibProgress(null);
    }
  }

  function resetCalibration() {
    clearCalibratedLatencyMs();
    setLatencyMs(0);
    toast.success("Latency calibration cleared.");
  }

  const barDurationMs = useMemo(() => Math.round((beatsPerBar * 60_000) / bpm), [beatsPerBar, bpm]);

  function updateBar(index: number, patch: Partial<BarRow>) {
    setBars((prev) => prev.map((b) => (b.index === index ? { ...b, ...patch } : b)));
  }

  async function processBar(index: number, blob: Blob, rmsLevel: number) {
    if (rmsLevel < 0.005 || blob.size < 2048) {
      updateBar(index, { status: "skipped" });
      return;
    }
    // Bound concurrency: max 3 in flight
    while (inflightRef.current >= 3) await new Promise((r) => setTimeout(r, 50));
    inflightRef.current++;
    try {
      updateBar(index, { status: "transcribing" });
      
      let text: string;
      if (localMode) {
        // Local transcription
        const config = loadLlmConfig();
        text = await transcribeLocal(blob, `bar-${index}.wav`, {
          baseUrl: config.whisperBaseUrl,
          backend: config.whisperBackend,
          model: config.whisperModel,
          language: config.whisperLanguage || undefined,
        });
      } else {
        const base64 = await blobToBase64(blob);
        const { text: cloudText } = await transcribeFn({
          data: { deviceId: getDeviceId(), base64, mime: "audio/wav", filename: `bar-${index}.wav` },
        });
        text = cloudText;
      }
      
      if (!text.trim()) { updateBar(index, { status: "skipped" }); return; }
      updateBar(index, { status: "writing", transcript: text });

      let line: string, syllables: number, endSound: string;
      if (localMode) {
        // Local generation using local pipeline
        const config = loadLlmConfig();
        // Build a simple brief for single bar generation
        const result = await runLocalPipeline(config, text, brief);
        const lines = result.lyrics.sections.flatMap((s) => s.lines);
        line = lines[0] || text;
        syllables = result.cadence.bars[0]?.syllables || 6;
        endSound = result.cadence.bars[0]?.endSound || "ah";
      } else {
        const neighbors = barsRef.current
          .filter((b) => b.index < index && b.line)
          .slice(-2)
          .map((b) => b.line!);
        const { line: cloudLine, syllables: cloudSyllables, endSound: cloudEndSound } = await generateFn({
          data: {
            deviceId: getDeviceId(),
            mumble: text,
            brief,
            neighborsBefore: neighbors,
            burnedPhrases: loadBurnedPhrases().slice(0, 30),
            burnedVowels: loadBurnedVowels().slice(0, 20),
          },
        });
        line = cloudLine;
        syllables = cloudSyllables;
        endSound = cloudEndSound;
      }
      updateBar(index, { status: "done", line, syllables, endSound });
    } catch (e) {
      console.warn("bar pipeline failed", e);
      updateBar(index, { status: "skipped" });
    } finally {
      inflightRef.current--;
    }
  }

  async function start() {
    if (captureRef.current) return;
    mixChunksRef.current = [];
    setBars([]);
    setBeat(0);
    const cap = new LiveCapture({
      bpm, beatsPerBar, click, inputLatencyMs: latencyMs,
      onBar: ({ index, blob, pcm, sampleRate, rmsLevel }) => {
        mixSampleRateRef.current = sampleRate;
        mixChunksRef.current.push(pcm);
        setBars((prev) => [...prev, { index, status: "recording" }]);
        // fire & forget; bounded concurrency inside
        void processBar(index, blob, rmsLevel);
      },
      onLevel: (l) => setLevel(l),
      onBeat: (b) => setBeat(b),
    });
    try {
      await cap.start();
      captureRef.current = cap;
      setRunning(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Microphone access denied");
    }
  }

  async function stop() {
    const cap = captureRef.current;
    if (!cap) return;
    await cap.stop();
    captureRef.current = null;
    setRunning(false);
  }

  async function commit() {
    if (running) await stop();
    const finalized = barsRef.current.filter((b) => b.status === "done" && b.line);
    if (!finalized.length) { toast.error("No finished bars to commit yet."); return; }

    setCommitting(true);
    try {
      // Wait for any still-inflight bars (max ~8s) so the take is complete.
      const deadline = Date.now() + 8000;
      while (
        Date.now() < deadline &&
        (inflightRef.current > 0 || barsRef.current.some((b) => b.status === "transcribing" || b.status === "writing"))
      ) {
        await new Promise((r) => setTimeout(r, 150));
      }

      const allDone = barsRef.current.filter((b) => b.status === "done" && b.line);
      const mix = encodeWav(mixChunksRef.current, mixSampleRateRef.current);
      
      if (localMode) {
        // Save to local store
        const trackId = crypto.randomUUID();
        const now = Date.now();
        const deviceId = getLocalDeviceId();
        const audioKey = await putBlob(`${trackId}/live-mix.wav`, mix);
        
        const bars = allDone.map((b, i) => ({
          id: `${trackId}:${i}`,
          trackId,
          index: i,
          transcript: b.transcript || "",
          line: b.line!,
          syllables: b.syllables ?? 6,
          endSound: b.endSound ?? "ah",
          audioKey: undefined,
          createdAt: now,
        }));
        
        // Run a full local pipeline to generate cadence and quality
        const config = loadLlmConfig();
        const transcript = allDone.map(b => b.transcript).join(" ");
        const result = await runLocalPipeline(config, transcript, brief);
        
        await putTrack({
          id: trackId,
          deviceId,
          title: "Live take",
          status: "done",
          bpm,
          beatsPerBar,
          createdAt: now,
          updatedAt: now,
          transcript,
          briefJson: JSON.stringify(brief),
          audioKey,
          lyrics: JSON.stringify(result.lyrics),
          cadenceMap: JSON.stringify(result.cadence),
          quality: JSON.stringify(result.quality),
          styleBrief: JSON.stringify(brief),
        });
        await putBars(bars);
        navigate({ to: "/track/$id", params: { id: trackId } });
      } else {
        const base64 = await blobToBase64(mix);
        const res = await commitFn({
          data: {
            deviceId: getDeviceId(),
            bpm,
            bars: allDone.map((b, i) => ({
              index: i,
              transcript: b.transcript || "",
              line: b.line!,
              syllables: b.syllables ?? 6,
              endSound: b.endSound ?? "ah",
            })),
            brief,
            base64,
            mime: "audio/wav",
            filename: "live-take.wav",
            title: "Live take",
          },
        });
        navigate({ to: "/track/$id", params: { id: res.id } });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  const finishedCount = bars.filter((b) => b.status === "done").length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
            <Music className="h-6 w-6 text-primary" /> Live punch-in
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mumble the flow on the click. Bars get written as you go. Commit when the take feels right.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={running ? "destructive" : "secondary"}>
            {running ? "● REC" : "idle"}
          </Badge>
          {finishedCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Sparkles className="h-3 w-3" /> {finishedCount} bar{finishedCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </div>

      <Card className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">BPM · {bpm}</Label>
            <Slider
              min={50} max={180} step={1}
              value={[bpm]}
              onValueChange={(v) => setBpm(v[0])}
              disabled={running}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Beats / bar</Label>
            <Select
              value={String(beatsPerBar)}
              onValueChange={(v) => setBeatsPerBar(parseInt(v, 10))}
              disabled={running}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 6, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Click track</Label>
            <div className="flex items-center gap-3 h-10">
              <Switch checked={click} onCheckedChange={setClick} disabled={running} />
              <span className="text-sm text-muted-foreground">
                Bar = {(barDurationMs / 1000).toFixed(2)}s
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Beat dots */}
          <div className="flex gap-1">
            {Array.from({ length: beatsPerBar }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-full transition-all ${
                  running && beat % beatsPerBar === i
                    ? "bg-primary scale-125"
                    : "bg-border"
                }`}
              />
            ))}
          </div>
          {/* VU */}
          <div className="flex-1 h-2 bg-border/40 rounded overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-75"
              style={{ width: `${Math.min(100, level * 280)}%` }}
            />
          </div>
          <Volume2 className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <Activity className="h-4 w-4 text-primary" />
          <div className="text-sm">
            <span className="font-medium">Mic latency</span>{" "}
            <span className="text-muted-foreground">
              {latencyMs > 0
                ? `${latencyMs}ms compensated${confidence > 0 ? ` · ${Math.round(confidence * 100)}% confidence` : ""}`
                : "not calibrated — bars may drift"}
            </span>
            {confidence > 0 && confidence < MIN_CONFIDENCE && (
              <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-600">
                low confidence
              </Badge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {calibrating && calibProgress && (
              <span className="text-xs text-muted-foreground tabular-nums">
                try {calibProgress.attempt}/{calibProgress.totalAttempts} · {calibProgress.done}/{calibProgress.total} clicks
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={runCalibration}
              disabled={calibrating || running}
            >
              {calibrating
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Calibrating…</>
                : latencyMs > 0 ? "Recalibrate" : "Calibrate"}
            </Button>
            {latencyMs > 0 && !calibrating && (
              <Button size="sm" variant="ghost" onClick={resetCalibration} disabled={running}>
                Reset
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!running ? (
            <Button size="lg" onClick={start} disabled={committing}>
              <Mic className="h-4 w-4 mr-2" /> Start recording
            </Button>
          ) : (
            <Button size="lg" variant="destructive" onClick={stop}>
              <Square className="h-4 w-4 mr-2 fill-current" /> Stop
            </Button>
          )}
          <Button
            size="lg"
            variant="secondary"
            onClick={commit}
            disabled={committing || (!finishedCount && !running)}
          >
            {committing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Committing…</>
              : <><Save className="h-4 w-4 mr-2" /> Commit take</>}
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            Bars stream in ~{(barDurationMs / 1000).toFixed(1)}s after they're sung.
          </span>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b text-xs uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Bar stream</span>
          <div className="flex items-center gap-2">
            <span>{bars.length} captured · {finishedCount} written</span>
            <RhymeLookup />
          </div>
        </div>

        {bars.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Hit start. The click counts you in, then every bar you mumble lands here.
          </div>
        ) : (
          <ol className="divide-y">
            {bars.map((b) => <BarLine key={b.index} bar={b} />)}
          </ol>
        )}
      </Card>
    </div>
  );
}

function BarLine({ bar }: { bar: BarRow }) {
  const dot =
    bar.status === "done" ? "bg-emerald-500"
    : bar.status === "skipped" ? "bg-muted-foreground/40"
    : bar.status === "writing" ? "bg-amber-400 animate-pulse"
    : bar.status === "transcribing" ? "bg-sky-400 animate-pulse"
    : "bg-rose-500 animate-pulse";
  const label =
    bar.status === "done" ? "ready"
    : bar.status === "skipped" ? "silent"
    : bar.status === "writing" ? "writing…"
    : bar.status === "transcribing" ? "transcribing…"
    : "recording…";
  return (
    <li className="px-5 py-3 flex items-start gap-3">
      <div className="pt-1.5"><span className={`block h-2 w-2 rounded-full ${dot}`} /></div>
      <div className="w-12 text-xs font-mono text-muted-foreground pt-1">#{bar.index + 1}</div>
      <div className="flex-1 min-w-0 space-y-1">
        {bar.line ? (
          <div className="text-base leading-relaxed">{bar.line}</div>
        ) : (
          <div className="text-sm italic text-muted-foreground">{label}</div>
        )}
        {bar.transcript && (
          <div className="text-[11px] text-muted-foreground/70 font-mono truncate">
            mumble: {bar.transcript}
          </div>
        )}
      </div>
      {bar.endSound && bar.status === "done" && (
        <Badge variant="outline" className="text-[10px]">
          {bar.syllables}σ · -{bar.endSound}
        </Badge>
      )}
    </li>
  );
}

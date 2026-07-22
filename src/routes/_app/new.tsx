import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createTrack } from "@/lib/tracks.functions";
import { getDeviceId } from "@/lib/device-id";
import { DEFAULT_BRIEF, type StyleBrief } from "@/lib/lyrics-analysis";
import { StyleBriefForm } from "@/components/StyleBriefForm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Upload, Mic, Square, Loader2, Sliders, ChevronDown, Cpu, Cloud, Sparkles, Copy, FileText } from "lucide-react";
import { toast } from "sonner";
import { loadLlmConfig, isOfflineReady } from "@/lib/llm-config";
import { transcribeLocal } from "@/lib/local-transcribe";
import { addToStyleMemory, sampleStyleExamples, styleMemoryStats, loadBurnedPhrases, loadBurnedVowels } from "@/lib/style-memory";
import { recallStyleExamples, buildRecallQuery } from "@/lib/style-recall";
import { runLocalPipeline, type LocalLyrics, type ProgressEvent, type LocalCadence, type LocalQuality, type LocalBrief, type LocalPipelineResult } from "@/lib/local-pipeline";
import { putTrack, putBars, putBlob, isLocalOnly, getDeviceId as getLocalDeviceId } from "@/lib/local-store";

export const Route = createFileRoute("/_app/new")({
  head: () => ({ meta: [{ title: "New track · VoxScript" }] }),
  component: NewTrack,
});

const MAX_BYTES = 25 * 1024 * 1024;
const BRIEF_KEY = "voxscript:style-brief";
const TARGET_SAMPLE_RATE = 16000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const ratio = sampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(merged.length / ratio));
  const pcm16 = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(merged.length, Math.floor((i + 1) * ratio));
    let total = 0;
    for (let j = start; j < end; j++) total += merged[j];
    const sample = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcm16.length * 2, true);
  for (let i = 0; i < pcm16.length; i++) view.setInt16(44 + i * 2, pcm16[i], true);
  return new Blob([buffer], { type: "audio/wav" });
}

function NewTrack() {
  const navigate = useNavigate();
  const create = useServerFn(createTrack);
  const [busy, setBusy] = useState<null | "uploading" | "transcribing" | "writing" | "local">(null);
  const [recording, setRecording] = useState(false);
  const [brief, setBrief] = useState<StyleBrief>(DEFAULT_BRIEF);
  const [llmMode, setLlmMode] = useState<"cloud" | "local">("cloud");
  const [memCount, setMemCount] = useState(0);
  const [localTranscript, setLocalTranscript] = useState("");
  const [localProgress, setLocalProgress] = useState<string>("");
  const [localResult, setLocalResult] = useState<{ lyrics: LocalLyrics; score: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(BRIEF_KEY);
      if (saved) setBrief({ ...DEFAULT_BRIEF, ...JSON.parse(saved) });
    } catch { /* ignore */ }
    setLlmMode(loadLlmConfig().mode);
    setMemCount(styleMemoryStats().count);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(BRIEF_KEY, JSON.stringify(brief)); } catch { /* ignore */ }
  }, [brief]);

  async function submit(file: File | Blob, filename: string, mime: string) {
    if (file.size === 0) { toast.error("Empty recording — try again."); return; }
    if (file.size > MAX_BYTES) { toast.error("File too large (max 25 MB)."); return; }
    const config = loadLlmConfig();
    const localMode = isLocalOnly();
    // Fully-offline branch: transcribe locally in the browser, then run the
    // local pipeline. Cloud branch still goes through the server function.
    if (isOfflineReady(config)) {
      setBusy("transcribing");
      setLocalProgress("Transcribing on local Whisper…");
      try {
        const transcript = await transcribeLocal(file, filename, {
          baseUrl: config.whisperBaseUrl,
          backend: config.whisperBackend,
          model: config.whisperModel,
          language: config.whisperLanguage || undefined,
        });
        if (!transcript.trim()) throw new Error("Local Whisper returned empty transcript");
        setLocalTranscript(transcript);
        setBusy("local");
        const result = await runLocalPipeline(config, transcript, brief, (e: ProgressEvent) => setLocalProgress(e.message));
        const score = result.quality.drakeScore ?? 0;
        const bars = result.lyrics.sections.flatMap((s) => s.lines);
        addToStyleMemory({ title: result.lyrics.title, drakeScore: score, vibe: result.cadence.detectedVibe, bars });
        setMemCount(styleMemoryStats().count);
        setLocalResult({ lyrics: result.lyrics, score });
        // Save to local store if in local mode
        if (localMode) {
          await saveLocalTrack(file, result, transcript);
        }
        toast.success(`Offline run complete · ${score.toFixed(1)}/10`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Offline pipeline failed");
      } finally {
        setBusy(null);
        setLocalProgress("");
      }
      return;
    }
    // Local mode with cloud transcription or local LLM + cloud transcription
    if (localMode) {
      setBusy("transcribing");
      setLocalProgress("Transcribing…");
      try {
        // Use local transcription if configured, otherwise fall back to cloud
        let transcript: string;
        if (config.transcriptionMode === "local") {
          transcript = await transcribeLocal(file, filename, {
            baseUrl: config.whisperBaseUrl,
            backend: config.whisperBackend,
            model: config.whisperModel,
            language: config.whisperLanguage || undefined,
          });
        } else {
          // Cloud transcription - would need server function, but in local mode we can't
          // For now, we'll require local transcription in local mode
          throw new Error("Local mode requires local transcription. Enable local Whisper in settings.");
        }
        if (!transcript.trim()) throw new Error("Transcription returned empty result");
        setLocalTranscript(transcript);
        setBusy("local");
        const result = await runLocalPipeline(config, transcript, brief, (e: ProgressEvent) => setLocalProgress(e.message));
        const score = result.quality.drakeScore ?? 0;
        const bars = result.lyrics.sections.flatMap((s) => s.lines);
        addToStyleMemory({ title: result.lyrics.title, drakeScore: score, vibe: result.cadence.detectedVibe, bars });
        setMemCount(styleMemoryStats().count);
        setLocalResult({ lyrics: result.lyrics, score });
        await saveLocalTrack(file, result, transcript);
        toast.success(`Local track saved · ${score.toFixed(1)}/10`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Local pipeline failed");
      } finally {
        setBusy(null);
        setLocalProgress("");
      }
      return;
    }
    setBusy("uploading");
    try {
      const base64 = await blobToBase64(file);
      setBusy("transcribing");
      const recallQuery = buildRecallQuery({
        topic: brief?.topic,
        attitude: brief?.attitude,
        customSlang: brief?.customSlang,
        genre: brief?.genre,
      });
      const recalled = recallQuery
        ? await recallStyleExamples(recallQuery, { count: 3, filter: { genre: brief?.genre } })
        : [];
      const styleExamples = recalled.length ? recalled : sampleStyleExamples(3, { genre: brief?.genre });
      const burnedPhrases = loadBurnedPhrases().slice(0, 40);
      const burnedVowels = loadBurnedVowels().slice(0, 30);
      const res = await create({
        data: { deviceId: getDeviceId(), filename, mimeType: mime, base64, styleBrief: brief, styleExamples, burnedPhrases, burnedVowels },
      });
      setBusy("writing");
      navigate({ to: "/track/$id", params: { id: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  async function saveLocalTrack(audioBlob: Blob, result: LocalPipelineResult, transcript: string) {
    const trackId = crypto.randomUUID();
    const now = Date.now();
    const deviceId = getLocalDeviceId();
    const audioKey = await putBlob(`${trackId}/main.wav`, audioBlob);
    const bars = result.lyrics.sections.flatMap((s, si) => s.lines.map((line, li) => ({
      id: `${trackId}:${si * 1000 + li}`,
      trackId,
      index: si * 1000 + li,
      transcript: result.cadence.bars[si * 1000 + li]?.text || transcript,
      line,
      syllables: result.cadence.bars[si * 1000 + li]?.syllables,
      endSound: result.cadence.bars[si * 1000 + li]?.endSound,
      audioKey: undefined,
      createdAt: now,
    })));
    await putTrack({
      id: trackId,
      deviceId,
      title: result.lyrics.title,
      status: "done",
      bpm: 92,
      beatsPerBar: 4,
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
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    await submit(f, f.name, f.type || "audio/mpeg");
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Audio recording is not supported in this browser.");
      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const mutedOutput = ctx.createGain();
      mutedOutput.gain.value = 0;
      pcmRef.current = [];
      processor.onaudioprocess = (event) => {
        pcmRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(mutedOutput);
      mutedOutput.connect(ctx.destination);
      streamRef.current = stream;
      audioCtxRef.current = ctx;
      sourceRef.current = source;
      processorRef.current = processor;
      setRecording(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Microphone access denied.");
    }
  }

  async function stopRecording() {
    const chunks = pcmRef.current;
    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await audioCtxRef.current?.close().catch(() => undefined);
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
    pcmRef.current = [];
    setRecording(false);
    const blob = encodeWav(chunks, sampleRate);
    if (blob.size < 2048) { toast.error("That recording was empty — try again."); return; }
    await submit(blob, "recording.wav", "audio/wav");
  }

  async function runLocal() {
    if (!localTranscript.trim()) { toast.error("Paste a transcript first."); return; }
    setBusy("local");
    setLocalResult(null);
    setLocalProgress("Starting…");
    try {
      const config = loadLlmConfig();
      const result = await runLocalPipeline(config, localTranscript, brief, (e: ProgressEvent) => {
        setLocalProgress(e.message);
      });
      const score = result.quality.drakeScore ?? 0;
      const bars = result.lyrics.sections.flatMap((s) => s.lines);
      addToStyleMemory({ title: result.lyrics.title, drakeScore: score, vibe: result.cadence.detectedVibe, bars });
      setMemCount(styleMemoryStats().count);
      setLocalResult({ lyrics: result.lyrics, score });
      toast.success(`Generated. Score ${score.toFixed(1)}/10${score >= 8 ? " · saved to memory" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Local generation failed");
    } finally {
      setBusy(null);
      setLocalProgress("");
    }
  }

  if (busy && busy !== "local") {
    const label =
      busy === "uploading" ? "Uploading your audio…"
      : busy === "transcribing" ? "Mapping cadence & transcribing…"
      : "Writing & editing lyrics…";
    return (
      <Card className="p-12 text-center max-w-md mx-auto">
        <Loader2 className="h-8 w-8 text-primary mx-auto mb-4 animate-spin" />
        <h2 className="font-display text-lg font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Multi-pass ghostwriter + Drake-tier critic loop. Usually 60–180 seconds.
        </p>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">New track</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Drop a voice memo, record directly, or run on your local LLM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={llmMode === "local" ? "default" : "secondary"}>
            {llmMode === "local" ? <><Cpu className="h-3 w-3 mr-1" /> Local LLM</> : <><Cloud className="h-3 w-3 mr-1" /> Cloud</>}
          </Badge>
          {memCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Sparkles className="h-3 w-3" /> {memCount} memory
            </Badge>
          )}
        </div>
      </div>

      <Collapsible defaultOpen>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:border-primary/50 transition-colors text-sm">
            <span className="flex items-center gap-2 font-display font-semibold">
              <Sliders className="h-4 w-4 text-primary" />
              Style brief
              <span className="text-xs font-normal text-muted-foreground">— shapes how the ghostwriter writes</span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <StyleBriefForm value={brief} onChange={setBrief} />
        </CollapsibleContent>
      </Collapsible>

      <Card className="p-6 space-y-4">
        <div>
          <h2 className="font-display font-semibold">Local Generation</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Record voice, upload audio, or paste transcript. Pipeline runs 100% on your machine.
          </p>
        </div>

        <Tabs defaultValue="audio" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="audio">
              <Mic className="h-4 w-4 mr-2" />
              Record / Upload Audio
            </TabsTrigger>
            <TabsTrigger value="transcript">
              <FileText className="h-4 w-4 mr-2" />
              Paste Transcript
            </TabsTrigger>
          </TabsList>

          <TabsContent value="audio" className="space-y-4 pt-4">
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="h-7 w-7 text-primary mx-auto mb-2" />
              <div className="font-display font-semibold text-sm">Upload audio file</div>
              <div className="text-xs text-muted-foreground mt-1">
                mp3, wav, m4a, webm · up to 25 MB
              </div>
              <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
            </label>

            {/* Recording tips */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3 text-sm">
              <div className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">🎤</span>
                <div>
                  <div className="font-semibold text-foreground">Record / upload ONLY your vocals (acapella)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    No background music, beats, or loud room noise should be audible in the recording.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">✨</span>
                <div>
                  <div className="font-semibold text-foreground">Keep your vocals clear and unprocessed</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Avoid reverb, delay, distortion, heavy autotune, or other FX. Raw, unprocessed vocals are preferred.
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground my-2">
              <div className="h-px bg-border flex-1" />
              or record directly
              <div className="h-px bg-border flex-1" />
            </div>

            <div className="flex justify-center">
              {recording ? (
                <Button size="lg" variant="destructive" onClick={stopRecording}>
                  <Square className="h-4 w-4 mr-2 fill-current" />
                  Stop recording
                </Button>
              ) : (
                <Button size="lg" onClick={startRecording}>
                  <Mic className="h-4 w-4 mr-2" />
                  Start recording
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="transcript" className="space-y-4 pt-4">
            <Textarea
              value={localTranscript}
              onChange={(e) => setLocalTranscript(e.target.value)}
              placeholder="uh, yeah, like I'm driving through the city late at night, palm trees blurring..."
              rows={6}
              className="font-mono text-xs"
            />
            <Button onClick={runLocal} disabled={busy === "local"} className="w-full">
              {busy === "local" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {localProgress || "Generating…"}</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Generate locally</>
              )}
            </Button>

            {localResult && (
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-semibold">{localResult.lyrics.title}</h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{localResult.score.toFixed(1)}/10</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const txt = localResult.lyrics.sections
                          .map((s) => `[${s.type.toUpperCase()}]\n${s.lines.join("\n")}`)
                          .join("\n\n");
                        navigator.clipboard.writeText(txt);
                        toast.success("Copied");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {localResult.lyrics.sections.map((s, i) => (
                  <div key={i}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{s.type}</div>
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{s.lines.join("\n")}</pre>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

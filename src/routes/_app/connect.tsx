import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, Copy, RefreshCw, Zap, Cpu, Mic2 } from "lucide-react";
import {
  discoverLlmBackends,
  discoverWhisperBackends,
  getOllamaContextLength,
  recommendedModels,
  recommendedWhisper,
  corsHint,
  type DiscoveredLlm,
  type DiscoveredWhisper,
  type LlmBackend,
} from "@/lib/local-discovery";
import { loadLlmConfig, saveLlmConfig, pingLocalLlm, type LlmConfig } from "@/lib/llm-config";
import { pingLocalWhisper } from "@/lib/local-transcribe";
import { detectModel, tierFor, profileFor } from "@/lib/local-profiles";

export const Route = createFileRoute("/_app/connect")({
  component: ConnectPage,
});

function ConnectPage() {
  const [config, setConfig] = useState<LlmConfig>(loadLlmConfig());
  const [llms, setLlms] = useState<DiscoveredLlm[]>([]);
  const [whispers, setWhispers] = useState<DiscoveredWhisper[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState<"llm" | "whisper" | null>(null);
  const [testResult, setTestResult] = useState<{ kind: "llm" | "whisper"; ok: boolean; msg: string } | null>(null);

  async function scan() {
    setScanning(true);
    try {
      const [l, w] = await Promise.all([discoverLlmBackends(), discoverWhisperBackends()]);
      setLlms(l);
      setWhispers(w);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => { scan(); }, []);

  function updateConfig(patch: Partial<LlmConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    saveLlmConfig(next);
  }

  async function useThisLlm(d: DiscoveredLlm, modelId: string) {
    let ctx: number | undefined;
    if (d.backend === "ollama") {
      const base = d.baseUrl.replace(/\/v1$/, "");
      ctx = await getOllamaContextLength(base, modelId);
    } else {
      const m = d.models.find((m) => m.id === modelId);
      ctx = m?.contextTokens;
    }
    updateConfig({
      mode: "local",
      localBaseUrl: d.baseUrl,
      localModel: modelId,
      localApiKey: d.backend === "ollama" ? "ollama" : (config.localApiKey || "local"),
      localContextTokens: ctx,
    });
    toast.success(`Connected to ${d.backend} · ${modelId}${ctx ? ` (${ctx} ctx)` : ""}`);
  }

  function useThisWhisper(w: DiscoveredWhisper) {
    updateConfig({
      transcriptionMode: "local",
      whisperBaseUrl: w.baseUrl,
      whisperBackend: w.backend === "unknown" ? "auto" : w.backend,
    });
    toast.success(`Whisper set to ${w.backend} at ${w.baseUrl}`);
  }

  async function testLlm() {
    setTesting("llm");
    const r = await pingLocalLlm(config);
    setTestResult({ kind: "llm", ok: r.ok, msg: r.message });
    setTesting(null);
  }
  async function testWhisper() {
    setTesting("whisper");
    const r = await pingLocalWhisper({
      baseUrl: config.whisperBaseUrl,
      backend: config.whisperBackend,
      model: config.whisperModel,
      language: config.whisperLanguage || undefined,
    });
    setTestResult({ kind: "whisper", ok: r.ok, msg: r.message });
    setTesting(null);
  }

  const detected = detectModel(config.localModel);
  const profile = profileFor(config.localModel);
  const effectiveTier = config.tierOverride ?? tierFor(detected.paramsB);
  const offlineReady = config.mode === "local" && config.transcriptionMode === "local";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Connect Local AI</h1>
          <p className="text-muted-foreground mt-1">Discover and wire up local LLM + Whisper servers for offline ghostwriting.</p>
        </div>
        <Button onClick={scan} disabled={scanning} variant="outline">
          {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Rescan localhost
        </Button>
      </div>

      {offlineReady && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 flex items-center gap-3">
          <Zap className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">Offline-ready</div>
            <div className="text-sm text-muted-foreground">LLM + transcription both routed locally. You can pull the network plug.</div>
          </div>
        </div>
      )}

      <Tabs defaultValue="llm">
        <TabsList>
          <TabsTrigger value="llm"><Cpu className="h-4 w-4 mr-1.5" />LLM</TabsTrigger>
          <TabsTrigger value="whisper"><Mic2 className="h-4 w-4 mr-1.5" />Transcription</TabsTrigger>
          <TabsTrigger value="tuning">Tuning</TabsTrigger>
        </TabsList>

        {/* ============= LLM TAB ============= */}
        <TabsContent value="llm" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Detected backends</CardTitle>
              <CardDescription>Probed common localhost ports. Click <em>Use</em> next to a model to wire it up.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {llms.length === 0 && <div className="text-sm text-muted-foreground">Scanning…</div>}
              {llms.map((d) => (
                <BackendCard key={d.baseUrl} d={d} onUse={(m) => useThisLlm(d, m)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active configuration</CardTitle>
              <CardDescription>
                Family <Badge variant="secondary">{detected.family}</Badge> · tier <Badge variant="secondary">{effectiveTier}</Badge> · ~{detected.paramsB || "?"}B · format <Badge variant="outline">{profile.writeFormat}</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="baseUrl">Base URL</Label>
                  <Input id="baseUrl" value={config.localBaseUrl} onChange={(e) => updateConfig({ localBaseUrl: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="model">Model ID</Label>
                  <Input id="model" value={config.localModel} onChange={(e) => updateConfig({ localModel: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="apiKey">API key</Label>
                  <Input id="apiKey" value={config.localApiKey} onChange={(e) => updateConfig({ localApiKey: e.target.value })} placeholder="ollama / lm-studio / etc" />
                </div>
                <div>
                  <Label htmlFor="ctx">Context tokens (probed)</Label>
                  <Input id="ctx" type="number" value={config.localContextTokens ?? ""} placeholder="auto" onChange={(e) => updateConfig({ localContextTokens: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={testLlm} disabled={testing === "llm"}>
                  {testing === "llm" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Test connection
                </Button>
              </div>
              {testResult?.kind === "llm" && (
                <div className={`text-sm flex items-start gap-2 ${testResult.ok ? "text-primary" : "text-destructive"}`}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <XCircle className="h-4 w-4 mt-0.5" />}
                  <span>{testResult.msg}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <RecommendedInstall />
        </TabsContent>

        {/* ============= WHISPER TAB ============= */}
        <TabsContent value="whisper" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Detected transcription servers</CardTitle>
              <CardDescription>Configure local Whisper server for offline voice-to-text.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {whispers.length === 0 && <div className="text-sm text-muted-foreground">Scanning…</div>}
              {whispers.map((w) => (
                <div key={w.baseUrl} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {w.reachable
                      ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      : <XCircle className="h-5 w-5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{w.backend} <span className="text-muted-foreground font-normal">{w.baseUrl}</span></div>
                      {w.error && <div className="text-xs text-muted-foreground truncate">{w.error}</div>}
                    </div>
                  </div>
                  <Button size="sm" disabled={!w.reachable} onClick={() => useThisWhisper(w)}>Use</Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Active transcription</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex gap-3 items-end flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <Label>Mode</Label>
                  <Select value={config.transcriptionMode} onValueChange={(v: "cloud" | "local") => updateConfig({ transcriptionMode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cloud">Cloud (Lovable AI / OpenAI)</SelectItem>
                      <SelectItem value="local">Local Whisper</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <Label>Backend</Label>
                  <Select value={config.whisperBackend} onValueChange={(v: LlmConfig["whisperBackend"]) => updateConfig({ whisperBackend: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="faster-whisper">faster-whisper-server</SelectItem>
                      <SelectItem value="whisper.cpp">whisper.cpp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label>Base URL</Label>
                  <Input value={config.whisperBaseUrl} onChange={(e) => updateConfig({ whisperBaseUrl: e.target.value })} />
                </div>
                <div>
                  <Label>Model</Label>
                  <Input value={config.whisperModel} onChange={(e) => updateConfig({ whisperModel: e.target.value })} />
                </div>
                <div>
                  <Label>Language (ISO, blank = auto)</Label>
                  <Input value={config.whisperLanguage} onChange={(e) => updateConfig({ whisperLanguage: e.target.value })} placeholder="en" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={testWhisper} disabled={testing === "whisper" || config.transcriptionMode !== "local"} variant="outline">
                  {testing === "whisper" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Test transcription server
                </Button>
              </div>
              {testResult?.kind === "whisper" && (
                <div className={`text-sm flex items-start gap-2 ${testResult.ok ? "text-primary" : "text-destructive"}`}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <XCircle className="h-4 w-4 mt-0.5" />}
                  <span>{testResult.msg}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <RecommendedWhisperInstall />
        </TabsContent>

        {/* ============= TUNING TAB ============= */}
        <TabsContent value="tuning" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Family & tier overrides</CardTitle>
              <CardDescription>Detection runs off the model id. Override if it picks wrong — affects prompt format, sampling, and iteration budget.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Family</Label>
                <Select value={config.familyOverride ?? "auto"} onValueChange={(v) => updateConfig({ familyOverride: v === "auto" ? undefined : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto · detected: {detected.family}</SelectItem>
                    {(["qwen", "llama", "mistral", "deepseek", "gemma", "phi", "command-r", "yi", "other"] as const).map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tier</Label>
                <Select value={config.tierOverride ?? "auto"} onValueChange={(v) => updateConfig({ tierOverride: v === "auto" ? undefined : v as "small" | "mid" | "large" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto · detected: {tierFor(detected.paramsB)}</SelectItem>
                    <SelectItem value="small">small (≤8B) — 2 critic loops, target 7.5</SelectItem>
                    <SelectItem value="mid">mid (13–32B) — 4 loops, target 8.5</SelectItem>
                    <SelectItem value="large">large (70B+) — 6 loops, target 9.0</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Memory cap (max few-shot entries kept locally)</Label>
                <Input type="number" min={50} max={20000} step={50} value={config.localMemoryCap} onChange={(e) => updateConfig({ localMemoryCap: Number(e.target.value) || 2000 })} />
                <p className="text-xs text-muted-foreground mt-1">Default 2000 for local mode. Cloud mode caps at 200 to keep request size sane. Save in Settings to apply.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackendCard({ d, onUse }: { d: DiscoveredLlm; onUse: (modelId: string) => void }) {
  const [picked, setPicked] = useState<string>(d.models[0]?.id ?? "");
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {d.reachable
            ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            : <XCircle className="h-5 w-5 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium">{d.backend} <span className="text-muted-foreground font-normal text-sm">{d.baseUrl}</span></div>
            {d.error && <div className="text-xs text-muted-foreground truncate">{d.error} — {corsHint(d.backend)}</div>}
            {d.reachable && <div className="text-xs text-muted-foreground">{d.models.length} model{d.models.length === 1 ? "" : "s"} available</div>}
          </div>
        </div>
      </div>
      {d.reachable && d.models.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger className="min-w-[260px] max-w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {d.models.map((m) => {
                const det = detectModel(m.id);
                return (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id} {det.paramsB ? `· ${det.paramsB}B` : ""} {m.sizeBytes ? `· ${(m.sizeBytes / 1e9).toFixed(1)}GB` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => picked && onUse(picked)} disabled={!picked}>Use this model</Button>
        </div>
      )}
    </div>
  );
}

function RecommendedInstall() {
  const [backend, setBackend] = useState<LlmBackend>("ollama");
  const list = recommendedModels(backend);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recommended models</CardTitle>
        <CardDescription>Battle-tested for lyric writing at 13–32B scale.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={backend} onValueChange={(v: LlmBackend) => setBackend(v)}>
          <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ollama">Ollama</SelectItem>
            <SelectItem value="lm-studio">LM Studio</SelectItem>
          </SelectContent>
        </Select>
        {list.map((r) => (
          <div key={r.command} className="rounded-md border bg-muted/30 px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{r.tier}</Badge>
                <span className="font-medium text-sm">{r.modelId}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
              <code className="block text-xs mt-1 font-mono break-all">{r.command}</code>
            </div>
            <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(r.command); toast.success("Copied"); }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Separator />
        <p className="text-xs text-muted-foreground">CORS issue? {corsHint(backend)}</p>
      </CardContent>
    </Card>
  );
}

function RecommendedWhisperInstall() {
  const list = recommendedWhisper();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up a local Whisper server</CardTitle>
        <CardDescription>Any OpenAI-compatible /v1/audio/transcriptions endpoint works.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.map((r) => (
          <div key={r.command} className="rounded-md border bg-muted/30 px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{r.description}</div>
              <code className="block text-xs mt-1 font-mono break-all">{r.command}</code>
            </div>
            <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(r.command); toast.success("Copied"); }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground pt-2">CORS issue? {corsHint("whisper")}</p>
      </CardContent>
    </Card>
  );
}

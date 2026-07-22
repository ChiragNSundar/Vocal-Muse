import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Cpu, CheckCircle2, XCircle, Loader2, Mic, Sparkles,
  ArrowRight, ArrowLeft, Zap, Radio, Brain,
} from "lucide-react";
import { discoverLlmBackends, discoverWhisperBackends } from "@/lib/local-discovery";
import { loadLlmConfig, pingLocalLlm } from "@/lib/llm-config";
import { pingLocalWhisper } from "@/lib/local-transcribe";
import { playFx } from "@/lib/sound-fx";

const ONBOARDING_KEY = "voxscript:onboarding-complete";

export const Route = createFileRoute("/_app/onboarding")({
  head: () => ({
    meta: [
      { title: "Get Started — VoxScript" },
      { name: "description", content: "Set up your local AI and get familiar with VoxScript in 3 easy steps." },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1: AI status
  const [scanning, setScanning] = useState(false);
  const [llmOk, setLlmOk] = useState<boolean | null>(null);
  const [whisperOk, setWhisperOk] = useState<boolean | null>(null);
  const [llmName, setLlmName] = useState("");
  const [whisperName, setWhisperName] = useState("");

  async function scanAi() {
    setScanning(true);
    setLlmOk(null);
    setWhisperOk(null);
    try {
      const [llms, whispers] = await Promise.all([
        discoverLlmBackends(),
        discoverWhisperBackends(),
      ]);
      if (llms.length > 0) {
        setLlmOk(true);
        setLlmName(llms[0].label);
      } else {
        // Try pinging the saved config
        const cfg = loadLlmConfig();
        try {
          await pingLocalLlm(cfg);
          setLlmOk(true);
          setLlmName(cfg.model || "Local LLM");
        } catch {
          setLlmOk(false);
        }
      }
      if (whispers.length > 0) {
        setWhisperOk(true);
        setWhisperName(whispers[0].label);
      } else {
        try {
          await pingLocalWhisper();
          setWhisperOk(true);
          setWhisperName("Whisper Server");
        } catch {
          setWhisperOk(false);
        }
      }
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (step === 0) scanAi();
  }, [step]);

  function complete() {
    localStorage.setItem(ONBOARDING_KEY, "true");
    playFx("track-saved");
    navigate({ to: "/library" });
  }

  const steps = [
    { title: "Connect AI", icon: Cpu },
    { title: "Try Recording", icon: Mic },
    { title: "Explore Features", icon: Sparkles },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Progress header */}
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-bold">Welcome to VoxScript</h1>
        <p className="text-muted-foreground">
          Let's get you set up in 3 quick steps.
        </p>
        <div className="flex items-center gap-3">
          {steps.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setStep(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <s.icon className="h-3.5 w-3.5" />
              )}
              {s.title}
            </button>
          ))}
        </div>
        <Progress value={((step + 1) / 3) * 100} className="h-1" />
      </div>

      {/* Step Content */}
      {step === 0 && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Step 1: Connect Your AI</h2>
              <p className="text-xs text-muted-foreground">VoxScript runs on local AI servers. Let's check if yours are ready.</p>
            </div>
          </div>

          <div className="grid gap-3">
            {/* LLM Status */}
            <div className="flex items-center justify-between p-4 rounded-lg border bg-background/60">
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-amber-400" />
                <div>
                  <div className="text-sm font-medium">LLM (Lyric Generator)</div>
                  <div className="text-xs text-muted-foreground">
                    {scanning ? "Scanning..." : llmOk ? llmName : "Not detected — install LM Studio or Ollama"}
                  </div>
                </div>
              </div>
              {scanning ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : llmOk ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <XCircle className="h-3 w-3 mr-1" /> Offline
                </Badge>
              )}
            </div>

            {/* Whisper Status */}
            <div className="flex items-center justify-between p-4 rounded-lg border bg-background/60">
              <div className="flex items-center gap-3">
                <Radio className="h-5 w-5 text-sky-400" />
                <div>
                  <div className="text-sm font-medium">Whisper (Voice Transcription)</div>
                  <div className="text-xs text-muted-foreground">
                    {scanning ? "Scanning..." : whisperOk ? whisperName : "Not detected — install faster-whisper-server"}
                  </div>
                </div>
              </div>
              {scanning ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : whisperOk ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <XCircle className="h-3 w-3 mr-1" /> Offline
                </Badge>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button variant="ghost" size="sm" onClick={() => scanAi()} disabled={scanning}>
              <Loader2 className={`h-4 w-4 mr-1.5 ${scanning ? "animate-spin" : ""}`} />
              Re-scan
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate({ to: "/connect" })}>
                <Cpu className="h-4 w-4 mr-1.5" />
                Go to Connect Page
              </Button>
              <Button onClick={() => setStep(1)}>
                Next
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>

          {!llmOk && !scanning && (
            <p className="text-xs text-muted-foreground">
              💡 Don't have a local AI? You can still explore the app — just skip ahead!
            </p>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Mic className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Step 2: Your First Recording</h2>
              <p className="text-xs text-muted-foreground">VoxScript turns mumbled freestyles into polished lyrics.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-4 rounded-lg border bg-background/60 space-y-2">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">New Track Studio</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Record a quick freestyle directly in the browser, or upload an audio file. The AI reads your flow and generates matching lyrics.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/new" })} className="w-full mt-2">
                <Mic className="h-3.5 w-3.5 mr-1.5" />
                Try New Track
              </Button>
            </div>

            <div className="p-4 rounded-lg border bg-background/60 space-y-2">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-emerald-400" />
                <span className="font-medium text-sm">Live Punch-In</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Real-time bar-by-bar recording with metronome sync. Each bar is transcribed and processed as you go — like a real studio session.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/live" })} className="w-full mt-2">
                <Radio className="h-3.5 w-3.5 mr-1.5" />
                Try Live Mode
              </Button>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
            <Button onClick={() => setStep(2)}>
              Next
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Step 3: Explore the Full Studio</h2>
              <p className="text-xs text-muted-foreground">Here's everything VoxScript has to offer.</p>
            </div>
          </div>

          <div className="grid gap-3">
            {[
              { icon: Brain, color: "text-amber-400", title: "Reference & Style Intelligence", desc: "Search songs on the web, extract cadence fingerprints, ingest into permanent style memory.", to: "/references" as const },
              { icon: Cpu, color: "text-sky-400", title: "Connect Local AI", desc: "Auto-scan and wire up LM Studio, Ollama, or any OpenAI-compatible local server.", to: "/connect" as const },
              { icon: Zap, color: "text-emerald-400", title: "Settings & Training", desc: "Monitor storage, run synthetic self-play training benchmarks, manage caches.", to: "/settings" as const },
            ].map(({ icon: Icon, color, title, desc, to }) => (
              <button
                key={title}
                onClick={() => navigate({ to })}
                className="flex items-start gap-3 p-4 rounded-lg border bg-background/60 hover:border-primary/40 transition-colors text-left w-full"
              >
                <Icon className={`h-5 w-5 ${color} mt-0.5 shrink-0`} />
                <div>
                  <div className="font-medium text-sm">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
            <Button onClick={complete} className="shadow-lg shadow-primary/20">
              <Sparkles className="h-4 w-4 mr-1.5" />
              Finish Setup & Open Library
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

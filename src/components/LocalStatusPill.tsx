import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cpu, Cloud, Loader2, WifiOff, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { loadLlmConfig, pingLocalLlm, isOfflineReady, type LlmConfig } from "@/lib/llm-config";
import { pingLocalWhisper } from "@/lib/local-transcribe";
import { setMemoryLimits } from "@/lib/style-memory";

type Status = "checking" | "cloud" | "local-ready" | "offline-ready" | "local-broken";

export function LocalStatusPill() {
  const [status, setStatus] = useState<Status>("checking");
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [tip, setTip] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const cfg = loadLlmConfig();
      setConfig(cfg);
      // Sync memory cap on every boot — local mode can hold a much bigger
      // few-shot library than cloud (no per-request size limit).
      setMemoryLimits({ maxEntries: cfg.mode === "local" ? cfg.localMemoryCap : 200 });
      const llm = await pingLocalLlm(cfg);
      if (!llm.ok) { if (!cancelled) { setStatus("local-broken"); setTip(llm.message); } return; }
      const w = await pingLocalWhisper({ baseUrl: cfg.whisperBaseUrl, backend: cfg.whisperBackend, model: cfg.whisperModel, language: cfg.whisperLanguage || undefined });
      if (!cancelled) {
        if (w.ok) { setStatus("offline-ready"); setTip(`Offline-ready · ${cfg.localModel} + Whisper`); }
        else { setStatus("local-ready"); setTip(`Local LLM ready · ${cfg.localModel}`); }
      }
    }
    check();
    const t = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const variant = status === "offline-ready" ? "default"
    : status === "local-ready" ? "secondary"
    : status === "local-broken" ? "destructive"
    : "outline";

  const Icon = status === "checking" ? Loader2
    : status === "cloud" ? Cloud
    : status === "offline-ready" ? Zap
    : status === "local-broken" ? WifiOff
    : Cpu;

  const label = status === "checking" ? "Checking…"
    : status === "cloud" ? "Cloud"
    : status === "offline-ready" ? "Offline-ready"
    : status === "local-broken" ? "Local LLM down"
    : "Local";

  return (
    <Link to="/connect" title={tip} className="inline-flex">
      <Badge variant={variant} className="cursor-pointer gap-1 text-[11px]">
        <Icon className={`h-3 w-3 ${status === "checking" ? "animate-spin" : ""}`} />
        {label}
        {config?.mode === "local" && status !== "checking" && status !== "local-broken" && (
          <span className="text-muted-foreground/80 hidden sm:inline">· {config.localModel.split(":")[0].slice(0, 14)}</span>
        )}
      </Badge>
    </Link>
  );
}

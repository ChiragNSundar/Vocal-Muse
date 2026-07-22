// User config for which LLM backend to use. Stored in localStorage.
// Cloud mode = Lovable AI (server functions). Local mode = browser hits
// an OpenAI-compatible local endpoint (Ollama, LM Studio, llama.cpp server).
//
// Transcription is configured separately so a user can run a local LLM but
// still use cloud STT, or go fully offline with a local Whisper server.

export type LlmConfig = {
  mode: "cloud" | "local";
  localBaseUrl: string;
  localModel: string;
  localApiKey: string;
  /** Cached context length probed from the model — used for chunk planning. */
  localContextTokens?: number;
  /** Optional family/tier override when auto-detection is wrong. */
  familyOverride?: string;
  tierOverride?: "small" | "mid" | "large";

  // Transcription
  transcriptionMode: "cloud" | "local";
  whisperBaseUrl: string;
  whisperBackend: "faster-whisper" | "whisper.cpp" | "auto";
  whisperModel: string;
  whisperLanguage: string;

  // Memory tuning — local mode can afford a much bigger few-shot library.
  localMemoryCap: number;
};

const KEY = "voxscript:llm-config";

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  mode: "local",
  localBaseUrl: "http://localhost:1234/v1",
  localModel: "local-model",
  localApiKey: "lm-studio",
  localContextTokens: undefined,
  familyOverride: undefined,
  tierOverride: undefined,
  transcriptionMode: "local",
  whisperBaseUrl: "http://localhost:9000",
  whisperBackend: "faster-whisper",
  whisperModel: "Systran/faster-whisper-base.en",
  whisperLanguage: "",
  localMemoryCap: 2000,
};

export function loadLlmConfig(): LlmConfig {
  if (typeof localStorage === "undefined") return DEFAULT_LLM_CONFIG;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LLM_CONFIG;
    const loaded = JSON.parse(raw);
    return { ...DEFAULT_LLM_CONFIG, ...loaded, mode: "local", transcriptionMode: "local" };
  } catch {
    return DEFAULT_LLM_CONFIG;
  }
}

export function saveLlmConfig(config: LlmConfig) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(config));
}

/** True when the entire pipeline (LLM + STT) can run without internet. */
export function isOfflineReady(config: LlmConfig): boolean {
  return config.mode === "local" && config.transcriptionMode === "local";
}

export async function pingLocalLlm(config: LlmConfig): Promise<{ ok: boolean; message: string }> {
  if (config.mode !== "local") return { ok: false, message: "Local mode is not enabled" };
  try {
    const res = await fetch(`${config.localBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.localApiKey || "local"}`,
      },
      body: JSON.stringify({
        model: config.localModel,
        messages: [{ role: "user", content: "Reply with just OK" }],
        max_tokens: 8,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, message: `${res.status} ${res.statusText} — ${txt.slice(0, 200)}` };
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { ok: true, message: `Connected. Response: "${content.trim().slice(0, 80)}"` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `${msg}. If you're using Ollama, run: OLLAMA_ORIGINS='*' ollama serve`,
    };
  }
}

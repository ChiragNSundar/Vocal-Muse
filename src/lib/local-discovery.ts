// Browser-side discovery for local AI backends.
//
// We probe the common localhost ports for OpenAI-compatible LLM servers
// and Whisper transcription servers and report back what's reachable.
// Each probe is short-timeout (1500ms) so a closed port doesn't block.
//
// Nothing here writes config — the connect page decides what to save.

export type LlmBackend = "ollama" | "lm-studio" | "llama.cpp" | "text-gen-webui" | "vllm" | "unknown";

export type DiscoveredLlm = {
  backend: LlmBackend;
  baseUrl: string;
  models: { id: string; sizeBytes?: number; contextTokens?: number; family?: string }[];
  reachable: boolean;
  error?: string;
};

export type DiscoveredWhisper = {
  backend: "faster-whisper" | "whisper.cpp" | "unknown";
  baseUrl: string;
  reachable: boolean;
  error?: string;
};

const LLM_CANDIDATES: { backend: LlmBackend; baseUrl: string }[] = [
  { backend: "ollama", baseUrl: "http://localhost:11434" },
  { backend: "lm-studio", baseUrl: "http://localhost:1234" },
  { backend: "llama.cpp", baseUrl: "http://localhost:8080" },
  { backend: "text-gen-webui", baseUrl: "http://localhost:5000" },
  { backend: "vllm", baseUrl: "http://localhost:8000" },
];

const WHISPER_CANDIDATES: { backend: DiscoveredWhisper["backend"]; baseUrl: string }[] = [
  { backend: "faster-whisper", baseUrl: "http://localhost:9000" },
  { backend: "whisper.cpp", baseUrl: "http://localhost:8081" },
  { backend: "faster-whisper", baseUrl: "http://localhost:8000" }, // shared port w/ vllm; second probe distinguishes
];

async function fetchTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 1500);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI-compat `/v1/models` shape. */
type OpenAIModelsResponse = { data?: Array<{ id?: string; context_length?: number }> };

async function listOpenAIModels(baseUrl: string): Promise<{ id: string; contextTokens?: number }[]> {
  const res = await fetchTimeout(`${baseUrl}/v1/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as OpenAIModelsResponse;
  return (json.data ?? [])
    .map((m) => ({ id: String(m.id ?? ""), contextTokens: typeof m.context_length === "number" ? m.context_length : undefined }))
    .filter((m) => m.id);
}

/** Ollama-native `/api/tags` exposes installed models with sizes. */
type OllamaTagsResponse = {
  models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string; family?: string } }>;
};
async function listOllamaModels(baseUrl: string): Promise<DiscoveredLlm["models"]> {
  const res = await fetchTimeout(`${baseUrl}/api/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as OllamaTagsResponse;
  return (json.models ?? [])
    .map((m) => ({
      id: String(m.name ?? ""),
      sizeBytes: typeof m.size === "number" ? m.size : undefined,
      family: m.details?.family ?? undefined,
    }))
    .filter((m) => m.id);
}

/** Ollama `/api/show` reports context length per model. */
type OllamaShowResponse = {
  model_info?: Record<string, unknown>;
  parameters?: string;
};
export async function getOllamaContextLength(baseUrl: string, modelId: string): Promise<number | undefined> {
  try {
    const res = await fetchTimeout(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId }),
      timeoutMs: 3000,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as OllamaShowResponse;
    const info = json.model_info ?? {};
    for (const [k, v] of Object.entries(info)) {
      if (/context_length$/i.test(k) && typeof v === "number") return v;
    }
    // fall back to `parameters` text block (`num_ctx 8192`)
    const params = json.parameters ?? "";
    const m = params.match(/num_ctx\s+(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* ignore */
  }
  return undefined;
}

export async function probeLlmBackend(candidate: { backend: LlmBackend; baseUrl: string }): Promise<DiscoveredLlm> {
  const { backend, baseUrl } = candidate;
  try {
    if (backend === "ollama") {
      const models = await listOllamaModels(baseUrl);
      return { backend, baseUrl: `${baseUrl}/v1`, models, reachable: true };
    }
    const models = await listOpenAIModels(baseUrl);
    return { backend, baseUrl: `${baseUrl}/v1`, models, reachable: true };
  } catch (e) {
    return {
      backend,
      baseUrl: `${baseUrl}/v1`,
      models: [],
      reachable: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function discoverLlmBackends(): Promise<DiscoveredLlm[]> {
  const results = await Promise.all(LLM_CANDIDATES.map(probeLlmBackend));
  return results.filter((r) => r.reachable || true); // return all so UI can show what was checked
}

export async function probeWhisperBackend(candidate: { backend: DiscoveredWhisper["backend"]; baseUrl: string }): Promise<DiscoveredWhisper> {
  const { backend, baseUrl } = candidate;
  try {
    // faster-whisper-server exposes /v1/models, whisper.cpp server responds on root with HTML
    const res = await fetchTimeout(`${baseUrl}/v1/models`);
    if (res.ok) return { backend: "faster-whisper", baseUrl, reachable: true };
    // try whisper.cpp /load shape
    const res2 = await fetchTimeout(`${baseUrl}/`, { timeoutMs: 1000 });
    if (res2.ok) return { backend: "whisper.cpp", baseUrl, reachable: true };
    return { backend, baseUrl, reachable: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { backend, baseUrl, reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function discoverWhisperBackends(): Promise<DiscoveredWhisper[]> {
  return Promise.all(WHISPER_CANDIDATES.map(probeWhisperBackend));
}

export type RecommendedModel = {
  command: string;
  modelId: string;
  description: string;
  tier: "small" | "mid" | "large";
};

/** Curated install commands per backend. */
export function recommendedModels(backend: LlmBackend): RecommendedModel[] {
  if (backend === "ollama") {
    return [
      { command: "ollama pull qwen2.5:14b", modelId: "qwen2.5:14b", description: "Best mid-tier all-rounder. ~9GB.", tier: "mid" },
      { command: "ollama pull qwen2.5:32b", modelId: "qwen2.5:32b", description: "Cloud-grade lyrics. ~20GB, needs 24GB VRAM.", tier: "mid" },
      { command: "ollama pull mixtral:8x7b", modelId: "mixtral:8x7b", description: "MoE, strong wordplay. ~26GB.", tier: "mid" },
      { command: "ollama pull llama3.3:70b-instruct-q4_K_M", modelId: "llama3.3:70b", description: "Closest to Gemini. ~40GB.", tier: "large" },
      { command: "ollama pull llama3.1:8b", modelId: "llama3.1:8b", description: "Budget fallback. Fast on 8GB VRAM.", tier: "small" },
    ];
  }
  if (backend === "lm-studio") {
    return [
      { command: "Search: Qwen2.5-14B-Instruct (Q4_K_M)", modelId: "qwen2.5-14b", description: "Best mid-tier. Use the GGUF Q4_K_M build.", tier: "mid" },
      { command: "Search: Qwen2.5-32B-Instruct (Q4_K_M)", modelId: "qwen2.5-32b", description: "Cloud-grade. Needs 24GB+ VRAM.", tier: "mid" },
      { command: "Search: Mixtral-8x7B-Instruct", modelId: "mixtral-8x7b", description: "MoE, strong wordplay.", tier: "mid" },
    ];
  }
  return [];
}

export type WhisperRecommendation = {
  command: string;
  description: string;
};

export function recommendedWhisper(): WhisperRecommendation[] {
  return [
    {
      command: "docker run -d --name fw -p 9000:8000 fedirz/faster-whisper-server:latest-cpu",
      description: "faster-whisper-server (OpenAI-compatible). CPU build; GPU image available.",
    },
    {
      command: "uvx faster-whisper-server --host 0.0.0.0 --port 9000",
      description: "Same, without Docker. Requires Python + uv.",
    },
    {
      command: "./server -m models/ggml-base.en.bin --host 0.0.0.0 --port 8081",
      description: "whisper.cpp HTTP server. Builds from github.com/ggerganov/whisper.cpp.",
    },
  ];
}

export function corsHint(backend: LlmBackend | "whisper"): string {
  switch (backend) {
    case "ollama":
      return "Restart Ollama with: OLLAMA_ORIGINS='*' ollama serve  (or set the env var permanently in your OS)";
    case "lm-studio":
      return "In LM Studio: Local Server tab → enable 'CORS' → restart server.";
    case "llama.cpp":
      return "Start with: ./server --host 0.0.0.0 --port 8080 --api-key '' (CORS is on by default).";
    case "whisper":
      return "faster-whisper-server enables CORS by default. whisper.cpp: pass --allow-cors when starting the server.";
    default:
      return "Allow cross-origin requests from this site, then retry.";
  }
}

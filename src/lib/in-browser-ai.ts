// In-browser AI models using WebLLM and transformers.js
//
// Provides zero-install LLM inference (WebGPU) and Whisper transcription (WASM)
// Models are downloaded on first use and cached in browser storage.

import { cacheGet, cacheSet, hashInputs } from "./cache";

export type InBrowserLlmConfig = {
  model: "qwen2.5-0.5b" | "qwen2.5-1.5b" | "llama-3-8b" | "gemma-2-2b";
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
};

export type InBrowserTranscribeConfig = {
  model: "whisper-tiny" | "whisper-base" | "whisper-small";
  language?: string;
};

export type InBrowserEmbedConfig = {
  model: "nomic-embed-text-v1.5";
};

let webllmEngine: any = null;
let whisperPipeline: any = null;
let embedPipeline: any = null;
let initPromise: Promise<void> | null = null;
let initStatus: "idle" | "loading" | "ready" | "error" = "idle";
let initProgress = 0;
let initError: string | null = null;

function getModelId(config: InBrowserLlmConfig): string {
  const map: Record<string, string> = {
    "qwen2.5-0.5b": "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "qwen2.5-1.5b": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "llama-3-8b": "Llama-3-8B-Instruct-q4f16_1-MLC",
    "gemma-2-2b": "gemma-2-2b-it-q4f16_1-MLC",
  };
  return map[config.model] || map["qwen2.5-0.5b"];
}

function getWhisperModelId(config: InBrowserTranscribeConfig): string {
  const map: Record<string, string> = {
    "whisper-tiny": "Xenova/whisper-tiny.en",
    "whisper-base": "Xenova/whisper-base.en",
    "whisper-small": "Xenova/whisper-small.en",
  };
  return map[config.model] || map["whisper-tiny"];
}

export async function initInBrowserAI(
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  if (initStatus === "ready") return;
  if (initStatus === "loading") return initPromise!;
  
  initStatus = "loading";
  initProgress = 0;
  initError = null;
  
  initPromise = (async () => {
    try {
      // Check WebGPU support
      if (!(navigator as any).gpu) {
        throw new Error("WebGPU not supported in this browser. Use Chrome/Edge with WebGPU enabled.");
      }
      
      onProgress?.(0.1, "Loading WebLLM engine...");
      
      // Dynamic import to avoid SSR issues
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      
      // We'll initialize the actual engine on first chat call
      // This just verifies WebGPU works
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (!adapter) {
        throw new Error("Failed to get WebGPU adapter");
      }
      const device = await adapter.requestDevice();
      device.destroy();
      
      onProgress?.(0.3, "WebGPU ready");
      initStatus = "ready";
    } catch (e) {
      initStatus = "error";
      initError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  })();
  
  return initPromise;
}

export async function chatInBrowser(
  config: InBrowserLlmConfig,
  system: string,
  user: string,
  opts: { temperature?: number; top_p?: number; max_tokens?: number } = {}
): Promise<string> {
  if (initStatus !== "ready") {
    await initInBrowserAI();
  }
  
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  const modelId = getModelId(config);
  
  // Cache key for model loading
  const cacheKey = await hashInputs(["webllm", modelId]);
  const cachedEngine = await cacheGet<any>("chat", cacheKey);
  
  if (!webllmEngine) {
    if (cachedEngine) {
      webllmEngine = cachedEngine;
    } else {
      webllmEngine = await CreateMLCEngine(modelId, {
        initProgressCallback: (report: any) => {
          if (report.text) {
            console.log(`[WebLLM] ${report.text}`);
          }
        },
      });
      await cacheSet("chat", cacheKey, webllmEngine, { model: modelId });
    }
  }
  
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  
  const reply = await webllmEngine.chat.completions.create({
    messages,
    temperature: opts.temperature ?? config.temperature ?? 0.7,
    top_p: opts.top_p ?? config.top_p ?? 0.95,
    max_tokens: opts.max_tokens ?? config.max_tokens ?? 4096,
    stream: false,
  });
  
  return reply.choices[0]?.message?.content ?? "";
}

export async function transcribeInBrowser(
  audio: Blob,
  config: InBrowserTranscribeConfig
): Promise<string> {
  if (!whisperPipeline) {
    const { pipeline } = await import("@huggingface/transformers");
    const modelId = getWhisperModelId(config);
    
    whisperPipeline = await pipeline("automatic-speech-recognition", modelId, {
      dtype: "q4",
      device: "webgpu",
      progress_callback: (progress: any) => {
        if (progress.status === "downloading") {
          console.log(`[Whisper] Downloading: ${Math.round(progress.progress * 100)}%`);
        }
      },
    });
  }
  
  // Convert blob to array buffer
  const arrayBuffer = await audio.arrayBuffer();
  const audioData = new Float32Array(arrayBuffer);
  
  // Normalize to 16kHz mono if needed
  // Note: In production, use @huggingface/transformers audio processing
  const result = await whisperPipeline(audioData, {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: config.language || "en",
    return_timestamps: false,
  });
  
  return result.text?.trim() || "";
}

export async function embedInBrowser(
  texts: string[],
  config: InBrowserEmbedConfig
): Promise<number[][]> {
  if (!embedPipeline) {
    const { pipeline } = await import("@huggingface/transformers");
    
    embedPipeline = await pipeline("feature-extraction", "Xenova/nomic-embed-text-v1.5", {
      dtype: "q4",
      device: "webgpu",
    });
  }
  
  const outputs = await embedPipeline(texts, {
    pooling: "mean",
    normalize: true,
  });
  
  // Convert to plain arrays
  return Array.from({ length: texts.length }, (_, i) => 
    Array.from(outputs[i].data) as number[]
  );
}

export function getInitStatus(): { status: typeof initStatus; progress: number; error: string | null } {
  return { status: initStatus, progress: initProgress, error: initError };
}

export function resetInit() {
  webllmEngine = null;
  whisperPipeline = null;
  embedPipeline = null;
  initPromise = null;
  initStatus = "idle";
  initProgress = 0;
  initError = null;
}
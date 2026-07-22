// Browser-side adapter for local Whisper transcription servers.
//
// Two backends supported behind one call:
//   - faster-whisper-server  (OpenAI-compatible /v1/audio/transcriptions)
//   - whisper.cpp HTTP       (/inference, slightly different form fields)
//   - in-browser (transformers.js + WebGPU)
//
// Caller passes the audio Blob and config; we POST directly from the
// browser. Zero cloud roundtrip.

export type LocalWhisperConfig = {
  baseUrl: string;
  backend: "faster-whisper" | "whisper.cpp" | "auto" | "in-browser";
  model?: string; // e.g. "Systran/faster-whisper-base.en" or "base.en"
  language?: string; // ISO-639-1 or omit for auto-detect
};

import { cacheGet, cacheSet, hashBlob, hashInputs } from "./cache";
import { transcribeInBrowser, initInBrowserAI } from "./in-browser-ai";

export async function transcribeLocal(audio: Blob, filename: string, config: LocalWhisperConfig): Promise<string> {
  // In-browser transcription (transformers.js)
  if (config.backend === "in-browser" || config.baseUrl === "in-browser") {
    const inBrowserConfig = {
      model: (config.model as "whisper-tiny" | "whisper-base" | "whisper-small") || "whisper-tiny",
      language: config.language,
    };
    return transcribeInBrowser(audio, inBrowserConfig);
  }
  
  const base = config.baseUrl.replace(/\/+$/, "");
  // Cache key includes model + language so swapping models invalidates the
  // cached transcript. Audio hash is the heavy part — pure SHA-256 over
  // the bytes; identical re-uploads (same recording, retried after a
  // tweak) skip the Whisper round-trip entirely.
  const [audioHash, paramHash] = await Promise.all([
    hashBlob(audio),
    hashInputs([config.model || "", config.language || "", config.backend || "auto"]),
  ]);
  const key = `${audioHash}:${paramHash}`;
  const cached = await cacheGet<string>("transcribe", key);
  if (cached) return cached;
  const backend = config.backend === "auto" ? await detectBackend(base) : config.backend;
  const text = backend === "whisper.cpp"
    ? await transcribeWhisperCpp(audio, filename, base, config)
    : await transcribeFasterWhisper(audio, filename, base, config);
  if (text.trim()) {
    await cacheSet("transcribe", key, text, { filename, bytes: audio.size, model: config.model });
  }
  return text;
}

async function detectBackend(base: string): Promise<"faster-whisper" | "whisper.cpp"> {
  try {
    const r = await fetch(`${base}/v1/models`, { method: "GET" });
    if (r.ok) return "faster-whisper";
  } catch { /* fall through */ }
  return "whisper.cpp";
}

async function transcribeFasterWhisper(audio: Blob, filename: string, base: string, config: LocalWhisperConfig): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", config.model || "Systran/faster-whisper-base.en");
  if (config.language) form.append("language", config.language);
  form.append("response_format", "json");
  const res = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Local Whisper failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

async function transcribeWhisperCpp(audio: Blob, filename: string, base: string, config: LocalWhisperConfig): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("temperature", "0.0");
  form.append("response_format", "json");
  if (config.language) form.append("language", config.language);
  const res = await fetch(`${base}/inference`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`whisper.cpp failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

export async function pingLocalWhisper(config: LocalWhisperConfig): Promise<{ ok: boolean; message: string }> {
  const base = config.baseUrl.replace(/\/+$/, "");
  try {
    if (config.backend === "whisper.cpp") {
      const r = await fetch(`${base}/`, { method: "GET" });
      return { ok: r.ok, message: r.ok ? "Connected" : `HTTP ${r.status}` };
    }
    const r = await fetch(`${base}/v1/models`);
    if (!r.ok) return { ok: false, message: `HTTP ${r.status}` };
    const j = (await r.json()) as { data?: { id?: string }[] };
    const ids = (j.data ?? []).map((m) => m.id).filter(Boolean);
    return { ok: true, message: `Connected. ${ids.length} model${ids.length === 1 ? "" : "s"} available.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

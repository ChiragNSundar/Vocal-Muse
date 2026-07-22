// Fully-local persistence layer.
//
// Two backends behind one API:
//   - IndexedDB  → structured records (tracks, bars, takes, style memory refs)
//   - OPFS       → binary blobs (audio takes, mixdowns) so we don't blow the
//                  IDB size guidance for large media.
//
// Everything here runs 100% in the browser. No server, no Supabase, no
// network. Callers pick this store when the user is in "local-only" mode
// (Settings → Fully local), or as a mirror alongside cloud sync so the app
// keeps working offline and survives a Lovable Cloud outage.
//
// Bundle export/import roundtrips everything to a single .json (with audio
// inlined as base64) so the user can back up or move between machines.

import { cacheGet, cacheSet, hashInputs } from "./cache";
import { runLocalPipeline, type LocalPipelineResult, type LocalLyrics, type LocalCadence, type LocalQuality, type LocalBrief } from "./local-pipeline";
import { loadLlmConfig } from "./llm-config";

const DB_NAME = "voxscript-local";
const DB_VERSION = 1;
const STORES = ["tracks", "bars", "takes", "meta"] as const;
type Store = (typeof STORES)[number];

// Re-export types from local-pipeline for convenience
export type { LocalPipelineResult, LocalLyrics, LocalCadence, LocalQuality, LocalBrief };

export type LocalTrack = {
  id: string;
  deviceId: string;
  title: string;
  status: "draft" | "recording" | "done" | "error";
  bpm?: number;
  beatsPerBar?: number;
  createdAt: number;
  updatedAt: number;
  transcript?: string;
  briefJson?: string;
  audioKey?: string; // OPFS path
  lyrics?: string; // JSON stringified LocalLyrics
  cadenceMap?: string; // JSON stringified LocalCadence
  quality?: string; // JSON stringified LocalQuality
  styleBrief?: string; // JSON stringified StyleBrief
  error?: string;
};

export type LocalBar = {
  id: string; // `${trackId}:${index}`
  trackId: string;
  index: number;
  transcript?: string;
  line?: string;
  syllables?: number;
  endSound?: string;
  audioKey?: string;
  createdAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tracks")) {
        const s = db.createObjectStore("tracks", { keyPath: "id" });
        s.createIndex("deviceId", "deviceId");
        s.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("bars")) {
        const s = db.createObjectStore("bars", { keyPath: "id" });
        s.createIndex("trackId", "trackId");
      }
      if (!db.objectStoreNames.contains("takes")) {
        db.createObjectStore("takes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(name: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openDb().then((db) =>
    new Promise<T>((resolve, reject) => {
      const t = db.transaction(name, mode);
      const store = t.objectStore(name);
      Promise.resolve(fn(store)).then(
        (v) => { t.oncomplete = () => resolve(v); },
        (e) => { t.abort(); reject(e); },
      );
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }),
  );
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

// ---------- Tracks ----------

export async function putTrack(t: LocalTrack): Promise<void> {
  await tx("tracks", "readwrite", (s) => req(s.put({ ...t, updatedAt: Date.now() })));
}

export async function getTrack(id: string): Promise<LocalTrack | null> {
  try { return (await tx("tracks", "readonly", (s) => req(s.get(id) as IDBRequest<LocalTrack>))) ?? null; }
  catch { return null; }
}

export async function listTracks(deviceId?: string): Promise<LocalTrack[]> {
  const all = await tx<LocalTrack[]>("tracks", "readonly", (s) => req(s.getAll() as IDBRequest<LocalTrack[]>));
  const filtered = deviceId ? all.filter((t) => t.deviceId === deviceId) : all;
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteTrack(id: string): Promise<void> {
  const bars = await barsForTrack(id);
  await Promise.all(bars.map((b) => b.audioKey ? deleteBlob(b.audioKey) : Promise.resolve()));
  const track = await getTrack(id);
  if (track?.audioKey) await deleteBlob(track.audioKey);
  await tx("tracks", "readwrite", (s) => req(s.delete(id)));
  await tx("bars", "readwrite", (s) => new Promise<void>((resolve, reject) => {
    const idx = s.index("trackId");
    const cur = idx.openCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => { const c = cur.result; if (!c) return resolve(); c.delete(); c.continue(); };
    cur.onerror = () => reject(cur.error);
  }));
}

// ---------- Bars ----------

export async function putBar(b: LocalBar): Promise<void> {
  await tx("bars", "readwrite", (s) => req(s.put(b)));
}

export async function putBars(bars: LocalBar[]): Promise<void> {
  await tx("bars", "readwrite", async (s) => { for (const b of bars) await req(s.put(b)); });
}

export async function barsForTrack(trackId: string): Promise<LocalBar[]> {
  const all = await tx<LocalBar[]>("bars", "readonly", (s) =>
    req(s.index("trackId").getAll(IDBKeyRange.only(trackId)) as IDBRequest<LocalBar[]>),
  );
  return all.sort((a, b) => a.index - b.index);
}

// ---------- OPFS blob storage ----------

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {

    const root = await navigator.storage?.getDirectory?.();
    return root ?? null;
  } catch { return null; }
}

async function opfsDir(name: string): Promise<FileSystemDirectoryHandle | null> {
  const root = await opfsRoot();
  if (!root) return null;
  return root.getDirectoryHandle(name, { create: true });
}

/** Save a Blob to OPFS. Returns the storage key (path) to persist alongside the record. */
export async function putBlob(key: string, blob: Blob): Promise<string> {
  const dir = await opfsDir("audio");
  if (!dir) {
    // Fallback: stash into IDB `takes` store as base64 so we still work
    // in browsers without OPFS (older Safari, Firefox private windows).
    const buf = await blob.arrayBuffer();
    await tx("takes", "readwrite", (s) => req(s.put({ id: key, bytes: buf, type: blob.type })));
    return `idb:${key}`;
  }
  const fh = await dir.getFileHandle(key.replace(/[/\\]/g, "_"), { create: true });

  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return `opfs:${key}`;
}

export async function getBlob(storageKey: string): Promise<Blob | null> {
  if (storageKey.startsWith("idb:")) {
    const id = storageKey.slice(4);
    const rec = await tx<{ bytes: ArrayBuffer; type: string } | undefined>(
      "takes", "readonly", (s) => req(s.get(id) as IDBRequest<{ bytes: ArrayBuffer; type: string } | undefined>),
    );
    if (!rec) return null;
    return new Blob([rec.bytes], { type: rec.type });
  }
  if (!storageKey.startsWith("opfs:")) return null;
  const key = storageKey.slice(5);
  const dir = await opfsDir("audio");
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(key.replace(/[/\\]/g, "_"));
    return await fh.getFile();
  } catch { return null; }
}

export async function deleteBlob(storageKey: string): Promise<void> {
  if (storageKey.startsWith("idb:")) {
    const id = storageKey.slice(4);
    await tx("takes", "readwrite", (s) => req(s.delete(id))).catch(() => {});
    return;
  }
  if (!storageKey.startsWith("opfs:")) return;
  const dir = await opfsDir("audio");
  if (!dir) return;
  try { await dir.removeEntry(storageKey.slice(5).replace(/[/\\]/g, "_")); } catch { /* ignore */ }
}

// ---------- Estimated usage + settings ----------

export type StorageEstimate = { usedBytes: number; quotaBytes: number };

export async function estimateStorage(): Promise<StorageEstimate> {
  try {

    const est = await navigator.storage?.estimate?.();
    return { usedBytes: est?.usage ?? 0, quotaBytes: est?.quota ?? 0 };
  } catch { return { usedBytes: 0, quotaBytes: 0 }; }
}

const LOCAL_ONLY_KEY = "voxscript:local-only";

export function isLocalOnly(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(LOCAL_ONLY_KEY) !== "0";
}

export function setLocalOnly(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (enabled) localStorage.setItem(LOCAL_ONLY_KEY, "1");
  else localStorage.removeItem(LOCAL_ONLY_KEY);
}

// ---------- Bundle export / import ----------

export type Bundle = {
  version: 1;
  exportedAt: number;
  tracks: LocalTrack[];
  bars: LocalBar[];
  /** audioKey → base64 wav bytes */
  audio: Record<string, { type: string; base64: string }>;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

export async function exportBundle(deviceId?: string): Promise<Bundle> {
  const tracks = await listTracks(deviceId);
  const bars: LocalBar[] = [];
  for (const t of tracks) bars.push(...await barsForTrack(t.id));
  const audio: Bundle["audio"] = {};
  const keys = new Set<string>();
  for (const t of tracks) if (t.audioKey) keys.add(t.audioKey);
  for (const b of bars) if (b.audioKey) keys.add(b.audioKey);
  for (const k of keys) {
    const blob = await getBlob(k);
    if (blob) audio[k] = { type: blob.type || "audio/wav", base64: await blobToBase64(blob) };
  }
  return { version: 1, exportedAt: Date.now(), tracks, bars, audio };
}

export async function importBundle(bundle: Bundle, opts: { overwrite?: boolean } = {}): Promise<{ tracks: number; bars: number; audio: number }> {
  if (bundle.version !== 1) throw new Error(`Unsupported bundle version: ${bundle.version}`);
  for (const [key, item] of Object.entries(bundle.audio)) {
    const existing = opts.overwrite ? null : await getBlob(key);
    if (!existing) await putBlob(key.replace(/^(opfs|idb):/, ""), base64ToBlob(item.base64, item.type));
  }
  for (const t of bundle.tracks) {
    const existing = opts.overwrite ? null : await getTrack(t.id);
    if (!existing) await putTrack(t);
  }
  await putBars(bundle.bars);
  return { tracks: bundle.tracks.length, bars: bundle.bars.length, audio: Object.keys(bundle.audio).length };
}

export async function downloadBundle(deviceId?: string): Promise<void> {
  const bundle = await exportBundle(deviceId);
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `voxscript-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Re-export getDeviceId from device-id for local mode
export { getDeviceId } from "./device-id";

// Re-export runLocalPipeline and types from local-pipeline
export { runLocalPipeline } from "./local-pipeline";

// Re-export loadLlmConfig
export { loadLlmConfig } from "./llm-config";

// Re-export transcribeLocal
export { transcribeLocal } from "./local-transcribe";

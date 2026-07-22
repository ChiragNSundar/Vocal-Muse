// IndexedDB-backed cache for expensive AI work.
//
// What we cache (all keyed by a stable SHA-256 over the *inputs that affect
// the output*, so a one-byte change misses the cache):
//
//   - transcribe   audio Blob → text  (local Whisper only; cloud upload is
//                  server-side, we can't observe the bytes after upload).
//   - chat         (model, system, user, sampling) → assistant text
//                  (every local LLM round-trip — cadence, write, critic,
//                  refine, format-repair, training).
//   - pipeline     (model, transcript, brief, profile) → full result
//                  (top-level shortcut when the user re-runs an identical
//                  input — common during training and during settings
//                  tweaks).
//
// Why IndexedDB instead of localStorage:
//   - 5 MB localStorage quota is blown by ~10 transcripts of a normal verse
//   - localStorage is synchronous and would jank the writing UI
//   - IDB gives us per-namespace stores and atomic counts
//
// Eviction is LRU by `accessedAt`, capped per-namespace. TTL is soft —
// expired entries are skipped on read and pruned on the next write.

const DB_NAME = "voxscript-cache";
const DB_VERSION = 2;
const STORES = ["transcribe", "chat", "pipeline", "embeddings"] as const;
export type CacheNamespace = (typeof STORES)[number];

// Sensible caps — each entry is a few KB of text except `transcribe` which
// is the raw transcript. 500 entries × ~2 KB ≈ 1 MB per store, well under
// any browser quota.
const LIMITS: Record<CacheNamespace, { maxEntries: number; ttlMs: number }> = {
  transcribe: { maxEntries: 300, ttlMs: 1000 * 60 * 60 * 24 * 30 }, // 30d
  chat: { maxEntries: 1500, ttlMs: 1000 * 60 * 60 * 24 * 7 }, //  7d
  pipeline: { maxEntries: 200, ttlMs: 1000 * 60 * 60 * 24 * 14 }, // 14d
  // Embeddings are deterministic per (model, text); cache aggressively.
  embeddings: { maxEntries: 5000, ttlMs: 1000 * 60 * 60 * 24 * 60 }, // 60d
};

type CacheRecord<T> = {
  key: string;
  value: T;
  bytes: number;
  createdAt: number;
  accessedAt: number;
  hits: number;
  meta?: Record<string, unknown>;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "key" });
          store.createIndex("accessedAt", "accessedAt");
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(ns: CacheNamespace, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(ns, mode);
        const store = t.objectStore(ns);
        Promise.resolve(fn(store)).then(
          (value) => { t.oncomplete = () => resolve(value); },
          (err) => { t.abort(); reject(err); },
        );
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

// ---------------------------------------------------------------------------
// Hashing — stable JSON serialization + SHA-256
// ---------------------------------------------------------------------------

/** JSON.stringify with sorted keys so {a,b} and {b,a} hash to the same value. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!subtle) {
    // Non-secure context fallback (rare). Use a fast 64-bit FNV-ish hash —
    // good enough for cache keys, not for crypto.
    const s = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
    let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }
  const buf = typeof data === "string" ? new TextEncoder().encode(data).buffer : (data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
  const digest = await subtle.digest("SHA-256", buf as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashInputs(parts: unknown[]): Promise<string> {
  return sha256Hex(stableStringify(parts));
}

export async function hashBlob(blob: Blob): Promise<string> {
  // Hashing the whole audio is O(n) but the user is already waiting on
  // transcription — this is a tiny fraction of that cost.
  const buf = await blob.arrayBuffer();
  return sha256Hex(new Uint8Array(buf));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function cacheGet<T>(ns: CacheNamespace, key: string): Promise<T | null> {
  try {
    const rec = await tx<CacheRecord<T> | undefined>(ns, "readonly", (s) => reqPromise(s.get(key) as IDBRequest<CacheRecord<T> | undefined>));
    if (!rec) return null;
    const { ttlMs } = LIMITS[ns];
    if (Date.now() - rec.createdAt > ttlMs) return null;
    // Best-effort LRU bookkeeping — fire-and-forget so reads stay fast.
    void tx(ns, "readwrite", (s) => reqPromise(s.put({ ...rec, accessedAt: Date.now(), hits: rec.hits + 1 }))).catch(() => {});
    return rec.value;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(ns: CacheNamespace, key: string, value: T, meta?: Record<string, unknown>): Promise<void> {
  try {
    const bytes = approxBytes(value);
    const now = Date.now();
    const rec: CacheRecord<T> = { key, value, bytes, createdAt: now, accessedAt: now, hits: 0, meta };
    await tx(ns, "readwrite", (s) => reqPromise(s.put(rec)));
    void enforceLimit(ns);
  } catch {
    /* swallow — caching is best-effort */
  }
}

/** Convenience wrapper. Returns a cached value or computes + stores it. */
export async function withCache<T>(
  ns: CacheNamespace,
  key: string,
  compute: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<{ value: T; fromCache: boolean }> {
  const hit = await cacheGet<T>(ns, key);
  if (hit !== null) return { value: hit, fromCache: true };
  const value = await compute();
  await cacheSet(ns, key, value, meta);
  return { value, fromCache: false };
}

export type CacheStats = {
  namespace: CacheNamespace;
  entries: number;
  bytes: number;
  hits: number;
  oldest?: number;
  newest?: number;
};

export async function cacheStats(): Promise<CacheStats[]> {
  const out: CacheStats[] = [];
  for (const ns of STORES) {
    try {
      const all = await tx<CacheRecord<unknown>[]>(ns, "readonly", (s) => reqPromise(s.getAll() as IDBRequest<CacheRecord<unknown>[]>));
      out.push({
        namespace: ns,
        entries: all.length,
        bytes: all.reduce((sum, r) => sum + (r.bytes || 0), 0),
        hits: all.reduce((sum, r) => sum + (r.hits || 0), 0),
        oldest: all.reduce((min, r) => Math.min(min, r.createdAt), Number.POSITIVE_INFINITY) || undefined,
        newest: all.reduce((max, r) => Math.max(max, r.createdAt), 0) || undefined,
      });
    } catch {
      out.push({ namespace: ns, entries: 0, bytes: 0, hits: 0 });
    }
  }
  return out;
}

export async function clearCache(ns?: CacheNamespace): Promise<void> {
  const targets = ns ? [ns] : [...STORES];
  for (const n of targets) {
    try { await tx(n, "readwrite", (s) => reqPromise(s.clear())); } catch { /* ignore */ }
  }
}

async function enforceLimit(ns: CacheNamespace): Promise<void> {
  const { maxEntries } = LIMITS[ns];
  try {
    const count = await tx<number>(ns, "readonly", (s) => reqPromise(s.count()));
    if (count <= maxEntries) return;
    const overflow = count - maxEntries;
    // Walk the accessedAt index oldest-first and delete `overflow` entries.
    await tx(ns, "readwrite", (s) => new Promise<void>((resolve, reject) => {
      const cursorReq = s.index("accessedAt").openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= overflow) { resolve(); return; }
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    }));
  } catch { /* ignore */ }
}

function approxBytes(value: unknown): number {
  try {
    if (typeof value === "string") return value.length * 2; // UTF-16 in JS
    return stableStringify(value).length * 2;
  } catch { return 0; }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

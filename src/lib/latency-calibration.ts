// Audio round-trip latency calibration.
//
// Plays a short series of clicks through WebAudio and simultaneously records
// the mic. By comparing each click's scheduled AudioContext time to when its
// peak energy actually shows up in the captured PCM, we estimate the
// round-trip output→speaker→mic→input latency in milliseconds.
//
// The result is fed into LiveCapture so bar PCM windows line up with the
// clicks the artist actually performed against — without it, the first
// ~30–150ms of every bar is the previous bar's tail.

export type LatencyResult = {
  /** Median measured round-trip latency in ms. */
  latencyMs: number;
  /** Per-click measurements (ms), for UI display. */
  samples: number[];
  /** Mean absolute deviation around the median — lower is tighter. */
  jitterMs: number;
  /** How many of the scheduled clicks were located in the recording. */
  detectedClicks: number;
  /** How many clicks were scheduled. */
  expectedClicks: number;
  /** 0..1 confidence the latency estimate is trustworthy. */
  confidence: number;
};

export const MIN_CONFIDENCE = 0.7;

const LS_KEY = "voxscript:live-latency-ms";

export function loadCalibratedLatencyMs(): number {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (!v) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n < 800 ? n : 0;
  } catch { return 0; }
}

export function saveCalibratedLatencyMs(ms: number): void {
  try { localStorage.setItem(LS_KEY, String(Math.round(ms))); } catch { /* ignore */ }
}

export function clearCalibratedLatencyMs(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

export type CalibrateOpts = {
  clicks?: number;        // default 6
  spacingMs?: number;     // default 500
  onProgress?: (done: number, total: number) => void;
};

export async function measureMicLatencyMs(opts: CalibrateOpts = {}): Promise<LatencyResult> {
  const clicks = opts.clicks ?? 6;
  const spacing = opts.spacingMs ?? 500;

  const stream = await navigator.mediaDevices.getUserMedia({
    // Disable processing so the click bleed isn't suppressed.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Audio is not supported in this browser.");
  }
  const ctx = new Ctor();
  const sr = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(1024, 1, 1);
  const muted = ctx.createGain(); muted.gain.value = 0;

  const chunks: Float32Array[] = [];
  let baseTime = -1; // AudioContext time of the first captured sample.

  processor.onaudioprocess = (e) => {
    if (baseTime < 0) baseTime = e.playbackTime;
    const buf = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(buf.length);
    copy.set(buf);
    chunks.push(copy);
  };
  source.connect(processor);
  processor.connect(muted);
  muted.connect(ctx.destination);

  // Loud, sharp transient → easy to detect over room noise.
  const outGain = ctx.createGain();
  outGain.gain.value = 0.9;
  outGain.connect(ctx.destination);

  const startCtx = ctx.currentTime + 0.4;
  const scheduledTimes: number[] = [];
  for (let i = 0; i < clicks; i++) {
    const when = startCtx + i * (spacing / 1000);
    scheduledTimes.push(when);
    scheduleClick(ctx, outGain, when);
  }

  // Wait until the last click + tail has been captured.
  const totalMs = (startCtx - ctx.currentTime) * 1000 + clicks * spacing + 400;
  const tickEvery = 80;
  for (let waited = 0; waited < totalMs; waited += tickEvery) {
    opts.onProgress?.(Math.min(clicks, Math.floor(waited / spacing)), clicks);
    await new Promise((r) => setTimeout(r, tickEvery));
  }
  opts.onProgress?.(clicks, clicks);

  processor.disconnect();
  source.disconnect();
  outGain.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close().catch(() => undefined);

  if (baseTime < 0) throw new Error("No audio captured. Check your microphone.");

  const pcm = mergeChunks(chunks);
  const peaks = detectPeaks(pcm, sr);
  if (peaks.length < Math.max(3, Math.floor(clicks / 2))) {
    throw new Error("Couldn't hear the click. Increase output volume or unmute speakers, then retry.");
  }

  const samples: number[] = [];
  for (const scheduled of scheduledTimes) {
    const expectedSample = Math.round((scheduled - baseTime) * sr);
    // Find peak closest to expected (within ±spacing/2).
    let best = -1; let bestDist = Infinity;
    for (const p of peaks) {
      const d = Math.abs(p - expectedSample);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    if (best < 0) continue;
    const measuredMs = ((best / sr) - (scheduled - baseTime)) * 1000;
    if (measuredMs > -50 && measuredMs < 600) samples.push(measuredMs);
  }
  if (samples.length < 3) throw new Error("Calibration was inconsistent. Try again in a quieter spot.");

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const jitter = samples.reduce((s, v) => s + Math.abs(v - median), 0) / samples.length;
  const detectionRatio = samples.length / clicks;
  // Confidence: blend of detection coverage and tightness (≤10ms jitter → 1, ≥80ms → 0).
  const jitterScore = Math.max(0, Math.min(1, (80 - jitter) / 70));
  const confidence = Math.max(0, Math.min(1, 0.55 * detectionRatio + 0.45 * jitterScore));
  return {
    latencyMs: Math.max(0, Math.round(median)),
    samples,
    jitterMs: Math.round(jitter),
    detectedClicks: samples.length,
    expectedClicks: clicks,
    confidence,
  };
}

/**
 * Run calibration up to `maxAttempts` times, returning the first result whose
 * confidence ≥ MIN_CONFIDENCE. If none qualify, returns the best attempt so
 * the caller can show the score and let the user decide whether to keep it.
 */
export async function calibrateWithRetry(opts: CalibrateOpts & {
  maxAttempts?: number;
  minConfidence?: number;
  onAttempt?: (attempt: number, total: number) => void;
} = {}): Promise<{ result: LatencyResult; attempts: number; acceptable: boolean }> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const threshold = opts.minConfidence ?? MIN_CONFIDENCE;
  let best: LatencyResult | null = null;
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    opts.onAttempt?.(i + 1, maxAttempts);
    try {
      const r = await measureMicLatencyMs(opts);
      if (!best || r.confidence > best.confidence) best = r;
      if (r.confidence >= threshold) return { result: r, attempts, acceptable: true };
    } catch (e) {
      if (i === maxAttempts - 1 && !best) throw e;
    }
    // Small pause between attempts to let mic AGC settle.
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!best) throw new Error("Calibration failed.");
  return { result: best, attempts, acceptable: best.confidence >= threshold };
}

function scheduleClick(ctx: AudioContext, out: GainNode, when: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.value = 1500;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.9, when + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  osc.connect(env);
  env.connect(out);
  osc.start(when);
  osc.stop(when + 0.05);
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function detectPeaks(pcm: Float32Array, sr: number): number[] {
  const winSamples = Math.round(sr * 0.01); // 10ms windows
  const energies: number[] = [];
  for (let i = 0; i < pcm.length; i += winSamples) {
    let s = 0;
    const end = Math.min(pcm.length, i + winSamples);
    for (let j = i; j < end; j++) s += pcm[j] * pcm[j];
    energies.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  let max = 0;
  for (const e of energies) if (e > max) max = e;
  const thr = Math.max(0.015, max * 0.4);
  const refractoryWins = Math.round(0.2 / 0.01); // 200ms refractory
  const peaks: number[] = [];
  for (let k = 1; k < energies.length - 1; k++) {
    if (
      energies[k] >= thr &&
      energies[k] >= energies[k - 1] &&
      energies[k] >= energies[k + 1] &&
      (peaks.length === 0 || k - (peaks[peaks.length - 1] / winSamples) > refractoryWins)
    ) {
      peaks.push(k * winSamples);
    }
  }
  return peaks;
}

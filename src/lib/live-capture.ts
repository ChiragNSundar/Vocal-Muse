// Live punch-in capture engine.
//
// Mounts the mic via WebAudio, drives a WebAudio metronome locked to BPM,
// and slices the rolling PCM buffer on bar boundaries (BPM + beats-per-bar
// + first downbeat). Each finished bar window is encoded as a complete WAV
// (via src/lib/wav.ts) and handed to `onBar` — never MediaRecorder
// fragments, which fail STT after the first slice.
//
// Pure event-emitting class; no React. Route components own the UI state.

import { encodeWav, rms } from "./wav";

export type LiveCaptureOpts = {
  bpm: number;
  beatsPerBar: number; // 2 / 3 / 4 / 6 / 8
  click: boolean;
  /**
   * Measured round-trip mic latency (ms). The first PCM samples are
   * discarded so that bar windows align with the clicks the artist
   * actually heard. Run the calibration step in /live to obtain it.
   */
  inputLatencyMs?: number;
  /** Called once per finalized bar window. */
  onBar: (bar: {
    index: number;
    blob: Blob;
    pcm: Float32Array;
    sampleRate: number;
    rmsLevel: number;
    startedAt: number; // performance.now()
    durationMs: number;
  }) => void;
  /** Live VU level (0..1) emitted ~30Hz for the UI. */
  onLevel?: (level: number) => void;
  /** Beat tick — for UI flashing the click. */
  onBeat?: (beatInBar: number, barIndex: number) => void;
};

type State = {
  ctx: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  click: GainNode | null;
  pcmBuf: Float32Array[];
  pcmSamples: number;
  barIndex: number;
  startedAt: number;
  beatTimer: number | null;
  beatCount: number;
  levelTimer: number | null;
  level: number;
};

export class LiveCapture {
  private state: State | null = null;
  constructor(private opts: LiveCaptureOpts) {}

  get isRunning() { return !!this.state; }

  async start() {
    if (this.state) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Audio recording is not supported in this browser.");
    }
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    const muted = ctx.createGain();
    muted.gain.value = 0;

    const sr = ctx.sampleRate;
    const samplesPerBar = Math.round((this.opts.beatsPerBar * 60 / this.opts.bpm) * sr);
    // Lead-in (100ms — matches the ctx.currentTime + 0.1 schedule below)
    // plus measured mic latency. Drop that many PCM samples before bar 0
    // so each bar window contains the audio the artist performed against
    // the corresponding click, not the silence before count-in.
    const leadInMs = 100;
    let skipRemaining = Math.max(0, Math.round(((leadInMs + (this.opts.inputLatencyMs ?? 0)) / 1000) * sr));

    const state: State = {
      ctx, stream, source, processor,
      click: this.opts.click ? ctx.createGain() : null,
      pcmBuf: [], pcmSamples: 0, barIndex: 0,
      startedAt: performance.now(),
      beatTimer: null, beatCount: 0,
      levelTimer: null, level: 0,
    };
    if (state.click) {
      state.click.gain.value = 0.4;
      state.click.connect(ctx.destination);
    }

    processor.onaudioprocess = (event) => {
      let input = event.inputBuffer.getChannelData(0);
      if (skipRemaining > 0) {
        if (input.length <= skipRemaining) { skipRemaining -= input.length; return; }
        input = input.subarray(skipRemaining);
        skipRemaining = 0;
      }
      const copy = new Float32Array(input.length);
      copy.set(input);
      state.pcmBuf.push(copy);
      state.pcmSamples += copy.length;
      state.level = rms(copy);

      while (state.pcmSamples >= samplesPerBar) {
        const bar = new Float32Array(samplesPerBar);
        let written = 0;
        while (written < samplesPerBar && state.pcmBuf.length) {
          const head = state.pcmBuf[0];
          const need = samplesPerBar - written;
          if (head.length <= need) {
            bar.set(head, written);
            written += head.length;
            state.pcmBuf.shift();
          } else {
            bar.set(head.subarray(0, need), written);
            state.pcmBuf[0] = head.subarray(need);
            written += need;
          }
        }
        state.pcmSamples -= samplesPerBar;
        const idx = state.barIndex++;
        const blob = encodeWav([bar], sr);
        this.opts.onBar({
          index: idx,
          blob,
          pcm: bar,
          sampleRate: sr,
          rmsLevel: rms(bar),
          startedAt: state.startedAt + (idx * this.opts.beatsPerBar * 60_000 / this.opts.bpm),
          durationMs: this.opts.beatsPerBar * 60_000 / this.opts.bpm,
        });
      }
    };

    source.connect(processor);
    processor.connect(muted);
    muted.connect(ctx.destination);

    // Metronome: schedule clicks ahead with WebAudio for sample-accurate timing.
    const beatMs = 60_000 / this.opts.bpm;
    const startTime = ctx.currentTime + 0.1;
    state.startedAt = performance.now() + 100;
    // schedule first 64 beats; refresh during run
    let scheduledBeats = 0;
    const scheduleAhead = () => {
      while (scheduledBeats < state.beatCount + 64) {
        const when = startTime + scheduledBeats * (beatMs / 1000);
        if (state.click) playClick(ctx, state.click, when, scheduledBeats % this.opts.beatsPerBar === 0);
        scheduledBeats++;
      }
    };
    scheduleAhead();

    state.beatTimer = window.setInterval(() => {
      const b = state.beatCount++;
      this.opts.onBeat?.(b % this.opts.beatsPerBar, Math.floor(b / this.opts.beatsPerBar));
      scheduleAhead();
    }, beatMs);

    state.levelTimer = window.setInterval(() => this.opts.onLevel?.(state.level), 33);

    this.state = state;
  }

  async stop() {
    const s = this.state; if (!s) return;
    this.state = null;
    if (s.beatTimer) clearInterval(s.beatTimer);
    if (s.levelTimer) clearInterval(s.levelTimer);
    s.processor.disconnect();
    s.source.disconnect();
    s.stream.getTracks().forEach((t) => t.stop());
    await s.ctx.close().catch(() => undefined);
  }
}

function playClick(ctx: AudioContext, out: GainNode, when: number, accent: boolean) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1000;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(accent ? 0.6 : 0.35, when + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  osc.connect(env);
  env.connect(out);
  osc.start(when);
  osc.stop(when + 0.06);
}

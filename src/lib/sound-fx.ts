/**
 * Tiny sound-FX sprite system using the Web Audio API.
 *
 * All sounds are synthesized — no external files needed.
 * Call `playFx("bar-generated")` from anywhere.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** User preference key in localStorage */
const PREF_KEY = "voxscript:sound-fx-enabled";

export function isSoundFxEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PREF_KEY) !== "false"; // default ON
}

export function setSoundFxEnabled(on: boolean) {
  localStorage.setItem(PREF_KEY, on ? "true" : "false");
}

type FxName =
  | "bar-generated"
  | "track-saved"
  | "recording-start"
  | "recording-stop"
  | "error"
  | "ingest"
  | "click";

/**
 * Play a sound effect by name.
 * Sounds are tiny synthesized tones — no asset files.
 */
export function playFx(name: FxName) {
  if (!isSoundFxEnabled()) return;
  if (typeof window === "undefined") return;

  try {
    const ac = getCtx();
    switch (name) {
      case "bar-generated":
        playTone(ac, 880, 0.08, "sine", 0.15);
        setTimeout(() => playTone(ac, 1100, 0.06, "sine", 0.12), 80);
        break;
      case "track-saved":
        playTone(ac, 660, 0.1, "sine", 0.18);
        setTimeout(() => playTone(ac, 880, 0.08, "sine", 0.14), 100);
        setTimeout(() => playTone(ac, 1100, 0.06, "sine", 0.10), 200);
        break;
      case "recording-start":
        playTone(ac, 440, 0.06, "square", 0.08);
        setTimeout(() => playTone(ac, 660, 0.04, "square", 0.06), 60);
        break;
      case "recording-stop":
        playTone(ac, 660, 0.06, "square", 0.08);
        setTimeout(() => playTone(ac, 440, 0.04, "square", 0.06), 60);
        break;
      case "error":
        playTone(ac, 200, 0.15, "sawtooth", 0.1);
        break;
      case "ingest":
        playTone(ac, 523, 0.05, "sine", 0.12);
        setTimeout(() => playTone(ac, 659, 0.05, "sine", 0.10), 60);
        setTimeout(() => playTone(ac, 784, 0.04, "sine", 0.08), 120);
        break;
      case "click":
        playTone(ac, 1000, 0.02, "square", 0.05);
        break;
    }
  } catch {
    // Silently ignore audio errors — never crash the UI for sound FX
  }
}

function playTone(
  ac: AudioContext,
  freq: number,
  duration: number,
  type: OscillatorType,
  volume: number,
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration);
}

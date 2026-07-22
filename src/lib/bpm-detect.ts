/**
 * Auto BPM detection using onset-detection with Web Audio API.
 *
 * Analyzes an audio buffer and returns estimated BPM + confidence.
 */

export interface BpmResult {
  bpm: number;
  confidence: number; // 0-1
}

/**
 * Detect the BPM of an audio file (ArrayBuffer).
 * Uses an onset-detection algorithm with autocorrelation.
 */
export async function detectBpm(arrayBuffer: ArrayBuffer): Promise<BpmResult> {
  const audioCtx = new OfflineAudioContext(1, 1, 44100);

  // Decode the audio file
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  // Downsample for speed (target ~11kHz)
  const downsampleFactor = Math.max(1, Math.round(sampleRate / 11025));
  const downsampled = new Float32Array(Math.floor(channelData.length / downsampleFactor));
  for (let i = 0; i < downsampled.length; i++) {
    downsampled[i] = Math.abs(channelData[i * downsampleFactor]);
  }
  const dsRate = sampleRate / downsampleFactor;

  // Compute energy envelope using windowed RMS
  const windowSize = Math.round(dsRate * 0.02); // 20ms windows
  const hopSize = Math.round(windowSize / 2);
  const numFrames = Math.floor((downsampled.length - windowSize) / hopSize);
  const envelope = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    const start = i * hopSize;
    for (let j = start; j < start + windowSize; j++) {
      sum += downsampled[j] * downsampled[j];
    }
    envelope[i] = Math.sqrt(sum / windowSize);
  }

  // Onset detection: first-order difference + half-wave rectification
  const onsets = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) {
    onsets[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  }

  // Autocorrelation of onset signal
  const frameRate = dsRate / hopSize;
  const minBpm = 60;
  const maxBpm = 200;
  const minLag = Math.round(frameRate * 60 / maxBpm);
  const maxLag = Math.round(frameRate * 60 / minBpm);

  let bestLag = minLag;
  let bestCorr = -Infinity;
  const correlations: number[] = [];

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const len = Math.min(onsets.length - lag, onsets.length);
    for (let i = 0; i < len; i++) {
      corr += onsets[i] * onsets[i + lag];
    }
    corr /= len;
    correlations.push(corr);

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = Math.round((frameRate * 60) / bestLag);

  // Confidence: ratio of best peak to mean
  const mean = correlations.reduce((a, b) => a + b, 0) / correlations.length;
  const confidence = mean > 0 ? Math.min(1, bestCorr / (mean * 3)) : 0;

  // Snap to common BPM ranges
  const snapped = snapBpm(bpm);

  return { bpm: snapped, confidence: Math.round(confidence * 100) / 100 };
}

/** Snap BPM to the nearest common tempo if within ±2 BPM */
function snapBpm(bpm: number): number {
  const common = [60, 70, 72, 75, 80, 85, 88, 90, 92, 95, 100, 105, 108, 110, 112, 115, 120, 125, 128, 130, 135, 140, 145, 150, 155, 160, 170, 175, 180];
  for (const c of common) {
    if (Math.abs(bpm - c) <= 2) return c;
  }
  return bpm;
}

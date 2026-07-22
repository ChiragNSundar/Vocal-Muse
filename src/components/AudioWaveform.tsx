import { useEffect, useRef } from "react";

interface AudioWaveformProps {
  /** The MediaStream to visualize. If null, shows a flat line. */
  stream: MediaStream | null;
  /** Whether actively recording — controls color */
  recording?: boolean;
  /** Width and height of the canvas */
  width?: number;
  height?: number;
  /** CSS class for the container */
  className?: string;
}

/**
 * Real-time audio waveform visualizer using Web Audio API AnalyserNode.
 * Renders an oscilloscope-style waveform on a canvas at ~60fps.
 */
export function AudioWaveform({
  stream,
  recording = false,
  width = 600,
  height = 120,
  className = "",
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    // Clean up previous
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
      analyserRef.current = null;
    }

    if (!stream || stream.getAudioTracks().length === 0) {
      // Draw flat line
      drawFlatLine(ctx2d, canvas.width, canvas.height);
      return;
    }

    // Set up audio context + analyser
    const audioCtx = new AudioContext();
    ctxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      if (!analyserRef.current || !ctx2d || !canvas) return;
      animRef.current = requestAnimationFrame(draw);

      analyserRef.current.getByteTimeDomainData(dataArray);

      const w = canvas.width;
      const h = canvas.height;

      ctx2d.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx2d.fillRect(0, 0, w, h);

      ctx2d.lineWidth = 2;
      // Amber when recording, muted when idle
      ctx2d.strokeStyle = recording
        ? "oklch(0.78 0.13 60 / 0.9)"   // primary/amber
        : "oklch(0.68 0.01 90 / 0.4)";  // muted-foreground

      ctx2d.beginPath();

      const sliceWidth = w / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;

        if (i === 0) {
          ctx2d.moveTo(x, y);
        } else {
          ctx2d.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx2d.lineTo(w, h / 2);
      ctx2d.stroke();
    }

    draw();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      audioCtx.close().catch(() => {});
    };
  }, [stream, recording]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`rounded-lg border border-border/50 bg-background/80 ${className}`}
      style={{ width: "100%", height: `${height}px` }}
    />
  );
}

function drawFlatLine(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "oklch(0.68 0.01 90 / 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

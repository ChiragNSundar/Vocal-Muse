import { useEffect, useRef, useState } from "react";

interface MetronomeRingProps {
  /** Beats per minute */
  bpm: number;
  /** Whether the metronome is actively ticking */
  active: boolean;
  /** Number of beats per bar (time signature numerator) */
  beatsPerBar?: number;
  /** Size of the ring in pixels */
  size?: number;
  /** CSS class */
  className?: string;
}

/**
 * Circular metronome ring that pulses on each beat.
 * Shows a progress arc filling per beat, with a flash on downbeats.
 */
export function MetronomeRing({
  bpm,
  active,
  beatsPerBar = 4,
  size = 160,
  className = "",
}: MetronomeRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!active) {
      drawIdle(ctx, size);
      return;
    }

    startTimeRef.current = performance.now();
    const beatMs = 60_000 / bpm;
    const barMs = beatMs * beatsPerBar;

    function draw() {
      if (!ctx || !canvas) return;
      animRef.current = requestAnimationFrame(draw);

      const elapsed = performance.now() - startTimeRef.current;
      const beatProgress = (elapsed % beatMs) / beatMs;
      const barProgress = (elapsed % barMs) / barMs;
      const currentBeat = Math.floor((elapsed % barMs) / beatMs);
      const isDownbeat = currentBeat === 0 && beatProgress < 0.15;

      const cx = size / 2;
      const cy = size / 2;
      const radius = size / 2 - 12;
      const ringWidth = 6;

      // Clear
      ctx.clearRect(0, 0, size, size);

      // Background ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "oklch(0.27 0.007 270)"; // border color
      ctx.lineWidth = ringWidth;
      ctx.stroke();

      // Progress arc (fills per bar)
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + barProgress * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = isDownbeat
        ? "oklch(0.85 0.15 60)"  // bright flash on downbeat
        : "oklch(0.78 0.13 60 / 0.8)"; // primary amber
      ctx.lineWidth = ringWidth;
      ctx.lineCap = "round";
      ctx.stroke();

      // Beat dot at the tip
      const dotX = cx + Math.cos(endAngle) * radius;
      const dotY = cy + Math.sin(endAngle) * radius;
      ctx.beginPath();
      ctx.arc(dotX, dotY, ringWidth / 2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = isDownbeat ? "oklch(0.9 0.15 60)" : "oklch(0.78 0.13 60)";
      ctx.fill();

      // Beat indicators (small dots around the ring)
      for (let i = 0; i < beatsPerBar; i++) {
        const angle = startAngle + (i / beatsPerBar) * Math.PI * 2;
        const bx = cx + Math.cos(angle) * (radius - 16);
        const by = cy + Math.sin(angle) * (radius - 16);
        ctx.beginPath();
        ctx.arc(bx, by, i === currentBeat ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = i === currentBeat
          ? "oklch(0.78 0.13 60)"
          : i < currentBeat
            ? "oklch(0.78 0.13 60 / 0.4)"
            : "oklch(0.27 0.007 270)";
        ctx.fill();
      }

      // Center text: current beat
      ctx.fillStyle = "oklch(0.96 0.005 90)";
      ctx.font = `bold ${size * 0.22}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${currentBeat + 1}`, cx, cy - 6);

      // Sub-label
      ctx.fillStyle = "oklch(0.68 0.01 90)";
      ctx.font = `${size * 0.08}px "Inter", sans-serif`;
      ctx.fillText(`of ${beatsPerBar}`, cx, cy + size * 0.12);
    }

    draw();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [active, bpm, beatsPerBar, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}

function drawIdle(ctx: CanvasRenderingContext2D, size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 12;

  ctx.clearRect(0, 0, size, size);

  // Dim ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "oklch(0.27 0.007 270)";
  ctx.lineWidth = 6;
  ctx.stroke();

  // Center text
  ctx.fillStyle = "oklch(0.68 0.01 90)";
  ctx.font = `${size * 0.09}px "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("READY", cx, cy);
}

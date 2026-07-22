// Tiny dependency-free radar chart for the 3-critic council scores
// (pocket / wordplay / authenticity). SVG only, themable.

type Props = {
  scores: Record<string, number>; // 0..10
  size?: number;
};

export function QualityRadar({ scores, size = 180 }: Props) {
  const labels = Object.keys(scores);
  const n = labels.length;
  if (!n) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 28;

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, v: number) => {
    const f = Math.max(0, Math.min(1, v / 10));
    return [cx + Math.cos(angle(i)) * r * f, cy + Math.sin(angle(i)) * r * f] as const;
  };
  const ringPoint = (i: number, f: number) => [
    cx + Math.cos(angle(i)) * r * f,
    cy + Math.sin(angle(i)) * r * f,
  ] as const;

  const polyPath = (f: number) =>
    labels
      .map((_, i) => ringPoint(i, f).join(","))
      .join(" ");

  const dataPath = labels
    .map((l, i) => point(i, scores[l] ?? 0).join(","))
    .join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Critic radar">
      {/* concentric rings */}
      {[0.33, 0.66, 1].map((f) => (
        <polygon
          key={f}
          points={polyPath(f)}
          className="fill-none stroke-border"
          strokeWidth={1}
        />
      ))}
      {/* spokes */}
      {labels.map((_, i) => {
        const [x, y] = ringPoint(i, 1);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="stroke-border" strokeWidth={1} />
        );
      })}
      {/* data */}
      <polygon
        points={dataPath}
        className="fill-primary/25 stroke-primary"
        strokeWidth={2}
      />
      {/* points + labels */}
      {labels.map((l, i) => {
        const [x, y] = point(i, scores[l] ?? 0);
        const [lx, ly] = ringPoint(i, 1.18);
        return (
          <g key={l}>
            <circle cx={x} cy={y} r={3} className="fill-primary" />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px] uppercase tracking-wider"
            >
              {l} {(scores[l] ?? 0).toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

import { memo } from "react";

const WIDTH = 184, HEIGHT = 22;

/* Recent CPU (last 30 snapshots) with the model's 70% and 90% thresholds as hairlines. */
export const Sparkline = memo(function Sparkline({ values }: { values: number[] }) {
  const points = values.length >= 2 ? values.map((value, i) =>
    `${(i * WIDTH) / (values.length - 1)},${HEIGHT - (Math.max(0, Math.min(100, value)) / 100) * HEIGHT}`).join(" ") : "";
  return (
    <svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" className="overflow-visible">
      <line x1="0" x2={WIDTH} y1={HEIGHT * 0.3} y2={HEIGHT * 0.3} stroke="var(--if-warn)" strokeWidth="0.6" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={WIDTH} y1={HEIGHT * 0.1} y2={HEIGHT * 0.1} stroke="var(--if-hot)" strokeWidth="0.6" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      {points && <polyline points={points} fill="none" stroke="var(--if-ink-2)" strokeWidth="1.3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
});

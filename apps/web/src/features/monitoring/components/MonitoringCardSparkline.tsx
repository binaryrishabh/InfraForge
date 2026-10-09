import { memo } from "react";

interface MonitoringCardSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  thresholdLines?: boolean;
}

/* Atmospheric sparkline, de-glowed: a single clean polyline plus flat
threshold rules (bronze 70%, brick 90%). No gradient fills, no blur
filters — the graph reads as instrumentation, not decoration. */
export const MonitoringCardSparkline = memo(function MonitoringCardSparkline({
  values,
  width = 180,
  height = 48,
  color = "#4FA89B",
  thresholdLines = true,
}: MonitoringCardSparklineProps) {
  const hasData = values.length >= 2;
  let points = "";
  if (hasData) {
    const maxVal = 100;
    const stepX = width / (values.length - 1);
    points = values
      .map((val, index) => {
        const clampedVal = Math.max(0, Math.min(maxVal, val));
        const x = index * stepX;
        const y = height - (clampedVal / maxVal) * height;
        return `${x},${y}`;
      })
      .join(" ");
  }
  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Threshold rules: 70% (bronze) and 90% (brick). SVG y is inverted. */}
      {thresholdLines && (
        <>
          <line
            x1={0}
            y1={height * 0.3}
            x2={width}
            y2={height * 0.3}
            stroke="#C98A4B"
            strokeWidth={0.5}
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <line
            x1={0}
            y1={height * 0.1}
            x2={width}
            y2={height * 0.1}
            stroke="#C4574A"
            strokeWidth={0.5}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        </>
      )}
      {hasData && (
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
});
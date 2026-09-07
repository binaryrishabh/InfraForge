import { memo, useId } from "react";

interface MonitoringCardSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  thresholdLines?: boolean;
}

export const MonitoringCardSparkline = memo(function MonitoringCardSparkline({
  values,
  width = 180,
  height = 48,
  color = "#5B8CFF",
  thresholdLines = true,
}: MonitoringCardSparklineProps) {
  // Unique per-instance ids so many sparklines can coexist in one SVG layer.
  const reactId = useId();
  const uid = reactId.replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `spark-gradient-${uid}`;
  const glowId = `spark-glow-${uid}`;

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
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>

      {/* Threshold gridlines: 70% (amber) and 90% (red). SVG y is inverted. */}
      {thresholdLines && (
        <>
          <line
            x1={0}
            y1={height * 0.3}
            x2={width}
            y2={height * 0.3}
            stroke="#F5A524"
            strokeWidth={0.5}
            strokeDasharray="3 3"
            opacity={0.4}
          />
          <line
            x1={0}
            y1={height * 0.1}
            x2={width}
            y2={height * 0.1}
            stroke="#F0564A"
            strokeWidth={0.5}
            strokeDasharray="3 3"
            opacity={0.4}
          />
        </>
      )}

      {hasData && (
        <>
          {/* Atmospheric gradient area fill */}
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill={`url(#${gradientId})`}
            stroke="none"
          />
          {/* Soft glow pass behind the main stroke */}
          <g filter={`url(#${glowId})`}>
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={2}
              opacity={0.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          {/* Main stroke */}
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={0.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
});
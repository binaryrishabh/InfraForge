import { memo } from "react";

interface MonitoringCardSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

export const MonitoringCardSparkline = memo(function MonitoringCardSparkline({
  values,
  width = 180,
  height = 24,
  color = "#5B8CFF",
}: MonitoringCardSparklineProps) {
  if (values.length < 2) {
    return <svg width={width} height={height} />;
  }

  const maxVal = 100;
  const minVal = 0;
  const stepX = width / (values.length - 1);

  const points = values
    .map((val, index) => {
      const clampedVal = Math.max(minVal, Math.min(maxVal, val));
      const x = index * stepX;
      const y = height - (clampedVal / maxVal) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#1F2633" strokeWidth={1} />
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={color}
        fillOpacity={0.08}
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});
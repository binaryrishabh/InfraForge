import { memo } from "react";

interface PendingConnectionLineProps {
  // Canvas-space port anchor on the card edge — the drag's fixed origin.
  source: { x: number; y: number };
  cursor: { x: number; y: number };
}

export const PendingConnectionLine = memo(function PendingConnectionLine({
  source,
  cursor,
}: PendingConnectionLineProps) {
  const x1 = source.x;
  const y1 = source.y;
  const x2 = cursor.x;
  const y2 = cursor.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const isHorizontal = Math.abs(dx) >= Math.abs(dy);
  const pull = distance * 0.4;

  let c1x: number, c1y: number, c2x: number, c2y: number;

  if (isHorizontal) {
    const dir = dx >= 0 ? 1 : -1;
    c1x = x1 + pull * dir;
    c1y = y1;
    c2x = x2 - pull * dir;
    c2y = y2;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    c1x = x1;
    c1y = y1 + pull * dir;
    c2x = x2;
    c2y = y2 - pull * dir;
  }

  const path = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="#5B8CFF"
        strokeWidth={2}
        strokeDasharray="6 4"
        pointerEvents="none"
      />
      {/* Socket at the origin port so the drag visibly starts plugged in */}
      <circle cx={x1} cy={y1} r={5} fill="#0B0E14" stroke="#5B8CFF" strokeWidth={2} pointerEvents="none" />
      <circle cx={x1} cy={y1} r={2} fill="#7AA2FF" pointerEvents="none" />
    </g>
  );
});
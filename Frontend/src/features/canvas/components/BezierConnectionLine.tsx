import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface BezierConnectionLineProps {
  source: { x: number; y: number; type: ResourceType };
  target: { x: number; y: number; type: ResourceType };
  port: number;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function BezierConnectionLine({ source, target, port, isSelected = false, onSelect }: BezierConnectionLineProps) {
  const CENTER_OFFSET = 24;
  const NODE_HALF = 20;

  const cx1 = source.x + CENTER_OFFSET;
  const cy1 = source.y + CENTER_OFFSET;
  const cx2 = target.x + CENTER_OFFSET;
  const cy2 = target.y + CENTER_OFFSET;

  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const isHorizontal = Math.abs(dx) >= Math.abs(dy);

  let x1: number, y1: number, x2: number, y2: number;
  if (isHorizontal) {
    const dir = dx >= 0 ? 1 : -1;
    x1 = cx1 + NODE_HALF * dir;
    y1 = cy1;
    x2 = cx2 - NODE_HALF * dir;
    y2 = cy2;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    x1 = cx1;
    y1 = cy1 + NODE_HALF * dir;
    x2 = cx2;
    y2 = cy2 - NODE_HALF * dir;
  }

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

  const midX = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
  const midY = (y1 + 3 * c1y + 3 * c2y + y2) / 8;

  const strokeColor = isSelected ? "#F0564A" : "#3b82f6";

  return (
    <g>
      {/* Soft glow underlay */}
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={4} opacity={0.15} strokeLinecap="round" />
      {/* Main curve */}
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
      {/* Port label pinned to the exact curve midpoint */}
      <circle cx={midX} cy={midY} r={9} fill="#1e293b" stroke={strokeColor} strokeWidth={1} />
      <text x={midX} y={midY + 3} textAnchor="middle" fill="#94a3b8" fontSize="8">
        :{port}
      </text>
      {/* Invisible wide hit path on top for click select/delete. Its own
          pointerEvents="stroke" overrides the layer's pointer-events-none. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ cursor: "pointer" }}
        pointerEvents="stroke"
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
      />
    </g>
  );
}
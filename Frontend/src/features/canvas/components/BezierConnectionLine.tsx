import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface BezierConnectionLineProps {
  source: { x: number; y: number; type: ResourceType };
  target: { x: number; y: number; type: ResourceType };
  port: number;
  isSelected?: boolean;
  onSelect?: () => void;
  scale?: number;
}

export function BezierConnectionLine({ source, target, port, isSelected = false, onSelect, scale = 1 }: BezierConnectionLineProps) {
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

  // Level-of-detail: the port badge is a clean readable pill, rendered only
  // above ~65% zoom. Below that it disappears so the canvas stays uncluttered.
  const showPortBadge = scale >= 0.65;
  const label = ":" + port;
  const estWidth = label.length * 7 + 14;

  // Keep the invisible hit path clickable at low zoom without over-growing.
  const hitScale = scale < 1 ? Math.min(1 / scale, 2) : 1;

  return (
    <g>
      {/* Soft glow underlay */}
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={4} opacity={0.15} strokeLinecap="round" />
      {/* Main curve */}
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
      {/* Port badge pinned to the exact curve midpoint — gated by zoom */}
      {showPortBadge && (
        <g>
          <rect x={midX - estWidth / 2} y={midY - 9} width={estWidth} height={18} rx={9} fill="#0B0E14" stroke={strokeColor} strokeWidth={1.5} />
          <text x={midX} y={midY + 3.5} textAnchor="middle" fill="#EDF1F7" fontSize={11} fontFamily="ui-monospace, SFMono-Regular, monospace" fontWeight={500}>{label}</text>
        </g>
      )}
      {/* Invisible wide hit path on top for click select/delete. Its own
          pointerEvents="stroke" overrides the layer's pointer-events-none. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16 * hitScale}
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
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface BezierConnectionLineProps {
  source: { x: number; y: number; type: ResourceType };
  target: { x: number; y: number; type: ResourceType };
  port: number;
  isSelected?: boolean;
  onSelect?: () => void;
  scale?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

export function BezierConnectionLine({
  source,
  target,
  port,
  isSelected = false,
  onSelect,
  scale = 1,
  nodeWidth = 48,
  nodeHeight = 48,
}: BezierConnectionLineProps) {
  const centerXOffset = nodeWidth / 2;
  const centerYOffset = nodeHeight / 2;
  const cx1 = source.x + centerXOffset;
  const cy1 = source.y + centerYOffset;
  const cx2 = target.x + centerXOffset;
  const cy2 = target.y + centerYOffset;

  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const isHorizontal = Math.abs(dx) >= Math.abs(dy);

  // The line tucks just under the node edge (small gap) so it appears to
  // emerge cleanly from the border instead of floating or hiding inside.
  const EDGE_GAP = 4;

  let x1: number, y1: number, x2: number, y2: number;

  if (isHorizontal) {
    // Exits the left/right edge -> measure half the node WIDTH.
    const halfExtent = nodeWidth / 2 - EDGE_GAP;
    const dir = dx >= 0 ? 1 : -1;
    x1 = cx1 + halfExtent * dir;
    y1 = cy1;
    x2 = cx2 - halfExtent * dir;
    y2 = cy2;
  } else {
    // Exits the top/bottom edge -> measure half the node HEIGHT.
    const halfExtent = nodeHeight / 2 - EDGE_GAP;
    const dir = dy >= 0 ? 1 : -1;
    x1 = cx1;
    y1 = cy1 + halfExtent * dir;
    x2 = cx2;
    y2 = cy2 - halfExtent * dir;
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

  const strokeColor = isSelected ? "#5B8CFF" : "#3A465C";

  const showPortBadge = scale >= 0.65;
  const label = ":" + port;
  const estWidth = label.length * 7 + 14;

  const hitScale = scale < 1 ? Math.min(1 / scale, 2) : 1;

  return (
    <g>
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={4} opacity={0.15} strokeLinecap="round" />
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />

      {showPortBadge && (
        <g>
          <rect x={midX - estWidth / 2} y={midY - 9} width={estWidth} height={18} rx={9} fill="#0B0E14" stroke={isSelected ? "#5B8CFF" : "#273042"} strokeWidth={1.5} />
          <text x={midX} y={midY + 3.5} textAnchor="middle" fill={isSelected ? "#AAB4C5" : "#677185"} fontSize={11} fontFamily="ui-monospace, SFMono-Regular, monospace" fontWeight={500}>{label}</text>
        </g>
      )}

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
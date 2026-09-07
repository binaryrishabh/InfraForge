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
  // Live tube: packets render (stagnant when paused, flowing when running).
  showPackets?: boolean;
  animatePackets?: boolean;
}

const TUBE_CASING_WIDTH = 9;
const TUBE_CORE_WIDTH = 5;
const PACKET_WIDTH = 3;
// Dash period 24 matches the -24 flow keyframe offset for a seamless loop.
const PACKET_DASH = "7 17";
const RIVET_TS = [0.22, 0.5, 0.78];

export function BezierConnectionLine({
  source,
  target,
  port,
  isSelected = false,
  onSelect,
  scale = 1,
  nodeWidth = 48,
  nodeHeight = 48,
  showPackets = false,
  animatePackets = false,
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

  // Anchor per axis so tubes emerge from the card border they leave/enter by.
  const horizontalHalf = nodeWidth / 2 - 4;
  const verticalHalf = nodeHeight / 2 - 4;

  let x1: number, y1: number, x2: number, y2: number;
  if (isHorizontal) {
    const dir = dx >= 0 ? 1 : -1;
    x1 = cx1 + horizontalHalf * dir;
    y1 = cy1;
    x2 = cx2 - horizontalHalf * dir;
    y2 = cy2;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    x1 = cx1;
    y1 = cy1 + verticalHalf * dir;
    x2 = cx2;
    y2 = cy2 - verticalHalf * dir;
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

  // Point along the cubic Bezier, used to place rivet joints.
  const pointAt = (t: number) => {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2,
      y: mt * mt * mt * y1 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y2,
    };
  };
  const rivets = RIVET_TS.map(pointAt);

  // Arrowhead tangent at the target end (points into the node).
  const arrowAngle = (Math.atan2(y2 - c2y, x2 - c2x) * 180) / Math.PI;

  const midX = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
  const midY = (y1 + 3 * c1y + 3 * c2y + y2) / 8;

  const casingColor = isSelected ? "#273042" : "#1F2633";
  const coreColor = isSelected ? "#5B8CFF" : "#3A465C";
  const rivetColor = isSelected ? "#7AA2FF" : "#46536B";
  const packetColor = isSelected ? "#EDF1F7" : "#8FB3FF";

  const showPortBadge = scale >= 0.65;
  const label = ":" + port;
  const estWidth = label.length * 7 + 14;
  const hitScale = scale < 1 ? Math.min(1 / scale, 2) : 1;

  return (
    <g>
      {/* Energized halo behind a live tube */}
      {showPackets && (
        <>
          <path d={path} fill="none" stroke="#5B8CFF" strokeWidth={12} opacity={0.10} strokeLinecap="round" />
          <path d={path} fill="none" stroke="#5B8CFF" strokeWidth={8} opacity={0.16} strokeLinecap="round" />
        </>
      )}
      {/* Tube casing (outer wall) */}
      <path d={path} fill="none" stroke={casingColor} strokeWidth={TUBE_CASING_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      {/* Tube core (inner channel) */}
      <path d={path} fill="none" stroke={coreColor} strokeWidth={TUBE_CORE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      {/* Packets: flowing while running, stagnant while paused */}
      {showPackets && (
        <path
          d={path}
          fill="none"
          stroke={packetColor}
          strokeWidth={PACKET_WIDTH}
          strokeDasharray={PACKET_DASH}
          strokeLinecap="round"
          opacity={0.9}
          className={animatePackets ? "infraforge-flow-packets" : undefined}
        />
      )}
      {/* Rivet joints along the tube */}
      {rivets.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={rivetColor} />
      ))}
      {/* Direction arrowhead into the target */}
      <path
        d="M0,0 L-9,-4.5 L-9,4.5 Z"
        transform={`translate(${x2} ${y2}) rotate(${arrowAngle})`}
        fill={coreColor}
      />
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
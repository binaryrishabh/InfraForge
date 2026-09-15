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
  showPackets?: boolean;
  animatePackets?: boolean;
}

// Tube family thinned ~35% per owner ask: casing 7 -> 4.5, core 4 -> 2.5,
// packets 2.5 -> 1.6. The line reads as a precise wire, not a pipe.
const TUBE_CASING_WIDTH = 4.5;
const TUBE_CORE_WIDTH = 2.5;
const PACKET_WIDTH = 1.6;
// Dash period 24 matches the -24 flow keyframe offset for a seamless loop.
const PACKET_DASH = "7 17";
// Flow chevrons sit in the node-side half of each gap (between the node edge
// and the mid-line port badge), biased toward the nodes per owner feedback.
const CHEVRON_TS = [0.18, 0.82];
// Zoomed out (port badge hidden): the pair merges into one center marker.
const CENTER_CHEVRON_TS = [0.5];
const CHEVRON_PATH = "M -6.1 -3.5 L 0 0 L -6.1 3.5";
// Chevron strokes thinned with the tube so the whole line family matches.
const CHEVRON_HALO_WIDTH = 3.25;
const CHEVRON_CORE_WIDTH = 1.5;
// Stubby lines skip the chevrons so short connections never look cluttered.
const CHEVRON_MIN_DISTANCE = 110;
// Port badge typography: font lifted ~25% (10 -> 12.5) per owner ask; the
// pill geometry scales with it so the label keeps its breathing room.
const PORT_FONT_SIZE = 12.5;
const PORT_BADGE_HEIGHT = 20;
const PORT_BADGE_PADDING = 18;
const PORT_CHAR_ADVANCE = 8.5;

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

  // Exact curve midpoint (t = 0.5) — where the badge rides.
  const midX = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
  const midY = (y1 + 3 * c1y + 3 * c2y + y2) / 8;

  // Point along the cubic Bezier (chevron placement).
  const pointAt = (t: number) => {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2,
      y: mt * mt * mt * y1 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y2,
    };
  };

  // Tangent direction of the curve at t, in degrees (chevron rotation).
  const tangentAngleAt = (t: number) => {
    const mt = 1 - t;
    const tangentX =
      3 * mt * mt * (c1x - x1) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (x2 - c2x);
    const tangentY =
      3 * mt * mt * (c1y - y1) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (y2 - c2y);
    return (Math.atan2(tangentY, tangentX) * 180) / Math.PI;
  };

  // Arrowhead tangent at the target end (points into the node).
  const arrowAngle = (Math.atan2(y2 - c2y, x2 - c2x) * 180) / Math.PI;

  const casingColor = isSelected ? "#273042" : "#1F2633";
  const coreColor = isSelected ? "#5B8CFF" : "#3A465C";
  const packetColor = isSelected ? "#EDF1F7" : showPackets ? "#8FB3FF" : "#677185";
  const arrowColor = isSelected ? "#EDF1F7" : showPackets ? "#8FB3FF" : "#677185";

  const showPortBadge = scale >= 0.65;
  const showChevrons = distance > CHEVRON_MIN_DISTANCE;
  // Badge visible: two chevrons flank it in the node-side gaps.
  // Badge hidden (zoomed out): the pair merges into ONE center marker.
  const chevronTs = showPortBadge ? CHEVRON_TS : CENTER_CHEVRON_TS;
  const label = ":" + port;
  const badgeWidth = label.length * PORT_CHAR_ADVANCE + PORT_BADGE_PADDING;

  const hitScale = scale < 1 ? Math.min(1 / scale, 2) : 1;

  return (
    <g>
      {/* Energized halo behind a live tube (thinned with the tube) */}
      {showPackets && (
        <>
          <path d={path} fill="none" stroke="#5B8CFF" strokeWidth={6.5} opacity={0.10} strokeLinecap="round" />
          <path d={path} fill="none" stroke="#5B8CFF" strokeWidth={4} opacity={0.16} strokeLinecap="round" />
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
      {/* Flow chevrons: two flanking the port badge while it is visible, or a
          single direction marker at the exact line center once zoom-out
          hides the badge. */}
      {showChevrons &&
        chevronTs.map((t) => {
          const p = pointAt(t);
          const angle = tangentAngleAt(t);
          return (
            <g key={t} transform={`translate(${p.x} ${p.y}) rotate(${angle})`}>
              <path
                d={CHEVRON_PATH}
                fill="none"
                stroke={arrowColor}
                strokeWidth={CHEVRON_HALO_WIDTH}
                opacity={0.18}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={CHEVRON_PATH}
                fill="none"
                stroke={arrowColor}
                strokeWidth={CHEVRON_CORE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      {/* Direction arrowhead into the target port */}
      <path
        d="M0,0 L-9,-4.5 L-9,4.5 Z"
        transform={`translate(${x2} ${y2}) rotate(${arrowAngle})`}
        fill={coreColor}
      />
      {/* Port badge: oval pill riding the curve midpoint */}
      {showPortBadge && (
        <g>
          <rect
            x={midX - badgeWidth / 2}
            y={midY - PORT_BADGE_HEIGHT / 2}
            width={badgeWidth}
            height={PORT_BADGE_HEIGHT}
            rx={PORT_BADGE_HEIGHT / 2}
            fill="#12161F"
            stroke={isSelected ? "#5B8CFF" : "#35415A"}
            strokeWidth={1}
          />
          <text
            x={midX}
            y={midY + PORT_FONT_SIZE * 0.35}
            textAnchor="middle"
            fill={isSelected ? "#EDF1F7" : "#AAB4C5"}
            fontSize={PORT_FONT_SIZE}
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontWeight={600}
          >
            {label}
          </text>
        </g>
      )}
      {/* Invisible fat hit path — deliberately NOT thinned, keeps clicks easy */}
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
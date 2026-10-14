import { X } from "lucide-react";

interface BezierConnectionLineProps {
  source: { x: number; y: number };
  target: { x: number; y: number };
  port: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  scale?: number;
  nodeWidth: number;
  sourceHeight: number;
  targetHeight: number;
  showPackets?: boolean;
  animatePackets?: boolean;
  // The recorded health of the resource this line feeds; never a per-line measurement.
  tone?: "warn" | "fail" | null;
  label?: string;
}

const CHEVRON = "M -5 -3 L 0 0 L -5 3";

function geometry(source: { x: number; y: number }, target: { x: number; y: number }, nodeWidth: number, sourceHeight: number, targetHeight: number) {
  const cx1 = source.x + nodeWidth / 2, cy1 = source.y + sourceHeight / 2;
  const cx2 = target.x + nodeWidth / 2, cy2 = target.y + targetHeight / 2;
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const distance = Math.hypot(dx, dy);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  let x1 = cx1, y1 = cy1, x2 = cx2, y2 = cy2;
  if (horizontal) { const dir = dx >= 0 ? 1 : -1; x1 += (nodeWidth / 2 - 2) * dir; x2 -= (nodeWidth / 2 - 2) * dir; }
  else { const dir = dy >= 0 ? 1 : -1; y1 += (sourceHeight / 2 - 2) * dir; y2 -= (targetHeight / 2 - 2) * dir; }
  const pull = distance * 0.4;
  const [c1x, c1y, c2x, c2y] = horizontal
    ? [x1 + pull * Math.sign(dx || 1), y1, x2 - pull * Math.sign(dx || 1), y2]
    : [x1, y1 + pull * Math.sign(dy || 1), x2, y2 - pull * Math.sign(dy || 1)];
  const at = (t: number) => {
    const m = 1 - t;
    return { x: m ** 3 * x1 + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t ** 3 * x2, y: m ** 3 * y1 + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t ** 3 * y2 };
  };
  const angle = (t: number) => {
    const m = 1 - t;
    return Math.atan2(3 * m * m * (c1y - y1) + 6 * m * t * (c2y - c1y) + 3 * t * t * (y2 - c2y), 3 * m * m * (c1x - x1) + 6 * m * t * (c2x - c1x) + 3 * t * t * (x2 - c2x)) * 180 / Math.PI;
  };
  return { path: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`, distance, at, angle };
}

/* An ink line between two cards: direction chevrons, the target's listening port
at the midpoint, and moving dashes only while a run is advancing. */
export function BezierConnectionLine({ source, target, port, isSelected = false, onSelect, onRemove, scale = 1, nodeWidth, sourceHeight, targetHeight, showPackets = false, animatePackets = false, tone = null, label }: BezierConnectionLineProps) {
  const { path, distance, at, angle } = geometry(source, target, nodeWidth, sourceHeight, targetHeight);
  const color = isSelected ? "var(--if-accent)" : tone === "fail" ? "var(--if-fail)" : tone === "warn" ? "var(--if-warn)" : "var(--if-ink-3)";
  const mid = at(0.5);
  const badge = scale >= 0.6;
  const text = `:${port}`;
  const width = text.length * 7.6 + 14;
  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={isSelected ? 2.4 : 1.6} strokeLinecap="round" />
      {showPackets && <path d={path} fill="none" stroke={tone ? color : "var(--if-accent)"} strokeWidth={2} strokeDasharray="6 14" strokeLinecap="round" className={animatePackets ? "if-flow" : undefined} opacity={0.85} />}
      {distance > 110 && (badge ? [0.2, 0.8] : [0.5]).map((t) => {
        const p = at(t);
        return <path key={t} d={CHEVRON} transform={`translate(${p.x} ${p.y}) rotate(${angle(t)})`} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {badge && (
        <g>
          <rect x={mid.x - width / 2} y={mid.y - 9} width={width} height={18} rx={3} fill="var(--if-raised)" stroke={isSelected ? "var(--if-accent)" : "var(--if-line-strong)"} />
          <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={11.5} fontFamily="var(--font-mono)" fill="var(--if-ink-2)">{text}</text>
        </g>
      )}
      {onSelect && (
        <path d={path} fill="none" stroke="transparent" strokeWidth={16 * (scale < 1 ? Math.min(1 / scale, 2) : 1)} pointerEvents="stroke" style={{ cursor: "pointer" }}
          onClick={(event) => { event.stopPropagation(); onSelect(); }}>
          {label && <title>{label}</title>}
        </path>
      )}
      {isSelected && onRemove && (
        <foreignObject x={mid.x + width / 2 + 4} y={mid.y - 14} width={132} height={28} style={{ overflow: "visible", pointerEvents: "auto" }}>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-raised px-2 text-xs font-medium text-fail shadow-e2 hover:bg-fail-soft">
            <X size={12} aria-hidden="true" /> Remove link
          </button>
        </foreignObject>
      )}
    </g>
  );
}

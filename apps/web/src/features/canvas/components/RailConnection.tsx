import { X } from "lucide-react";

interface RailConnectionProps {
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
  // The recorded health of the resource this line feeds; never a per-line measurement.
  tone?: "warn" | "fail" | null;
  label?: string;
  securityLabel?: string;
}

type Point = { x: number; y: number };
const CHEVRON = "M -5 -3.5 L 0 0 L -5 3.5";

/* A rail between two stations, drawn like a transit map: straight out of the source,
one 45° run, straight into the target. Mostly-vertical pairs run top to bottom instead. */
function railPoints(source: Point, target: Point, nodeWidth: number, sourceHeight: number, targetHeight: number): Point[] {
  const a = { x: source.x + nodeWidth / 2, y: source.y + sourceHeight / 2 }, b = { x: target.x + nodeWidth / 2, y: target.y + targetHeight / 2 };
  // The same axis choice as utils/connectionSides.ts, so occupied ports and rails agree.
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horizontal) {
    const dir = Math.sign(b.x - a.x) || 1;
    const x1 = a.x + (nodeWidth / 2) * dir, x2 = b.x - (nodeWidth / 2) * dir, dy = b.y - a.y, span = Math.abs(x2 - x1);
    if (Math.abs(dy) < 1) return [{ x: x1, y: a.y }, { x: x2, y: b.y }];
    const run = Math.min(Math.abs(dy), Math.max(0, span - 32)), mid = (x1 + x2) / 2;
    return [{ x: x1, y: a.y }, { x: mid - (run / 2) * dir, y: a.y }, { x: mid + (run / 2) * dir, y: a.y + Math.sign(dy) * run }, { x: mid + (run / 2) * dir, y: b.y }, { x: x2, y: b.y }];
  }
  const dir = Math.sign(b.y - a.y) || 1;
  const y1 = a.y + (sourceHeight / 2) * dir, y2 = b.y - (targetHeight / 2) * dir, dx = b.x - a.x, span = Math.abs(y2 - y1);
  if (Math.abs(dx) < 1) return [{ x: a.x, y: y1 }, { x: b.x, y: y2 }];
  const run = Math.min(Math.abs(dx), Math.max(0, span - 32)), mid = (y1 + y2) / 2;
  return [{ x: a.x, y: y1 }, { x: a.x, y: mid - (run / 2) * dir }, { x: a.x + Math.sign(dx) * run, y: mid + (run / 2) * dir }, { x: b.x, y: mid + (run / 2) * dir }, { x: b.x, y: y2 }];
}

// A point and heading a fraction of the way along the polyline.
function along(points: Point[], f: number) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let left = lengths.reduce((s, l) => s + l, 0) * f;
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (left <= lengths[i]! || i === lengths.length - 1) {
      const k = lengths[i] ? Math.min(1, left / lengths[i]!) : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
    }
    left -= lengths[i]!;
  }
  return { x: points[0]!.x, y: points[0]!.y, angle: 0 };
}

export function RailConnection({ source, target, port, isSelected = false, onSelect, onRemove, scale = 1, nodeWidth, sourceHeight, targetHeight, tone = null, label, securityLabel }: RailConnectionProps) {
  const points = railPoints(source, target, nodeWidth, sourceHeight, targetHeight);
  const path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  const length = points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
  const color = isSelected ? "var(--if-accent)" : tone === "fail" ? "var(--if-fail)" : tone === "warn" ? "var(--if-warn)" : "var(--if-ink-3)";
  const mid = along(points, 0.5), badge = scale >= 0.6, text = `:${port}${securityLabel ? ` ${securityLabel}` : ""}`, width = text.length * 7.4 + 12;
  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={isSelected ? 2.4 : 1.75} strokeLinejoin="round" strokeLinecap="square" />
      {length > 110 && (badge ? [0.22, 0.78] : [0.5]).map((f) => {
        const p = along(points, f);
        return <path key={f} d={CHEVRON} transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {badge && <g>
        <rect x={mid.x - width / 2} y={mid.y - 9} width={width} height={18} fill="var(--if-canvas)" stroke={isSelected ? "var(--if-accent)" : "var(--if-line-strong)"} />
        <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--if-ink-2)">{text}</text>
      </g>}
      {onSelect && (
        <path d={path} fill="none" stroke="transparent" strokeWidth={16 * (scale < 1 ? Math.min(1 / scale, 2) : 1)} pointerEvents="stroke" style={{ cursor: "pointer" }}
          onClick={(event) => { event.stopPropagation(); onSelect(); }}>
          {label && <title>{label}</title>}
        </path>
      )}
      {isSelected && onRemove && (
        <foreignObject x={mid.x + width / 2 + 4} y={mid.y - 14} width={132} height={28} style={{ overflow: "visible", pointerEvents: "auto" }}>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}
            className="inline-flex h-7 items-center gap-1 border border-line-strong bg-raised px-2 text-xs font-semibold text-fail shadow-e2 hover:bg-fail-soft">
            <X size={12} aria-hidden="true" /> Remove link
          </button>
        </foreignObject>
      )}
    </g>
  );
}

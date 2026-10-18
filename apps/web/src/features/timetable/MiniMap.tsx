import { useMemo } from "react";
import { layoutTiers, type TierEdge, type TierNode } from "./tiers";

const COL = 30, ROW = 16, TILE = 8, PAD = 6;

/* A thumbnail of a station map: the same tiers as the full map, with no labels. It is a
recognisable shape for a list row, not something to read values from. */
export function MiniMap({ nodes, edges, className }: { nodes: TierNode[]; edges: TierEdge[]; className?: string }) {
  const { placed, cols, rows } = useMemo(() => layoutTiers(nodes, edges), [nodes, edges]);
  if (!placed.length) return <svg width={COL} height={ROW + PAD * 2} aria-hidden="true" className={className} />;
  const at = new Map(placed.map((p) => [p.id, { x: PAD + TILE / 2 + p.col * COL, y: PAD + TILE / 2 + p.row * ROW }]));
  const width = PAD * 2 + TILE + Math.max(0, cols - 1) * COL, height = PAD * 2 + TILE + Math.max(0, rows - 1) * ROW;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={className}>
      {edges.map((e) => {
        const a = at.get(e.source), b = at.get(e.target); if (!a || !b) return null;
        const mid = (a.x + b.x) / 2;
        return <path key={`${e.source}>${e.target}`} d={`M${a.x} ${a.y}H${mid - Math.abs(b.y - a.y) / 2}L${mid + Math.abs(b.y - a.y) / 2} ${b.y}H${b.x}`}
          fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />;
      })}
      {placed.map((p) => { const { x, y } = at.get(p.id)!; return <rect key={p.id} x={x - TILE / 2} y={y - TILE / 2} width={TILE} height={TILE} fill="var(--if-bg)" stroke="currentColor" strokeWidth="1.2" />; })}
    </svg>
  );
}

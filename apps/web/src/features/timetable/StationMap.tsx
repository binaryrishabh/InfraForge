import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/ui/cx";
import { StationGlyph } from "@/ui/StationGlyph";
import { HealthGlyph } from "@/ui/HealthMark";
import { healthState } from "@/ui/health";
import { layoutTiers, type TierEdge, type TierNode } from "./tiers";

export interface StationState {
  health?: string | null;
  // A short recorded fact shown under the label, such as "CPU 86%".
  reading?: string;
  // Recorded intervals (process down, not ready, not eligible) active at this moment.
  flags?: string[];
}

interface StationMapProps {
  nodes: TierNode[];
  edges: TierEdge[];
  states?: Record<string, StationState>;
  marked?: string | null;
  markLabel?: string;
  selected?: string | null;
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
}

const TILE = 40;
// Wide maps read left to right like the timetable; narrow containers stack the tiers top to bottom.
const WIDE = { col: 168, row: 120, padX: 72, padY: 56 }, TALL = { col: 124, row: 136, padX: 40, padY: 36 };

// Transit-style rail: straight out of the source, one 45° run, straight into the target.
function railPath(x1: number, y1: number, x2: number, y2: number, vertical: boolean) {
  // Work along the main axis (p) and across it (q), then map back to x/y.
  const [p1, q1, p2, q2] = vertical ? [y1, x1, y2, x2] : [x1, y1, x2, y2];
  const dq = q2 - q1, dp = p2 - p1;
  const pt = (p: number, q: number) => vertical ? `${q} ${p}` : `${p} ${q}`;
  if (Math.abs(dq) < 0.5 || dp <= 0) return `M${pt(p1, q1)}L${pt(p2, q2)}`;
  const run = Math.min(Math.abs(dq), Math.max(0, dp - 2 * TILE)), mid = p1 + dp / 2;
  return `M${pt(p1, q1)}L${pt(mid - run / 2, q1)}L${pt(mid + run / 2, q1 + Math.sign(dq) * run)}L${pt(mid + run / 2, q2)}L${pt(p2, q2)}`;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/* The architecture as a station map. Stations stay in the same places in the brief, the
designer's tidy layout, the live run and the replay, so the learner's spatial memory
carries from one to the next. State is drawn only when a recorded state is supplied. */
export function StationMap({ nodes, edges, states, marked, markLabel, selected, onSelect, label, className }: StationMapProps) {
  const { placed, cols, rows } = useMemo(() => layoutTiers(nodes, edges), [nodes, edges]);
  const [wrap, available] = useWidth();
  const g = WIDE, wideWidth = g.padX * 2 + Math.max(0, cols - 1) * g.col;
  // Stack the tiers when the left-to-right map would have to shrink below readable size.
  const vertical = available > 0 && available < wideWidth * 0.72 && cols > 2;
  const s = vertical ? TALL : WIDE;
  const at = new Map(placed.map((p) => [p.id, vertical
    ? { x: s.padX + p.row * s.col, y: s.padY + p.col * s.row } : { x: s.padX + p.col * s.col, y: s.padY + p.row * s.row }]));
  const width = vertical ? s.padX * 2 + Math.max(0, rows - 1) * s.col + 80 : wideWidth;
  const height = vertical ? s.padY * 2 + Math.max(0, cols - 1) * s.row + 40 : s.padY * 2 + Math.max(0, rows - 1) * s.row + 24;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div ref={wrap} className={cx("w-full", vertical ? className?.replace(/max-h-\[[^\]]+\]/g, "") : className)}>
    {/* Never scale the map up much past its natural size: labels should read like text, not signage. */}
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label} style={{ maxWidth: width * 1.1 }} className="mx-auto block h-auto w-full">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {edges.map((e) => {
          const a = at.get(e.source), b = at.get(e.target); if (!a || !b) return null;
          const dead = [e.source, e.target].some((id) => healthState(states?.[id]?.health) === "failed");
          const d = vertical ? railPath(a.x, a.y + TILE / 2, b.x, b.y - TILE / 2, true) : railPath(a.x + TILE / 2, a.y, b.x - TILE / 2, b.y, false);
          return <path key={`${e.source}>${e.target}`} d={d}
            stroke="currentColor" strokeWidth={dead ? 1.25 : 1.75} strokeDasharray={dead ? "3 4" : undefined}
            className={dead ? "text-ink-3" : "text-ink-2"} />;
        })}
      </g>
      {placed.map((p) => {
        const { x, y } = at.get(p.id)!, node = byId.get(p.id)!, st = states?.[p.id], h = healthState(st?.health);
        const tone = h === "failed" || h === "critical" ? "text-fail" : h === "saturated" ? "text-hot" : h === "degraded" ? "text-warn" : "text-ink";
        const interactive = !!onSelect;
        return (
          <g key={p.id} transform={`translate(${x} ${y})`}
            {...(interactive ? { role: "button", tabIndex: 0, "aria-pressed": selected === p.id, "aria-label": `${node.label}, ${node.type ?? "resource"}${st?.health ? `, ${h}` : ""}`,
              onClick: () => onSelect(p.id), onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(p.id); } } } : {})}
            className={cx(interactive && "cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-accent")}>
            {marked === p.id && <rect x={-TILE / 2 - 5} y={-TILE / 2 - 5} width={TILE + 10} height={TILE + 10} fill="none" stroke="var(--if-fail)" strokeWidth="1.2" strokeDasharray="4 3" />}
            <rect x={-TILE / 2} y={-TILE / 2} width={TILE} height={TILE} fill="var(--if-bg)" stroke="currentColor"
              strokeWidth={selected === p.id ? 2.2 : h !== "healthy" && h !== "unknown" ? 2 : 1.25}
              strokeDasharray={st && st.health === null ? "3 3" : undefined} className={selected === p.id ? "text-accent" : tone} />
            {h === "failed" && <rect x={-TILE / 2} y={-TILE / 2} width={TILE} height={TILE} fill="var(--if-fail)" opacity="0.14" />}
            <g transform="translate(-10 -10)" className={tone}><StationGlyph type={node.type ?? ""} size={20} /></g>
            {st?.health && h !== "healthy" && <g transform={`translate(${TILE / 2 - 6} ${-TILE / 2 - 6})`}><rect width="12" height="12" fill="var(--if-bg)" /><HealthGlyph state={h} size={12} /></g>}
            <g transform={vertical ? `translate(${TILE / 2 + 10} ${-TILE / 2 - 2})` : undefined}>
              <text y={vertical ? 12 : TILE / 2 + 16} textAnchor={vertical ? "start" : "middle"} className="fill-ink" style={{ font: "650 13px var(--font-sans)" }}>{node.label}</text>
              <text y={vertical ? 27 : TILE / 2 + 31} textAnchor={vertical ? "start" : "middle"} className="fill-ink-3" style={{ font: "11px var(--font-sans)" }}>
                {st?.flags?.length ? st.flags.join(" · ") : st?.reading ?? node.type}
              </text>
              {marked === p.id && markLabel && <text y={vertical ? 41 : TILE / 2 + 46} textAnchor={vertical ? "start" : "middle"} className="fill-fail" style={{ font: "600 11px var(--font-sans)" }}>{markLabel}</text>}
            </g>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

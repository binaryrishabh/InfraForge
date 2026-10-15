import { useEffect, useId, useRef, useState } from "react";
import type { ExperimentTrace } from "@infraforge/contracts/reports";
import type { ExperimentResult } from "@infraforge/contracts/challenges";
import { pressureSegments } from "../traceGeometry";

const BANDS = ["critical", "saturated", "degraded", "healthy"] as const;
const COLOR = { critical: "text-fail", saturated: "text-warn", degraded: "text-warn", healthy: "text-ok" };

export function TraceCharts({ trace, experiment, resourceId }: { trace: ExperimentTrace; experiment: ExperimentResult; resourceId: string }) {
  const container = useRef<HTMLDivElement>(null), label = useId();
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.floor(entry!.contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const start = trace.expectedStart!, end = trace.expectedEnd!;
  const x = (second: number) => 62 + ((second - start) / Math.max(1, end - start)) * (width - 78);
  const y = (value: number) => 134 - value;
  const marker = experiment.appliedSimulatedSeconds ?? experiment.atSimulatedSecond;
  const context = () => <>
    <rect x={x(marker)} y="24" width={Math.max(0, x(Math.min(end, marker + experiment.durationSimulatedSeconds)) - x(marker))} height="116" fill="currentColor" className="text-warn" opacity="0.08" />
    {trace.missingRanges.map((gap) => <rect key={gap.start} x={x(gap.start) - 2} y="24" width={Math.max(4, x(gap.end) - x(gap.start) + 4)} height="116" fill={`url(#${label}-gap)`} />)}
    <line x1={x(marker)} x2={x(marker)} y1="22" y2="140" stroke="currentColor" strokeDasharray="3 3" className="text-ink-2" />
    <text x={x(marker)} y="14" textAnchor="middle" fontSize="11" fill="currentColor">{experiment.appliedSimulatedSeconds == null ? "Scheduled" : "Applied"} {marker}s</text>
    <line x1={x(end)} x2={x(end)} y1="22" y2="140" stroke="currentColor" className="text-ink-2" />
    <text x={x(start)} y="157" fontSize="11" fill="currentColor">{start}s</text>
    <text x={x(end)} y="157" textAnchor="end" fontSize="11" fill="currentColor">Evaluation {end}s</text>
  </>;
  const pattern = () => <defs><pattern id={`${label}-gap`} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5 5 0" stroke="currentColor" className="text-ink-3" strokeWidth="1" opacity="0.5" /></pattern></defs>;
  return <div ref={container} className="mt-4 min-w-0 space-y-4 text-ink">
    <figure>
      <figcaption className="text-[13px] font-semibold">System health over time</figcaption>
      <svg role="img" aria-label={`Discrete overall health samples, seconds ${start}–${end}. Missing measurements are hatched gaps. Equivalent key-moment values follow.`} viewBox={`0 0 ${width} 170`} className="mt-1 h-[170px] w-full">
        {pattern()}{context()}
        {BANDS.map((band, i) => <g key={band}><text x="0" y={35 + i * 30} fill="currentColor" fontSize="10">{band}</text><line x1="62" x2={width - 16} y1={31 + i * 30} y2={31 + i * 30} stroke="currentColor" opacity="0.12" /></g>)}
        {trace.points.map((p) => <circle key={p.simulatedSeconds} cx={x(p.simulatedSeconds)} cy={31 + BANDS.indexOf(p.overallHealth) * 30} r="2.5" fill="currentColor" className={COLOR[p.overallHealth]}><title>{`Second ${p.simulatedSeconds}: ${p.overallHealth}`}</title></circle>)}
      </svg>
    </figure>
    <figure>
      <figcaption className="flex flex-wrap justify-between gap-2 text-[13px]"><span className="min-w-0 break-all font-semibold">Resource pressure · {resourceId}</span><span>CPU — solid · Memory ┄ dashed · percent</span></figcaption>
      <svg role="img" aria-label={`${resourceId} CPU and memory, percent. Straight segments join adjacent measured seconds only; gaps are not interpolated. Equivalent values follow.`} viewBox={`0 0 ${width} 170`} className="mt-1 h-[170px] w-full">
        {context()}
        {[0, 50, 100].map((value) => <g key={value}><text x="26" y={y(value) + 4} fontSize="11" fill="currentColor">{value}%</text><line x1="62" x2={width - 16} y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.15" /></g>)}
        {(["cpu", "memory"] as const).map((field) => <g key={field} className={field === "cpu" ? "text-accent" : "text-ink-2"}>
          {pressureSegments(trace.points, resourceId, field).map((segment, i) => <g key={i}>
            <polyline points={segment.map((p) => `${x(p.second)},${y(p.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={field === "memory" ? "4 3" : undefined} />
            {segment.map((p) => <circle key={p.second} cx={x(p.second)} cy={y(p.value)} r="1.7" fill="currentColor"><title>{`Second ${p.second}: ${field} ${p.value}%`}</title></circle>)}
          </g>)}
        </g>)}
      </svg>
    </figure>
    <p className="text-xs text-ink-3">Each point is a completed simulated tick. Shading marks the {experiment.appliedSimulatedSeconds == null ? "scheduled" : "applied"} fault window; hatching marks missing evidence. No smoothing, estimated intermediate values or live WebSocket samples are used.</p>
  </div>;
}

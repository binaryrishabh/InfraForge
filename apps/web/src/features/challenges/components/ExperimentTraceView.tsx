import { useId, useState } from "react";
import type { ExperimentTrace } from "@infraforge/contracts/reports";
import type { ExperimentResult } from "@infraforge/contracts/challenges";
import { Notice } from "@/ui/Page";
import { HealthMark } from "@/ui/HealthMark";
import { TraceCharts } from "./TraceCharts";

export function ExperimentTraceView({ trace, experiment }: { trace?: ExperimentTrace; experiment: ExperimentResult }) {
  const id = useId();
  const [chosen, setChosen] = useState(experiment.targetResourceId);
  const [second, setSecond] = useState<number | null>(null);
  if (!trace || !trace.points.length) return <Notice className="mt-4" tone="warn" title="Experiment trace unavailable">{trace?.reason ?? "This older attempt has no retained per-second measurements. No series was reconstructed."}</Notice>;
  const resourceId = trace.resourceFacts.some((r) => r.id === chosen) ? chosen : trace.resourceFacts[0]?.id ?? experiment.targetResourceId;
  const facts = trace.resourceFacts.find((r) => r.id === resourceId);
  const rows = [{ label: "Before the fault", second: experiment.atSimulatedSecond - 1 },
    { label: "At the fault boundary (tick measured before application)", second: experiment.appliedSimulatedSeconds ?? experiment.atSimulatedSecond },
    { label: "First retained tick after the boundary", second: trace.moments?.firstAfterFault ?? null },
    { label: "First measured overall-health change between adjacent ticks", second: trace.moments?.firstOverallHealthChange ?? null },
    { label: "Highest recorded CPU in the retained experiment window", second: facts?.highestCpu.second ?? null },
    { label: "Last active-fault tick (fault ends after measurement)", second: trace.moments?.lastActiveFault ?? null },
    { label: "First retained sample after fault end", second: trace.moments?.firstPostFault ?? null },
    { label: "First retained Healthy target sample after fault end", second: trace.moments?.firstTargetHealthy ?? null },
    { label: "First retained Healthy overall-system sample after fault end", second: trace.moments?.firstOverallHealthy ?? null },
    { label: "At evaluation", second: trace.moments?.evaluation ?? null }].filter((r) => r.second !== null && trace.points.some((p) => p.simulatedSeconds === r.second));
  const selected = trace.points.find((p) => p.simulatedSeconds === second) ?? trace.points.at(-1)!;
  const selectedResource = selected.resources.find((r) => r.id === resourceId);
  return <section id="recorded-experiment-window" tabIndex={-1} aria-labelledby={`${id}-title`} className="mt-5 min-w-0">
    <h4 id={`${id}-title`} className="text-[15px] font-semibold text-ink">Recorded experiment window</h4>
    <p className="mt-1 text-sm text-ink-2">Seconds {trace.expectedStart}–{trace.expectedEnd} · {trace.sampleCount} durable samples · <strong>{trace.status === "complete" ? "Complete" : "Incomplete"}</strong>. {trace.reason}</p>
    <p className="mt-1 text-sm text-ink-2">{experiment.appliedSimulatedSeconds == null ? "Fault application was not recorded." : `Fault applied at second ${experiment.appliedSimulatedSeconds}. That tick's measurements precede application; the next tick can first measure its effect.`}</p>
    <p className="mt-1 text-xs text-ink-3">The pre-fault window can include the traffic ramp. Retained load values distinguish it from a steady baseline.</p>
    {!!trace.missingRanges.length && <details className="mt-2 text-sm text-ink-2"><summary className="cursor-pointer font-medium">Missing evidence — {trace.missingRanges.length} {trace.missingRanges.length === 1 ? "range" : "ranges"}</summary>
      <p className="mt-1">{trace.missingRanges.map((r) => r.start === r.end ? `${r.start}s` : `${r.start}–${r.end}s`).join(", ")}. Nothing is interpolated.</p></details>}
    <label htmlFor={`${id}-resource`} className="mt-4 block text-sm font-medium text-ink">Inspect a resource</label>
    <select id={`${id}-resource`} value={resourceId} onChange={(e) => setChosen(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink sm:w-auto sm:max-w-full">
      {trace.resourceFacts.map((r) => <option key={r.id} value={r.id}>{r.id}{r.id === experiment.targetResourceId ? " · experiment target" : ""}</option>)}
    </select>
    {!!trace.resourceFactsOmitted && <p className="mt-1 text-xs text-ink-3">The selector shows 128 resources, including the target. {trace.resourceFactsOmitted} additional resource summaries are omitted; their bounded samples remain retained.</p>}
    <TraceCharts trace={trace} experiment={experiment} resourceId={resourceId} />
    <div className="mt-4 overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-sm"><caption className="p-3 text-left font-semibold text-ink">Key retained moments · {resourceId}. Missing values remain unknown; CPU/memory are percent.</caption>
        <thead className="border-y border-line bg-sunken text-xs text-ink-2"><tr><th className="p-2">Moment</th><th className="p-2">Second</th><th className="p-2">System / resource health</th><th className="p-2">CPU / memory</th></tr></thead>
        <tbody>{rows.map((row) => { const point = trace.points.find((p) => p.simulatedSeconds === row.second), r = point?.resources.find((r) => r.id === resourceId);
          return <tr key={row.label} className="border-t border-line"><th scope="row" className="p-2 text-xs font-medium text-ink">{row.label}</th><td className="if-num p-2">{point ? <button className="text-accent underline" onClick={() => setSecond(point.simulatedSeconds)} aria-label={`Inspect retained sample at second ${point.simulatedSeconds}`}>{point.simulatedSeconds}s</button> : row.second == null ? "Not recorded" : `${row.second}s · missing`}</td>
            <td className="p-2"><div><HealthMark size="sm" value={point?.overallHealth} /></div><HealthMark size="sm" value={r?.health} /></td><td className="if-num p-2">{r ? `${r.cpu}% / ${r.memory}%` : "Unknown"}</td></tr>; })}</tbody>
      </table>
    </div>
    <label htmlFor={`${id}-second`} className="mt-4 block text-sm font-medium text-ink">Inspect any retained second</label>
    <select id={`${id}-second`} value={selected.simulatedSeconds} onChange={(e) => setSecond(Number(e.target.value))} className="mt-1 rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink">
      {trace.points.map((p) => <option key={p.simulatedSeconds} value={p.simulatedSeconds}>{p.simulatedSeconds} seconds</option>)}
    </select>
    <div role="status" aria-live="polite" className="mt-2 space-y-1 text-sm text-ink-2">
      <p>Second {selected.simulatedSeconds} · topology revision {selected.topologyRevision} · computed at {selected.sampledAt}. System {selected.overallHealth} · load {selected.loadFraction} / target {selected.targetLoadFraction}.</p>
      <p>{resourceId}: {selectedResource ? `${selectedResource.health}, CPU ${selectedResource.cpu}%, memory ${selectedResource.memory}%, RPS ${selectedResource.rps ?? "not recorded"}, connections ${selectedResource.connections ?? "not recorded"}` : "No measurement retained at this second."}</p>
      {selected.pools.map((p) => <p key={p.id}>{p.id}: {p.currentReplicas} current replicas ({p.baseReplicas} placed plus active spawned replicas); {p.pending ? `${p.pending.action === "up" ? "provisioning" : "draining"}, ${p.pending.secondsRemaining} seconds remaining` : "no pending replica change"}. Replica count does not establish healthy serving capacity.</p>)}
    </div>
    <p className="mt-3 text-sm text-ink-3">{facts?.firstHealthyAfterFault == null ? "No Healthy sample for this resource was retained after the scheduled fault window." : `First retained Healthy sample for ${resourceId} ${facts.firstHealthyAfterFaultComplete ? "after the fault" : "after missing evidence"}: second ${facts.firstHealthyAfterFault}.`} Highest values describe this retained window only. Samples do not establish continuous health or production recovery.</p>
  </section>;
}

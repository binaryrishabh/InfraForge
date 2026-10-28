import type { ExperimentTrace } from "@infraforge/contracts/reports";
import type { ExperimentResult, PredictionQuestion, PredictionResult } from "@infraforge/contracts/challenges";
import type { Lane, PredictionMark, Station, TimetableModel, Window } from "./model";

interface TraceInput {
  trace: ExperimentTrace;
  experiment: ExperimentResult;
  stations: Station[];
  predictions?: PredictionResult[];
  // Question kinds from the challenge brief, so a prediction can be pinned to the stations it is about.
  questions?: PredictionQuestion[];
}

/* Resilience evidence: one completed second per retained second, per resource.
The fault tick is measured before the fault applies, so its effect first shows on the
next tick. Seconds outside the retained window, and missing ranges inside it, are Unknown. */
export function fromExperimentTrace({ trace, experiment, stations, predictions = [], questions = [] }: TraceInput): TimetableModel | null {
  if (!trace.points.length || trace.expectedStart == null || trace.expectedEnd == null) return null;
  const start = 0, end = trace.expectedEnd;
  const lanes: Record<string, Lane> = {};
  const known = new Set(trace.points.flatMap((p) => p.resources.map((r) => r.id)));
  const ordered = [...stations.filter((s) => known.has(s.id)), ...[...known].filter((id) => !stations.some((s) => s.id === id)).map((id) => ({ id, label: id, type: null }))];
  for (const s of ordered) lanes[s.id] = { station: s.id, samples: [], bands: [] };
  for (const point of trace.points) for (const r of point.resources) lanes[r.id]?.samples.push({ t: point.simulatedSeconds, health: r.health, cpu: r.cpu ?? undefined, memory: r.memory ?? undefined, rps: r.rps, connections: r.connections });

  const windows: Window[] = [];
  if (trace.expectedStart > start) windows.push({ from: start, to: trace.expectedStart, kind: "unknown", label: "Not retained: only the experiment window keeps per-second measurements" });
  for (const gap of trace.missingRanges) windows.push({ from: gap.start, to: gap.end + 1, kind: "unknown", label: "Missing evidence" });
  const applied = experiment.appliedSimulatedSeconds ?? experiment.atSimulatedSecond;
  const faultEnd = applied + experiment.durationSimulatedSeconds;
  windows.push({ from: applied, to: Math.min(end, faultEnd), kind: "fault", label: `${faultLabel(experiment.fault)} on ${experiment.targetResourceId}` });
  if (end > faultEnd) windows.push({ from: faultEnd, to: end, kind: "observation", label: "After the fault window" });

  const kinds = new Map(questions.map((q) => [q.id, q.kind]));
  const others = ordered.map((s) => s.id).filter((id) => id !== experiment.targetResourceId);
  const pinned: PredictionMark[] = predictions.map((p) => {
    const kind = kinds.get(p.id);
    const at = kind === "baseline-health" ? applied : end;
    const stationsFor = kind === "survivor-health" ? others : kind === "target-health" ? [experiment.targetResourceId]
      : kind === "database-health" ? ordered.filter((s) => s.type === "Database").map((s) => s.id) : "system" as const;
    return { t: at, stations: stationsFor, prompt: p.prompt, predicted: p.predicted, recorded: p.actual, outcome: p.outcome };
  });

  return {
    unit: "s", start, end, stations: ordered, lanes,
    system: trace.points.map((p) => ({ t: p.simulatedSeconds, health: p.overallHealth })),
    trains: [], windows,
    marks: [
      { t: applied, kind: "fault", label: `${experiment.appliedSimulatedSeconds == null ? "Scheduled" : "Applied"} ${applied}s`, station: experiment.targetResourceId },
      { t: end, kind: "evaluation", label: `Judged ${end}s` },
    ],
    predictions: pinned,
    evidence: {
      complete: trace.status === "complete",
      note: trace.status === "complete"
        ? `Every completed tick from ${trace.expectedStart}s to ${trace.expectedEnd}s is retained.`
        : `${trace.sampleCount} ticks retained; ${trace.missingRanges.length} missing ${trace.missingRanges.length === 1 ? "range" : "ranges"} stay Unknown.`,
    },
  };
}

export function faultLabel(fault: string) {
  return ({ crash: "Crash", "network-delay": "Network delay", "cpu-spike": "CPU spike", "memory-leak": "Memory leak", "disk-failure": "Disk failure" } as Record<string, string>)[fault] ?? fault;
}

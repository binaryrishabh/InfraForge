import type { EvidenceCue, GuidedReview } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";
import { observationReview } from "./observationReview";

// Reuse the evaluator's facts/sources. No second judge, advice or inferred cause.
export function guidedReview(report: RunReport, canImprove: boolean, unavailableReason: string | null): GuidedReview | null {
  const e = report.challenge;
  if (!e) return null;
  const observation = observationReview(report, canImprove, unavailableReason);
  if (observation) return observation;
  const cues: EvidenceCue[] = [];
  for (const c of e.criteria.filter((c) => c.status === "not-met").slice(0, 2)) {
    cues.push({ id: `requirement:${c.id}`, kind: "requirement", title: c.label, statement: c.detail, sources: c.sources,
      limit: "This recorded fact explains the requirement verdict; it does not establish a general cause or a solution." });
  }
  for (const p of e.predictions.filter((p) => p.outcome === "different").slice(0, 1)) {
    cues.push({ id: `prediction:${p.id}`, kind: "prediction", title: p.prompt,
      statement: `You predicted ${p.predicted}. The recorded answer was ${p.actual}. ${p.detail}`, sources: p.sources,
      limit: "A prediction mismatch is a difference in expectation, not another failed requirement." });
  }
  const experiment = e.experiment, trace = report.experimentTrace;
  if (e.definitionMatches && experiment && trace) {
    const applied = experiment.appliedSimulatedSeconds;
    const before = applied === null ? null : trace.points.find((p) => p.simulatedSeconds === applied);
    const after = applied === null ? null : trace.points.find((p) => p.simulatedSeconds > applied);
    const target = experiment.targetResourceId;
    for (const [point, phase] of [[before, "At the fault boundary, before application"], [after, "First retained sample after the scheduled fault was applied"]] as const) {
      const resource = point?.resources.find((r) => r.id === target);
      if (!point || !resource) continue;
      cues.push({ id: `trace:${point.simulatedSeconds}`, kind: "measurement", title: phase,
        statement: `${target} recorded ${resource.cpu}% CPU, ${resource.memory}% memory and ${resource.health} health at second ${point.simulatedSeconds}.`,
        sources: [`RunEvidenceSample[${point.simulatedSeconds}].resources[${target}]`, `RunAction[${experiment.actionId}].appliedSimulatedSeconds`],
        resourceId: target, simulatedSecond: point.simulatedSeconds,
        limit: "These are retained samples around the scheduled action. Their sequence alone does not prove causality or recovery." });
    }
  } else if (e.definitionMatches && report.terminal?.measurementFreshness === "current-revision" && report.terminal.simulatedSeconds === e.evaluationSeconds) {
    const r = [...report.terminal.resources].sort((a, b) => Number(b.health === "saturated" || b.health === "failed") - Number(a.health === "saturated" || a.health === "failed") || (b.cpu ?? -1) - (a.cpu ?? -1) || a.id.localeCompare(b.id))[0];
    if (r) cues.push({ id: `terminal:${r.id}`, kind: "measurement", title: "At evaluation",
      statement: `${r.id} recorded ${r.health ?? "unknown"} health${r.cpu === undefined ? "" : ` and ${r.cpu}% CPU`} at second ${report.terminal.simulatedSeconds}.`,
      resourceId: r.id, simulatedSecond: report.terminal.simulatedSeconds, sources: [`terminalSnapshot.metrics.${r.id}`],
      limit: "One exact snapshot does not show how long this state lasted or which upstream change produced it." });
  }
  if (!cues.length && e.criteria.length) {
    const c = e.criteria[0]!;
    cues.push({ id: `requirement:${c.id}`, kind: c.status === "met" ? "requirement" : "unknown", title: c.label,
      statement: c.detail, sources: c.sources, limit: "Read the remaining requirements in the full record before drawing a conclusion." });
  }
  const missing = !e.definitionMatches ? "The recorded challenge version or rules cannot be verified; this attempt must not be reinterpreted under different rules." :
    experiment ? trace?.status !== "complete" ? trace?.reason ?? "The bounded experiment trace was not retained." :
      `Only seconds ${trace.expectedStart}–${trace.expectedEnd} are retained. Post-fault recovery and behavior outside this window remain unknown.` :
    !report.terminal ? "No exact terminal state was retained. Later behavior cannot be reconstructed from a diagnostic checkpoint." :
      "This Design challenge retains terminal/gate evidence, not a continuous series. Duration of saturation and causal explanations remain unknown.";
  cues.push({ id: "evidence-limit", kind: "unknown", title: "What remains unknown", statement: missing,
    sources: experiment ? ["RunEvidenceSample", "challengeExperiment"] : ["terminalSnapshot", "stages"],
    limit: "One pair cannot establish statistical significance, production reliability or a general effect across seeds." });
  return { cues: cues.slice(0, 6), canImprove, unavailableReason };
}

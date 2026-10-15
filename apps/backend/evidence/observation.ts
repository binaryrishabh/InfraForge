import type { ExperimentResult, RecordedExperiment } from "@infraforge/contracts/challenges";
import type { ExperimentEvidenceSample, ObservedHealthSample, PostFaultObservation } from "@infraforge/contracts/reports";

// An observation is a fact about retained completed ticks, never a recovery timer.
export function postFaultObservation(plan: RecordedExperiment, evaluation: number, points: ExperimentEvidenceSample[],
  experiment?: ExperimentResult | null): PostFaultObservation {
  const scheduledEnd = plan.atSimulatedSecond + plan.durationSimulatedSeconds;
  const verified = experiment?.state === "ended" && experiment.endedSimulatedSeconds === scheduledEnd &&
    experiment.appliedSimulatedSeconds === plan.atSimulatedSecond;
  const post = verified ? points.filter((p) => p.simulatedSeconds > scheduledEnd) : [];
  const atEvaluation = post.find((p) => p.simulatedSeconds === evaluation);
  const targetValues = points.flatMap((p) => { const resource = p.resources.find((r) => r.id === plan.targetResourceId);
    return resource ? [{ second: p.simulatedSeconds, health: resource.health }] : []; });
  const systemValues = points.map((p) => ({ second: p.simulatedSeconds, health: p.overallHealth }));
  const sample = (values: Array<{ second: number; health: string }>, healthy: boolean): ObservedHealthSample | null => {
    if (!verified) return null;
    const first = values.find((v) => v.second > scheduledEnd && (!healthy || v.health === "healthy"));
    if (!first) return null;
    const seconds = new Set(values.map((v) => v.second));
    return { ...first, completeSinceFaultEnd: Array.from({ length: first.second - scheduledEnd + 1 }, (_, i) => scheduledEnd + i).every((s) => seconds.has(s)) };
  };
  const status = (values: Array<{ second: number; health: string }>, first: ObservedHealthSample | null) => {
    if (first) return "healthy-observed" as const;
    const seconds = new Set(values.filter((v) => v.second > scheduledEnd).map((v) => v.second));
    return verified && evaluation > scheduledEnd && seconds.size === evaluation - scheduledEnd ? "unhealthy-through-window" as const : "unknown" as const;
  };
  const targetHealthy = sample(targetValues, true), systemHealthy = sample(systemValues, true);
  return { status: evaluation <= scheduledEnd ? "not-applicable" : !verified ? "fault-end-unverified" : post.length ? "samples-retained" : "no-samples",
    scheduledFaultEndSecond: scheduledEnd, faultEndSecond: verified ? scheduledEnd : null, evaluationSecond: evaluation,
    sampleCount: post.length,
    target: { status: status(targetValues, targetHealthy), firstSample: sample(targetValues, false), firstHealthy: targetHealthy,
      healthAtEvaluation: atEvaluation?.resources.find((r) => r.id === plan.targetResourceId)?.health ?? null },
    system: { status: status(systemValues, systemHealthy), firstHealthy: systemHealthy, healthAtEvaluation: atEvaluation?.overallHealth ?? null },
    pendingPoolsAtEvaluation: atEvaluation?.pools.filter((p) => p.pending !== null) ?? [] };
}

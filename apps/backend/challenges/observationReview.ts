import type { EvidenceCue, GuidedReview } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";

export function observationReview(report: RunReport, canImprove: boolean, unavailableReason: string | null): GuidedReview | null {
  const e = report.challenge, trace = report.experimentTrace, observation = trace?.observation;
  if (!e?.definitionMatches || !e.experiment || !observation || observation.status === "not-applicable") return null;
  const experiment = e.experiment, target = experiment.targetResourceId, cues: EvidenceCue[] = [];
  const prediction = e.predictions.find((p) => p.outcome === "different") ?? e.predictions[0];
  if (prediction) cues.push({ id: `prediction:${prediction.id}`, kind: "prediction", title: "Expectation", sources: prediction.sources,
    statement: `You predicted ${prediction.predicted}. ${prediction.detail}`, limit: "Prediction outcomes and challenge requirements are separate." });
  cues.push({ id: "observation:fault", kind: "measurement", title: "Fault", statement: experiment.detail, sources: experiment.sources,
    limit: "The fault-end tick still measures the injected effect. Its removal does not establish system health." });
  const first = observation.target.firstHealthy, system = observation.system.firstHealthy;
  const sample = (name: string, value: typeof first) => value ? `${name}: first retained Healthy sample ${value.completeSinceFaultEnd ? "after the fault" : "after missing evidence"}, second ${value.second}.` : `${name}: no retained Healthy sample after a verified fault end.`;
  cues.push({ id: "observation:after", kind: "measurement", title: "After the fault",
    statement: `${sample(target, first)} ${sample("Overall system", system)}`, sources: ["RunEvidenceSample", "RunAction.completedSimulatedSeconds"],
    resourceId: target, ...(first ? { simulatedSecond: first.second } : {}), limit: "Each statement names a sample, not continuous health or production recovery." });
  const failed = e.criteria.filter((c) => c.status === "not-met").map((c) => c.detail).join(" ");
  cues.push({ id: "observation:evaluation", kind: "measurement", title: "Evaluation",
    statement: `At second ${e.evaluationSeconds}: target ${observation.target.healthAtEvaluation ?? "unknown"}; overall system ${observation.system.healthAtEvaluation ?? "unknown"}. ${failed}`.trim(),
    sources: ["RunEvidenceSample", "terminalSnapshot.metrics"], limit: "Earlier Healthy samples do not establish health at evaluation or afterwards." });
  cues.push({ id: "evidence-limit", kind: "unknown", title: "Unknown",
    statement: `${trace!.reason} Only seconds ${trace!.expectedStart}–${trace!.expectedEnd} are retained. Missing intervals and later behavior are unknown.`,
    sources: ["RunEvidenceSample", "challengeExperiment"], limit: "The model does not measure production availability, request success, latency, data recovery or MTTR." });
  return { cues, canImprove, unavailableReason };
}

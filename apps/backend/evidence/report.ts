import { experimentWindow, EXPERIMENT_MAX_POINTS, EXPERIMENT_MAX_RESOURCES, type ExperimentTrace, type ExperimentEvidenceSample } from "@infraforge/contracts/reports";
import { readRecordedExperiment } from "../challenges/experiment";
import { evidencePayload, sampleHash } from "./contract";
import { postFaultObservation } from "./observation";
import type { ExperimentResult } from "@infraforge/contracts/challenges";

export interface StoredEvidenceSample { simulatedSeconds: number; sampledAt: Date; payload: unknown; hash: string }
export function buildExperimentTrace(row: { challengeExperiment?: unknown; evaluationStopAtSimulatedSeconds?: number | null;
  inputVersion?: 1 | 2 | null;
  experiment?: ExperimentResult | null;
  evidenceSamples?: StoredEvidenceSample[] }): ExperimentTrace {
  const empty = (status: ExperimentTrace["status"], reason: string): ExperimentTrace => ({ status, reason,
    expectedStart: null, expectedEnd: null, actualFirst: null, actualLast: null, sampleCount: 0,
    missingRanges: [], points: [], moments: null, resourceFacts: [], resourceFactsOmitted: 0 });
  if (row.challengeExperiment == null) return row.inputVersion !== 2 ? empty("unavailable", "This legacy run retained no experiment measurements; no series was reconstructed.") :
    empty("not-applicable", "Only bounded resilience attempts retain experiment tick evidence.");
  const plan = readRecordedExperiment(row.challengeExperiment);
  const window = plan && experimentWindow(plan, row.evaluationStopAtSimulatedSeconds);
  if (!window) return empty("unavailable", "The retained experiment plan/window is unreadable or unsupported; no series was reconstructed.");
  const points: ExperimentEvidenceSample[] = [];
  let invalid = (row.evidenceSamples?.length ?? 0) > EXPERIMENT_MAX_POINTS;
  for (const sample of row.evidenceSamples?.slice(0, EXPERIMENT_MAX_POINTS) ?? []) {
    const data = evidencePayload.safeParse(sample.payload);
    if (!data.success || !Number.isInteger(sample.simulatedSeconds) || sample.simulatedSeconds < window.start ||
        sample.simulatedSeconds > window.end || !(sample.sampledAt instanceof Date) || !Number.isFinite(sample.sampledAt.getTime()) || sampleHash(data.data) !== sample.hash ||
        points.some((p) => p.simulatedSeconds === sample.simulatedSeconds)) { invalid = true; continue; }
    points.push({ ...data.data, simulatedSeconds: sample.simulatedSeconds, sampledAt: sample.sampledAt.toISOString() });
  }
  points.sort((a, b) => a.simulatedSeconds - b.simulatedSeconds);
  const seconds = new Set(points.map((p) => p.simulatedSeconds));
  const missingRanges: ExperimentTrace["missingRanges"] = [];
  for (let second = window.start; second <= window.end; second++) {
    if (seconds.has(second)) continue;
    const last = missingRanges.at(-1);
    if (last && last.end + 1 === second) last.end = second;
    else missingRanges.push({ start: second, end: second });
  }
  const status = !points.length ? "unavailable" : missingRanges.length || invalid ? "incomplete" : "complete";
  const firstChange = (values: Array<{ second: number; health: string }>) => values.find((v, i) => i > 0 &&
    v.second === values[i - 1]!.second + 1 && v.health !== values[i - 1]!.health)?.second ?? null;
  const resourceIds = [...new Set(points.flatMap((p) => p.resources.map((r) => r.id)))].sort();
  const targetIndex = resourceIds.indexOf(plan!.targetResourceId);
  if (targetIndex >= 0) resourceIds.unshift(...resourceIds.splice(targetIndex, 1));
  const observation = postFaultObservation(plan!, window.end, points, row.experiment);
  const resourceFacts = resourceIds.slice(0, EXPERIMENT_MAX_RESOURCES).map((id) => {
    const values = points.flatMap((p) => { const r = p.resources.find((r) => r.id === id); return r ? [{ ...r, second: p.simulatedSeconds }] : []; });
    // Unknown values are skipped; a resource with no known value has no highest value.
    const highest = (key: "cpu" | "memory") => values.reduce<{ second: number; value: number } | null>((top, v) => {
      const value = v[key];
      return value !== null && (!top || value > top.value) ? { second: v.second, value } : top;
    }, null);
    const end = plan!.atSimulatedSecond + plan!.durationSimulatedSeconds;
    const healthy = observation.faultEndSecond !== null ? values.find((v) => v.second > end && v.health === "healthy") : undefined;
    const retained = new Set(values.map((v) => v.second));
    return { id, highestCpu: highest("cpu"), highestMemory: highest("memory"),
      firstHealthChange: firstChange(values), firstHealthyAfterFault: healthy?.second ?? null,
      firstHealthyAfterFaultComplete: !!healthy && Array.from({ length: healthy.second - end + 1 }, (_, i) => end + i).every((s) => retained.has(s)) };
  });
  return { status, reason: status === "complete" ? "Every expected completed-tick sample in this bounded window is retained." :
    !points.length ? "No durable samples are retained. Older attempts and stops before the window have no series." :
      `Some expected measurements are missing${invalid ? " or invalid" : ""}. Missing evidence remains missing; the run was not resumed.`,
    observation, expectedStart: window.start, expectedEnd: window.end, actualFirst: points[0]?.simulatedSeconds ?? null,
    actualLast: points.at(-1)?.simulatedSeconds ?? null, sampleCount: points.length, missingRanges, points,
    moments: { beforeFault: seconds.has(plan!.atSimulatedSecond - 1) ? plan!.atSimulatedSecond - 1 : null,
      lastActiveFault: observation.faultEndSecond !== null && seconds.has(observation.faultEndSecond) ? observation.faultEndSecond : null,
      firstPostFault: observation.faultEndSecond !== null ? points.find((p) => p.simulatedSeconds > observation.faultEndSecond!)?.simulatedSeconds ?? null : null,
      firstTargetHealthy: observation.target.firstHealthy?.second ?? null, firstOverallHealthy: observation.system.firstHealthy?.second ?? null,
      atFault: seconds.has(plan!.atSimulatedSecond) ? plan!.atSimulatedSecond : null,
      firstAfterFault: points.find((p) => p.simulatedSeconds > plan!.atSimulatedSecond)?.simulatedSeconds ?? null,
      firstOverallHealthChange: firstChange(points.map((p) => ({ second: p.simulatedSeconds, health: p.overallHealth }))),
      evaluation: seconds.has(window.end) ? window.end : null }, resourceFacts, resourceFactsOmitted: Math.max(0, resourceIds.length - EXPERIMENT_MAX_RESOURCES) };
}

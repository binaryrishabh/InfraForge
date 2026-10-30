import { expect, test } from "bun:test";
import { DeploymentChaosNames as Fault } from "@infraforge/domain/resource";
import { recordedExperiment } from "../challenges/experiment";
import { specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { improvementSource } from "../challenges/improvements";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import { sampleHash } from "../evidence/contract";
import type { CapturedEvidence } from "../evidence/contract";
import type { StoredRun } from "../reports/report";
import { answers, attemptReport, attemptRow, legacyDefinition as definition } from "./challengeHarness";
import { afterTheCacheReturnsV2 } from "../challenges/definitions/after-the-cache-returns/v2";
import { evaluateAttempt } from "../challenges/evaluate";

const d = definition("after-the-cache-returns"), plan = recordedExperiment(d)!;
// Historical comparison fixtures keep the v1 topology and its one-change reference.
const historicalReference = { ...d.starter!, resources: d.starter!.resources.map(r => r.id === "db" ? { ...r, skuId: "db.m5.large" } : r) };
const prediction = answers(d, { "target-health": "healthy", "overall-health": "saturated", "scale-out": "yes" });

/* A recorded attempt of the retired after-the-cache-returns exercise. Its reports stay readable, so the observation
logic is checked on records built here, not on an engine: the cache crashes at 60 and is down until the fault ends at
90; at 91 the cache is back and the database is briefly saturated; from 92 the system is healthy. The starter's
database saturates again from 127; the reference stays healthy through the evaluation at 135. */
function recorded(design = d.starter!, last = 135): StoredRun {
  const row = attemptRow(d, design, prediction, { stopAt: 1 });
  const starter = design === d.starter;
  const sample = (second: number): CapturedEvidence => {
    const cache = second > 60 && second <= 90 ? "failed" as const : "healthy" as const;
    const db = second === 91 || (starter && second >= 127) ? "saturated" as const : "healthy" as const;
    const overall = cache === "failed" ? "critical" as const : db === "saturated" ? "saturated" as const : "healthy" as const;
    const payload = { version: 2 as const, topologyRevision: 0, overallHealth: overall, loadFraction: 1, targetLoadFraction: 1,
      resources: [{ id: "cache", health: cache, cpu: cache === "failed" ? null : 20, memory: null }, { id: "db", health: db, cpu: db === "saturated" ? 97 : 60, memory: null }],
      pools: [{ id: "lb", currentReplicas: 4, baseReplicas: 4, pending: null }] };
    return { simulatedSeconds: second, sampledAt: new Date(), payload, hash: sampleHash(payload) };
  };
  const evidenceSamples = Array.from({ length: last - 29 }, (_, i) => sample(30 + i));
  const now = new Date(), parameters = { type: plan.fault, resourceId: plan.targetResourceId, trigger: "challenge-experiment" };
  const fault = { id: "fault", deploymentId: row.id, sequence: 1, scenarioStepId: null, kind: "chaos", parameters, status: last >= 90 ? "completed" : "running", requestedAt: now, appliedAt: now,
    appliedSimulatedSeconds: 60, completedAt: last >= 90 ? now : null, completedSimulatedSeconds: last >= 90 ? 90 : null, failureReason: null,
    outcome: { durationSimulatedSeconds: 30, baselineOverallHealth: "healthy", ...(last >= 90 ? { faultEnded: true, observedOverallHealth: "critical" } : {}) } };
  const final = evidenceSamples.at(-1)!.payload;
  return { ...row, evidenceSamples, actions: [fault] as StoredRun["actions"],
    terminalSnapshot: { ...(row.terminalSnapshot as object), simulatedSeconds: last, overallHealth: final.overallHealth } };
}
const row = () => recorded();

test("database session equality preserves v1 judging; strict spare capacity is opt-in", () => {
  for (const def of [definition("scale-out-safely"), d, afterTheCacheReturnsV2]) {
    const strict = def === afterTheCacheReturnsV2;
    const attempt = { challengeId: def.id, challengeVersion: def.version, challengeSpecHash: specHash(def),
      challengePrediction: answers(def, { "target-health": "healthy", "overall-health": "healthy", "database-health": "healthy", "scale-out": "yes" }),
      predictionSubmittedAt: new Date(), evaluationStopAtSimulatedSeconds: def.evaluationSeconds, challengeExperiment: recordedExperiment(def) };
    for (const [connections, status] of (strict ? [[84, "met"], [85, "not-met"], [86, "not-met"], [undefined, "not-evaluated"]] as const : [[100, "met"], [101, "not-met"], [undefined, "not-evaluated"]] as const)) {
      const judged = evaluateAttempt(attempt, { status: "torn-down", runtimeActive: false, input: def.starter!, stages: [], failure: null,
        terminal: { simulatedSeconds: def.evaluationSeconds, installedSkus: strict ? { db: "db.t3.micro" } : {}, resources: [{ id: "db", connections }] } });
      expect(judged.criteria.find(c => c.id === "connections")?.status).toBe(status);
    }
  }
});

test("authoring keeps legacy rules and rejects implicit, unsupported or unretainable observation windows", () => {
  const problems = (patch: Partial<typeof d>) => { const def = { ...d, ...patch }; return validateChallengeVersions([def], { [`${def.id}@1`]: specHash(def) }); };
  expect(problems({})).toEqual([]);
  expect(problems({ evaluationSeconds: 134 }).join(" ")).toContain("evaluation must be at second 135");
  for (const duration of [0, 61, 1.5]) expect(problems({ experiment: { ...d.experiment!, postFaultObservationSeconds: duration } }).join(" ")).toContain("postFaultObservationSeconds");
  expect(problems({ experiment: { ...d.experiment!, fault: Fault.MemoryLeak, postFaultObservationSeconds: 60 }, evaluationSeconds: 160 }).join(" ")).toContain("121 retained points");
  const legacy = definition("cache-failure");
  expect(legacy.experiment).not.toHaveProperty("postFaultObservationSeconds");
  expect(attemptReport(legacy, legacy.starter!, answers(legacy, { "baseline-health": "healthy", "database-health": "saturated" }), { stopAt: 1 }).experimentTrace?.observation?.status).toBe("not-applicable");
});

test("sample and resource gaps qualify first Healthy facts independently; a later gap does not erase an earlier fact", () => {
  const original = row();
  const missing91 = buildRunReport({ ...original, evidenceSamples: original.evidenceSamples!.filter((p) => p.simulatedSeconds !== 91) });
  expect(missing91.experimentTrace?.observation).toMatchObject({ sampleCount: 44,
    target: { firstHealthy: { second: 92, completeSinceFaultEnd: false } }, system: { firstHealthy: { second: 92, completeSinceFaultEnd: false } } });
  expect(missing91.guidedReview?.cues.find((c) => c.title === "After the fault")?.statement).toContain("after missing evidence");
  const resourceGap = structuredClone(original);
  for (const p of resourceGap.evidenceSamples!.filter((p) => p.simulatedSeconds === 91)) {
    const payload = p.payload as { resources: Array<{ id: string }> }; payload.resources = payload.resources.filter((r) => r.id !== "cache");
    p.hash = sampleHash(p.payload as Parameters<typeof sampleHash>[0]);
  }
  expect(buildRunReport(resourceGap).experimentTrace?.observation?.target.firstHealthy).toMatchObject({ second: 92, completeSinceFaultEnd: false });
  const laterGap = buildRunReport({ ...original, evidenceSamples: original.evidenceSamples!.filter((p) => p.simulatedSeconds !== 100) });
  expect(laterGap.experimentTrace?.observation?.target.firstHealthy?.completeSinceFaultEnd).toBe(true);
  const endGap = buildRunReport({ ...original, evidenceSamples: original.evidenceSamples!.filter((p) => p.simulatedSeconds !== 90) });
  expect(endGap.experimentTrace?.observation?.target.firstHealthy?.completeSinceFaultEnd).toBe(false);
  const delayed = structuredClone(original);
  const first = delayed.evidenceSamples!.find((p) => p.simulatedSeconds === 91)!;
  const payload = first.payload as { resources: Array<{ id: string; health: string }> };
  payload.resources.find((r) => r.id === "cache")!.health = "degraded";
  first.hash = sampleHash(first.payload as Parameters<typeof sampleHash>[0]);
  expect(buildRunReport(delayed).experimentTrace?.observation?.target.firstHealthy).toEqual({ second: 92, health: "healthy", completeSinceFaultEnd: true });
  delayed.evidenceSamples = delayed.evidenceSamples!.filter((p) => p.simulatedSeconds !== 91);
  expect(buildRunReport(delayed).experimentTrace?.observation?.target.firstHealthy).toEqual({ second: 92, health: "healthy", completeSinceFaultEnd: false });
});

test("pending provisioning at evaluation is derived only from the retained evaluation sample", () => {
  const original = row(), sample = original.evidenceSamples!.find((p) => p.simulatedSeconds === 135)!;
  const payload = sample.payload as { pools: Array<{ pending: { action: "up"; secondsRemaining: number } | null }> };
  payload.pools[0]!.pending = { action: "up", secondsRemaining: 17 };
  sample.hash = sampleHash(sample.payload as Parameters<typeof sampleHash>[0]);
  expect(buildRunReport(original).experimentTrace?.observation?.pendingPoolsAtEvaluation).toMatchObject([{ id: "lb", pending: { action: "up", secondsRemaining: 17 } }]);
  original.evidenceSamples = original.evidenceSamples!.filter((p) => p.simulatedSeconds !== 135);
  expect(buildRunReport(original).experimentTrace?.observation?.pendingPoolsAtEvaluation).toEqual([]);
});

test("no evidence, never Healthy and incomplete evidence are different observations", () => {
  const original = row();
  expect(buildRunReport({ ...original, evidenceSamples: [] }).experimentTrace?.observation).toMatchObject({ status: "no-samples", target: { status: "unknown" } });
  const unhealthy = structuredClone(original);
  for (const p of unhealthy.evidenceSamples!) if (p.simulatedSeconds > 90) {
    const payload = p.payload as { overallHealth: string; resources: Array<{ id: string; health: string }> };
    payload.overallHealth = "saturated"; payload.resources.find((r) => r.id === "cache")!.health = "degraded";
    p.hash = sampleHash(p.payload as Parameters<typeof sampleHash>[0]);
  }
  expect(buildRunReport(unhealthy).experimentTrace?.observation).toMatchObject({ target: { status: "unhealthy-through-window", firstHealthy: null }, system: { status: "unhealthy-through-window" } });
  unhealthy.evidenceSamples = unhealthy.evidenceSamples!.filter((p) => p.simulatedSeconds !== 95);
  expect(buildRunReport(unhealthy).experimentTrace?.observation?.target.status).toBe("unknown");
  const unverified = structuredClone(original); unverified.actions![0]!.completedSimulatedSeconds = 91;
  expect(buildRunReport(unverified).experimentTrace?.observation).toMatchObject({ status: "fault-end-unverified", sampleCount: 0, target: { firstHealthy: null } });
});

test("early stop and worker interruption during observation keep partial facts without evaluating or resuming", () => {
  const early = recorded(d.starter!, 95);
  const report = buildRunReport(early);
  expect(report.challenge?.status).toBe("not-evaluated");
  expect(report.experimentTrace).toMatchObject({ status: "incomplete", actualLast: 95, missingRanges: [{ start: 96, end: 135 }] });
  expect(report.experimentTrace?.observation).toMatchObject({ sampleCount: 5, target: { firstHealthy: { second: 91 }, healthAtEvaluation: null }, system: { healthAtEvaluation: null } });
  expect(report.challenge?.predictions.every((p) => p.outcome === "unknown")).toBe(true);
  const interrupted = buildRunReport({ ...early, status: "failed", terminalSnapshot: null,
    timeline: [{ event: "Simulation Interrupted", timestamp: new Date().toISOString(), message: "Worker stopped; no resume." }] });
  expect(interrupted.challenge?.status).toBe("not-evaluated");
  expect(interrupted.experimentTrace?.points).toEqual(report.experimentTrace?.points);
  expect(interrupted.experimentTrace?.moments?.evaluation).toBeNull();
  const expensive = (design: NonNullable<typeof d.starter>) => ({ ...design, resources: design.resources.map((r) => r.id === "db" ? { ...r, skuId: "db.m5.2xlarge" } : r) });
  const stopped = buildRunReport(recorded(expensive(d.starter!), 95));
  expect(stopped.challenge?.criteria.some((c) => c.status === "not-met")).toBe(true);
  expect(stopped.challenge?.status).toBe("not-evaluated");
});

test("Compare and improvement preserve observation conditions and present sample facts without a timing winner", () => {
  const a = row(), b = recorded(historicalReference);
  b.createdAt = new Date(a.createdAt.getTime() + 1000);
  const comparison = classifyComparison(a, b);
  expect(comparison.challengeConditions).toBe("same"); expect(comparison.designChangeReview?.count).toBe(1);
  expect(comparison.experimentEvidence?.comparable).toBe(true);
  expect(comparison.experimentEvidence?.traces.map((t) => t.observation?.system.healthAtEvaluation)).toEqual(["saturated", "healthy"]);
  expect(() => improvementSource(a, d.id)).toThrow("retired Model 1");
});

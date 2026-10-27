import { expect, test } from "bun:test";
import { DeploymentChaosNames as Fault, ResourceHealth } from "@infraforge/domain/resource";
import { createInitialState } from "@infraforge/simulation/engine";
import { captureRunInputs, engineSeed } from "../deployments/runInputs";
import { recordedExperiment } from "../challenges/experiment";
import { challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { improvementSource } from "../challenges/improvements";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import { sampleHash } from "../evidence/contract";
import { createEvidenceBuffer } from "../evidence/capture";
import { advanceTickBatch, experimentDue, reachedMatchedStop } from "../simulator/tickBatch";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { displaySimulationLogs } from "../simulator/logs";
import type { SimulationInstance } from "../simulator/instance";
import { answers, attemptReport, attemptRow, legacyDefinition as definition, REFERENCE } from "./challengeHarness";
import { observeCandidate } from "./recoveryExploration";

const d = definition("after-the-cache-returns"), plan = recordedExperiment(d)!;
const prediction = answers(d, { "target-health": "healthy", "overall-health": "saturated", "scale-out": "yes" });
const row = () => attemptRow(d, d.starter!, prediction);

test("presentation translates model log shorthand without changing engine behavior", () => {
  const logs = [
    { timestamp: "now", severity: "info" as const, resourceId: "cache", source: "chaos", message: "cache recovered from crash" },
    { timestamp: "now", severity: "info" as const, resourceId: "cache", source: "app", message: "utilization recovered on cache — cpu 4.5%" },
    { timestamp: "now", severity: "info" as const, resourceId: "lb", source: "nginx", message: "lb recovered — backends healthy, 502s stopped" },
  ];
  const displayed = displaySimulationLogs(logs);
  expect(displayed[0]?.message).toContain("injected fault ended");
  expect(displayed[1]?.message).toBe("cache recorded Healthy — CPU 4.5%");
  expect(displayed[2]?.message).toContain("previous-tick measurements");
  expect(displayed.some((l) => /recovered|502s stopped/.test(l.message))).toBe(false);
  expect(logs[0]?.message).toBe("cache recovered from crash");
});

test("published post-fault exercise has a fixed hash, failing starter and passing one-change reference", () => {
  expect(specHash(d)).toBe("4511ec082bcd0127140ea1689ccdc0fb5179362f891645ccef6008dde0e645e6");
  const starter = attemptReport(d, d.starter!, prediction);
  const reference = attemptReport(d, REFERENCE[d.id]!, answers(d, { "target-health": "healthy", "overall-health": "healthy", "scale-out": "yes" }));
  expect(starter.challenge?.status).toBe("not-met"); expect(reference.challenge?.status).toBe("met");
  for (const report of [starter, reference]) {
    expect(report.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched"]);
    expect(report.challenge?.experiment).toMatchObject({ state: "ended", appliedSimulatedSeconds: 60, endedSimulatedSeconds: 90 });
    expect(report.experimentTrace).toMatchObject({ status: "complete", sampleCount: 106, expectedStart: 30, expectedEnd: 135 });
    expect(report.experimentTrace?.observation).toMatchObject({ status: "samples-retained", sampleCount: 45,
      target: { firstSample: { second: 91, health: "healthy" }, firstHealthy: { second: 91, completeSinceFaultEnd: true } },
      system: { firstHealthy: { second: 92, completeSinceFaultEnd: true } } });
  }
  expect(starter.experimentTrace?.observation?.system.healthAtEvaluation).toBe("saturated");
  expect(reference.experimentTrace?.observation?.system.healthAtEvaluation).toBe("healthy");
  const point = (second: number) => starter.experimentTrace!.points.find((p) => p.simulatedSeconds === second)!;
  expect(point(90).resources.find((r) => r.id === "cache")?.health).toBe("failed");
  expect(point(91).resources.find((r) => r.id === "cache")?.health).toBe("healthy");
  expect(point(91).resources.find((r) => r.id === "db")?.health).toBe("saturated");
  expect(point(125).pools[0]?.pending?.secondsRemaining).toBe(1);
  expect(point(126).pools[0]?.currentReplicas).toBe(6);
  expect(point(127).resources.find((r) => r.id === "db")).toMatchObject({ health: "saturated", connections: 120 });
  expect(starter.guidedReview?.cues.map((c) => c.title)).toEqual(["Expectation", "Fault", "After the fault", "Evaluation", "Unknown"]);
});

test("authoring keeps legacy rules and rejects implicit, unsupported or unretainable observation windows", () => {
  const problems = (patch: Partial<typeof d>) => { const def = { ...d, ...patch }; return validateChallengeVersions([def], { [`${def.id}@1`]: specHash(def) }); };
  expect(problems({})).toEqual([]);
  expect(problems({ evaluationSeconds: 134 }).join(" ")).toContain("evaluation must be at second 135");
  for (const duration of [0, 61, 1.5]) expect(problems({ experiment: { ...d.experiment!, postFaultObservationSeconds: duration } }).join(" ")).toContain("postFaultObservationSeconds");
  expect(problems({ experiment: { ...d.experiment!, fault: Fault.MemoryLeak, postFaultObservationSeconds: 60 }, evaluationSeconds: 160 }).join(" ")).toContain("121 retained points");
  const legacy = definition("cache-failure");
  expect(legacy.experiment).not.toHaveProperty("postFaultObservationSeconds");
  expect(attemptReport(legacy, legacy.starter!, answers(legacy, { "baseline-health": "healthy", "database-health": "saturated" })).experimentTrace?.observation?.status).toBe("not-applicable");
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
  const early = attemptRow(d, d.starter!, prediction, { stopAt: 95 });
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
  const legacy = definition("cache-failure");
  expect(attemptReport(legacy, expensive(legacy.starter!), answers(legacy, { "baseline-health": "healthy", "database-health": "healthy" }), { stopAt: 75 }).challenge?.status).toBe("not-met");
  const stopped = attemptReport(d, expensive(d.starter!), prediction, { stopAt: 95 });
  expect(stopped.challenge?.criteria.some((c) => c.status === "not-met")).toBe(true);
  expect(stopped.challenge?.status).toBe("not-evaluated");
});

test("Compare and improvement preserve observation conditions and present sample facts without a timing winner", () => {
  const a = row(), b = attemptRow(d, REFERENCE[d.id]!, prediction);
  b.createdAt = new Date(a.createdAt.getTime() + 1000);
  const comparison = classifyComparison(a, b);
  expect(comparison.challengeConditions).toBe("same"); expect(comparison.designChangeReview?.count).toBe(1);
  expect(comparison.experimentEvidence?.comparable).toBe(true);
  expect(comparison.experimentEvidence?.traces.map((t) => t.observation?.system.healthAtEvaluation)).toEqual(["saturated", "healthy"]);
  expect(improvementSource(a, d.id).definition.experiment?.postFaultObservationSeconds).toBe(45);
  expect(() => improvementSource({ ...a, evaluationStopAtSimulatedSeconds: 120 }, d.id)).toThrow();
});

for (const speed of [1, 10, 60]) test(`${speed}x captures every post-fault second and stops exactly at 135 without overshoot`, async () => {
  for (const design of [d.starter!, REFERENCE[d.id]!]) {
    const input = captureRunInputs(design, d.workload, challengeSeed(d));
    const instance: SimulationInstance = { state: createInitialState("batch", input.resources, input.connectionLines, input.workloadProfile, engineSeed(input.seed)),
      tickCount: 0, pendingLogs: [], speed, lastCheckpointAt: 0, accumulatedCostUsd: 0, topology: input, topologyRevision: 0,
      actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
      autoStopAtSimulatedSeconds: 135, experiment: { plan, phase: "scheduled" }, evidence: createEvidenceBuffer(plan, 135) };
    while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {});
    expect(instance.state!.simulatedSeconds).toBe(60);
    applyAction(instance, "fault", { kind: "chaos", parameters: { type: Fault.Crash, resourceId: "cache", trigger: "challenge-experiment" } });
    instance.experiment!.phase = "applied";
    const completed: number[] = [];
    while (!reachedMatchedStop(instance)) await advanceTickBatch(instance, async (r) => {
      const running = r.actions.get("fault");
      if (running && actionCompletion(r, running)) { completed.push(r.state!.simulatedSeconds); r.actions.delete("fault"); }
    });
    await advanceTickBatch(instance, async () => {});
    expect(completed).toEqual([90]); expect(instance.state!.simulatedSeconds).toBe(135);
    const expected = attemptRow(d, design, prediction).evidenceSamples!;
    expect(instance.evidence!.pending.map((p) => p.hash)).toEqual(expected.map((p) => p.hash));
  }
});

for (const fault of Object.values(Fault))
  test(`model 1 ${fault}: last active metrics precede removal; next tick is actual post-fault evidence`, () => {
    const result = observeCandidate(d.starter!, { fault, target: "cache", rps: 300, seed: challengeSeed(d) });
    const last = result.samples.find((p) => p.second === result.end)!;
    expect(last.active).toBe(0);
    if (fault === "crash") expect(last.metrics.cache?.health).toBe(ResourceHealth.FAILED);
    if (fault === "disk-failure") expect(last.metrics.cache?.cpu).toBeGreaterThan(95);
    if (fault === "memory-leak") expect(last.metrics.cache?.memory).toBe(100);
    const next = result.samples.find((p) => p.second === result.end + 1)!;
    expect(next.active).toBe(0); expect(next.metrics.cache?.health).toBe(ResourceHealth.HEALTHY);
    expect(next.metrics.cache?.memory).toBeLessThan(70);
  });

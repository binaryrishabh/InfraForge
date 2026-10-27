import { expect, test } from "bun:test";
import { createInitialState } from "@infraforge/simulation/engine";
import { experimentWindow } from "@infraforge/contracts/reports";
import { captureRunInputs, engineSeed } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { recordedExperiment } from "../challenges/experiment";
import { createEvidenceBuffer } from "../evidence/capture";
import type { CapturedEvidence } from "../evidence/contract";
import { evidencePayload, sampleHash } from "../evidence/contract";
import { buildExperimentTrace } from "../evidence/report";
import { advanceTickBatch, experimentDue, reachedMatchedStop } from "../simulator/tickBatch";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import type { SimulationInstance } from "../simulator/instance";
import { definition } from "./challengeHarness";

const d = definition("lose-an-app-server"), plan = recordedExperiment(d)!;
function run(speed: number, def = d): SimulationInstance {
  const input = captureRunInputs(def.starter, def.workload, challengeSeed(def)), experiment = recordedExperiment(def)!;
  return { state: createInitialState("trace", input.resources, input.connectionLines, input.workloadProfile, engineSeed(input.seed)),
    tickCount: 0, pendingLogs: [], speed, lastCheckpointAt: 0, accumulatedCostUsd: 0, topology: input, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: def.evaluationSeconds, experiment: { plan: experiment, phase: "scheduled" }, evidence: createEvidenceBuffer(experiment, def.evaluationSeconds) };
}
const read = (points: CapturedEvidence[]) => buildExperimentTrace({ challengeExperiment: plan, evaluationStopAtSimulatedSeconds: 90, evidenceSamples: points });

for (const speed of [1, 10, 60]) test(`${speed}x retains every completed tick; fault-second measurement precedes application`, async () => {
  const instance = run(speed), saved: CapturedEvidence[] = [];
  const persist = async (r: SimulationInstance) => { saved.push(...r.evidence!.pending); r.evidence!.pending.length = 0; };
  while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(saved.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 31 }, (_, i) => 30 + i));
  const atFault = saved.at(-1)!;
  expect(atFault.payload.resources.find((r) => r.id === "app-2")!.health).toBe("healthy");
  applyAction(instance, "fault", { kind: "chaos", parameters: { type: plan.fault, resourceId: plan.targetResourceId, trigger: "challenge-experiment" } });
  instance.experiment!.phase = "applied";
  while (!reachedMatchedStop(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(saved.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 61 }, (_, i) => 30 + i));
  expect(saved.find((p) => p.simulatedSeconds === 61)!.payload.resources.find((r) => r.id === "app-2")!.health).toBe("failed");
  const report = read(saved);
  expect(report.status).toBe("complete"); expect(report.missingRanges).toEqual([]);
  expect(report.moments).toMatchObject({ beforeFault: 59, atFault: 60, firstAfterFault: 61, evaluation: 90 });
  expect(report.resourceFacts.find((r) => r.id === "app-2")?.firstHealthyAfterFault).toBeNull();
});

test("a failed/lost batch reply freezes and retries the identical captures before any further tick", async () => {
  const instance = run(60), saved = new Map<number, CapturedEvidence>();
  let fail = true, original: CapturedEvidence[] = [];
  const persist = async (r: SimulationInstance) => {
    const pending = r.evidence!.pending;
    if (!pending.length) return;
    for (const p of pending) { const old = saved.get(p.simulatedSeconds); if (old && old.hash !== p.hash) throw new Error("conflict"); saved.set(p.simulatedSeconds, p); }
    if (fail) { original = [...pending]; throw new Error("reply lost"); }
    pending.length = 0;
  };
  await expect(advanceTickBatch(instance, async () => {}, undefined, persist)).rejects.toThrow("reply lost");
  expect(instance.state.simulatedSeconds).toBe(60);
  await expect(advanceTickBatch(instance, async () => {}, undefined, persist)).rejects.toThrow("reply lost");
  expect(instance.state.simulatedSeconds).toBe(60); expect(instance.evidence!.pending).toEqual(original);
  fail = false;
  await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(instance.state.simulatedSeconds).toBe(60); expect(saved.size).toBe(31);
  expect([...saved.values()].map((p) => p.sampledAt)).toEqual(original.map((p) => p.sampledAt));
});

test("early stop/restart retains partial facts and bounded gaps; no implicit recovery or interpolation", async () => {
  const instance = run(60);
  await advanceTickBatch(instance, async () => {});
  const saved = [...instance.evidence!.pending];
  const interrupted = read(saved.filter((p) => ![40, 41].includes(p.simulatedSeconds)));
  expect(interrupted.status).toBe("incomplete");
  expect(interrupted.missingRanges).toEqual([{ start: 40, end: 41 }, { start: 61, end: 90 }]);
  expect(interrupted.actualLast).toBe(60); expect(interrupted.moments?.evaluation).toBeNull();
  expect(interrupted.points.some((p) => p.simulatedSeconds === 40)).toBe(false);
  const forged = structuredClone(saved); forged[0]!.payload.resources[0]!.cpu = 99;
  expect(read(forged).status).toBe("incomplete");
});

test("normal runs do not allocate a trace, legacy remains unavailable, and window/payload/hash bounds are explicit", async () => {
  expect(createEvidenceBuffer(null, 90)).toBeNull();
  expect(buildExperimentTrace({ inputVersion: 2 }).status).toBe("not-applicable");
  expect(buildExperimentTrace({}).status).toBe("unavailable");
  expect(read([]).status).toBe("unavailable");
  expect(experimentWindow(plan, 90)).toEqual({ start: 30, end: 90 });
  expect(experimentWindow(plan, 200)).toBeNull();
  const instance = run(60);
  await advanceTickBatch(instance, async () => {});
  const p = instance.evidence!.pending[0]!.payload;
  expect(evidencePayload.safeParse({ ...p, logs: [] }).success).toBe(false);
  // New samples are version 2, which can say a value is unknown instead of recording zero; version 1 cannot.
  expect(p.version).toBe(2);
  const unknown = { ...p, resources: [{ ...p.resources[0]!, cpu: null, memory: null, health: "unknown" }] };
  expect(evidencePayload.safeParse(unknown).success).toBe(true);
  expect(evidencePayload.safeParse({ ...unknown, version: 1 }).success).toBe(false);
  expect(evidencePayload.safeParse({ ...p, version: 1 }).success).toBe(true);
  expect(evidencePayload.safeParse({ ...p, resources: Array.from({ length: 129 }, (_, i) => ({ ...p.resources[0]!, id: String(i) })) }).success).toBe(false);
  expect(sampleHash(p)).toBe(sampleHash({ ...p, resources: [...p.resources].reverse() }));
  instance.evidence = null;
  await advanceTickBatch(instance, async () => {});
  expect(instance.evidence).toBeNull();
});

test("an uncapturable tick freezes instead of dropping a sample and continuing", async () => {
  const instance = run(60);
  instance.topologyRevision = 1_000_001; instance.metricsTopologyRevision = instance.topologyRevision;
  await expect(advanceTickBatch(instance, async () => {})).rejects.toThrow("advancement is frozen");
  expect(instance.state.simulatedSeconds).toBe(30);
  await expect(advanceTickBatch(instance, async () => {})).rejects.toThrow("advancement is frozen");
  expect(instance.state.simulatedSeconds).toBe(30);
});

for (const speed of [1, 10, 60]) test(`CPU spike schedules at 60 and ends at 80 at ${speed}x, with 51 exact tick samples`, async () => {
  const def = definition("headroom-under-cpu-pressure"), instance = run(speed, def), saved: CapturedEvidence[] = [];
  const persist = async (r: SimulationInstance) => { saved.push(...r.evidence!.pending); r.evidence!.pending.length = 0; };
  while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(instance.state.simulatedSeconds).toBe(60); expect(saved.at(-1)?.simulatedSeconds).toBe(60);
  applyAction(instance, "fault", { kind: "chaos", parameters: { type: instance.experiment!.plan.fault, resourceId: "app-2", trigger: "challenge-experiment" } });
  instance.experiment!.phase = "applied";
  const completed: number[] = [];
  while (!reachedMatchedStop(instance)) await advanceTickBatch(instance, async (r) => {
    if (actionCompletion(r, r.actions.get("fault")!)) completed.push(r.state.simulatedSeconds);
  }, undefined, persist);
  expect(completed).toEqual([80]); expect(saved.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 51 }, (_, i) => 30 + i));
});

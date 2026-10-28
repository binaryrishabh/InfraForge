import { expect, test } from "bun:test";
import { experimentWindow } from "@infraforge/contracts/reports";
import { captureRunInputs } from "../deployments/runInputs";
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
import { currentSecond } from "../simulator/engineView";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { definition } from "./challengeHarness";

// app-2 crashes at second 30 for 30 seconds; the attempt is judged at second 60, so evidence covers seconds 1 to 60.
const d = definition("lose-an-app-server"), plan = recordedExperiment(d)!;
function run(speed: number, def = d): SimulationInstance {
  const input = captureRunInputs(def.starter, def.workload, challengeSeed(def)), experiment = recordedExperiment(def)!;
  return { model2: createModel2Engine(input, def.evaluationSeconds, buildModel2Contract),
    tickCount: 0, pendingLogs: [], speed, lastCheckpointAt: 0, accumulatedCostUsd: 0, topology: input, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: def.evaluationSeconds, experiment: { plan: experiment, phase: "scheduled" }, evidence: createEvidenceBuffer(experiment, def.evaluationSeconds) };
}
const read = (points: CapturedEvidence[]) => buildExperimentTrace({ challengeExperiment: plan, evaluationStopAtSimulatedSeconds: 60, evidenceSamples: points });

for (const speed of [1, 10, 60]) test(`${speed}x retains every completed tick; fault-second measurement precedes application`, async () => {
  const instance = run(speed), saved: CapturedEvidence[] = [];
  const persist = async (r: SimulationInstance) => { saved.push(...r.evidence!.pending); r.evidence!.pending.length = 0; };
  while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(saved.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 30 }, (_, i) => 1 + i));
  const atFault = saved.at(-1)!;
  expect(atFault.payload.resources.find((r) => r.id === "app-2")!.health).toBe("healthy");
  applyAction(instance, "fault", { kind: "chaos", parameters: { type: plan.fault, resourceId: plan.targetResourceId, trigger: "challenge-experiment" } });
  instance.experiment!.phase = "applied";
  while (!reachedMatchedStop(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(saved.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 60 }, (_, i) => 1 + i));
  expect(saved.find((p) => p.simulatedSeconds === 31)!.payload.resources.find((r) => r.id === "app-2")!.health).toBe("failed");
  const report = read(saved);
  expect(report.status).toBe("complete"); expect(report.missingRanges).toEqual([]);
  expect(report.moments).toMatchObject({ beforeFault: 29, atFault: 30, firstAfterFault: 31, evaluation: 60 });
  expect(report.resourceFacts.find((r) => r.id === "app-2")?.firstHealthyAfterFault).toBeNull();
}, 60000);

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
  const reached = currentSecond(instance);
  expect(reached).toBeGreaterThan(0);
  await expect(advanceTickBatch(instance, async () => {}, undefined, persist)).rejects.toThrow("reply lost");
  expect(currentSecond(instance)).toBe(reached); expect(instance.evidence!.pending).toEqual(original);
  fail = false;
  while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(currentSecond(instance)).toBe(30); expect(saved.size).toBe(30);
  expect([...saved.values()].slice(0, original.length).map((p) => p.sampledAt)).toEqual(original.map((p) => p.sampledAt));
}, 60000);

test("early stop/restart retains partial facts and bounded gaps; no implicit recovery or interpolation", async () => {
  const instance = run(60);
  while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {});
  const saved = [...instance.evidence!.pending];
  const interrupted = read(saved.filter((p) => ![10, 11].includes(p.simulatedSeconds)));
  expect(interrupted.status).toBe("incomplete");
  expect(interrupted.missingRanges).toEqual([{ start: 10, end: 11 }, { start: 31, end: 60 }]);
  expect(interrupted.actualLast).toBe(30); expect(interrupted.moments?.evaluation).toBeNull();
  expect(interrupted.points.some((p) => p.simulatedSeconds === 10)).toBe(false);
  const forged = structuredClone(saved); forged[0]!.payload.resources[0]!.cpu = 99;
  expect(read(forged).status).toBe("incomplete");
}, 60000);

test("normal runs do not allocate a trace, legacy remains unavailable, and window/payload/hash bounds are explicit", async () => {
  expect(createEvidenceBuffer(null, 90)).toBeNull();
  expect(buildExperimentTrace({ inputVersion: 2 }).status).toBe("not-applicable");
  expect(buildExperimentTrace({}).status).toBe("unavailable");
  expect(read([]).status).toBe("unavailable");
  expect(experimentWindow(plan, 60)).toEqual({ start: 1, end: 60 });
  expect(experimentWindow({ ...plan, atSimulatedSecond: 60 }, 90)).toEqual({ start: 30, end: 90 });
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
  // Model 2 leaves CPU and memory unknown where it does not model them; only fully known samples fit version 1.
  expect(p.resources.some((r) => r.memory === null)).toBe(true);
  expect(evidencePayload.safeParse({ ...p, version: 1 }).success).toBe(false);
  expect(evidencePayload.safeParse({ ...p, version: 1, resources: [{ ...p.resources[0]!, cpu: 10, memory: 20, health: "healthy" }] }).success).toBe(true);
  expect(evidencePayload.safeParse({ ...p, resources: Array.from({ length: 129 }, (_, i) => ({ ...p.resources[0]!, id: String(i) })) }).success).toBe(false);
  expect(sampleHash(p)).toBe(sampleHash({ ...p, resources: [...p.resources].reverse() }));
  instance.evidence = null;
  await advanceTickBatch(instance, async () => {});
  expect(instance.evidence).toBeNull();
}, 60000);

test("an uncapturable tick freezes instead of dropping a sample and continuing", async () => {
  const instance = run(60);
  instance.topologyRevision = 1_000_001; instance.metricsTopologyRevision = instance.topologyRevision;
  await expect(advanceTickBatch(instance, async () => {})).rejects.toThrow("advancement is frozen");
  expect(currentSecond(instance)).toBe(1);
  await expect(advanceTickBatch(instance, async () => {})).rejects.toThrow("advancement is frozen");
  expect(currentSecond(instance)).toBe(1);
}, 60000);

for (const speed of [1, 10, 60]) test(`CPU spike schedules at 30 and ends at 50 at ${speed}x, with 50 exact tick samples`, async () => {
  const def = definition("headroom-under-cpu-pressure"), instance = run(speed, def), saved: CapturedEvidence[] = [];
  const persist = async (r: SimulationInstance) => { saved.push(...r.evidence!.pending); r.evidence!.pending.length = 0; };
  while (!experimentDue(instance)) await advanceTickBatch(instance, async () => {}, undefined, persist);
  expect(currentSecond(instance)).toBe(30); expect(saved.at(-1)?.simulatedSeconds).toBe(30);
  applyAction(instance, "fault", { kind: "chaos", parameters: { type: instance.experiment!.plan.fault, resourceId: "app-2", trigger: "challenge-experiment" } });
  instance.experiment!.phase = "applied";
  const completed: number[] = [];
  while (!reachedMatchedStop(instance)) await advanceTickBatch(instance, async (r) => {
    if (actionCompletion(r, r.actions.get("fault")!)) completed.push(currentSecond(r));
  }, undefined, persist);
  expect(completed).toEqual([50]); expect(saved.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 50 }, (_, i) => 1 + i));
}, 60000);

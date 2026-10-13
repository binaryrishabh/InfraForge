import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { classifyComparison } from "../comparison/classify";
import { compareInputs } from "../comparison/inputs";
import { normalizedFinalState } from "../comparison/outcomes";
import type { StoredRun } from "../reports/report";
import type { RunAction } from "../lib/generated/prisma/client";
import { layout, workload } from "./integration/scenario";

const at = new Date("2026-10-13T10:00:00.000Z");
const captured = { ...captureRunInputs(layout, workload), seed: "comparison-seed" };
const terminal = { version: 1, kind: "terminal", capturedAt: at.toISOString(), topologyRevision: 0,
  metricsComputedAt: at.toISOString(), metricsTopologyRevision: 0, simulatedSeconds: 20,
  overallHealth: "healthy", loadFraction: 1, targetLoadFraction: 1, accumulatedCostUsd: 0.02, burnRatePerHourUsd: 3.6,
  metrics: { "vm-a": { cpu: 25, memory: 20, rps: 100, connections: 3, health: "healthy" } },
  activeChaos: [], restarting: [], pools: {}, installedSkus: { "vm-a": "m5.large" } };
function row(id: string, changes: Partial<StoredRun> = {}): StoredRun {
  return { id, infrastructureId: "design", runName: id, status: "torn-down", resourceCount: 5,
    createdAt: at, updatedAt: at, topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
    workloadProfile: captured.workloadProfile, seed: captured.seed, simulationState: null,
    runInputs: structuredClone(captured), liveTopology: layout, terminalSnapshot: structuredClone(terminal), actions: [], actionCount: 0, ...changes };
}
function action(kind = "load", seconds = 5, parameters: object = { targetLoadFraction: 0.5 }): RunAction {
  return { id: "action", deploymentId: "a", sequence: 1, kind, parameters, status: "completed", requestedAt: at, appliedAt: at,
    completedAt: at, appliedSimulatedSeconds: seconds, completedSimulatedSeconds: seconds,
    outcome: kind === "speed" ? { previousSpeed: 1, appliedSpeed: 60 } : { previousTarget: 1, appliedTarget: 0.5 }, failureReason: null };
}
const pair = (a: Partial<StoredRun> = {}, b: Partial<StoredRun> = {}) => classifyComparison(row("a", a), row("b", b));

test("orders ties by ID and compares deterministic normalized final state without wall identifiers", () => {
  const c = classifyComparison(row("b", { terminalSnapshot: { ...terminal, capturedAt: "2026-10-13T11:00:00.000Z", deploymentId: "b" } }), row("a"));
  expect(c.runs.map((r) => r.id)).toEqual(["a", "b"]);
  expect(c.starting.grade).toBe("same-starting-point");
  expect(c.headline).toBe("determinism-match");
  expect(c.evidence.deterministicState).toBe("matches");
  expect(normalizedFinalState(c.evidence.states[0]!)).toBe(normalizedFinalState(c.evidence.states[1]!));
  const mismatch = pair({}, { terminalSnapshot: { ...terminal, accumulatedCostUsd: 0.03 } });
  expect(mismatch.headline).toBe("determinism-mismatch");
  expect(mismatch.interpreted.at(-1)?.message).toContain("determinism defect");
});

test("classifies workload, seed, design, presentation-only and multiple changes separately", () => {
  const differentWorkload = { ...captured, workloadProfile: { ...captured.workloadProfile, targetThroughput: 600000 } };
  expect(pair({}, { runInputs: differentWorkload }).starting.grade).toBe("one-change-workload");
  expect(pair({}, { runInputs: { ...captured, seed: "other" } }).starting.grade).toBe("same-setup-different-seed");
  const changed = structuredClone(captured); changed.resources[2]!.skuId = "m5.xlarge";
  expect(pair({}, { runInputs: changed }).starting.grade).toBe("one-change-design");
  expect(pair({}, { runInputs: { ...changed, seed: "other" } }).starting.grade).toBe("several-things-changed");
  const moved = structuredClone(captured); moved.resources[0]!.x += 42; moved.resources[0]!.name = "New label";
  expect(pair({}, { runInputs: moved }).starting.grade).toBe("same-starting-point");
  expect(pair({}, { runInputs: changed }).starting.design?.reconfigured).toEqual([{ id: "vm-a", fields: [{ field: "skuId", earlier: "m5.large", later: "m5.xlarge" }] }]);
});

test("missing/different model/catalog provenance degrades; future models have unknown jitter rules", () => {
  for (const input of [null, { ...captured, version: 1 }, { ...captured, simulationModelVersion: "2" }, { ...captured, catalogSnapshot: "other" }]) {
    expect(pair({}, { runInputs: input }).starting.grade).toBe("side-by-side-only");
    expect(pair({}, { runInputs: input }).headline).toBe("descriptive-only");
  }
  const future = { ...captured, simulationModelVersion: "future" };
  expect(compareInputs(future, future).alignment.code).toBe("unknown");
});

test("starting positional alignment handles append, removal, reorder and never grades spawned resources", () => {
  const appended = { ...captured, resources: [...captured.resources, { id: "extra", type: "DNS" as const, x: 0, y: 0 }] };
  expect(compareInputs(captured, appended).alignment.aligned).toEqual(captured.resources.map((r) => r.id));
  const removed = { ...captured, resources: captured.resources.filter((r) => r.id !== "lb") };
  expect(compareInputs(captured, removed).alignment.aligned).toEqual(["dns"]);
  expect(compareInputs(captured, removed).alignment.shifted.map((r) => r.id)).toEqual(["vm-a", "vm-b", "db"]);
  const reordered = { ...captured, resources: [captured.resources[1]!, captured.resources[0]!, ...captured.resources.slice(2)] };
  expect(compareInputs(captured, reordered).alignment.shifted.map((r) => r.id)).toEqual(["dns", "lb"]);
  expect(pair({ terminalSnapshot: { ...terminal, metrics: { ...terminal.metrics, spawned: terminal.metrics["vm-a"] } } }).starting.alignment.aligned).not.toContain("spawned");
  expect(compareInputs(captured, appended).alignment.scope).toContain("Dynamic spawned resources are not graded");
  const numeric = { ...captured, resources: [{ id: "2", type: "DNS" as const, x: 0, y: 0 }, { id: "1", type: "DNS" as const, x: 0, y: 0 }] };
  expect(compareInputs(numeric, numeric).alignment.code).toBe("unknown");
});

test("conduct uses actual application/completion/outcome and speed is displayed without being an input difference", () => {
  const a = action();
  expect(pair({ actions: [a], actionCount: 1 }, { actions: [{ ...a, id: "other", deploymentId: "b" }], actionCount: 1 }).conduct.code).toBe("same");
  expect(pair({ actions: [a], actionCount: 1 }, { actions: [action("load", 6)], actionCount: 1 }).conduct.code).toBe("different");
  const speed = action("speed", 0, { speed: 60 });
  const c = pair({}, { actions: [speed], actionCount: 1 });
  expect(c.conduct.code).toBe("same"); expect(c.conduct.actions[1]).toHaveLength(1);
  expect(c.conduct.speedNote).toContain("when later human actions land");
  expect(c.headline).toBe("determinism-match");
  const sameSpeedA = [speed, { ...a, sequence: 2 }];
  const sameSpeedB = [speed, { ...action("load", 7), sequence: 2 }];
  expect(pair({ actions: sameSpeedA, actionCount: 2 }, { actions: sameSpeedB, actionCount: 2 }).conduct.code).toBe("different");
});

test("malformed/truncated/legacy and uncertain conduct cannot establish equivalence", () => {
  for (const changes of [{ actionCount: 501 }, { actions: [action("unknown")], actionCount: 1 },
    { actions: [{ ...action(), status: "failed", appliedSimulatedSeconds: null }], actionCount: 1 },
    { chaosEvents: [{ timestamp: at.toISOString(), type: "crash", resourceId: "vm-a", message: "request" }] }]) {
    expect(pair(changes).conduct.code).toBe("unknown");
  }
});

test("exact/checkpoint/missing evidence and unequal durations withhold appropriate deltas", () => {
  const shorter = pair({}, { terminalSnapshot: { ...terminal, simulatedSeconds: 10 } });
  expect(shorter.evidence.matchedDuration).toBe(false);
  expect(shorter.costs[1]?.delta).toBeNull(); expect(shorter.costs[1]?.earlier).toBe(0.02);
  expect(shorter.costs[1]?.withheldReason).toContain("matching simulated durations");
  const checkpoint = pair({}, { terminalSnapshot: null, simulationState: terminal });
  expect(checkpoint.evidence.code).toBe("exact-and-checkpoint");
  expect(checkpoint.resources[0]?.metrics.every((m) => m.delta === null)).toBe(true);
  expect(pair({ terminalSnapshot: null, simulationState: terminal }, { terminalSnapshot: null, simulationState: terminal }).evidence.code).toBe("checkpoints-only");
  expect(pair({}, { terminalSnapshot: null }).evidence.code).toBe("missing");
  expect(pair({}, { status: "live" }).available).toBe(false);
});

test("monthly catalog delta and final measurement freshness are independently labelled", () => {
  const stage = { name: "CostEstimate", status: "completed", startedAt: at.toISOString(), completedAt: at.toISOString(), message: "estimate", details: { monthlyEstimate: 25 } };
  expect(pair({ stages: [stage] }, { stages: [{ ...stage, details: { monthlyEstimate: 30 } }] }).costs[2]?.delta).toBe(5);
  expect(pair({ stages: [stage] }, { runInputs: { ...captured, catalogSnapshot: "other" }, stages: [stage] }).costs[2]?.delta).toBeNull();
  expect(pair({}, { terminalSnapshot: { ...terminal, metricsTopologyRevision: 0, topologyRevision: 2 } }).evidence.states[1]?.measurementFreshness).toBe("previous-revision");
});

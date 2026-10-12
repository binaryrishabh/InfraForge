import { describe, expect, test } from "bun:test";
import { buildRunReport, summarizeRun, type StoredRun } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { layout, workload } from "./integration/scenario";

const time = "2026-10-11T10:00:00.000Z";
function row(overrides: Partial<StoredRun> = {}): StoredRun {
  const input = { ...captureRunInputs(layout, workload), seed: "repeatable-report" };
  return { id: "11111111-1111-4111-8111-111111111111", infrastructureId: "design", infrastructure: { name: "Recorded architecture" },
    status: "completed", resourceCount: 5, createdAt: new Date(time), updatedAt: new Date(time), topologyRevision: 0,
    stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed,
    simulationState: null, runInputs: input, liveTopology: layout, ...overrides };
}
const costStage = { name: "CostEstimate", status: "completed", message: "Recorded monthly estimate",
  startedAt: time, completedAt: time, details: { monthlyEstimate: 74.25 } };

describe("durable run reports", () => {
  test("is deterministic, does not mutate records, and uses captured workload and seed", () => {
    const saved = row({ workloadProfile: { ...workload, targetThroughput: 1 }, seed: "stale-legacy-value" });
    const before = JSON.stringify(saved);
    const first = buildRunReport(saved);
    expect(JSON.stringify(buildRunReport(saved))).toBe(JSON.stringify(first));
    expect(JSON.stringify(saved)).toBe(before);
    expect(first.run.workload?.targetThroughput).toBe(workload.targetThroughput);
    expect(first.run.workloadSource).toBe("captured");
    expect(first.originalSeed).toBe("repeatable-report");
    expect(first.legacySeed).toBeNull();
  });

  test("a completed run without telemetry has no fabricated final health, metrics, duration or costs", () => {
    const report = buildRunReport(row());
    expect(report.run.status).toBe("completed");
    expect(report.run.hasReportData).toBe(false);
    expect(report.checkpoint).toBeNull();
    expect(report.interpreted).toEqual([]);
    expect(report.stages).toEqual([]);
    expect(report.unknown.join(" ")).toContain("Final resource health, CPU, memory and accumulated cost are unknown");
    expect(report.observed.some((fact) => fact.message.includes("healthy"))).toBe(false);
    expect(report.run.chaosEventCount).toBe(0);
    expect(report.observed.find((fact) => fact.id === "chaos-requests")?.message).toBe("0 chaos requests were recorded.");
  });

  test("a failed gate retains the actual reason without inventing a failed stage or recovery", () => {
    const report = buildRunReport(row({ status: "failed", timeline: [{ timestamp: time, event: "Deployment Failed", message: "No DNS entry point" }] }));
    expect(report.stages).toEqual([]);
    expect(report.observed.find((fact) => fact.id === "failure")?.message).toBe("No DNS entry point");
    expect(report.inspectNext[0]).toContain("recorded failure");
    expect(report.run.hasReportData).toBe(true);
    const interrupted = buildRunReport(row({ status: "failed", timeline: [{ timestamp: time, event: "Simulation Interrupted", message: "Worker restarted" }] }));
    expect(interrupted.observed.find((fact) => fact.id === "failure")?.message).toBe("Worker restarted");
  });

  test("a torn-down run labels its checkpoint as diagnostic, and CPU headroom stays tied to that snapshot", () => {
    const report = buildRunReport(row({ status: "torn-down", simulationState: { simulatedSeconds: 61, loadFraction: 1.5,
      overallHealth: "critical", accumulatedCostUsd: 0.0123, metrics: { "vm-a": { cpu: 92, memory: 40, rps: 200, connections: 4, health: "failed" }, db: { cpu: 89.9 } } } }));
    expect(report.checkpoint?.resources[0]).toMatchObject({ id: "vm-a", health: "failed", cpu: 92 });
    expect(report.checkpoint?.resources[1]).toEqual({ id: "db", cpu: 89.9 });
    expect(report.interpreted).toHaveLength(1);
    expect(report.interpreted[0]?.sources).toEqual(["simulationState.metrics.vm-a.cpu"]);
    expect(report.interpreted[0]?.message).toContain("at this checkpoint");
    expect(report.unknown.join(" ")).toContain("may predate the last controls or teardown");
    expect(report.unknown.join(" ")).toContain("updated time is not its measurement time");
    expect(report.unknown.join(" ")).toContain("full historical telemetry series");
  });

  test("chaos means recorded requests, not proof of a crash, causal bottleneck, recovery or cost change", () => {
    const report = buildRunReport(row({ chaosEvents: [{ timestamp: time, type: "crash", resourceId: "vm-a", message: "Requested crash" }] }));
    expect(report.run.chaosEventCount).toBe(1);
    expect(report.chaosEvents[0]?.type).toBe("crash");
    expect(report.interpreted).toEqual([]);
    expect(report.unknown.join(" ")).toContain("not proof of their full effect, causality, recovery or cost impact");
  });

  test("preserves stage warnings and stored cost without recalculating current prices", () => {
    const report = buildRunReport(row({ stages: [costStage, { ...costStage, name: "SecurityScan", message: "Public database",
      details: { issues: ["db is public"], warnings: ["Educational warning"], monthlyEstimate: 999 } }], simulationState: { accumulatedCostUsd: 0.02 } }));
    expect(report.stages[0]?.monthlyEstimateUsd).toBe(74.25);
    expect(report.stages[1]?.issues).toEqual(["db is public"]);
    expect(report.stages[1]?.monthlyEstimateUsd).toBeUndefined();
    expect(report.checkpoint?.accumulatedCostUsd).toBe(0.02);
    expect(report.unknown.join(" ")).toContain("not cloud bills");
  });

  test("live edits remain separate from immutable inputs, and canvas movement is not a configuration change", () => {
    const live = structuredClone(layout);
    live.resources = live.resources.filter((r) => r.id !== "vm-b");
    live.resources[0]!.x += 99;
    live.resources.find((r) => r.id === "vm-a")!.skuId = "m5.xlarge";
    live.resources.push({ id: "new-cache", type: "Cache", x: 1, y: 1 });
    live.connectionLines = live.connectionLines.filter((c) => c.sourceId !== "vm-b" && c.targetId !== "vm-b");
    const saved = row({ liveTopology: live, topologyRevision: 3 });
    const report = buildRunReport(saved);
    expect(report.topology.original?.resources.some((r) => r.id === "vm-b")).toBe(true);
    expect(report.topology.original?.resources.find((r) => r.id === "vm-a")?.skuId).toBe("m5.large");
    expect(report.topology.changes).toEqual({ added: ["new-cache"], removed: ["vm-b"], reconfigured: ["vm-a"], addedConnections: 0, removedConnections: 2 });
    expect(report.interpreted.find((fact) => fact.id === "accepted-topology-diff")?.message).toContain("does not prove");
  });

  test("malformed historical JSON is omitted with limits; it cannot become default empty topology or healthy metrics", () => {
    const report = buildRunReport(row({ stages: [{ ...costStage, details: { monthlyEstimate: "74" } }, null], timeline: {},
      chaosEvents: [{ timestamp: "yesterday", type: "crash" }], runInputs: { version: 99 }, liveTopology: {},
      workloadProfile: { targetThroughput: "bad" }, simulationState: { overallHealth: "unknown", metrics: { db: { cpu: -1 } } } }));
    expect(report.run.workload).toBeNull();
    expect(report.run.chaosEventCount).toBeNull();
    expect(report.checkpoint).toBeNull();
    expect(report.topology.original).toBeNull();
    expect(report.topology.accepted).toBeNull();
    expect(report.stages[0]?.monthlyEstimateUsd).toBeUndefined();
    expect(report.unknown.join(" ")).toContain("malformed");
    expect(report.unknown.join(" ")).toContain("not reconstructed from the saved design");
    expect(report.interpreted).toEqual([]);
  });

  test("valid historical fragments survive beside corrupt records, with unavailable fields left absent", () => {
    const report = buildRunReport(row({ timeline: [null, { timestamp: time, event: "Saved", message: "Actual event" }],
      simulationState: { metrics: { broken: { cpu: "92" }, partial: { memory: 20 } } } }));
    expect(report.timeline).toHaveLength(1);
    expect(report.checkpoint?.resources).toEqual([{ id: "partial", memory: 20 }]);
    expect(report.unknown.join(" ")).toContain("broken");
    expect(report.interpreted).toEqual([]);
    expect(buildRunReport(row({ simulationState: {} })).checkpoint).toBeNull();
  });

  test("legacy inputs are labelled and never silently resolved or reconstructed", () => {
    const report = buildRunReport(row({ runInputs: null, workloadProfile: workload, seed: "legacy-seed", liveTopology: null }));
    expect(report.run.workloadSource).toBe("legacy");
    expect(report.run.workload?.peakMultiplier).toBeUndefined();
    expect(report.legacySeed).toBe("legacy-seed");
    expect(report.originalSeed).toBeNull();
    expect(report.topology.original).toBeNull();
    expect(report.topology.changes).toBeNull();
  });

  test("ambiguous historical topology preserves inputs but does not infer configuration edits", () => {
    const saved = row({ topologyRevision: 1, liveTopology: { ...layout, resources: [...layout.resources, layout.resources[0]] } });
    const report = buildRunReport(saved);
    expect(report.topology.original).not.toBeNull();
    expect(report.topology.changes).toBeNull();
    expect(report.interpreted).toEqual([]);
    expect(report.unknown.join(" ")).toContain("comparison ambiguous");
  });

  test("bounded history parsing exposes incomplete counts instead of asserting zero or complete history", () => {
    const events = Array.from({ length: 501 }, () => ({ timestamp: time, type: "crash", resourceId: "vm-a", message: "Requested crash" }));
    const report = buildRunReport(row({ chaosEvents: events }));
    expect(report.chaosEvents).toHaveLength(500);
    expect(report.run.chaosEventCount).toBeNull();
    expect(report.unknown.join(" ")).toContain("first 500 entries");
    expect(summarizeRun(row({ chaosEvents: null })).chaosEventCount).toBeNull();
  });
});

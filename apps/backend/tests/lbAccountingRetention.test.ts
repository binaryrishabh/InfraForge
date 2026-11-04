import { expect, test } from "bun:test";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { readRecords } from "../reports/records";
import { selectionLayout } from "./lbSelection.test";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { storedJson } from "../utils/json";
import { buildRunReport } from "../reports/report";

const workload = { targetThroughput: 12000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
test("new explicit LB controls capture accounting and retain actual engine counters in report records", () => {
  const layout = selectionLayout("round-robin");
  layout.resources[0]!.lbAdmission = { version: 1, maxActive: 1, maxQueued: 2, queueWaitMs: 20 };
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, workload, "retained-lb"))));
  expect(input.adapterProfiles).toContain("lb-accounting/1");
  const run = createModel2Run(input, 3);
  for (let i = 0; i < 3; i++) run.advance();
  const actual = run.evidence().network.loadBalancers[0]!.accounting!;
  expect(actual.rejectedAtLb).toBeGreaterThan(0);
  expect(actual.queuedAtLb).toBeGreaterThan(0);
  expect(actual.acceptedByBackend).toBeGreaterThan(0);
  const metrics = run.view().metrics;
  expect(metrics.lb!.lbAccounting).toEqual(actual);
  const limits: string[] = [];
  const instance = { model2: run, topology: layout, topologyRevision: 0, pendingLogs: [], speed: 1, accumulatedCostUsd: 0,
    metricsComputedAt: "2026-11-04T00:00:00.000Z", metricsTopologyRevision: 0 } as unknown as SimulationInstance;
  const simulationState = storedJson(captureSnapshot("retained-lb", instance, "checkpoint"));
  const terminalSnapshot = storedJson(captureSnapshot("retained-lb", instance, "terminal"));
  const row = { id: "retained-lb", infrastructureId: null, status: "completed", resourceCount: layout.resources.length,
    createdAt: new Date("2026-11-04T00:00:00.000Z"), updatedAt: new Date("2026-11-04T00:00:00.000Z"), topologyRevision: 0,
    stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed, runInputs: input,
    liveTopology: layout, simulationState, terminalSnapshot };
  const records = readRecords(row, limits);
  expect(records.checkpoint!.resources.find(r => r.id === "lb")!.lbAccounting).toEqual(actual);
  expect(records.terminal!.resources.find(r => r.id === "lb")!.lbAccounting).toEqual(actual);
  expect(buildRunReport(row).terminal!.resources.find(r => r.id === "lb")!.lbAccounting).toEqual(actual);
  expect(limits).toEqual([]);
  console.info("retained-lb-accounting", JSON.stringify(actual));
});

test("retained accounting rejects unsupported, nonfinite, negative and extra counters", () => {
  const accounting = { profile: "lb-accounting/1", rejectedAtLb: 1, queuedAtLb: 2, acceptedByBackend: 3, queuedAtVm: 4, rejectedByVm: 5, timedOutDownstream: 6 };
  for (const invalid of [{ profile: "lb-accounting/2" }, { rejectedAtLb: -1 }, { queuedAtVm: Infinity }, { timedOutDownstream: 0.5 }, { acceptedByBackend: Number.MAX_SAFE_INTEGER + 1 }, { currentQueueDepth: 0 }]) {
    const limits: string[] = [];
    const records = readRecords({ stages: [], timeline: [], chaosEvents: [], simulationState: { simulatedSeconds: 3, metrics: { lb: { lbAccounting: { ...accounting, ...invalid } } } } }, limits);
    expect(records.checkpoint!.resources).toEqual([]);
    expect(limits.join(" ")).toContain("malformed");
  }
});

test("old captured LB intent never gains accounting; mismatched or duplicate profiles refuse", () => {
  const input = captureRunInputs(selectionLayout("round-robin"), workload, "old-lb");
  input.adapterProfiles = input.adapterProfiles!.filter(p => p !== "lb-accounting/1");
  const run = createModel2Run(input, 1); run.advance();
  expect(run.evidence().network.loadBalancers[0]).not.toHaveProperty("accounting");
  expect(run.view().metrics.lb).not.toHaveProperty("lbAccounting");
  const withoutControls = { ...input, resources: input.resources.map(r => ({ ...r, lbSelection: undefined })),
    adapterProfiles: input.adapterProfiles!.filter(p => p !== "lb-selection/1") };
  expect(buildContractFromRunInputs(withoutControls, 1)).toHaveProperty("contract");
  expect(buildContractFromRunInputs({ ...withoutControls, adapterProfiles: [...withoutControls.adapterProfiles, "lb-accounting/1"] }, 1)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["lb-accounting/1", "lb-accounting/1"] })).toThrow();
  const limits: string[] = [];
  const old = readRecords({ stages: [], timeline: [], chaosEvents: [], simulationState: { simulatedSeconds: 1, metrics: { lb: { cpu: null, memory: null, health: "healthy" } } } }, limits);
  expect(old.checkpoint!.resources[0]).not.toHaveProperty("lbAccounting");
});

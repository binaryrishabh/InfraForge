import type { ContractBuilder, Quantity } from "@infraforge/simulation/internal-product";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { buildRunReport, type StoredRun } from "../reports/report";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";

// Synthetic test contracts exercise ambiguous acknowledgements and backend refusal.
// Neither timing nor backend capacity is a designer control or lab calibration.
const diagnosticBuilder = (mode: string): ContractBuilder => (...args) => {
  const built = buildModel2Contract(...args);
  if ("refused" in built) return built;
  const set = <U extends "us" | "count">(q: Quantity<U>, value: number) => {
    if (q.kind !== "known") throw Error("Expected known diagnostic quantity");
    q.value = value;
    const entry = built.contract.ledger.find(e => e.id === q.provenance[0])!;
    entry.quantity = {...q}; entry.formula = String(value);
  };
  if (["ambiguous", "retried", "in-flight"].includes(mode)) {
    const transport = structuredClone(built.contract.transports.assumed!);
    const link = transport.links.find(l => l.id === "response")!;
    if (link.propagation.kind !== "known") throw Error("Expected known propagation");
    const provenance = "diagnostic.export.response";
    link.propagation = {...link.propagation, value: 2_000_000, provenance: [provenance]};
    const entry = structuredClone(built.contract.ledger.find(e => e.id === "link.response.propagation")!);
    built.contract.ledger.push({...entry, id: provenance, quantity: {...link.propagation}, formula: "2000000"});
    built.contract.transports["diagnostic-export"] = transport;
    built.contract.nodes.monitor!.internalEdges.find(e => e.purpose === "telemetry-export")!.transport = "diagnostic-export";
  }
  if (mode === "in-flight") for (const role of built.contract.nodes.monitor!.resources) {
    if (role.config.kind === "monitor") set(role.config.timeout, 4_000_000);
  }
  if (mode === "backend-full") for (const role of built.contract.nodes.monitor!.resources) {
    if (role.config.kind === "telemetry-backend") set(role.config.samples, 2);
  }
  return built;
};

export function monitoringReportFixture() {
  const cases = (["pressure", "retried", "in-flight", "fast-export", "larger-buffer", "ambiguous", "backend-full", "no-collection", "stale", "multiple"] as const).map(mode => {
    const long = mode === "stale", seconds = long || mode === "retried" ? 32 : mode === "in-flight" ? 4 : 12;
    const layout = monitoringLayout({version: 2, bufferSamples: ["larger-buffer", "retried"].includes(mode) ? 8 : 2,
      batchSamples: 1, exportAttempts: mode === "ambiguous" ? 1 : 2,
      collectionIntervalSeconds: mode === "no-collection" ? 60 : 1,
      exportIntervalSeconds: mode === "fast-export" ? 1 : 3}, mode === "multiple");
    const input = captureRunInputs(layout, monitoringWorkload, "monitoring-report");
    const run = createModel2Engine(input, seconds, diagnosticBuilder(mode));
    const instance: SimulationInstance = {model2: run, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
      accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
      metricsComputedAt: "2026-11-08T00:00:00.000Z", metricsTopologyRevision: 0};
    for (let s = 1; s <= seconds; s++) {
      run.advance();
      if (s === 2 && long) run.apply({kind: "chaos", parameters: {type: DeploymentChaosNames.Crash, resourceId: "vm"}});
    }
    const snapshot = captureSnapshot(mode, instance, "terminal");
    const row: StoredRun = {id: mode, infrastructureId: null, runName: "Monitoring evidence", status: "torn-down", resourceCount: input.resources.length,
      createdAt: new Date(snapshot.capturedAt), updatedAt: new Date(snapshot.capturedAt), topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
      workloadProfile: input.workloadProfile, seed: input.seed, simulationState: JSON.parse(JSON.stringify(captureSnapshot(mode, instance, "checkpoint"))),
      runInputs: input, liveTopology: input, terminalSnapshot: JSON.parse(JSON.stringify(snapshot))};
    const evidence = run.evidence();
    return {mode, row, raw: evidence.systems.monitors[0]!, backend: evidence.systems.backends[0]!, report: buildRunReport(row)};
  });
  const base = cases[0]!.row;
  type Snapshot = ReturnType<typeof captureSnapshot>;
  const variant = (change: (snapshot: Snapshot) => void, checkpointOnly = false) => {
    const snapshot = structuredClone(base.terminalSnapshot) as Snapshot;
    change(snapshot);
    return buildRunReport({...base, simulationState: checkpointOnly ? snapshot : null, terminalSnapshot: checkpointOnly ? null : snapshot});
  };
  return {cases,
    missing: variant(s => { delete s.metrics.monitor!.monitoring; delete s.metrics.monitor!.monitoringBackend; }),
    nullAge: variant(s => { s.metrics.monitor!.monitoring!.freshness![0]!.ageUs = null; s.metrics.monitor!.monitoringBackend!.latest![0]!.ageUs = null; }),
    unknown: variant(s => { s.metrics.monitor!.monitoring!.generated = null; s.metrics.monitor!.monitoringBackend!.received = null; }),
    invalid: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].flatMap(value => [
      variant(s => { s.metrics.monitor!.monitoring!.droppedBeforeExport = value; }),
      variant(s => { s.metrics.monitor!.monitoringBackend!.received = value; }),
      variant(s => { s.metrics.monitor!.monitoringBackend!.latest![0]!.ageUs = value; }),
    ]),
    checkpointOnly: variant(() => {}, true),
  };
}
if (import.meta.main) console.log(JSON.stringify(monitoringReportFixture()));

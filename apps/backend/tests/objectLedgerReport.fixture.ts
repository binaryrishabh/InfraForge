import type { Resource } from "@infraforge/domain/resource";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { ContractBuilder, ProductContract, Quantity, Unit } from "@infraforge/simulation/internal-product";
import { buildModel2Contract } from "@infraforge/simulation/internal-product";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { buildRunReport, type StoredRun } from "../reports/report";
import { objectLayout, objectWorkload } from "./objectCapacity.fixture";

export function objectReportFixture(layout: {resources: Resource[]; connectionLines: ReturnType<typeof objectLayout>["connectionLines"]},
  workload: WorkloadProfile, seconds: number, builder?: ContractBuilder) {
  const input = captureRunInputs(layout, workload, "object-ledger-proof"), model2 = createModel2Engine(input, seconds, builder);
  const instance: SimulationInstance = { model2, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: "2026-11-08T00:00:00.000Z", metricsTopologyRevision: 0 };
  const samples = [];
  for (let second = 1; second <= seconds; second++) {
    model2.advance();
    samples.push({second, raw: model2.evidence().asynchronous.objects.find(o => o.id === "store")!, metrics: model2.view().metrics.store!.objectStorage!});
  }
  const terminal = captureSnapshot("object-proof", instance, "terminal"), checkpoint = captureSnapshot("object-proof", instance, "checkpoint");
  const row: StoredRun = {id: "object-proof", infrastructureId: null, runName: "Object ownership proof", status: "torn-down", resourceCount: input.resources.length,
    createdAt: new Date("2026-11-08T00:00:00.000Z"), updatedAt: new Date("2026-11-08T00:00:00.000Z"), topologyRevision: 0,
    stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed,
    runInputs: input, liveTopology: layout, terminalSnapshot: JSON.parse(JSON.stringify(terminal)), simulationState: JSON.parse(JSON.stringify(checkpoint)), runtimeActive: false};
  return {input, row, samples, report: buildRunReport(row)};
}

/** Test-only commands exercise engine ownership; the designer does not author these identities/conditions. */
const lifecycleBuilder: ContractBuilder = (...args) => {
  const result = buildModel2Contract(...args); if ("refused" in result) return result;
  const contract = result.contract;
  const q = <U extends Unit>(id: string, value: number, unit: U): Quantity<U> => {
    const quantity = {kind: "known" as const, value, unit, provenance: [id]};
    contract.ledger.push({...contract.ledger[0]!, id, concept: id, quantity, formula: String(value), classification: "user-input"});
    return quantity;
  };
  const requests = [
    {kind: "put", namespace: "n", key: "x", bytes: 600000, content: "first"},
    {kind: "put", namespace: "n", key: "x", bytes: 700000, content: "replacement", ifGeneration: 2},
    {kind: "put", namespace: "n", key: "x", bytes: 1048576, content: "refused"},
    {kind: "put", namespace: "n", key: "x", bytes: 1, content: "conditional", ifAbsent: true},
    {kind: "put", namespace: "n", key: "x", bytes: 1, content: "stale", ifGeneration: 2},
    {kind: "delete", namespace: "n", key: "x", ifGeneration: 3},
    {kind: "delete", namespace: "n", key: "absent"},
    {kind: "put", namespace: "n", key: "y", bytes: 1047552, content: "full"},
    {kind: "put", namespace: "n", key: "z", bytes: 1, content: "overflow"},
  ];
  contract.commands = requests.map((request, i): ProductContract["commands"][number] => ({id: `ledger-${i}`, source: "$app", target: "$store",
    at: q(`ledger-${i}.at`, i * 1000000, "us"), operation: "read", request, bodyBytes: q(`ledger-${i}.body`, 0, "bytes"), provenance: "Controlled object ledger test only"}));
  return result;
};

export function objectReportCases() {
  const lifecycle = objectReportFixture(objectLayout("plain", 1), {...objectWorkload("plain"), readWriteRatio: 1}, 10, lifecycleBuilder);
  const capacities = [1, 2].map(capacity => objectReportFixture(objectLayout("upload", capacity), objectWorkload("upload"), 30));
  const duplicates = [false, true].map(idempotent => {
    const layout = objectLayout("idempotent", 1);
    layout.resources.find(r => r.id === "worker")!.asyncWorker!.idempotentResults = idempotent;
    return objectReportFixture(layout, objectWorkload("idempotent"), 10);
  });
  return {lifecycle, capacities, duplicates};
}

if (import.meta.main) {
  const cases = objectReportCases();
  const variant = (mutate: (row: typeof cases.lifecycle.row) => void) => { const row = structuredClone(cases.lifecycle.row); mutate(row); return buildRunReport(row); };
  type Snapshot = ReturnType<typeof captureSnapshot>;
  const old = variant(row => { delete (row.terminalSnapshot as Snapshot).metrics.store!.objectStorage; });
  const partial = variant(row => {
    const m = (row.terminalSnapshot as Snapshot).metrics.store!.objectStorage!;
    (row.terminalSnapshot as Snapshot).metrics.store!.objectStorage = {version: 1, storedBytes: m.storedBytes, capacityBytes: m.capacityBytes,
      committedPuts: m.committedPuts, replacedObjects: m.replacedObjects, removedObjects: m.removedObjects, deletes: m.deletes, "object-capacity": m["object-capacity"]};
  });
  console.log(JSON.stringify({reports: [cases.lifecycle, ...cases.capacities, ...cases.duplicates].map(c => c.report), old, partial,
    noRows: variant(row => { (row.terminalSnapshot as Snapshot).metrics = {}; }),
    checkpointOnly: variant(row => {row.terminalSnapshot = null;})}));
}

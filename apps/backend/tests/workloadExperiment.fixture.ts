import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import type { StoredRun } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine, type LiveView } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureSnapshot } from "../simulator/snapshot";
import { readRecords } from "../reports/records";

export const seconds = 8;
const at = new Date("2026-11-03T00:00:00.000Z");
const resources: Resource[] = [
  {id: "lb", type: "Load Balancer", x: 0, y: 0},
  {id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: {version: 1, workers: 1, queuedRequests: 16}},
  {id: "db", type: "Database", x: 2, y: 0},
];
const connectionLines: ConnectionLine[] = [
  {id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80},
  {id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432},
];
const topology = {resources, connectionLines};
// One worker: 3 ms read CPU + 1 ms database CPU and dependency transport.
// 180/s consumes 54% of its CPU service slot, about 76% including dependency wait.
export const input = captureRunInputs(topology, {targetThroughput: 10800, throughputUnit: "per-minute", trafficShape: "steady",
  payloadSize: "light", readWriteRatio: 1}, "controlled-workload-proof");

export function measure(input: RunInputs, id: string, horizon: number, sourceRunId?: string, matchedStop = true) {
  const engine = createModel2Engine(input, horizon, buildModel2Contract), views: LiveView[] = [];
  let maxQueued = 0;
  for (let i = 0; i < horizon; i++) {
    engine.advance(); views.push(structuredClone(engine.view()));
    const queued = engine.evidence().resources.find(r => r.id === "app")?.queued;
    if (queued === undefined) throw Error("Application queue evidence is unavailable.");
    maxQueued = Math.max(maxQueued, queued);
  }
  const terminal = captureSnapshot(id, {model2: engine, tickCount: horizon, pendingLogs: [], speed: 1,
    lastCheckpointAt: 0, accumulatedCostUsd: 0, topology, topologyRevision: 0, actions: new Map(),
    metricsComputedAt: at.toISOString(), metricsTopologyRevision: 0, acknowledge: null}, "terminal");
  const row: StoredRun = {id, infrastructureId: null, runName: id, status: "completed", resourceCount: 3,
    createdAt: at, updatedAt: at, stages: [], timeline: [], chaosEvents: [], seed: input.seed,
    workloadProfile: input.workloadProfile, runInputs: input, liveTopology: topology, simulationState: null,
    terminalSnapshot: JSON.parse(JSON.stringify(terminal)), topologyRevision: 0, actions: [], actionCount: 0,
    ...(sourceRunId ? {sourceRunId, rerunMode: "workload-variant", autoStopAtSimulatedSeconds: matchedStop ? seconds : null} : {})};
  const limits: string[] = [], records = readRecords(row, limits);
  return {input, row, records, limits, evidence: engine.evidence(), view: engine.view(), views, maxQueued};
}

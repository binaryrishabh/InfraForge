import type { Resource } from "@infraforge/domain/resource";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { buildRunReport, type StoredRun } from "../reports/report";
import { classifyComparison } from "../comparison/classify";

// Runs real product-compiled workloads and prints what the live panel, the stored report and the
// comparison receive. A subprocess keeps the rendering test inside the web workspace's import boundary.
const at = new Date("2026-11-03T00:00:00.000Z");
const resources: Resource[] = [
  { id: "lb", type: "Load Balancer", x: 0, y: 0 },
  { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 8 } },
  { id: "db", type: "Database", x: 2, y: 0 },
];
const topology = { resources, connectionLines: [
  { id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer" as const, targetType: "Virtual Machine" as const, port: 80 },
  { id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine" as const, targetType: "Database" as const, port: 5432 },
] };

function run(id: string, workload: WorkloadProfile, createdAt: Date, seconds: number) {
  const input = captureRunInputs(topology, workload, "learner-journey-seed");
  const engine = createModel2Engine(input, seconds);
  const live: unknown[] = [];
  for (let s = 0; s < seconds; s++) { engine.advance(); live.push(engine.view().traffic); }
  const terminal = captureSnapshot(id, { model2: engine, tickCount: seconds, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology, topologyRevision: 0, actions: new Map(), metricsComputedAt: at.toISOString(), metricsTopologyRevision: 0, acknowledge: null }, "terminal");
  const row: StoredRun = { id, infrastructureId: null, runName: id, status: "torn-down", resourceCount: resources.length,
    createdAt, updatedAt: createdAt, stages: [], timeline: [], chaosEvents: [], seed: input.seed, workloadProfile: input.workloadProfile,
    runInputs: input, liveTopology: topology, simulationState: null, terminalSnapshot: JSON.parse(JSON.stringify(terminal)),
    topologyRevision: 0, actions: [], actionCount: 0 };
  return { row, live, report: buildRunReport(row), evidence: engine.evidence() };
}

const { profiles, seconds } = JSON.parse(process.env.JOURNEY_INPUT!) as { profiles: WorkloadProfile[]; seconds: number };
const runs = profiles.map((profile, i) => run(`journey-${i + 1}`, profile, new Date(at.getTime() + i * 1000), seconds));
console.log(JSON.stringify({
  runs: runs.map(r => ({ live: r.live, report: r.report, evidence: r.evidence })),
  comparison: classifyComparison(runs[0]!.row, runs[1]!.row),
}));

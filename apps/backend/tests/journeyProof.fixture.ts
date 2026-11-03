import type { Resource } from "@infraforge/domain/resource";
import type { WorkloadProfile, WorkloadVariant } from "@infraforge/domain/workload";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { buildRunReport, type StoredRun } from "../reports/report";
import { classifyComparison } from "../comparison/classify";
import { createWorkloadVariantInput } from "../reruns/variants";

// Runs real product-compiled workloads and prints what the live panel, the stored report and the
// comparison receive. A subprocess keeps the rendering test inside the web workspace's import boundary.
// Input is either {profiles, seconds} (unrelated runs) or {source, variants, seconds}: the first run is the
// source and every other run is built by the same server function that creates a traffic experiment.
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

function run(id: string, input: RunInputs, createdAt: Date, seconds: number, lineage?: { sourceRunId: string }) {
  const engine = createModel2Engine(input, seconds);
  const live: unknown[] = [];
  for (let s = 0; s < seconds; s++) { engine.advance(); live.push(engine.view().traffic); }
  const terminal = captureSnapshot(id, { model2: engine, tickCount: seconds, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology, topologyRevision: 0, actions: new Map(), metricsComputedAt: at.toISOString(), metricsTopologyRevision: 0, acknowledge: null }, "terminal");
  const row: StoredRun & { sourceRunId?: string; rerunMode?: string } = { id, infrastructureId: null, runName: id, status: "torn-down", resourceCount: resources.length,
    createdAt, updatedAt: createdAt, stages: [], timeline: [], chaosEvents: [], seed: input.seed, workloadProfile: input.workloadProfile,
    runInputs: input, liveTopology: topology, simulationState: null, terminalSnapshot: JSON.parse(JSON.stringify(terminal)),
    topologyRevision: 0, actions: [], actionCount: 0, ...(lineage ? { ...lineage, rerunMode: "workload-variant", autoStopAtSimulatedSeconds: seconds } : {}) };
  return { row, live, report: buildRunReport(row), evidence: engine.evidence() };
}

const spec = JSON.parse(process.env.JOURNEY_INPUT!) as { profiles?: WorkloadProfile[]; source?: WorkloadProfile; variants?: WorkloadVariant[]; seconds: number };
const seed = "learner-journey-seed";
const sourceInput = captureRunInputs(topology, spec.source ?? spec.profiles![0], seed);
const inputs = spec.variants ? [sourceInput, ...spec.variants.map(v => createWorkloadVariantInput(sourceInput, v))]
  : [sourceInput, ...spec.profiles!.slice(1).map(profile => captureRunInputs(topology, profile, seed))];
const runs = inputs.map((input, i) => run(`journey-${i + 1}`, input, new Date(at.getTime() + i * 1000), spec.seconds, spec.variants && i > 0 ? { sourceRunId: "journey-1" } : undefined));
console.log(JSON.stringify({
  runs: runs.map(r => ({ live: r.live, report: r.report, evidence: r.evidence })),
  comparison: classifyComparison(runs[0]!.row, runs[1]!.row),
  comparisons: runs.slice(1).map(r => classifyComparison(runs[0]!.row, r.row)),
}));

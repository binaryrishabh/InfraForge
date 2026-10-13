import { randomUUID } from "node:crypto";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { RESOURCE_TYPES as T, type Resource } from "@infraforge/domain/resource";
import type { ChallengeDefinition, ChallengePrediction, ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs, engineSeed } from "../deployments/runInputs";
import { captureSnapshot } from "../simulator/snapshot";
import { runSecurityScan } from "../stages/securityScan.stages";
import { runCostEstimation } from "../stages/costEstimation.stages";
import { buildRunReport, type StoredRun } from "../reports/report";
import { challengeSeed, findChallenge, specHash } from "../challenges/registry";
import { fanIn, fanOut, starter } from "../challenges/starter";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "../simulator/instance";

export const definition = (id: string) => findChallenge(id)!.definition;

const vms = (n: number, skuId?: string) => Array.from({ length: n }, (_, i) =>
  [`vm${i + 1}`, T.VirtualMachine, 2, i, skuId ? { skuId } : undefined] as [string, typeof T.VirtualMachine, number, number, Partial<Resource>?]);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `vm${i + 1}`);
export function tier(n: number, opts: { vmSku?: string; dbSku?: string; cache?: boolean } = {}): ChallengeStarter {
  const cache = opts.cache ?? false;
  return starter([["dns", T.DNS, 0, 0], ["lb", T.LoadBalancer, 1, 0], ...vms(n, opts.vmSku),
    ...(cache ? [["cache", T.Cache, 3, 0] as [string, typeof T.Cache, number, number]] : []),
    ["db", T.Database, 4, 0, opts.dbSku ? { skuId: opts.dbSku } : undefined]],
  [["dns", "lb"], ...fanOut("lb", ids(n)), ...(cache ? [...fanIn(ids(n), "cache"), ["cache", "db"] as [string, string]] : fanIn(ids(n), "db"))]);
}

// Passing designs found during calibration; every one stays inside its challenge's budget.
export const REFERENCE: Record<string, ChallengeStarter> = {
  "first-production-api": tier(2),
  "secure-the-edge": starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { public: true, encryption: true }],
    ["vm1", T.VirtualMachine, 2, 0, { openPorts: [8080] }], ["vm2", T.VirtualMachine, 2, 2], ["db", T.Database, 3, 1]],
  [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "db")]),
  "cache-matters": tier(4, { cache: true }),
  "write-heavy": tier(3, { vmSku: "c5.large", dbSku: "db.m5.2xlarge" }),
  "scale-out-safely": tier(7, { vmSku: "c5.large", dbSku: "db.m5.large", cache: true }),
  "peak-traffic": tier(6, { vmSku: "c5.large", dbSku: "db.m5.xlarge", cache: true }),
};

export function answers(def: ChallengeDefinition, values: Record<string, string>): ChallengePrediction {
  return { answers: Object.fromEntries(def.predictions.map((q) => [q.id, values[q.id] ?? values[q.kind]!])), reasoning: null };
}

/* Runs the real model-1 engine for an attempt and builds the report exactly as the
API does: same captured inputs, gate functions, terminal capture and evaluation. */
export function attemptReport(def: ChallengeDefinition, design: ChallengeStarter, prediction: ChallengePrediction,
  options: { stopAt?: number; status?: string; runtimeActive?: boolean; hash?: string } = {}) {
  const runInputs = captureRunInputs({ ...design, layoutVersion: 3 }, def.workload, challengeSeed(def));
  let state = createInitialState("attempt", runInputs.resources, runInputs.connectionLines, runInputs.workloadProfile, engineSeed(runInputs.seed));
  for (let i = 0; i < (options.stopAt ?? def.evaluationSeconds); i++) state = tick(state, {}).state;
  const instance: SimulationInstance = { state, tickCount: state.simulatedSeconds, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: runInputs, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: new Date().toISOString(), metricsTopologyRevision: 0 };
  const now = new Date().toISOString();
  const stage = (name: string, result: { summary: string; details: object }) =>
    ({ name, status: "completed", startedAt: now, completedAt: now, message: result.summary, details: result.details });
  const active = options.runtimeActive ?? false;
  const row: StoredRun = { id: randomUUID(), infrastructureId: null, runName: def.title, status: options.status ?? "torn-down",
    resourceCount: runInputs.resources.length, createdAt: new Date(), updatedAt: new Date(), topologyRevision: 0,
    stages: [stage("Validate", { summary: "ready", details: { warnings: [] } }), stage("SecurityScan", runSecurityScan(runInputs.resources)),
      stage("CostEstimate", runCostEstimation(runInputs.resources))],
    timeline: [], chaosEvents: [], workloadProfile: runInputs.workloadProfile, seed: runInputs.seed, simulationState: null, runInputs,
    liveTopology: { resources: runInputs.resources, connectionLines: runInputs.connectionLines },
    terminalSnapshot: active ? null : storedJson(captureSnapshot("attempt", instance, "terminal")), actions: [], runtimeActive: active,
    challengeId: def.id, challengeVersion: def.version, challengeSpecHash: options.hash ?? specHash(def), challengePrediction: prediction,
    predictionSubmittedAt: new Date(), evaluationStopAtSimulatedSeconds: def.evaluationSeconds };
  return buildRunReport(row);
}

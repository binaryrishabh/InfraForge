import { randomUUID } from "node:crypto";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { RESOURCE_TYPES as T, type Resource } from "@infraforge/domain/resource";
import type { ChallengeDefinition, ChallengePrediction, ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs, engineSeed } from "../deployments/runInputs";
import { captureSnapshot } from "../simulator/snapshot";
import { runSecurityScan } from "../stages/securityScan.stages";
import { runCostEstimation } from "../stages/costEstimation.stages";
import { buildRunReport, type StoredRun } from "../reports/report";
import { challengeSeed, latestChallenge, specHash, type ChallengeRegistry } from "../challenges/registry";
import { EXPERIMENT_TRIGGER, recordedExperiment } from "../challenges/experiment";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";
import { fanIn, fanOut, starter } from "../challenges/starter";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "../simulator/instance";
import { captureEvidenceTick, createEvidenceBuffer } from "../evidence/capture";
import { afterTheCacheReturnsV1 } from "../challenges/definitions/after-the-cache-returns/v1";
import { createModel2Engine, type ContractBuilder } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { currentSecond } from "../simulator/engineView";

export const definition = (id: string) => latestChallenge(id)!.definition;

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
  "after-the-cache-returns": { ...afterTheCacheReturnsV1.starter!, resources: afterTheCacheReturnsV1.starter!.resources.map((r) =>
    r.id === "db" ? { ...r, skuId: "db.m5.large" } : r) },
  "headroom-under-cpu-pressure": starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 4, targetCpu: 60 } }],
    ["app-1", T.VirtualMachine, 2, 0], ["app-2", T.VirtualMachine, 2, 2, { skuId: "c5.xlarge" }], ["db", T.Database, 3, 1]],
  [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2"]), ...fanIn(["app-1", "app-2"], "db")]),
  "first-production-api": tier(2),
  "secure-the-edge": starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { public: true, encryption: true }],
    ["vm1", T.VirtualMachine, 2, 0, { openPorts: [8080] }], ["vm2", T.VirtualMachine, 2, 2], ["db", T.Database, 3, 1]],
  [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "db")]),
  "cache-matters": tier(4, { cache: true }),
  "write-heavy": tier(3, { vmSku: "c5.large", dbSku: "db.m5.2xlarge" }),
  "scale-out-safely": tier(7, { vmSku: "c5.large", dbSku: "db.m5.large", cache: true }),
  "peak-traffic": tier(6, { vmSku: "c5.large", dbSku: "db.m5.xlarge", cache: true }),
  "lose-an-app-server": starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1], ["app-1", T.VirtualMachine, 2, 0],
    ["app-2", T.VirtualMachine, 2, 1], ["app-3", T.VirtualMachine, 2, 2], ["db", T.Database, 3, 1]],
  [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2", "app-3"]), ...fanIn(["app-1", "app-2", "app-3"], "db")]),
  "cache-failure": starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1], ["app-1", T.VirtualMachine, 2, 0],
    ["app-2", T.VirtualMachine, 2, 1], ["app-3", T.VirtualMachine, 2, 2], ["app-4", T.VirtualMachine, 2, 3],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1, { skuId: "db.m5.xlarge" }]],
  [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2", "app-3", "app-4"]), ...fanIn(["app-1", "app-2", "app-3", "app-4"], "cache"), ["cache", "db"]]),
};

export function answers(def: ChallengeDefinition, values: Record<string, string>): ChallengePrediction {
  return { answers: Object.fromEntries(def.predictions.map((q) => [q.id, values[q.id] ?? values[q.kind]!])), reasoning: null };
}

/* Runs the real engine (Model 1, or Model 2 with engine: "2") for an attempt and builds the report exactly as the
API does: same captured inputs, gate functions, terminal capture and evaluation.
A resilience attempt's fault is applied after the tick that reaches its second with
the worker's own functions, and recorded as the durable action the worker writes. */
type AttemptOptions = { stopAt?: number; status?: string; runtimeActive?: boolean; hash?: string; skipExperiment?: boolean; registry?: ChallengeRegistry; plan?: unknown;
  engine?: "1" | "2"; builder?: ContractBuilder };
export function attemptReport(def: ChallengeDefinition, design: ChallengeStarter, prediction: ChallengePrediction, options: AttemptOptions = {}) {
  return buildRunReport(attemptRow(def, design, prediction, options), options.registry);
}
export function attemptRow(def: ChallengeDefinition, design: ChallengeStarter, prediction: ChallengePrediction, options: AttemptOptions = {}): StoredRun {
  const runInputs = captureRunInputs({ ...design, layoutVersion: 3 }, def.workload, challengeSeed(def), options.engine ?? "1");
  const engine = options.engine === "2" ? { model2: createModel2Engine(runInputs, def.evaluationSeconds, options.builder ?? buildModel2Contract) }
    : { state: createInitialState("attempt", runInputs.resources, runInputs.connectionLines, runInputs.workloadProfile, engineSeed(runInputs.seed)) };
  const instance: SimulationInstance = { ...engine, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: runInputs, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: new Date().toISOString(), metricsTopologyRevision: 0 };
  const plan = recordedExperiment(def);
  instance.evidence = createEvidenceBuffer(plan, def.evaluationSeconds);
  const actions: StoredAction[] = [];
  const deploymentId = randomUUID();
  for (let i = 0; i < (options.stopAt ?? def.evaluationSeconds); i++) {
    if (instance.model2) instance.model2.advance(); else instance.state = tick(instance.state!, {}).state;
    instance.metricsComputedAt = new Date().toISOString();
    captureEvidenceTick(instance);
    const second = currentSecond(instance);
    for (const [id, running] of instance.actions) {
      const done = actionCompletion(instance, running);
      if (!done) continue;
      Object.assign(actions.find((a) => a.id === id)!, { status: done.status, outcome: done.outcome, completedAt: new Date(), completedSimulatedSeconds: second });
      instance.actions.delete(id);
    }
    if (plan && !options.skipExperiment && second === plan.atSimulatedSecond) {
      const id = randomUUID();
      const parameters = { type: plan.fault, resourceId: plan.targetResourceId, trigger: EXPERIMENT_TRIGGER } as const;
      const applied = applyAction(instance, id, { kind: "chaos", parameters });
      actions.push({ id, deploymentId, sequence: actions.length + 1, kind: "chaos", parameters, status: applied.status, requestedAt: new Date(),
        appliedAt: new Date(), completedAt: null, appliedSimulatedSeconds: second, completedSimulatedSeconds: null,
        outcome: applied.outcome as StoredAction["outcome"], failureReason: null });
    }
  }
  instance.tickCount = currentSecond(instance);
  const now = new Date().toISOString();
  const stage = (name: string, result: { summary: string; details: object }) =>
    ({ name, status: "completed", startedAt: now, completedAt: now, message: result.summary, details: result.details });
  const active = options.runtimeActive ?? false;
  const row: StoredRun = { id: deploymentId, infrastructureId: null, runName: def.title, status: options.status ?? "torn-down",
    evidenceSamples: instance.evidence?.pending,
    resourceCount: runInputs.resources.length, createdAt: new Date(), updatedAt: new Date(), topologyRevision: 0,
    stages: [stage("Validate", { summary: "ready", details: { warnings: [] } }), stage("SecurityScan", runSecurityScan(runInputs.resources)),
      stage("CostEstimate", runCostEstimation(runInputs.resources))],
    timeline: [], chaosEvents: [], workloadProfile: runInputs.workloadProfile, seed: runInputs.seed, simulationState: null, runInputs,
    liveTopology: { resources: runInputs.resources, connectionLines: runInputs.connectionLines },
    terminalSnapshot: active ? null : storedJson(captureSnapshot("attempt", instance, "terminal")), actions, runtimeActive: active,
    challengeId: def.id, challengeVersion: def.version, challengeSpecHash: options.hash ?? specHash(def), challengePrediction: prediction,
    predictionSubmittedAt: new Date(), evaluationStopAtSimulatedSeconds: def.evaluationSeconds, challengeExperiment: options.plan === undefined ? plan : options.plan };
  return row;
}

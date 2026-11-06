import { randomUUID } from "node:crypto";
import { RESOURCE_TYPES as T, type Resource } from "@infraforge/domain/resource";
import type { ChallengeDefinition, ChallengePrediction, ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs } from "../deployments/runInputs";
import { captureSnapshot } from "../simulator/snapshot";
import { runSecurityScan } from "../stages/securityScan.stages";
import { runCostEstimation } from "../stages/costEstimation.stages";
import { buildRunReport, type StoredRun } from "../reports/report";
import { challengeSeed, findChallenge, latestChallenge, specHash, type ChallengeRegistry } from "../challenges/registry";
import { EXPERIMENT_TRIGGER, recordedExperiment } from "../challenges/experiment";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";
import { fanIn, fanOut, starter } from "../challenges/starter";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "../simulator/instance";
import { captureEvidenceTick, createEvidenceBuffer } from "../evidence/capture";
import { afterTheCacheReturnsV2 } from "../challenges/definitions/after-the-cache-returns/v2";
import { createModel2Engine, type ContractBuilder } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { currentSecond } from "../simulator/engineView";
import { recordedScenario } from "../challenges/scenario";
import { dueScenarioSteps } from "@infraforge/simulation/model2-run";
import { boundRetriesDuringSlowdownV1 } from "../challenges/definitions/bound-retries-during-slowdown/v1";
import { whereDoesTheTimeGoV1 } from "../challenges/definitions/where-does-the-time-go/v1";
import { waitingWithSpareCpuV1 } from "../challenges/definitions/waiting-with-spare-cpu/v1";
import { oneBiggerOrTwoSmallerV1 } from "../challenges/definitions/one-bigger-or-two-smaller/v1";
import { routeAroundASlowVmV1 } from "../challenges/definitions/route-around-a-slow-vm/v1";
import { leaveRoomForABurstV1 } from "../challenges/definitions/leave-room-for-a-burst/v1";
import { retryingAFullPoolV1 } from "../challenges/definitions/retrying-a-full-pool/v1";

import { moveReadsOffTheWriterV1 } from "../challenges/definitions/move-reads-off-the-writer/v1";
import { budgetAppDatabaseSessionsV1 } from "../challenges/definitions/budget-app-database-sessions/v1";
import { replicasDoNotTakeWritesV1 } from "../challenges/definitions/replicas-do-not-take-writes/v1";
import { keepUpWithTheQueueV1 } from "../challenges/definitions/keep-up-with-the-queue/v1";
import { leaveTimeToAcknowledgeV1 } from "../challenges/definitions/leave-time-to-acknowledge/v1";
import { openOneSubscriberV1 } from "../challenges/definitions/open-one-subscriber/v1";
import { findTheDenyingRuleV1 } from "../challenges/definitions/find-the-denying-rule/v1";
import { leaveRoomForFirewallFlowsV1 } from "../challenges/definitions/leave-room-for-firewall-flows/v1";
import { chooseARetryMitigationV1 } from "../challenges/definitions/choose-a-retry-mitigation/v1";
import { catalogueLinkFlashV1 } from "../challenges/definitions/catalogue-link-flash/v1";
import { flashSaleOrderBacklogV1 } from "../challenges/definitions/flash-sale-order-backlog/v1";
import { protectOneApiRouteV1 } from "../challenges/definitions/protect-one-api-route/v1";
import { queueOverlappingJobsV1 } from "../challenges/definitions/queue-overlapping-jobs/v1";
import { boundFunctionPoolPressureV1 } from "../challenges/definitions/bound-function-pool-pressure/v1";
import { notificationRetryStormV1 } from "../challenges/definitions/notification-retry-storm/v1";
import { analyticsBurstBufferV1 } from "../challenges/definitions/analytics-burst-buffer/v1";

// Historical report fixtures deliberately keep their published Model 1 conditions.
export const legacyDefinition = (id: string) => findChallenge(id, 1)!.definition;
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
  "protect-one-api-route": {...protectOneApiRouteV1.starter!, resources: protectOneApiRouteV1.starter!.resources.map(r => r.id === "gateway" ? {...r, apiGateway: {...r.apiGateway!, routes: r.apiGateway!.routes!.map(route => route.id === "read" ? {...route, burstRequests: 1} : route)}} : r)},
  "queue-overlapping-jobs": {...queueOverlappingJobsV1.starter!, resources: queueOverlappingJobsV1.starter!.resources.map(r => r.id === "timer" ? {...r, scheduler: {...r.scheduler!, overlap: "queue"}} : r)},
  "bound-function-pool-pressure": {...boundFunctionPoolPressureV1.starter!, resources: boundFunctionPoolPressureV1.starter!.resources.map(r => r.id === "fn" ? {...r, serverless: {...r.serverless!, concurrency: 32}} : r)},
  "catalogue-link-flash": {...catalogueLinkFlashV1.starter!, resources: catalogueLinkFlashV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.xlarge"} : r.id === "cache" ? {...r, cachePolicy: {version: 2, capacityEntries: 16}} : r)},
  "flash-sale-order-backlog": {...flashSaleOrderBacklogV1.starter!, resources: flashSaleOrderBacklogV1.starter!.resources.map(r => r.id === "worker" ? {...r, asyncWorker: {...r.asyncWorker!, cpuMsPerJob: 100}} : r.id === "queue" ? {...r, asyncQueue: {...r.asyncQueue!, visibilityTimeoutSeconds: 5}} : r)},
  "notification-retry-storm": {...notificationRetryStormV1.starter!, resources: notificationRetryStormV1.starter!.resources.map(r => r.id === "queue" ? {...r, asyncQueue: {...r.asyncQueue!, maxReceives: 2}} : r)},
  "analytics-burst-buffer": {...analyticsBurstBufferV1.starter!, resources: analyticsBurstBufferV1.starter!.resources.map(r => r.id === "queue" ? {...r, asyncQueue: {...r.asyncQueue!, capacityMessages: 400}} : r)},
  "find-the-denying-rule": {...findTheDenyingRuleV1.starter!, resources: findTheDenyingRuleV1.starter!.resources.map(r => r.id === "fw" ? {...r, firewallSettings: {...r.firewallSettings!, rules: r.firewallSettings!.rules.map(rule => rule.id === "quarantine-db" ? {...rule, priority: 20} : rule)}} : r)},
  "leave-room-for-firewall-flows": {...leaveRoomForFirewallFlowsV1.starter!, resources: leaveRoomForFirewallFlowsV1.starter!.resources.map(r => r.id === "fw" ? {...r, firewallCapacity: {version: 1, maxFlows: 8}} : r)},
  "choose-a-retry-mitigation": {...chooseARetryMitigationV1.starter!, resources: chooseARetryMitigationV1.starter!.resources.map(r => r.id === "lb" ? {...r, retry: {...r.retry!, maxAttempts: 2}} : r)},
  "keep-up-with-the-queue": {...keepUpWithTheQueueV1.starter!, resources: keepUpWithTheQueueV1.starter!.resources.map(r => r.id === "worker" ? {...r, asyncWorker: {...r.asyncWorker!, cpuMsPerJob: 50}} : r)},
  "leave-time-to-acknowledge": {...leaveTimeToAcknowledgeV1.starter!, resources: leaveTimeToAcknowledgeV1.starter!.resources.map(r => r.id === "queue" ? {...r, asyncQueue: {...r.asyncQueue!, visibilityTimeoutSeconds: 5}} : r)},
  "open-one-subscriber": {...openOneSubscriberV1.starter!, resources: openOneSubscriberV1.starter!.resources.map(r => r.id === "queue" ? {...r, listenerSettings: {version: 1, ports: [5672]}} : r)},
  "move-reads-off-the-writer": {...moveReadsOffTheWriterV1.starter!, resources: moveReadsOffTheWriterV1.starter!.resources.map(r => r.id === "db" ? {...r, databaseReadRouting: {version: 1, policy: "replica-preferred"}} : r)},
  "budget-app-database-sessions": {...budgetAppDatabaseSessionsV1.starter!, resources: budgetAppDatabaseSessionsV1.starter!.resources.map(r => r.id === "lb" ? {...r, autoscaling: {...r.autoscaling!, minReplicas: 4}} : r)},
  "replicas-do-not-take-writes": {...replicasDoNotTakeWritesV1.starter!, resources: replicasDoNotTakeWritesV1.starter!.resources.map(r => r.id === "db" ? {...r, skuId: "db.t3.micro"} : r)},
  "route-around-a-slow-vm": {...routeAroundASlowVmV1.starter!, resources: routeAroundASlowVmV1.starter!.resources.map(r => r.id === "lb" ? {...r, lbSelection: {version: 1, policy: "least-outstanding"}} : r)},
  "leave-room-for-a-burst": {...leaveRoomForABurstV1.starter!, resources: leaveRoomForABurstV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.large"} : r)},
  "leave-room-for-a-burst-large": {...leaveRoomForABurstV1.starter!, resources: leaveRoomForABurstV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.xlarge"} : r)},
  "retrying-a-full-pool": {...retryingAFullPoolV1.starter!, resources: retryingAFullPoolV1.starter!.resources.map(r => r.id === "lb" ? {...r, retry: {...r.retry!, maxAttempts: 2}} : r)},
  "where-does-the-time-go": {...whereDoesTheTimeGoV1.starter!, resources: whereDoesTheTimeGoV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.large"} : r)},
  "waiting-with-spare-cpu": {...waitingWithSpareCpuV1.starter!, resources: waitingWithSpareCpuV1.starter!.resources.map(r => r.id === "app" ? {...r, vmExecution: {...r.vmExecution!, workers: 4}} : r)},
  "one-bigger-or-two-smaller": {...oneBiggerOrTwoSmallerV1.starter!, resources: oneBiggerOrTwoSmallerV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.xlarge"} : r)},
  // Alternative passing design for the same comparison. Never imported by runtime code.
  "one-bigger-or-two-smaller-horizontal": starter([["lb", T.LoadBalancer, 0, 0], ["app", T.VirtualMachine, 1, 0, {skuId: "c5.large"}],
    ["app2", T.VirtualMachine, 1, 1, {skuId: "c5.large"}], ["db", T.Database, 2, 0, {size: "medium"}]],
  [["lb", "app"], ["app", "db"], ["lb", "app2"], ["app2", "db"]]),
  "bound-retries-during-slowdown": {...boundRetriesDuringSlowdownV1.starter!, resources: boundRetriesDuringSlowdownV1.starter!.resources.map(r => r.id === "lb" ?
    {...r, retry: {enabled: true, maxAttempts: 2, backoffMs: 100, jitterRatio: 0.2, maxConcurrentRetries: 4, retryOn: ["backendFailure", "timeout", "connectionFailure"]}} : r)},
  "after-the-cache-returns": { ...afterTheCacheReturnsV2.starter!, resources: afterTheCacheReturnsV2.starter!.resources.map((r) =>
    r.id === "db" ? { ...r, skuId: "db.m5.xlarge" } : r) },
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

/* Runs Model 2 for an attempt and builds the report exactly as the API does: same captured inputs, gate functions, terminal capture and evaluation.
A resilience attempt's fault is applied after the tick that reaches its second with
the worker's own functions, and recorded as the durable action the worker writes. */
type AttemptOptions = { stopAt?: number; status?: string; runtimeActive?: boolean; hash?: string; skipExperiment?: boolean; registry?: ChallengeRegistry; plan?: unknown;
  builder?: ContractBuilder };
export function attemptReport(def: ChallengeDefinition, design: ChallengeStarter, prediction: ChallengePrediction, options: AttemptOptions = {}) {
  return buildRunReport(attemptRow(def, design, prediction, options), options.registry);
}
export function attemptRow(def: ChallengeDefinition, design: ChallengeStarter, prediction: ChallengePrediction, options: AttemptOptions = {}): StoredRun {
  const runInputs = captureRunInputs({ ...design, layoutVersion: 3 }, def.workload, challengeSeed(def));
  const seconds = options.stopAt ?? def.evaluationSeconds;
  const model2 = createModel2Engine(runInputs, Math.max(seconds, def.evaluationSeconds), options.builder ?? buildModel2Contract);
  const instance: SimulationInstance = { model2, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: runInputs, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: new Date().toISOString(), metricsTopologyRevision: 0 };
  const plan = recordedExperiment(def);
  const scenario = recordedScenario(def, runInputs);
  let nextScenarioStep = 0;
  instance.evidence = createEvidenceBuffer(plan, def.evaluationSeconds);
  const actions: StoredAction[] = [];
  const deploymentId = randomUUID();
  for (let i = 0; i < seconds; i++) {
    instance.model2.advance();
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
      actions.push({ id, deploymentId, sequence: actions.length + 1, scenarioStepId: null, kind: "chaos", parameters, status: applied.status, requestedAt: new Date(),
        appliedAt: new Date(), completedAt: null, appliedSimulatedSeconds: second, completedSimulatedSeconds: null,
        outcome: applied.outcome as StoredAction["outcome"], failureReason: null });
    }
    if (scenario && !options.skipExperiment) for (const step of dueScenarioSteps(scenario, nextScenarioStep, second)) {
      const id = randomUUID(), applied = applyAction(instance, id, {kind: "intervention", parameters: step.request});
      actions.push({id, deploymentId, sequence: actions.length + 1, scenarioStepId: step.id, kind: "intervention", parameters: storedJson(step.request) as StoredAction["parameters"], status: applied.status,
        requestedAt: new Date(), appliedAt: new Date(), completedAt: null, appliedSimulatedSeconds: second, completedSimulatedSeconds: null,
        outcome: storedJson(applied.outcome) as StoredAction["outcome"], failureReason: null});
      nextScenarioStep++;
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
    predictionSubmittedAt: new Date(), evaluationStopAtSimulatedSeconds: def.evaluationSeconds, challengeExperiment: options.plan === undefined ? plan : options.plan,
    ...(scenario ? {challengeScenario: scenario} : {}) };
  return row;
}

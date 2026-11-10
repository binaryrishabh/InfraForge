import { openTheForwardingGateV1 } from "../challenges/definitions/open-the-forwarding-gate/v1";
import { keepAFunctionWarmV1 } from "../challenges/definitions/keep-a-function-warm/v1";
import { isolateRouteCreditsV1 } from "../challenges/definitions/isolate-route-credits/v1";
import { resolveAfterPublicationV1 } from "../challenges/definitions/resolve-after-publication/v1";
import { shedLoadAtTheEdgeV1 } from "../challenges/definitions/shed-load-at-the-edge/v1";
import { holdSlotsOnASlowCallV1 } from "../challenges/definitions/hold-slots-on-a-slow-call/v1";
import { admitAReplicaImageV1 } from "../challenges/definitions/admit-a-replica-image/v1";
import { restoreSafeRedundancyV1 } from "../challenges/definitions/restore-safe-redundancy/v1";
import { keepFailedEventsV1 } from "../challenges/definitions/keep-failed-events/v1";
import { redriveAfterTheFixV1 } from "../challenges/definitions/redrive-after-the-fix/v1";
import { scaleOnDeliveredSamplesV1 } from "../challenges/definitions/scale-on-delivered-samples/v1";
import { moveMonitoringSamplesV1 } from "../challenges/definitions/move-monitoring-samples/v1";
import { objectBytesVersusAppCpuV1 } from "../challenges/definitions/object-bytes-versus-app-cpu/v1";
import { sizeTheAppDatabasePoolV1 } from "../challenges/definitions/size-the-app-database-pool/v1";
import { restoreADatabaseWriterV1 } from "../challenges/definitions/restore-a-database-writer/v1";
import { testACircuitAgainV1 } from "../challenges/definitions/test-a-circuit-again/v1";
import { keepAnAssetCachedV1 } from "../challenges/definitions/keep-an-asset-cached/v1";
import { openAndSizeAnApiV1 } from "../challenges/definitions/open-and-size-an-api/v1";
import { splitTheCapacityBudgetV1 } from "../challenges/definitions/split-the-capacity-budget/v1";
import { diagnoseConsumerCreditV1 } from "../challenges/definitions/diagnose-consumer-credit/v1";
import { diagnoseConsumerCreditV2 } from "../challenges/definitions/diagnose-consumer-credit/v2";
import { parallelJobsForABurstV1 } from "../challenges/definitions/parallel-jobs-for-a-burst/v1";
import { fitARequestInMemoryV1 } from "../challenges/definitions/fit-a-request-in-memory/v1";
import { keepWaitingWorkV1 } from "../challenges/definitions/keep-waiting-work/v1";
import { checkTheMissingServerV1 } from "../challenges/definitions/check-the-missing-server/v1";
import { diagnoseQueryAdmissionV1 } from "../challenges/definitions/diagnose-query-admission/v1";
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
import { reuseBeforeExpiryV1 } from "../challenges/definitions/reuse-before-expiry/v1";
import { shareACacheFillV1 } from "../challenges/definitions/share-a-cache-fill/v1";
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
import { writesCostMoreThanReadsV1 } from "../challenges/definitions/writes-cost-more-than-reads/v1";
import { balancerSharesTurnsV1 } from "../challenges/definitions/balancer-shares-turns/v1";
import { notificationRetryStormV1 } from "../challenges/definitions/notification-retry-storm/v1";
import { analyticsBurstBufferV1 } from "../challenges/definitions/analytics-burst-buffer/v1";
import { diagnoseLostAppCapacityV1 } from "../challenges/definitions/diagnose-lost-app-capacity/v1";
import { investigateAPoolResetV1 } from "../challenges/definitions/investigate-a-pool-reset/v1";
import { budgetForAPartitionV1 } from "../challenges/definitions/budget-for-a-partition/v1";
import { traceASaturationCascadeV1 } from "../challenges/definitions/trace-a-saturation-cascade/v1";

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
  "release-the-cpu-budget": {...releaseTheCpuBudgetV1.starter!, resources: releaseTheCpuBudgetV1.starter!.resources.map(r => r.id === "app" ? {...r, vmCpuQuota: {...r.vmCpuQuota!, limitPercent: 100}} : r)},
  "open-the-forwarding-gate": {...openTheForwardingGateV1.starter!, resources: openTheForwardingGateV1.starter!.resources.map(r => r.id === "lb" ? {...r, lbAdmission: {...r.lbAdmission!, maxActive: 16}} : r)},
  "keep-a-function-warm": {...keepAFunctionWarmV1.starter!, resources: keepAFunctionWarmV1.starter!.resources.map(r => r.id === "fn" ? {...r, serverless: {...r.serverless!, idleExpiryMs: 5000}} : r)},
  "isolate-route-credits": {...isolateRouteCreditsV1.starter!, resources: isolateRouteCreditsV1.starter!.resources.map(r => r.id === "gateway" ? {...r, gatewayQuota: {...r.gatewayQuota!, scope: "per-route"}} : r)},
  "resolve-after-publication": {...resolveAfterPublicationV1.starter!, resources: resolveAfterPublicationV1.starter!.resources.map(r => r.id === "dns" ? {...r, dnsCachePolicy: {version: 1, maxTtlSeconds: 1}} : r)},
  "shed-load-at-the-edge": {...shedLoadAtTheEdgeV1.starter!, resources: shedLoadAtTheEdgeV1.starter!.resources.map(r => r.id === "lb" ? {...r, lbAdmission: {...r.lbAdmission!, maxActive: 16}} : r)},
  "hold-slots-on-a-slow-call": {...holdSlotsOnASlowCallV1.starter!, resources: holdSlotsOnASlowCallV1.starter!.resources.map(r => r.id === "worker" ? {...r, asyncWorker: {...r.asyncWorker!, concurrency: 4}} : r)},
  "admit-a-replica-image": {...admitAReplicaImageV1.starter!, resources: admitAReplicaImageV1.starter!.resources.map(r => r.id === "app" ? {...r, artifactCachePolicy: {version: 1, capacityBytes: 4096}} : r)},
  "restore-safe-redundancy": {...restoreSafeRedundancyV1.starter!, resources: restoreSafeRedundancyV1.starter!.resources.map(r => r.id === "db" ? {...r, databaseReplication: {...r.databaseReplication!, rejoin: "snapshot-replay/1"}} : r)},
  "keep-failed-events": {...keepFailedEventsV1.starter!, resources: keepFailedEventsV1.starter!.resources.map(r => r.id === "bus" ? {...r, eventBus: {...r.eventBus!, deadLetterCapacity: 100}} : r)},
  "redrive-after-the-fix": {...redriveAfterTheFixV1.starter!, resources: redriveAfterTheFixV1.starter!.resources.map(r => r.id === "queue" ? {...r, asyncQueue: {...r.asyncQueue!, redriveAtSecond: 45}} : r)},
  "scale-on-delivered-samples": {...scaleOnDeliveredSamplesV1.starter!, resources: scaleOnDeliveredSamplesV1.starter!.resources.map(r => r.id === "monitor" ? {...r, monitoringPolicy: {version: 1 as const, collectionIntervalSeconds: 2, exportIntervalSeconds: 2}} : r)},
  "move-monitoring-samples": {...moveMonitoringSamplesV1.starter!, resources: moveMonitoringSamplesV1.starter!.resources.map(r => r.id === "monitor" ? {...r, monitoringPolicy: {...r.monitoringPolicy!, batchSamples: 16}} : r)},
  "object-bytes-versus-app-cpu": {...objectBytesVersusAppCpuV1.starter!, resources: objectBytesVersusAppCpuV1.starter!.resources.map(r => r.id === "store" ? {...r, objectStoragePolicy: {version: 1, capacityMiB: 4}} : r)},
  "size-the-app-database-pool": {...sizeTheAppDatabasePoolV1.starter!, resources: sizeTheAppDatabasePoolV1.starter!.resources.map(r => r.id === "db" ? {...r, dbPoolMaxConnections: 2} : r)},
  "restore-a-database-writer": {...restoreADatabaseWriterV1.starter!, resources: restoreADatabaseWriterV1.starter!.resources.map(r => r.id === "db" ? {...r, databaseRecoveryPlan: {version: 1, promoteAtSecond: 3}} : r)},
  "test-a-circuit-again": {...testACircuitAgainV1.starter!, resources: testACircuitAgainV1.starter!.resources.map(r =>
    r.id === "lb" ? {...r, circuitBreaker: {...r.circuitBreaker!, cooldownMs: 2000}} : r)},
  "keep-an-asset-cached": {...keepAnAssetCachedV1.starter!, resources: keepAnAssetCachedV1.starter!.resources.map(r =>
    r.id === "cdn" ? {...r, cdnCachePolicy: {version: 1, ttlSeconds: 60}} : r)},
  "diagnose-consumer-credit-v2": {...diagnoseConsumerCreditV2.starter!, resources: diagnoseConsumerCreditV2.starter!.resources.map(r =>
    r.id === "worker" ? {...r, asyncWorker: {...r.asyncWorker!, prefetch: 16}} : r)},
  "parallel-jobs-for-a-burst": {...parallelJobsForABurstV1.starter!, resources: parallelJobsForABurstV1.starter!.resources.map(r =>
    r.id === "worker" ? {...r, asyncWorker: {...r.asyncWorker!, concurrency: 2}} : r)},
  "keep-waiting-work": {...keepWaitingWorkV1.starter!, resources: keepWaitingWorkV1.starter!.resources.map(r =>
    r.id === "queue" ? {...r, asyncQueue: {...r.asyncQueue!, retentionSeconds: 60}} : r)},
  "check-the-missing-server": {...checkTheMissingServerV1.starter!, resources: checkTheMissingServerV1.starter!.resources.map(r =>
    r.id === "lb" ? {...r, lbHealth: {...r.lbHealth!, intervalSeconds: 1}} : r)},
  "share-a-cache-fill": {...shareACacheFillV1.starter!, resources: shareACacheFillV1.starter!.resources.map(r =>
    r.id === "cache" ? {...r, cachePolicy: {...r.cachePolicy!, singleFlight: true}} : r)},
  "reuse-before-expiry": {...reuseBeforeExpiryV1.starter!, resources: reuseBeforeExpiryV1.starter!.resources.map(r =>
    r.id === "cache" ? {...r, cachePolicy: {...r.cachePolicy!, ttlSeconds: 60}} : r)},
  "open-and-size-an-api": {...openAndSizeAnApiV1.starter!, resources: openAndSizeAnApiV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.large"} : r.id === "fw" ? {...r, firewallSettings: {...r.firewallSettings!, rules: r.firewallSettings!.rules.map(rule => rule.id === "quarantine-db" ? {...rule, priority: 20} : rule)}} : r)},
  "open-and-size-an-api-headroom": {...openAndSizeAnApiV1.starter!, resources: openAndSizeAnApiV1.starter!.resources.map(r => r.id === "app" ? {...r, skuId: "c5.xlarge"} : r.id === "fw" ? {...r, firewallSettings: {...r.firewallSettings!, rules: r.firewallSettings!.rules.map(rule => rule.id === "quarantine-db" ? {...rule, priority: 20} : rule)}} : r)},
  "split-the-capacity-budget": {...splitTheCapacityBudgetV1.starter!, resources: splitTheCapacityBudgetV1.starter!.resources.map(r => ({...r, skuId: r.id === "app" ? "s-4vcpu-8gb" : "db-s-2vcpu-4gb"}))},
  "split-the-capacity-budget-app-headroom": {...splitTheCapacityBudgetV1.starter!, resources: splitTheCapacityBudgetV1.starter!.resources.map(r => ({...r, skuId: r.id === "app" ? "s-8vcpu-16gb" : "db-s-2vcpu-4gb"}))},
  "split-the-capacity-budget-db-headroom": {...splitTheCapacityBudgetV1.starter!, resources: splitTheCapacityBudgetV1.starter!.resources.map(r => ({...r, skuId: r.id === "app" ? "s-4vcpu-8gb" : "db-s-4vcpu-8gb"}))},
  "diagnose-consumer-credit": {...diagnoseConsumerCreditV1.starter!, resources: diagnoseConsumerCreditV1.starter!.resources.map(r => r.id === "worker" ? {...r, asyncWorker: {...r.asyncWorker!, prefetch: 16}} : r)},
  "fit-a-request-in-memory": {...fitARequestInMemoryV1.starter!, resources: fitARequestInMemoryV1.starter!.resources.map(r => r.id === "app" ? {...r, size: "large"} : r)},
  "fit-a-request-in-memory-request": {...fitARequestInMemoryV1.starter!, resources: fitARequestInMemoryV1.starter!.resources.map(r => r.id === "app" ? {...r, vmMemory: {...r.vmMemory!, requestMiB: 256}} : r)},
  "diagnose-query-admission": {...diagnoseQueryAdmissionV1.starter!, resources: diagnoseQueryAdmissionV1.starter!.resources.map(r => r.id === "db" ? {...r, dbConcurrency: {...r.dbConcurrency!, activeQueries: 4}} : r)},
  "cache-or-database": starter([["app", T.VirtualMachine, 0, 0, {skuId: "c5.xlarge"}],
    ["cache", T.Cache, 1, 0, {cachePolicy: {version: 2, capacityEntries: 16}}],
    ["db", T.Database, 2, 0, {size: "small", dataKeyspace: {version: 1, count: 16, accessPattern: "hot-key"}}]], [["app", "cache"], ["cache", "db"]]),
  "cache-or-database-capacity": {...definition("cache-or-database").starter!, resources: definition("cache-or-database").starter!.resources.map(r => r.id === "db" ? {...r, skuId: "db.t3.micro"} : r)},
  "one-vm-or-a-pool": starter([["lb", T.LoadBalancer, 0, 0, definition("one-vm-or-a-pool").starter!.resources[0]!],
    ["app", T.VirtualMachine, 1, 0, {skuId: "c5.large"}], ["peer1", T.VirtualMachine, 1, 1, {skuId: "c5.large"}], ["db", T.Database, 2, 0, {size: "medium"}]],
    [["lb", "app"], ["app", "db"], ["lb", "peer1"], ["peer1", "db"]]),
  "one-vm-or-a-pool-small": starter([["lb", T.LoadBalancer, 0, 0, definition("one-vm-or-a-pool").starter!.resources[0]!],
    ["app", T.VirtualMachine, 1, 0, {size: "small"}], ["peer1", T.VirtualMachine, 1, 1, {size: "small"}], ["peer2", T.VirtualMachine, 1, 2, {size: "small"}], ["db", T.Database, 2, 0, {size: "medium"}]],
    [["lb", "app"], ["app", "db"], ["lb", "peer1"], ["peer1", "db"], ["lb", "peer2"], ["peer2", "db"]]),
  "limit-or-capacity": {...definition("limit-or-capacity").starter!, resources: definition("limit-or-capacity").starter!.resources.map(r => r.id === "gateway" ? {...r, apiGateway: {...r.apiGateway!, routes: r.apiGateway!.routes!.map(route => route.id === "read" ? {...route, burstRequests: 1} : route)}} : r)},
  "limit-or-capacity-workers": {...definition("limit-or-capacity").starter!, resources: definition("limit-or-capacity").starter!.resources.map(r => r.id === "readApp" ? {...r, vmExecution: {...r.vmExecution!, workers: 4}} : r)},
  "diagnose-lost-app-capacity": {...diagnoseLostAppCapacityV1.starter!, resources: diagnoseLostAppCapacityV1.starter!.resources.map(r => r.id === "fw" ? {...r, firewallCapacity: {...r.firewallCapacity!, maxFlows: 8}} : r)},
  "investigate-a-pool-reset": {...investigateAPoolResetV1.starter!, resources: investigateAPoolResetV1.starter!.resources.map(r => r.id === "lb" ? {...r, retry: {...r.retry!, maxAttempts: 2}} : r)},
  "budget-for-a-partition": {...budgetForAPartitionV1.starter!, resources: budgetForAPartitionV1.starter!.resources.map(r => r.id === "peer" ? {...r, skuId: "c5.large"} : r)},
  "budget-for-a-partition-headroom": {...budgetForAPartitionV1.starter!, resources: budgetForAPartitionV1.starter!.resources.map(r => r.id === "peer" ? {...r, skuId: "c5.xlarge"} : r)},
  "trace-a-saturation-cascade": {...traceASaturationCascadeV1.starter!, resources: traceASaturationCascadeV1.starter!.resources.map(r => r.id === "db" ? {...r, skuId: "db.m5.large"} : r)},
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
  // Request-path labs: the one-setting fix, and the plausible change that must still fail.
  "writes-cost-more-than-reads": {...writesCostMoreThanReadsV1.starter!, resources: writesCostMoreThanReadsV1.starter!.resources.map(r => r.id === "db" ? {...r, size: "medium"} : r)},
  // The designer offers catalog sizes, not the generic size field: the same change as a learner makes it in the Instance size control.
  "writes-cost-more-than-reads-catalog": {...writesCostMoreThanReadsV1.starter!, resources: writesCostMoreThanReadsV1.starter!.resources.map(r => r.id === "db" ? {...r, skuId: "db.m5.large"} : r)},
  "writes-cost-more-than-reads-second-app": starter([["dns", T.DNS, 0, 0], ["lb", T.LoadBalancer, 1, 0], ["app", T.VirtualMachine, 2, 0, {size: "large"}], ["app2", T.VirtualMachine, 2, 1, {size: "large"}],
    ["db", T.Database, 3, 0, {size: "small"}]], [["dns", "lb"], ["lb", "app"], ["app", "db"], ["lb", "app2"], ["app2", "db"]]),
  "balancer-shares-turns": {...balancerSharesTurnsV1.starter!, resources: balancerSharesTurnsV1.starter!.resources.map(r => r.id === "app-a" ? {...r, skuId: "c5.large"} : r)},
  "balancer-shares-turns-bigger-b": {...balancerSharesTurnsV1.starter!, resources: balancerSharesTurnsV1.starter!.resources.map(r => r.id === "app-b" ? {...r, skuId: "c5.xlarge"} : r)},
  "balancer-shares-turns-least-outstanding": {...balancerSharesTurnsV1.starter!, resources: balancerSharesTurnsV1.starter!.resources.map(r => r.id === "lb" ? {...r, lbSelection: {version: 1 as const, policy: "least-outstanding" as const}} : r)},
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
  if (scenario?.databaseRecovery) instance.scenario = {plan: scenario, next: 0, pending: new Set()};
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

// The text-only versions retain the exact hidden reference designs.
REFERENCE["reuse-before-expiry-v2"] = REFERENCE["reuse-before-expiry"]!;
REFERENCE["share-a-cache-fill-v2"] = REFERENCE["share-a-cache-fill"]!;
REFERENCE["catalogue-link-flash-v2"] = REFERENCE["catalogue-link-flash"]!;
REFERENCE["cache-or-database-v2"] = REFERENCE["cache-or-database"]!;
import { releaseTheCpuBudgetV1 } from "../challenges/definitions/release-the-cpu-budget/v1";

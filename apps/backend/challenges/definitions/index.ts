import { diagnoseConsumerCreditV1 } from "./diagnose-consumer-credit/v1";
import { fitARequestInMemoryV1 } from "./fit-a-request-in-memory/v1";
import { diagnoseQueryAdmissionV1 } from "./diagnose-query-admission/v1";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { reuseBeforeExpiryV1 } from "./reuse-before-expiry/v1";
import { shareACacheFillV1 } from "./share-a-cache-fill/v1";
import { firstProductionApiV1 } from "./first-production-api/v1";
import { secureTheEdgeV1 } from "./secure-the-edge/v1";
import { cacheMattersV1 } from "./cache-matters/v1";
import { writeHeavyV1 } from "./write-heavy/v1";
import { scaleOutSafelyV1 } from "./scale-out-safely/v1";
import { peakTrafficV1 } from "./peak-traffic/v1";
import { loseAnAppServerV1 } from "./lose-an-app-server/v1";
import { cacheFailureV1 } from "./cache-failure/v1";
import { headroomUnderCpuPressureV1 } from "./headroom-under-cpu-pressure/v1";
import { afterTheCacheReturnsV2 } from "./after-the-cache-returns/v2";
import { afterTheCacheReturnsV1 } from "./after-the-cache-returns/v1";
import { loseAnAppServerV2 } from "./lose-an-app-server/v2";
import { firstProductionApiV2 } from "./first-production-api/v2";
import { secureTheEdgeV2 } from "./secure-the-edge/v2";
import { cacheMattersV2 } from "./cache-matters/v2";
import { writeHeavyV2 } from "./write-heavy/v2";
import { scaleOutSafelyV2 } from "./scale-out-safely/v2";
import { peakTrafficV2 } from "./peak-traffic/v2";
import { headroomUnderCpuPressureV2 } from "./headroom-under-cpu-pressure/v2";
import { boundRetriesDuringSlowdownV1 } from "./bound-retries-during-slowdown/v1";
import { whereDoesTheTimeGoV1 } from "./where-does-the-time-go/v1";
import { waitingWithSpareCpuV1 } from "./waiting-with-spare-cpu/v1";
import { oneBiggerOrTwoSmallerV1 } from "./one-bigger-or-two-smaller/v1";
import { routeAroundASlowVmV1 } from "./route-around-a-slow-vm/v1";
import { leaveRoomForABurstV1 } from "./leave-room-for-a-burst/v1";
import { retryingAFullPoolV1 } from "./retrying-a-full-pool/v1";

import { moveReadsOffTheWriterV1 } from "./move-reads-off-the-writer/v1";
import { budgetAppDatabaseSessionsV1 } from "./budget-app-database-sessions/v1";
import { replicasDoNotTakeWritesV1 } from "./replicas-do-not-take-writes/v1";
import { keepUpWithTheQueueV1 } from "./keep-up-with-the-queue/v1";
import { leaveTimeToAcknowledgeV1 } from "./leave-time-to-acknowledge/v1";
import { openOneSubscriberV1 } from "./open-one-subscriber/v1";
import { findTheDenyingRuleV1 } from "./find-the-denying-rule/v1";
import { leaveRoomForFirewallFlowsV1 } from "./leave-room-for-firewall-flows/v1";
import { chooseARetryMitigationV1 } from "./choose-a-retry-mitigation/v1";
import { catalogueLinkFlashV1 } from "./catalogue-link-flash/v1";
import { flashSaleOrderBacklogV1 } from "./flash-sale-order-backlog/v1";
import { protectOneApiRouteV1 } from "./protect-one-api-route/v1";
import { queueOverlappingJobsV1 } from "./queue-overlapping-jobs/v1";
import { boundFunctionPoolPressureV1 } from "./bound-function-pool-pressure/v1";
import { writesCostMoreThanReadsV1 } from "./writes-cost-more-than-reads/v1";
import { balancerSharesTurnsV1 } from "./balancer-shares-turns/v1";
import { notificationRetryStormV1 } from "./notification-retry-storm/v1";
import { analyticsBurstBufferV1 } from "./analytics-burst-buffer/v1";
import { diagnoseLostAppCapacityV1 } from "./diagnose-lost-app-capacity/v1";
import { investigateAPoolResetV1 } from "./investigate-a-pool-reset/v1";
import { budgetForAPartitionV1 } from "./budget-for-a-partition/v1";
import { traceASaturationCascadeV1 } from "./trace-a-saturation-cascade/v1";
import { cacheOrDatabaseV1 } from "./cache-or-database/v1";
import { oneVmOrAPoolV1 } from "./one-vm-or-a-pool/v1";
import { limitOrCapacityV1 } from "./limit-or-capacity/v1";

/* Every published version of every challenge, calibrated against simulation model
"1" and catalog "2026-08". Versions are immutable and never removed: historical
attempts are judged by exactly the version that created them. Order sets the
challenge list. See ../README.md for the authoring rules. */
export const CHALLENGE_VERSIONS: readonly ChallengeDefinition[] = [
  reuseBeforeExpiryV1,
  shareACacheFillV1,
  diagnoseConsumerCreditV1,
  fitARequestInMemoryV1,
  diagnoseQueryAdmissionV1,
  firstProductionApiV1,
  secureTheEdgeV1,
  cacheMattersV1,
  writeHeavyV1,
  scaleOutSafelyV1,
  peakTrafficV1,
  loseAnAppServerV1,
  cacheFailureV1,
  headroomUnderCpuPressureV1,
  afterTheCacheReturnsV1,
  // Model 2 versions (calibrated 2026-10-28).
  firstProductionApiV2,
  secureTheEdgeV2,
  cacheMattersV2,
  writeHeavyV2,
  scaleOutSafelyV2,
  peakTrafficV2,
  loseAnAppServerV2,
  headroomUnderCpuPressureV2,
  afterTheCacheReturnsV2,
  boundRetriesDuringSlowdownV1,
  whereDoesTheTimeGoV1,
  waitingWithSpareCpuV1,
  oneBiggerOrTwoSmallerV1,
  routeAroundASlowVmV1,
  leaveRoomForABurstV1,
  retryingAFullPoolV1,
  moveReadsOffTheWriterV1,
  budgetAppDatabaseSessionsV1,
  replicasDoNotTakeWritesV1,
  keepUpWithTheQueueV1,
  leaveTimeToAcknowledgeV1,
  openOneSubscriberV1,
  findTheDenyingRuleV1,
  leaveRoomForFirewallFlowsV1,
  chooseARetryMitigationV1,
  catalogueLinkFlashV1,
  flashSaleOrderBacklogV1,
  protectOneApiRouteV1,
  queueOverlappingJobsV1,
  boundFunctionPoolPressureV1,
  writesCostMoreThanReadsV1,
  balancerSharesTurnsV1,
  notificationRetryStormV1,
  analyticsBurstBufferV1,
  diagnoseLostAppCapacityV1,
  investigateAPoolResetV1,
  budgetForAPartitionV1,
  traceASaturationCascadeV1,
  cacheOrDatabaseV1,
  oneVmOrAPoolV1,
  limitOrCapacityV1,
];

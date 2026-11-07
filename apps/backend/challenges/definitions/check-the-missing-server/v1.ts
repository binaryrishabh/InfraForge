import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const checkTheMissingServerV1: ChallengeDefinition = {
  engine: "2", id: "check-the-missing-server", version: 1, title: "Check the missing server", difficulty: "starter",
  summary: "Two servers have spare capacity, but slow health checks keep sending requests to the crashed one.",
  concepts: ["Health checks", "Routing after failure", "Failed callers"],
  story: ["Two app servers share 100 reads per second. Either server has enough CPU to handle that traffic alone. Just after second 2, app crashes for an authored eight-second outage including its restart.",
    "The load balancer checks servers only every 60 seconds. It keeps giving turns to the missing server. Change only how often it checks; leave both servers and the database as they are."],
  objective: "Through second 12, complete at least 1100 callers with at most 100 unsuccessful callers.",
  workload: {targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "100 reads/s. Two c5.large apps and a medium database; no retries or autoscaling. The healthy server has spare capacity.",
  evaluationSeconds: 12,
  evaluationNote: "Count callers from start through second 12, after the outage ends. Final health cannot erase earlier failed callers.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "lose-app", atSecond: 2,
    request: {interventionId: "vm-crash", revision: 1, target: {resourceId: "app"}, parameters: {duration: 8}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 1100; at most 100 unsuccessful through second 12", minCompleted: 1100, maxUnsuccessful: 100}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What health will be recorded at second 12, after app returns? Can that erase failed callers?"}],
  hints: ["Run unchanged. Compare whole-run Completed and Failed with the final health; they describe different things.",
    "The other server already has enough CPU. Buying it more CPU does not stop turns being sent to app before a failed check removes app from routing.",
    "Select lb. In Health checks, set Check interval (seconds) to 1. Keep Check timeout (seconds) at 1 and Failures before unhealthy at 1."],
  debrief: ["A spare server helps only when requests reach it. The shorter check interval removes the crashed server from eligible routing sooner, so more callers reach the unchanged survivor. Some requests still fail before detection; this is not zero-loss failover.",
    "This lab changes failure detection, not survivor capacity. Next try Choose a retry mitigation to compare the costs of retrying failed work after a partition.",
    "The scripted process crash uses owned-work cancellation and a fixed one-second restart. Samples and cumulative caller counts do not prove continuous health, physical repair time or production availability. The check timing and CPU costs are educational assumptions.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 1, unhealthyAfter: 1, healthyAfter: 1}}],
    ["app", "Virtual Machine", 1, 0, {skuId: "c5.large"}], ["peer", "Virtual Machine", 1, 1, {skuId: "c5.large"}],
    ["db", "Database", 2, 0, {size: "medium"}]], [["lb", "app"], ["lb", "peer"], ["app", "db"], ["peer", "db"]]),
};

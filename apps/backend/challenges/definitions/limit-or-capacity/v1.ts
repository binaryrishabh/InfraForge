import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const limitOrCapacityV1: ChallengeDefinition = {
  engine: "2", id: "limit-or-capacity", version: 1, title: "Limit or capacity", difficulty: "core",
  summary: "Choose route admission control or backend worker capacity under the same protection requirement.",
  concepts: ["Per-route token buckets", "Worker admission", "CPU versus concurrency", "Refusal tradeoffs"],
  story: ["An API Gateway offers 1000 reads and 1000 writes/second to separate backends. The read backend has c5.xlarge CPU capacity but only one worker and no waiting queue. Its read route starts with 10000 credits and refills at one per second. Spare CPU cannot accept calls beyond the worker bound.",
    "Through second 2, complete at least two reads and 250 writes without upstream failures on either route. Either limit read admission or admit the work with more backend workers. The requirement deliberately permits refusal; it does not require every offered caller to succeed."],
  objective: "Meet both route requirements in two ways. Explain the read throughput and CPU tradeoff using recorded populations rather than treating a passing requirement as availability.",
  workload: {targetThroughput: 120000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.5, payloadSize: "light"},
  workloadNote: "2000 calls/s split evenly over GET /read and POST /write. Independent route tokens still share gateway CPU, transport and in-flight capacity.",
  evaluationSeconds: 2, evaluationNote: "Cumulative route outcomes through second 2. Caller refusal is a real failure, even when it protects a backend.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "reads", kind: "gateway-route-work", label: "Read route completes two calls without upstream failures", resourceId: "gateway", routeId: "read", minCompleted: 2, maxUpstreamFailed: 0},
    {id: "writes", kind: "gateway-route-work", label: "Write route completes 250 calls without upstream failures", resourceId: "gateway", routeId: "write", minCompleted: 250, maxUpstreamFailed: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the report record despite meeting or missing the route protection requirements?"}],
  hints: ["Inspect read upstream failures alongside read CPU. The single worker can reject work while other cores are idle.",
    "Keep refill unchanged and reduce only read burst credits to one. Compare read completions, rate refusals and CPU, keeping the write route unchanged.",
    "Alternatively retain the route and give readApp four workers, keeping its queue at zero and instance unchanged. Two workers are a plausible near miss. Explain what each passing design gives up."],
  debrief: ["Route admission can protect the worker by refusing most read callers. Backend worker capacity can instead complete many more reads while using more CPU. Both can meet the stated protection requirements, so defend a choice using actual completions, refusals and resource CPU.",
    "The write route retains independent credits, but shares execution capacity with reads. Compare write counters in these controlled runs; do not turn unchanged counts into a general fairness guarantee. A passing protection exercise may retain unhealthy overall health and caller failures.",
    "Gateway cost is Unknown in the current estimator, so this exercise makes no priced comparison. Exact routes, synthetic CPU work and fixed traffic are educational assumptions, not authentication, production quotas or provider benchmarks.", MODEL_NOTE],
  starter: starter([["gateway", "API Gateway", 0, 0, {apiGateway: {version: 1, routes: [
    {id: "read", edge: "gateway-readApp", path: "/read", method: "GET", burstRequests: 10000, requestsPerSecond: 1},
    {id: "write", edge: "gateway-writeApp", path: "/write", method: "POST", burstRequests: 100, requestsPerSecond: 100}]}}],
    ["readApp", "Virtual Machine", 1, 0, {skuId: "c5.xlarge", vmExecution: {version: 1, workers: 1, queuedRequests: 0}}],
    ["writeApp", "Virtual Machine", 1, 1]], [["gateway", "readApp"], ["gateway", "writeApp"]]),
};

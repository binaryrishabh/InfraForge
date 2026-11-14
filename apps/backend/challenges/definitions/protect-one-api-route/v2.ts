import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const protectOneApiRouteV2: ChallengeDefinition = {
  engine: "2", id: "protect-one-api-route", version: 2, title: "Protect one API route", difficulty: "core",
  summary: "Bound read-route admission without consuming the write route's independent credits.",
  concepts: ["Route token buckets", "Backend admission", "Shared gateway capacity"],
  story: ["An API Gateway receives 1000 reads and 1000 writes per second on two exact routes. The read backend has one worker and no waiting queue. Its route starts with 10000 burst credits but refills only one each second.",
    "The write route owns a separate 100-credit bucket refilling at 100/s. Both routes still share gateway CPU, transport and the global in-flight bound. These are educational limits, not provider settings."],
  objective: "Through second 2, complete at least two reads with no read upstream failures, while completing at least 250 writes with no write upstream failures.",
  workload: {targetThroughput: 120000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.5, payloadSize: "light"},
  workloadNote: "2000 calls/s split evenly into GET /read and POST /write. Refused callers remain visible; admission control sacrifices offered work.",
  evaluationSeconds: 2, evaluationNote: "Cumulative per-route outcomes through second 2. This does not prove fairness under arbitrary shared-capacity saturation.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "reads", kind: "gateway-route-work", label: "Read route completes two calls without upstream failures", resourceId: "gateway", routeId: "read", minCompleted: 2, maxUpstreamFailed: 0},
    {id: "writes", kind: "gateway-route-work", label: "Write route completes 250 calls without upstream failures", resourceId: "gateway", routeId: "write", minCompleted: 250, maxUpstreamFailed: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "Will overall health be Healthy after deliberately rejecting excess traffic?"}],
  hints: ["Compare each route's admitted, rate-refused, completed and upstream-failed populations. Many available tokens can overwhelm a bounded backend.",
    "A slower refill cannot remove the initial 10000 credits. A smaller global in-flight bound also applies to writes; it is not an independent route budget.",
    "Keep read refill at 1/s. One burst credit is the only passing value with other settings unchanged: it just meets the completion minimum; two credits already cause an upstream failure. Leave writes, the gateway in-flight limit and both backends unchanged."],
  debrief: ["Reducing read burst credits protects its worker without spending the write route's tokens. Controlled runs retain the same write admission and completion counts. Shared execution can still couple routes; independent tokens are not a universal no-starvation guarantee.",
    "The reference rejects more callers and completes fewer total calls. Overall health can remain unhealthy because rate refusals are real failures in this model. Passing the protection requirements does not establish availability or a latency SLO.", MODEL_NOTE],
  starter: starter([["gateway", "API Gateway", 0, 0, {apiGateway: {version: 1, routes: [
    {id: "read", edge: "gateway-readApp", path: "/read", method: "GET", burstRequests: 10000, requestsPerSecond: 1},
    {id: "write", edge: "gateway-writeApp", path: "/write", method: "POST", burstRequests: 100, requestsPerSecond: 100}]}}],
    ["readApp", "Virtual Machine", 1, 0, {vmExecution: {version: 1, workers: 1, queuedRequests: 0}}], ["writeApp", "Virtual Machine", 1, 1]],
  [["gateway", "readApp"], ["gateway", "writeApp"]]),
};

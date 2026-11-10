import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";

export const isolateRouteCreditsV1: ChallengeDefinition = {
  engine: "2", id: "isolate-route-credits", version: 1, title: "Isolate route credits", difficulty: "core",
  summary: "A busy read route spends the credits that writes need. Diagnose quota ownership before adding CPU.",
  concepts: ["Shared quota coupling", "Per-route admission", "CPU versus policy", "Isolation and total budget"],
  story: ["A gateway receives 100 calls per second with a fixed 90% read pattern. Two exact routes share one bucket: two initial credits and ten new credits per second. Reads can spend a credit before the next write arrives, even while gateway CPU is almost idle.",
    "Run unchanged and keep the report. Inspect each route's completed, admitted and throttled populations beside quota scope and CPU. Predict final overall health first. Change only Quota scope to Separate for each route, then review exactly one change and compare the saved reports."],
  objective: "Through second 6, complete at least 45 reads and 45 writes with no upstream failures on either route. Explain why the scope change helps writes and why callers are still refused.",
  workload: {targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.9, payloadSize: "light"},
  workloadNote: "Fixed 100 calls/s, 90% reads. Equal saved route budgets. Shared scope owns one bucket; per-route scope owns two. No random arrivals.",
  evaluationSeconds: 6,
  evaluationNote: "Cumulative route outcomes through second 6. Neither terminal CPU nor health establishes continuous availability. Rate refusals remain failed callers.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Pass deployment checks"},
    {id: "reads", kind: "gateway-route-work", label: "Complete at least 45 reads with no upstream failures", resourceId: "gateway", routeId: "read", minCompleted: 45, maxUpstreamFailed: 0},
    {id: "writes", kind: "gateway-route-work", label: "Complete at least 45 writes with no upstream failures", resourceId: "gateway", routeId: "write", minCompleted: 45, maxUpstreamFailed: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded when the gateway deliberately refuses many callers, even with low CPU?"}],
  hints: ["Distinguish Route throttles (429), Capacity refusals (503) and Upstream failures (502). A policy refusal does not prove CPU exhaustion.",
    "Select gateway. Keep both routes' two-credit burst and ten-per-second refill unchanged; change only Quota scope from Shared across routes to Separate for each route.",
    "For a separate near miss, restore the starter and enlarge only writeApp from small to large. Compare write completions and rate refusals. Extra backend CPU cannot mint gateway credits."],
  debrief: ["The shared quota admits whichever matching request reaches the bucket while a credit exists. In this fixed pattern, read calls consume most credits. Per-route scope gives writes their own full bucket, so read traffic cannot spend that bucket's credits.",
    "Per-route scope also increases the aggregate possible admission: each route now owns the same saved budget. This is a deliberate policy change, not a proof of equal fairness at a fixed total rate. Shared CPU, in-flight bounds, transport and upstream capacity can still couple the routes.",
    "More write-backend CPU leaves gateway token ownership and refill unchanged in the controlled near miss. A passing route objective can coexist with Critical overall health and many refused reads. Compare the recorded populations and the one-change review before explaining causation.",
    "This deterministic InfraForge model uses educational command demand, integer token refill, exact routes and a fixed workload. It does not implement provider quotas, authentication, distributed quota coordination, tenant fairness or availability guarantees. Missing scope or outcomes stay Unknown and unscored."],
  starter: starter([["gateway", "API Gateway", 0, 0, {size: "small", gatewayQuota: {version: 1, scope: "shared"}, apiGateway: {version: 1, routes: [
    {id: "read", edge: "gateway-readApp", path: "/read", method: "GET", burstRequests: 2, requestsPerSecond: 10},
    {id: "write", edge: "gateway-writeApp", path: "/write", method: "POST", burstRequests: 2, requestsPerSecond: 10}]}}],
    ["readApp", "Virtual Machine", 1, 0], ["writeApp", "Virtual Machine", 1, 1, {size: "small"}]], [["gateway", "readApp"], ["gateway", "writeApp"]]),
};

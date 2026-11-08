import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const testACircuitAgainV1: ChallengeDefinition = {
  engine: "2", id: "test-a-circuit-again", version: 1, title: "Test a circuit again", difficulty: "advanced",
  summary: "Let a path test the returning server without leaving callers behind a long open circuit.",
  concepts: ["Circuit cooldown", "Half-open probes", "Caller outcomes"],
  story: ["A single app server crashes at second 2 for 3 seconds, including its restart. The load balancer checks health every second, but its circuit waits 60000 ms before admitting a test.",
    "The app can return while the caller's circuit is still open. Faster health checks cannot bypass that path's cooldown."],
  objective: "Through second 12, complete at least 150 callers with at most 90 unsuccessful callers. Inspect the circuit's own state, transitions and probes to explain the result.",
  workload: {targetThroughput: 1200, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "20 read-only callers per second. One large app, fixed health checks and no retries.",
  evaluationSeconds: 12, evaluationNote: "Caller counts cover the whole segment through second 12. Circuit state is an instant sample; probe and transition counts are cumulative, not a recovery timeline.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete at least 150 callers with at most 90 unsuccessful through second 12", minCompleted: 150, maxUnsuccessful: 90}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be sampled at second 12?"}],
  hints: ["Compare the returning app with the load balancer's path state. A server's return does not close the caller's circuit.",
    "A 5000 ms cooldown does eventually admit a successful probe, but still leaves too many callers unsuccessful in this fixed window.",
    "Select lb. Change only Circuit breaker: Wait before testing again from 60000 to 2000 ms, then compare caller counts and probe outcomes."],
  debrief: ["A cooldown controls when the existing path machine may enter half-open. One admitted probe can close it; health checks also use that path and cannot bypass an open circuit.",
    "The requirements score cumulative caller outcomes. Saved path state, transitions and probe counts explain admission, but are not separately scored or a chronological history. A closed final state alone can coexist with too many failed callers.",
    "Shorter cooldowns may test a dependency while it is still failing. This fixed case does not establish an optimal policy, exact recovery time, continuous health or provider availability.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbSelection: {version: 1, policy: "round-robin"},
    lbHealth: {version: 1, intervalSeconds: 1, timeoutSeconds: 1, unhealthyAfter: 1, healthyAfter: 1},
    circuitBreaker: {enabled: true, failureThreshold: 1, cooldownMs: 60000}}],
  ["app", "Virtual Machine", 1, 0, {size: "large"}]], [["lb", "app"]]),
  scenario: {version: 1, visibility: "revealed", steps: [{id: "app-crash", atSecond: 2,
    request: {interventionId: "vm-crash", revision: 1, target: {resourceId: "app"}, parameters: {duration: 3}}}]},
};

import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const diagnoseLostAppCapacityV1: ChallengeDefinition = {
  engine: "2", id: "diagnose-lost-app-capacity", version: 1, title: "Diagnose lost app capacity", difficulty: "advanced",
  summary: "A saturated app is the loud symptom. Diagnose why its peer receives no work before buying more CPU.",
  concepts: ["Misleading symptoms", "Tracked flows", "Backend eligibility", "Evidence-led diagnosis"],
  story: ["Two small apps share a medium database. Callers become slow, app is saturated, peer is idle and db is Healthy. The allow-all firewall tracks just one connection. Startup probes use the same dependency paths as the workload.",
    "Run unchanged. Use the saved incoming database counters to submit a database-admission answer in another unchanged attempt, verified before editing. Then inspect the firewall's capacity refusals to narrow the recorded other-or-mixed classification."],
  objective: "Through second 6, admit at least two tracked connections with no policy or flow-capacity refusals, and complete second-6 requests with p95 at most 20 ms.",
  workload: {targetThroughput: 30000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "500 reads/s. Each small app has one educational CPU core and 3 ms request work. The medium DB has two cores; each read needs 1 ms.",
  evaluationSeconds: 6, evaluationNote: "Admission counters cover start through second 6, including probes. Latency covers only second-6 completions; no continuous health claim.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "admission", kind: "firewall-admission-budget", label: "Two tracked admissions without policy or flow-capacity refusals", resourceId: "fw", minAdmissions: 2, maxPolicyDenied: 0, maxCapacityRefused: 0},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20}],
  predictions: [{id: "cause", kind: "database-admission", prompt: "Which incoming DB admission evidence explains the idle peer? Verify your answer on the unchanged design before editing."},
    {id: "busy", kind: "busiest-type", prompt: "Which resource type will have the highest known CPU at second 6? Does that alone identify the cause?"}],
  hints: ["Read app and peer CPU, DB incoming paths, missing-listener denials, policy denials and fw Flow capacity refusals together. A busy app alone is not a diagnosis.",
    "One dependency probe is refused by flow capacity. Its app cannot join the eligible serving set. The admitted app then carries the offered workload alone.",
    "After verifying other-or-mixed admission evidence on the unchanged design, change only fw Tracked connection limit from 1 to 8. Enlarging app treats the symptom but leaves the refused path."],
  debrief: ["The classifier reuses the failures labs' retained database-admission prediction. Other-or-mixed does not name a unique cause; the firewall's positive flow-capacity counter, zero policy denials and complete incoming DB paths provide the supporting evidence here.",
    "Increasing only tracked-flow capacity admits both paths. Both apps then serve work, app CPU falls and the completion tail shortens. Enlarging app alone can shorten latency while still failing the connection requirement. The refused startup probe is not itself a failed caller.",
    "Diagnosis order is an exercise instruction using unchanged attempts, not an edit lock. The prediction cannot verify arbitrary prose or every causal explanation. Missing paths or counters leave it Unknown. Firewall CPU, packet traces and continuous health are not recorded.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
    retry: {enabled: true, maxAttempts: 4, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
  ["app", "Virtual Machine", 1, 0, {size: "small"}], ["peer", "Virtual Machine", 1, 1, {size: "small"}], ["db", "Database", 2, 0, {size: "medium"}],
  ["fw", "Firewall", 2, 1, {firewallCapacity: {version: 1, maxFlows: 1}, firewallState: {version: 1, idleTimeoutSeconds: 1}, firewallSettings: {version: 1, default: "allow", rules: []}}]],
  [["lb", "app"], ["lb", "peer"], ["app", "db"], ["peer", "db"], ["fw", "db"]]),
};

import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const findTheDenyingRuleV1: ChallengeDefinition = {
  engine: "2", id: "find-the-denying-rule", version: 1, title: "Diagnose a denied dependency", difficulty: "core",
  summary: "A clean scan and idle database hide a denied dependency. Predict the cause, then read the recorded rule counters.",
  concepts: ["Evidence-led diagnosis", "Rule priority", "Security scan limits"],
  story: ["Run the inherited design unchanged first. Callers fail while the database is idle. Decide whether a firewall rule, a missing listener or another admission failure explains the symptoms before editing anything.",
    "The prediction is checked against retained incoming database admission counters. Inspect the recorded rule name, then test one change. A clean exposure scan alone cannot prove reachability."],
  objective: "Retain fw, obtain at least one tracked admission with zero policy denials and zero capacity refusals through second 4, and keep a clean security scan.",
  workload: {targetThroughput: 480, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Eight reads/s, fixed app and database. Admission counters include startup probes as well as workload connections.",
  evaluationSeconds: 4, evaluationNote: "Counters cover start through second 4; health is only the final sample. The pre-edit prediction is verified after the run.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "scan", kind: "security-clean", label: "The exposure scan has no findings"},
    {id: "admission", kind: "firewall-admission-budget", label: "fw admits connections without policy or capacity refusals", resourceId: "fw", minAdmissions: 1, maxPolicyDenied: 0, maxCapacityRefused: 0}],
  predictions: [{id: "cause", kind: "database-admission", prompt: "Which incoming database admission evidence will this design record? Predict before changing the starter."},
    {id: "scan", kind: "security-clean", prompt: "Can this failing design still have zero exposure-scan findings?"}],
  hints: ["Run unchanged. Read caller failures, DB CPU, incoming DB backend deliveries and rule counters together. Idle CPU does not identify a cause.",
    "The recorded denial names fw:ingress:quarantine-db. Rules run in ascending priority; an allow rule after a matching deny cannot win.",
    "Change only quarantine-db priority from 0 to 20, after allow-app-db at 10. Increasing capacity does not change which rule matches."],
  debrief: ["The starter's database receives no backend deliveries; its incoming admission counters identify quarantine-db, with no missing-listener denials. The scan checks exposure and encryption, not TCP reachability. The final idle DB health label does not explain caller failure.",
    "The prediction classifies recorded admission denials, not every application failure. It requires all fixed direct DB paths, safe counters and current terminal evidence. Missing paths, counters or a terminal sample leave the answer Unknown. Packet traces, application correctness and provider availability are not recorded.",
    "Putting the existing allow rule first changes real admission and downstream completions. The hidden comparison changes only the deny rule priority. The educational model checks both directions; this policy keeps egress allowed by default.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0], ["app", "Virtual Machine", 1, 0], ["db", "Database", 2, 0],
    ["fw", "Firewall", 2, 1, {firewallCapacity: {version: 1, maxFlows: 100}, firewallState: {version: 1, idleTimeoutSeconds: 1}, firewallSettings: {version: 1, default: "allow", rules: [
      {id: "quarantine-db", priority: 0, direction: "ingress", source: "app", destination: "db", fromPort: 5432, toPort: 5432, action: "deny"},
      {id: "allow-app-db", priority: 10, direction: "ingress", source: "app", destination: "db", fromPort: 5432, toPort: 5432, action: "allow"},
    ]}}]], [["lb", "app"], ["app", "db"], ["fw", "db"]]),
};

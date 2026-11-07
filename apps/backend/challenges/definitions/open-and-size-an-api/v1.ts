import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const openAndSizeAnApiV1: ChallengeDefinition = {
  engine: "2", id: "open-and-size-an-api", version: 1, title: "Mission: open and size an API", difficulty: "core",
  summary: "Combine firewall rule priority and app capacity on a steady read path before attempting a burst mission.",
  concepts: ["Firewall rule priority", "App capacity"],
  story: ["An inherited API offers 400 reads each second through a load balancer, one generic small app and a fixed db.m5.large database. A firewall guards the app-to-database connection. Its quarantine-db deny rule runs before its allow-app-db rule.",
    "Use two earlier ideas: permit the intended dependency, then give the app enough capacity to execute its 3 ms of assumed CPU work per read. Keep the topology, workload, database and firewall flow capacity fixed. There is no burst or fault in this guided mission."],
  objective: "Through second 6, retain fw with positive tracked admissions and no policy or flow-capacity refusals, and complete at least 2300 callers with no unsuccessful callers.",
  workload: {targetThroughput: 24000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "400 reads/s from the start, light payloads. Capacity and CPU work are educational assumptions. No retries, cache or autoscaling.",
  evaluationSeconds: 6, evaluationNote: "Caller populations and firewall counters cover start through second 6. In-flight callers are separate. Final p95 and health are observations, not scored whole-run guarantees.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "admission", kind: "firewall-admission-budget", label: "Retain fw: positive admissions, no policy or flow-capacity refusals", resourceId: "fw", minAdmissions: 1, maxPolicyDenied: 0, maxCapacityRefused: 0},
    {id: "work", kind: "caller-outcomes", label: "Complete 2300 callers with no unsuccessful callers through second 6", minCompleted: 2300, maxUnsuccessful: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "After your current changes, what overall health will be recorded at second 6?"}],
  hints: ["Run unchanged. Inspect the database's incoming rule counters and fw's policy denials before interpreting idle database CPU. Rule priority and app capacity solve different problems.",
    "Select fw > Firewall policy. On quarantine-db, change Priority from 0 to 20, after allow-app-db at 10. Run again with the original app; compare Whole run: Completed, Failed and In-flight, then app CPU.",
    "Select app > Instance size > Provider > AWS > c5.large. Combine it with the rule change, then try c5.xlarge. Restore each partial design to explain its failure. Keep the database and flow capacity unchanged."],
  debrief: ["A matching deny rule prevents database admission. Buying app capacity alone cannot change that decision. Putting the existing allow rule first opens the dependency but exposes the app's CPU demand: 400 reads/s at 3 ms/read exceeds the generic small app's one assumed core.",
    "The combined c5.large and c5.xlarge designs can both meet the fixed requirements. Compare their app CPU and saved catalog estimates; the larger option need not complete more callers or improve the terminal tail. Instance size changes modeled cores and default worker slots together.",
    "Firewall counters include startup probes and count connections, not callers. Caller populations count a different unit; in-flight callers are neither successful nor unsuccessful. A clean exposure scan does not establish reachability, and recorded zero refusals is different from missing counters.",
    "Next try catalogue-link-flash: combine app burst headroom with cache working-set capacity. This mission verifies no authentication, application correctness, security certification, continuous health or production availability. Prices are catalog snapshot figures, not a quote; modeled capacity is educational.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0], ["app", "Virtual Machine", 1, 0, {size: "small"}],
    ["db", "Database", 2, 0, {skuId: "db.m5.large"}],
    ["fw", "Firewall", 2, 1, {firewallCapacity: {version: 1, maxFlows: 1000}, firewallState: {version: 1, idleTimeoutSeconds: 1}, firewallSettings: {version: 1, default: "allow", rules: [
      {id: "quarantine-db", priority: 0, direction: "ingress", source: "app", destination: "db", fromPort: 5432, toPort: 5432, action: "deny"},
      {id: "allow-app-db", priority: 10, direction: "ingress", source: "app", destination: "db", fromPort: 5432, toPort: 5432, action: "allow"},
    ]}}]], [["lb", "app"], ["app", "db"], ["fw", "db"]]),
};

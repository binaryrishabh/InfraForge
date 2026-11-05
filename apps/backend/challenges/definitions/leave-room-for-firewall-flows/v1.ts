import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const leaveRoomForFirewallFlowsV1: ChallengeDefinition = {
  engine: "2", id: "leave-room-for-firewall-flows", version: 1, title: "Leave room for firewall flows", difficulty: "core",
  summary: "Measure firewall connection occupancy and capacity refusals separately from policy denials and caller success.",
  concepts: ["Tracked connections", "Flow capacity", "Measurement populations"],
  story: ["Four initial app instances share a database behind an allow-all firewall. The firewall tracks only one connection; its idle timeout is one second. Startup probes also open connections.",
    "Some connection attempts can be refused even while available backends finish all caller requests. Inspect the flow-capacity counter instead of treating a Healthy label as proof that every connection was admitted."],
  objective: "Through second 6, retain fw with at least four tracked admissions, no policy denials and no flow capacity refusals. Keep the exposure scan clean.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s, four initial app instances, one-second firewall idle expiry. All counts include startup probes.",
  evaluationSeconds: 6, evaluationNote: "Score cumulative firewall counters through second 6. Occupancy is current state, not cumulative admissions or unique callers.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "scan", kind: "security-clean", label: "The exposure scan has no findings"},
    {id: "admission", kind: "firewall-admission-budget", label: "fw tracks at least four admissions without refusals", resourceId: "fw", minAdmissions: 4, maxPolicyDenied: 0, maxCapacityRefused: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "Can overall modeled health be Healthy while some startup connection attempts were refused?"}],
  hints: ["Read Current flow occupancy, Tracked state admissions, Flow capacity refusals and Policy denied new admissions separately.",
    "The rules already allow traffic. Enlarging the app does not enlarge the firewall's saved tracked-connection limit.",
    "Select fw. Change only Tracked connection limit from 1 to 8. Keep the one-second idle timeout; compare expired entries as well as occupancy."],
  debrief: ["Capacity refusals are distinct from rule denials. The comparison enlarges only the saved flow limit. Startup probes and independently owned app pools contribute connections; admissions and occupancy are not caller populations.",
    "In this workload the starter can finish callers through admitted paths despite probe refusals. Passing the flow budget is therefore a connection-admission result, not an availability improvement. An idle entry can expire; cumulative admissions need not equal current occupancy.",
    "Established flows bypass new admission checks until close or modeled idle expiry. This lab measures capacity and expiry counters, not a packet-level state machine or a policy-change experiment. Firewall CPU and memory are Unknown; timeout and limits are educational inputs.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}, autoscaling: {enabled: true, minReplicas: 4, maxReplicas: 4, targetCpu: 80}}],
    ["app", "Virtual Machine", 1, 0, {size: "large"}], ["db", "Database", 2, 0],
    ["fw", "Firewall", 2, 1, {firewallCapacity: {version: 1, maxFlows: 1}, firewallState: {version: 1, idleTimeoutSeconds: 1}, firewallSettings: {version: 1, default: "allow", rules: []}}]],
  [["lb", "app"], ["app", "db"], ["fw", "db"]]),
};

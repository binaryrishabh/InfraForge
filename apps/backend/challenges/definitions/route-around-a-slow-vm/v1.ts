import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const routeAroundASlowVmV1: ChallengeDefinition = {
  engine: "2", id: "route-around-a-slow-vm", version: 1, title: "Route around a slow VM", difficulty: "core",
  summary: "Compare round robin with least outstanding when one Healthy backend has a CPU quota.",
  concepts: ["Backend selection", "CPU quotas", "Tail latency"],
  story: ["Two small VMs serve the same read-only endpoint. The slow VM has a 25% CPU quota. Both can remain Healthy while unfinished work accumulates on the slow one.",
    "Round robin gives each VM a turn. Keep both VMs and their quotas unchanged, then test a policy that considers unfinished requests."],
  objective: "At second 6, complete requests with p95 at most 100 ms. Compare each VM's throughput and the response-time median with its tail.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/second, light payloads. No database or fault. slow has a 25% CPU quota; fast has no quota.",
  evaluationSeconds: 6, evaluationNote: "Scores completed-request p95 in second 6 only. CPU is reported against physical capacity, so 25% can exhaust the slow VM's quota.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 6", maxMs: 100}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 6, even if one VM is waiting on quota?"}],
  hints: ["Inspect p50, p95 and per-VM throughput together. A Healthy label does not rule out a long queue.",
    "Buying a bigger fast VM leaves round robin sending half the calls to the quota-limited VM.",
    "Select lb. Under Backend selection, change Round robin to Least outstanding. Keep both VMs unchanged."],
  debrief: ["Least outstanding selects the eligible backend with the fewest unfinished requests. It can shift work to the faster VM without adding capacity.",
    "p50 describes the median completed response; p95 describes the slower tail of those completions. Neither includes unfinished requests. The scored values cover second 6, not the whole run.",
    "Quota utilization is different from physical CPU utilization. Lexical backend ids break selection ties; this profile does not guarantee fair distribution, continuous health or production latency.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbSelection: {version: 1, policy: "round-robin"},
    lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}}],
  ["slow", "Virtual Machine", 1, 0, {size: "small", vmCpuQuota: {version: 1, limitPercent: 25}}],
  ["fast", "Virtual Machine", 1, 1, {size: "small"}]], [["lb", "slow"], ["lb", "fast"]]),
};

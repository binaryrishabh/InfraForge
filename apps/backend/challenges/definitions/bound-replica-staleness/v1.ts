import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const boundReplicaStalenessV1: ChallengeDefinition = {
  engine: "2", id: "bound-replica-staleness", version: 1, title: "Bound replica staleness", difficulty: "core",
  summary: "Reads already move to the replica and the writer is relieved, but many of them miss recent commits. Decide what to change when freshness is a requirement.",
  concepts: ["Read routing", "Replica lag", "Stale reads", "Capacity versus freshness"],
  story: [
    "Four app instances send 1,200 requests/second, 75% reads and 25% writes across 100 modeled keys. Reads already go to the replica, which applies each writer commit after a modeled delay of 1,000 ms.",
    "Latency looks good, yet the saved read-routing counters show many reads that missed a recent commit. Compare stale reads with the writer's load before changing one setting.",
  ],
  objective: "At second 6, completed-request p95 at most 100 ms and at most 600 stale reads recorded through second 6.",
  workload: {targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.75, payloadSize: "light"},
  workloadNote: "1,200 requests/s, 75% reads; 100 uniformly selected modeled keys. Statement CPU assumptions: 1 ms/read and 2 ms/write.",
  evaluationSeconds: 6,
  evaluationNote: "p95 scores completions in second 6 only. Stale-read counts are cumulative from the start, include health probes and describe modeled row versions.",
  criteria: [
    {id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms in second 6", maxMs: 100},
    {id: "fresh", kind: "stale-reads", label: "At most 600 stale reads through second 6", resourceId: "db", maxStaleReads: 600},
  ],
  predictions: [{id: "health", kind: "database-health", prompt: "What database health will the starter record at second 6? Does it show how many reads were stale?"}],
  hints: [
    "Compare the replica's stale reads and oldest missed commit age with p95. Fast reads and fresh reads are different measurements.",
    "Sending reads back to the writer removes stale reads but returns the original overload; a larger app does not change either.",
    "Select db. In Database HA, change only Modeled replication delay from 1000 to 10 ms. Keep read routing, the replica and app counts unchanged.",
  ],
  debrief: [
    "A read served by the replica can miss commits applied after it. The number of such reads grows with the modeled delay between a writer commit and its application, so shortening that delay cuts stale reads while the replica keeps carrying the reads.",
    "As a near miss, restore the delay and route reads back to the primary only: stale reads fall to zero, but the writer carries everything again and p95 fails. Capacity and freshness are separate requirements here.",
    "The delay is an authored, fixed number; a real replica's lag varies with load and is not a dial you simply set. Counters are cumulative, include health probes and describe modeled row versions, not application consistency. No provider timing or availability guarantee follows.",
    MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}}],
    ["app", "Virtual Machine", 1, 0, {size: "large", autoscaling: {enabled: true, minReplicas: 4, maxReplicas: 4, targetCpu: 80}}],
    ["db", "Database", 2, 0, {dataKeyspace: {version: 1, count: 100, accessPattern: "uniform"},
      databaseReplication: {version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary"}, databaseReadRouting: {version: 1, policy: "replica-preferred"}}]],
  [["lb", "app"], ["app", "db"]]),
};

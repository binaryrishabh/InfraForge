import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const moveReadsOffTheWriterV1: ChallengeDefinition = {
  engine: "2", id: "move-reads-off-the-writer", version: 1, title: "Move reads off the writer", difficulty: "core",
  summary: "A provisioned replica is idle while reads and writes compete on the primary. Change explicit read routing.",
  concepts: ["Read routing", "Member CPU budgets", "Async replication"],
  story: ["Four app instances send 1,200 requests/second: 75% reads and 25% writes across 100 modeled keys. One replica already exists, but explicit Primary only routing sends all application queries to the writer.",
    "Each database member has a separate CPU and query budget. An idle replica does not relieve the writer until reads use it. Keep capacity unchanged and route snapshot reads away from writes."],
  objective: "Complete requests with p95 at most 100 ms in second 6. Compare member CPU work, reads by source and writer commits across the two recorded runs.",
  workload: {targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.75, payloadSize: "light"},
  workloadNote: "1,200 requests/s, 75% reads; 100 uniformly selected modeled keys. Statement CPU assumptions: 1 ms/read and 2 ms/write; replica delay 1,000 ms.",
  evaluationSeconds: 6, evaluationNote: "Scores completed-request p95 during second 6 only. Member CPU work and read/write counters accumulate from the start, including health probes.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms in second 6", maxMs: 100}],
  predictions: [{id: "health", kind: "database-health", prompt: "Will the database health label alone expose the busy primary at second 6?"}],
  hints: ["Inspect primary and replica consumed CPU microseconds and read counts. The combined database CPU percentage averages both members.",
    "A larger waiting-query queue does not add CPU or move reads. Writes still require the writer.",
    "Select db. In Database HA, change Read routing from Primary only to Replica preferred. Keep the replica and app counts unchanged."],
  debrief: ["Explicit replica-preferred routing sends snapshot reads to an available replica. Writes continue on the primary; member admissions, commits and consumed CPU show the split. A full replica refuses capacity rather than spilling work to the primary.",
    "Combined database CPU averages the two member budgets. The primary can exhaust its budget while the combined label remains Healthy. Inspect member work and caller outcomes together.",
    "The replica applies commits after an authored fixed delay. Recorded stale-read counts and oldest missed commit age describe actual modeled reads; lower latency does not establish fresh reads or application consistency. These cumulative counters include health probes.",
    "p95 covers completions in second 6, excluding failures and unfinished callers. It is not a whole-run SLO. Member CPU budgets are independent assumptions; host CPU sharing and finite database IO are unsupported in this profile.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}}],
    ["app", "Virtual Machine", 1, 0, {size: "large", autoscaling: {enabled: true, minReplicas: 4, maxReplicas: 4, targetCpu: 80}}],
    ["db", "Database", 2, 0, {dataKeyspace: {version: 1, count: 100, accessPattern: "uniform"},
      databaseReplication: {version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary"}, databaseReadRouting: {version: 1, policy: "primary-only"}}]],
  [["lb", "app"], ["app", "db"]]),
};

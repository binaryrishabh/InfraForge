import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const replicasDoNotTakeWritesV1: ChallengeDefinition = {
  engine: "2", id: "replicas-do-not-take-writes", version: 1, title: "Replicas do not take writes", difficulty: "core",
  summary: "Test the tempting replica fix against a write-only workload, then give the writer more capacity.",
  concepts: ["Writer capacity", "Read replicas", "Controlled comparisons"],
  story: ["Four app instances send 650 writes/second across 100 modeled keys. The small database has one CPU core; each authored write uses 2 ms of CPU before commit.",
    "Try enabling one replica and Replica preferred read routing while keeping the writer small. Then restore the starter and change only the database size. Compare writer commits and caller latency."],
  objective: "Complete requests with p95 at most 100 ms in second 6. Explain why a replica-only attempt can fail even when the combined database health label improves.",
  workload: {targetThroughput: 39000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0, payloadSize: "light"},
  workloadNote: "650 writes/s, light payloads, 100 uniformly selected modeled keys; 2 ms CPU/write. Load-balancer probes can also issue reads.",
  evaluationSeconds: 6, evaluationNote: "Scores completed-request p95 during second 6 only. Replication/read-routing counters include health probes; they are not application read demand.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms in second 6", maxMs: 100}],
  predictions: [{id: "health", kind: "database-health", prompt: "What database health will the small single writer record at second 6?"}],
  hints: ["A read replica receives already committed writes. It does not share application write execution with the current writer.",
    "With a replica, the combined CPU percentage includes idle replica capacity. Compare writer commits and completed-request latency before concluding the bottleneck moved.",
    "Restore the starter, select db and choose db.t3.micro under Instance size. Keep the apps, keyspace and workload unchanged."],
  debrief: ["The replica-only near miss leaves application writes on the primary. Read-routing evidence distinguishes the few probe reads from primary write commits. Neither an added replica nor its lower combined CPU percentage supplies writer CPU.",
    "Choosing db.t3.micro increases the modeled writer from one to two cores. The tier also changes assumed query slots and session limits; this lab proves the effect of the tier choice, not an isolated physical CPU benchmark.",
    "The authored uniform key selection spreads writes across 100 logical rows. It is not a cache-key claim, a production data distribution or a promise about transaction isolation. The reference does not add replicas or a cache.",
    "Inspect failed and unfinished callers alongside p95. The scored percentile covers second-6 completions only and makes no whole-run SLO or availability claim.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}}],
    ["app", "Virtual Machine", 1, 0, {size: "large", autoscaling: {enabled: true, minReplicas: 4, maxReplicas: 4, targetCpu: 80}}],
    ["db", "Database", 2, 0, {size: "small", dataKeyspace: {version: 1, count: 100, accessPattern: "uniform"}}]],
  [["lb", "app"], ["app", "db"]]),
};

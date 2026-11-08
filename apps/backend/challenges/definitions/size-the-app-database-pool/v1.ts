import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";
export const sizeTheAppDatabasePoolV1: ChallengeDefinition = {
  engine: "2", id: "size-the-app-database-pool", version: 1, title: "Size the app database pool", difficulty: "core",
  summary: "Callers wait for one application database connection while CPU has spare capacity. Test the transport pool bound.",
  concepts: ["Application transport pools", "Pool acquisition wait", "Database sessions", "One-change experiments"],
  story: ["A read service offers 1000 requests/s. The app has eight modeled cores and the database has two. Each read uses 3 ms of app CPU and 1 ms of database CPU. The application pool allows only one connection to this database path.",
    "Run unchanged. A connection remains occupied across a database exchange. Requests wait for that connection and can fill the app queue even though neither CPU is saturated. This is separate from database query admission and its session ceiling."],
  objective: "Complete at least 5900 callers with no unsuccessful callers through second 6, and completed-request p95 at most 20 ms in second 6. Test one pool setting.",
  workload: {targetThroughput: 60000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "1000 reads/s, steady, light payloads. One application replica and one database path. No retries or scripted faults.",
  evaluationSeconds: 6, evaluationNote: "Whole-run caller counts through second 6 and completed-request latency in second 6 have separate windows.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20},
    {id: "work", kind: "caller-outcomes", label: "Complete 5900 callers without unsuccessful callers through second 6", minCompleted: 5900, maxUnsuccessful: 0}],
  predictions: [{id: "database", kind: "database-health", prompt: "What database health will the unchanged run record in second 6?"}],
  hints: ["Inspect CPU, Connections, Refused session opens and Duration: Acquired pool wait on the app-to-db path. Read cumulative caller outcomes beside final-second p95.",
    "The application's transport pool is distinct from Active queries and the database session ceiling. A larger database does not change this saved pool bound.",
    "Select db and change only Application database connections from 1 to 2. Keep the app, database size, query admission and workload unchanged."],
  debrief: ["The controlled pair changes only the maximum connections in the application's database transport pool. The starter queues acquisitions and then app work with spare CPU. The changed pool permits overlapping database exchanges; no new engine behavior is introduced.",
    "Compare the saved app-to-db path's acquired wait, pending acquisitions and caller counts. Refused session opens stays zero: this is transport pool saturation, not database session exhaustion. Enlarging only the database leaves the pool bottleneck and caller failures.",
    "Pool maxima are limits, not measured occupancy. Pools open lazily, per source replica and database path; more replicas can multiply the session budget. Raising a pool can expose a different bottleneck in another design.",
    "Acquired pool wait includes establishment and only ended acquisition phases. Failed, cancelled or unfinished acquisitions have no measured duration. A direct pool peak is Unknown. The final-second p95 excludes failed and unfinished callers and proves no whole-run latency SLO or continuous health.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "m5.2xlarge"}],
    ["db", "Database", 1, 0, {skuId: "db.m5.large", dbPoolMaxConnections: 1}]], [["app", "db"]]),
};

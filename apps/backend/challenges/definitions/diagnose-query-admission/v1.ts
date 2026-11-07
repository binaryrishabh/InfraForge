import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const diagnoseQueryAdmissionV1: ChallengeDefinition = {
  engine: "2", id: "diagnose-query-admission", version: 1, title: "Diagnose query admission", difficulty: "advanced",
  summary: "A Healthy database has spare CPU while callers queue and fail. Diagnose its execution admission cap before buying capacity.",
  concepts: ["Database admission", "Occupied pooled sessions", "Backpressure", "Diagnosis from populations"],
  story: ["A pre-built read service offers 1200 reads/s. Its app uses m5.2xlarge and its database db.m5.large. The database permits one active query and 256 queued queries. Each read requires an educational 1 ms of DB CPU; the app requires 3 ms. There are no scripted faults or retries.",
    "The database reports Healthy despite caller failures and a long completion tail. Run unchanged and distinguish execution slots, CPU, lock wait and session refusals. Explain which bound holds up useful work before changing anything."],
  objective: "Complete at least 7000 callers with no unsuccessful callers through second 6, and completed-request p95 at most 20 ms in second 6. Relieve the diagnosed bound with one setting change.",
  workload: {targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "1200 reads/s, steady, light payloads. One active DB query, 256 pending slots, ten-session app-to-DB pool; educational CPU assumptions.",
  evaluationSeconds: 6, evaluationNote: "Score completions in second 6 separately from cumulative caller outcomes through second 6. Healthy DB health alone cannot satisfy either requirement.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20},
    {id: "work", kind: "caller-outcomes", label: "Complete 7000 callers without unsuccessful callers through second 6", minCompleted: 7000, maxUnsuccessful: 0}],
  predictions: [{id: "database", kind: "database-health", prompt: "What database health will be recorded despite caller queuing?"},
    {id: "busy", kind: "busiest-type", prompt: "Which resource type will have the highest known CPU in second 6?"}],
  hints: ["Inspect DB CPU and health alongside Serving queries, Queued queries, Queries waiting for locks and Refused session opens. Then inspect p95 and whole-run failed callers.",
    "One active query cannot use all the database's cores. Pending queries retain occupied sessions; the app can then queue even with spare CPU. Enlarging only the database instance leaves the explicit admission cap unchanged.",
    "Change only db Active queries from 1 to 4. Keep its SKU, queued-query limit, app and workload unchanged. Compare the same report measurements."],
  debrief: ["The controlled reference changes only the active-query bound. The starter has spare DB CPU, one serving query and queued DB work, with no lock wait or session refusals. More active slots let independent reads overlap on the existing CPU capacity.",
    "The fixed run removes the observed DB queue and changes caller outcomes. Merely choosing db.m5.xlarge lowers the CPU percentage without improving the starting tail or failures: a lower utilization percentage is not evidence that the admission problem is fixed.",
    "The retained latency breakdown aggregates completed callers and transport paths. Connection acquisition wait is zero here; do not invent that delay or call this session exhaustion. The current query and connection populations do not measure each query's holding time. Predictions verify health and busiest type, not a free-text root-cause explanation.",
    "The tail requirement covers only second-6 completions. Whole-run counts omit in-flight work from success and failure. Neither requirement proves continuous health, a whole-run latency SLO, availability or production PostgreSQL tuning. Active queries is an educational engine admission gate, not a provider setting.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "m5.2xlarge"}],
    ["db", "Database", 1, 0, {skuId: "db.m5.large", dbConcurrency: {version: 1, activeQueries: 1, queuedQueries: 256}}]], [["app", "db"]]),
};

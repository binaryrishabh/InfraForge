import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const whereDoesTheTimeGoV1: ChallengeDefinition = {
  engine: "2", id: "where-does-the-time-go", version: 1, title: "Where does the time go?", difficulty: "starter",
  summary: "Follow one request through an app and database. Change the resource that is actually busy.",
  concepts: ["Request path", "CPU bottleneck", "Response time"],
  story: ["One small app server reads from one database. Every request does 3 ms of modeled app CPU work and 1 ms of database CPU work.",
    "The workload offers 350 reads per second from the start. Run the starter, compare the two CPU measurements, then change one resource."],
  objective: "At second 12, record Healthy overall health and completed-request p95 at most 100 ms.",
  workload: {targetThroughput: 21000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "350 requests/second, all reads, light payloads. Full rate from the start; no ramp or fault.",
  evaluationSeconds: 12, evaluationNote: "Scored at second 12. p95 describes completions in the preceding second, not a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "health", kind: "overall-health", label: "Overall health is Healthy at second 12", allowed: ["healthy"]},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 12", maxMs: 100}],
  predictions: [{id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 12?"}],
  hints: ["Read app and database CPU separately in the final-state table.",
    "A small app has one assumed CPU core. At 350 reads/second, 3 ms of work per read asks for more than one core.",
    "In the app's Instance size section, select c5.large. Compare p95 and CPU with the starter."],
  debrief: ["Requests wait when app CPU demand exceeds its capacity. A larger database cannot do the app's CPU work.",
    "Selecting c5.large adds assumed CPU cores and default worker slots. The controlled runs show the effect of that setting together; they do not isolate physical CPU from worker count.",
    "Read offered and completed requests/second alongside latency. The scored p95 covers only requests that completed in the last second; it excludes unfinished and failed requests.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {size: "small"}], ["db", "Database", 1, 0, {size: "small"}]], [["app", "db"]]),
};

import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const writesCostMoreThanReadsV1: ChallengeDefinition = {
  engine: "2", id: "writes-cost-more-than-reads", version: 1, title: "Writes cost the database more", difficulty: "starter",
  summary: "Follow a request from DNS to the database. A write-heavy mix makes the database the busiest hop.",
  concepts: ["Request path", "Reads and writes", "Database CPU"],
  story: ["A notes service takes each request through DNS, a load balancer and one large app to a small database. Reads fetch a note; writes save one, and the database does more CPU work for a write than for a read.",
    "The service sees 600 requests/second and only 30% of them are reads. Run the starter, compare each resource's CPU, then change the one resource that is actually busy."],
  objective: "At second 12, record a Healthy database and completed-request p95 at most 100 ms.",
  workload: {targetThroughput: 36000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.3, payloadSize: "light"},
  workloadNote: "600 requests/second, 30% reads and the rest writes, light payloads. Full rate from the start; no ramp or fault.",
  evaluationSeconds: 12, evaluationNote: "Scored at second 12. p95 describes completions in the preceding second, not a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "database", kind: "database-healthy", label: "The database is Healthy at second 12"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 12", maxMs: 100}],
  predictions: [{id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 12?"}],
  hints: ["Read the CPU of the app and the database separately in the final-state table. The busiest hop sets the pace for every request.",
    "Adding a second app server gives the app more room, but every write still goes to the one database.",
    "Select db and choose the next larger Instance size. Keep the app, the workload and the connections unchanged."],
  debrief: ["With most requests writing, the database needs more CPU time per request than it would for reads alone. The small database runs out first, so requests wait there while the app has spare CPU.",
    "A second app server, or a bigger app, leaves the database unchanged. The next larger database size adds assumed CPU cores, and the wait disappears under the same workload. The same starter handles a read-only workload at the same rate, which isolates the read/write mix as the cause.",
    "A Healthy label and a fast p95 are separate measurements: a database can read Degraded while requests still finish quickly. This exercise scores the last second only, and the model's read and write costs are educational assumptions.", MODEL_NOTE],
  starter: starter([["dns", "DNS", 0, 0], ["lb", "Load Balancer", 1, 0], ["app", "Virtual Machine", 2, 0, {size: "large"}], ["db", "Database", 3, 0, {size: "small"}]],
    [["dns", "lb"], ["lb", "app"], ["app", "db"]]),
};

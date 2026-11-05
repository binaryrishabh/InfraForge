import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const oneBiggerOrTwoSmallerV1: ChallengeDefinition = {
  engine: "2", id: "one-bigger-or-two-smaller", version: 1, title: "One bigger box or two?", difficulty: "starter",
  summary: "A steady workload outgrows one app. Compare a larger app with two apps under the same traffic.",
  concepts: ["Vertical scaling", "Horizontal scaling", "Controlled comparison", "Educational cost estimate"],
  story: ["One c5.large app sits behind a load balancer and reads from a medium generic database. A controlled 300 requests/second run fits; this lab offers 800 requests/second to the same design.",
    "Try one c5.xlarge app, then two c5.large apps wired to the same load balancer and database. Record health, completed throughput, p95 and the educational monthly estimate for each."],
  objective: "At second 12, record Healthy overall health and completed-request p95 at most 100 ms, within a $200 educational monthly estimate.",
  workload: {targetThroughput: 48000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "800 requests/second, all reads, light payloads. Steady from the start; the 300/s control is a separate calibration run.",
  evaluationSeconds: 12, evaluationNote: "Scored at second 12; last-second measurements only. No outage is applied or availability measured.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "health", kind: "overall-health", label: "Overall health is Healthy at second 12", allowed: ["healthy"]},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 12", maxMs: 100},
    {id: "budget", kind: "monthly-budget", label: "Educational monthly estimate is at most $200", maxUsd: 200}],
  predictions: [{id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 12?"}],
  hints: ["Follow the busiest resource. Enlarging the database leaves app capacity unchanged.",
    "For the vertical comparison, change only app's instance to c5.xlarge.",
    "For the horizontal comparison, keep c5.large and add a second c5.large, connecting lb to it and it to db. Compare both reports."],
  debrief: ["A design that handles a lower arrival rate can queue work at a higher one. Compare the same design at 300 and 800 requests/second before changing capacity.",
    "One c5.xlarge and two c5.large apps both pass this workload. The recorded educational estimate is equal here; this exercise does not establish that either approach is cheaper in a real cloud.",
    "The topology with one app has one app instance; the other has two. No failure is tested, so neither passing report proves failover, outage tolerance or production availability. The shared database and load balancer are still dependencies.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0], ["app", "Virtual Machine", 1, 0, {skuId: "c5.large"}],
    ["db", "Database", 2, 0, {size: "medium"}]], [["lb", "app"], ["app", "db"]]),
};

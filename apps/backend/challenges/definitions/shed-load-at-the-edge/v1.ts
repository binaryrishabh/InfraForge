import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const shedLoadAtTheEdgeV1: ChallengeDefinition = {
  engine: "2", id: "shed-load-at-the-edge", version: 1, title: "Shed load at the edge", difficulty: "core",
  summary: "An overloaded app makes every caller wait. Decide how many requests the load balancer should let through at once, and accept the refusals that follow.",
  concepts: ["Admission limits", "Load shedding", "Tail latency under overload", "Refusals versus waiting"],
  story: [
    "A load balancer fronts one small app. About 2000 requests/s arrive, far more than the app can finish. The balancer is saved to forward up to 1024 requests at once with no queue, so nearly everything reaches the app, waits there, and finishes late or fails.",
    "The balancer has saved admission limits for requests forwarded at once, requests queued and queue wait. Compare the final-second tail with whole-run completions and failures before changing one setting.",
  ],
  objective: "At second 10, completed-request p95 at most 100 ms in that second, with at least 3000 callers completed through second 10. Refused callers are an expected cost and are not capped.",
  workload: {targetThroughput: 120000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "2000 reads/s, light payloads, one small app, no database and no faults. Demand stays above the app's capacity for the whole run.",
  evaluationSeconds: 10,
  evaluationNote: "Whole-run caller counts through second 10 and the completed-request p95 in second 10 have separate windows. The p95 excludes refused and unfinished callers.",
  criteria: [
    {id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms in second 10", maxMs: 100},
    {id: "work", kind: "caller-outcomes", label: "Complete at least 3000 callers through second 10; refusals are allowed", minCompleted: 3000, maxUnsuccessful: 20000},
  ],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record at second 10? Does a busy app that finishes some callers look healthy?"}],
  hints: [
    "Run unchanged. Compare app CPU with whole-run completed and failed callers and the final-second p95. The app is busy, yet most callers do not finish.",
    "A larger app raises capacity but demand can still exceed it; waiting in a deep queue is what makes the tail long.",
    "Select lb. Under Load balancer admission, change only Active requests from 1024 to 16. Keep Queued requests, the app size, workload and health checks unchanged.",
  ],
  debrief: [
    "The app finishes about the same number of requests either way, because its CPU is the limit. Without a tight admission limit the extra demand waits inside the app and the final-second tail is long. With a small active limit and no queue the balancer refuses the excess quickly and the requests it does admit finish fast.",
    "As a near miss, restore the starter and choose a larger app. More capacity finishes more callers, but at this demand the queue still forms, so the tail stays above the requirement. Refusing the excess is a trade: more refused callers in exchange for a bounded tail for the rest.",
    "This does not make the design able to serve 2000 requests/s; it chooses who waits. The limits are educational inputs, not provider defaults, and a real service would also need clients that back off. No availability guarantee follows from one sample.",
    MODEL_NOTE],
  starter: starter([
    ["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 1, timeoutSeconds: 1}, lbAdmission: {version: 1, maxActive: 1024, maxQueued: 0}}],
    ["app", "Virtual Machine", 1, 0, {size: "small"}]], [["lb", "app"]]),
};

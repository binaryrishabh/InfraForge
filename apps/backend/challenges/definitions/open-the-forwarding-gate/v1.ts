import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const openTheForwardingGateV1: ChallengeDefinition = {
  engine: "2", id: "open-the-forwarding-gate", version: 1, title: "Open the forwarding gate", difficulty: "core",
  summary: "Requests wait at the balancer while the app has spare CPU. Separate active forwarding capacity from waiting space.",
  concepts: ["Admission control", "Active versus queued work", "Queue wait expiry", "Downstream headroom"],
  story: ["A load balancer receives 300 reads per second but forwards only one request at a time. Up to 64 more calls can wait for 100 ms. The app and database have spare CPU, and no retries or autoscaling are enabled.",
    "Predict the busiest resource type, run unchanged and save the report. Inspect whole-run callers, Rejected at LB, Queued at LB and Admitted by backend. Queue counters count calls that waited, not current queue depth."],
  objective: "Through second 6, complete at least 1700 callers with at most 10 unsuccessful callers. Change one saved setting and explain which gate stopped the work.",
  workload: {targetThroughput: 18000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Fixed 300 reads/s, one c5.large app, medium database. Each read uses 3 ms app CPU and 1 ms DB CPU. These are educational demands, not provider timings.",
  evaluationSeconds: 6,
  evaluationNote: "Cumulative caller outcomes from start through second 6. In-flight callers count as neither completed nor unsuccessful. Final-second latency is not a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Pass deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 1700; at most 10 unsuccessful through second 6", minCompleted: 1700, maxUnsuccessful: 10}],
  predictions: [{id: "busy", kind: "busiest-type", prompt: "Which resource type will have the highest known CPU? Does that prove its CPU is the admission bottleneck?"}],
  hints: ["Compare cumulative callers with LB accounting and app CPU. Rejected at LB and Queued at LB describe a different gate from Refused by VM. The LB's CPU is Unknown.",
    "Select lb. Change only Active requests from 1 to 16 in Load balancer admission. Leave Queued requests at 64, Queue wait (ms) at 100, and both servers unchanged. Review exactly one change, run and compare saved reports.",
    "For a separate near miss, restore the starter and change only Queued requests from 64 to 4096. More waiting space does not raise the number forwarded at once or extend the 100 ms wait. Inspect whether the same callers still fail."],
  debrief: ["The single active slot serializes complete round trips, including the app's wait for its database. Spare backend CPU cannot be used by calls still waiting at the balancer. Increasing only active admission allows overlapping requests to use that headroom.",
    "Increasing the waiting limit alone leaves both the active gate and queue wait unchanged. Here the queue wait expires before 64 waiting places fill, so a larger queue does not help. A queue is useful for a bounded burst, but it is not service capacity.",
    "Read caller outcomes together with LB accounting. Queued-at-LB counts admissions that waited; admitted-by-backend counts attempts. These counters overlap and must not be added as disjoint caller outcomes. The busiest known CPU need not identify the limiting gate, especially when LB CPU is Unknown.",
    "This result depends on measured downstream headroom. Raising admission under a saturated app or database can move or worsen the queue. No arbitrary admission setting is universally safe. The six-second counts do not prove a steady-state maximum, a whole-run tail target, continuous health or production availability.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbAdmission: {version: 1, maxActive: 1, maxQueued: 64, queueWaitMs: 100}}],
    ["app", "Virtual Machine", 1, 0, {skuId: "c5.large"}], ["db", "Database", 2, 0, {size: "medium"}]], [["lb", "app"], ["app", "db"]]),
};

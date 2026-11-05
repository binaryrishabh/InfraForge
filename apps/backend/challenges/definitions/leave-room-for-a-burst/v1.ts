import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const leaveRoomForABurstV1: ChallengeDefinition = {
  engine: "2", id: "leave-room-for-a-burst", version: 1, title: "Leave room for a burst", difficulty: "core",
  summary: "A VM with spare CPU under steady traffic can run out of headroom during a fourfold burst.",
  concepts: ["Burst traffic", "Capacity headroom", "Educational cost estimates"],
  story: ["A small VM handles 100 reads/second through a load balancer. From second 120 until 140, the modeled traffic is four times higher.",
    "Compare the unchanged design before and during the burst. Then change app capacity and compare the monthly educational estimate with CPU headroom."],
  objective: "At second 125, during the burst, complete requests with p95 at most 100 ms. Compare c5.large and c5.xlarge as two valid capacity choices.",
  workload: {targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "100 reads/second normally; 400/second from 120 to 140. Light payloads, no database, no faults or automatic scaling.",
  evaluationSeconds: 125, evaluationNote: "Scores completed-request p95 in second 125, five seconds into the burst. This is not a whole-burst or whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 125", maxMs: 100}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will this design record during the burst at second 125?"}],
  hints: ["Compare the design at 100 reads/second with the fourfold burst. Spare CPU before second 120 is not reserved burst capacity.",
    "A longer VM queue holds more waiting work; it does not add CPU service capacity.",
    "Select app. Under Instance size, choose c5.large instead of Generic. Compare again with c5.xlarge, recording CPU and the educational monthly estimate."],
  debrief: ["The burst can make work arrive faster than the small VM completes it. Capacity that looks adequate at the baseline rate can leave a queue during the burst.",
    "c5.large and c5.xlarge are both valid designs here. Compare recorded CPU utilization to discuss headroom, and use the CostEstimate stage only as a labeled educational monthly estimate, not a current cloud quote.",
    "The last-second p95 omits unfinished and failed requests; inspect their counts too. Whole-run histogram percentile ranges cover another window and are not interchangeable with this exact second's p95. No availability or autoscaling guarantee is tested.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0], ["app", "Virtual Machine", 1, 0, {size: "small"}]], [["lb", "app"]]),
};

import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const setTheLimitAboveThePeakV1: ChallengeDefinition = {
  engine: "2", id: "set-the-limit-above-the-peak", version: 1, title: "Set the limit above the peak", difficulty: "core",
  summary: "A rate limit sized for ordinary traffic refuses a legitimate spike while the app stays mostly idle. Find the setting that matches the spike.",
  concepts: ["Rate limiting", "Sustained rate versus burst", "Refusals versus capacity", "Legitimate peaks"],
  story: [
    "A service gets 200 requests/s, rising to 600 for twenty seconds from second 120 to 140. One large app serves it comfortably. The load balancer has a saved rate limit of a 100-request burst and 300 sustained requests per second.",
    "During the spike the balancer refuses the excess while the app has spare CPU. Compare refused callers with app CPU before changing one setting.",
  ],
  objective: "Through second 140, complete at least 35500 callers with at most 100 unsuccessful callers.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 3, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s, 600/s at seconds 120 to 140; 36000 callers offered in total. One large app, no database, no faults.",
  evaluationSeconds: 140,
  evaluationNote: "Counters are whole-run caller outcomes through second 140. A single run proves no continuous availability and no abuse protection.",
  criteria: [
    {id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 35500 callers with at most 100 unsuccessful through second 140", minCompleted: 35500, maxUnsuccessful: 100},
  ],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record at second 140? Does an idle app mean callers were served?"}],
  hints: [
    "Compare app CPU with whole-run completed and failed callers. The app is not the limit; the balancer is refusing requests.",
    "A bigger app cannot admit what the balancer refuses. A larger burst only helps while its tokens last; the spike lasts twenty seconds.",
    "Select lb. Under Rate limit, change only Sustained requests per second from 300 to 800. Keep Burst requests, the app and the workload unchanged.",
  ],
  debrief: [
    "The limiter refills at the sustained rate, so during a 600/s spike it admits about 300/s once its burst is spent and refuses the rest. Raising the sustained rate above the spike lets the app serve every caller; the app was never the bottleneck.",
    "As a near miss, restore 300 and raise only the burst to 1000: the extra tokens last a few seconds of the spike, then refusals return. Choosing a bigger app does not change what the balancer admits.",
    "A rate limit is a policy, not capacity: set too low it turns a legitimate peak into failures; set too high it protects nothing. This lab measures one scripted peak, not abuse or fairness between clients. The numbers are educational inputs and no availability guarantee follows.",
    MODEL_NOTE],
  starter: starter([
    ["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 1, timeoutSeconds: 1}, lbRateLimit: {version: 1, burstRequests: 100, sustainedRequestsPerSecond: 300}}],
    ["app", "Virtual Machine", 1, 0, {size: "large"}]], [["lb", "app"]]),
};

import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const peakTrafficV2: ChallengeDefinition = {
  engine: "2", id: "peak-traffic", version: 2, title: "Survive the peak", difficulty: "advanced",
  summary: "Traffic doubles in short bursts. The evaluation lands inside one of them.",
  concepts: ["Traffic bursts", "Autoscaling lag", "Headroom"],
  story: [
    "A ticketing API averages 3.2 million requests an hour, but every two minutes a 20-second burst doubles the load.",
    "The current design looks fine between bursts. The evaluation second falls in the middle of a burst.",
  ],
  objective: "Use catalog sizes and keep every resource out of saturation during the burst at the evaluation second, for $750 a month or less.",
  workload: { targetThroughput: 3_200_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 2, readWriteRatio: 0.85, payloadSize: "medium" },
  workloadNote: "3,200,000 requests per hour (about 889 per second) with 2× bursts lasting 20 seconds every 120 seconds, from second 120; 85% reads, medium payloads.",
  evaluationSeconds: 130, evaluationNote: "Checked at simulated second 130, in the middle of the burst that starts at second 120.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 130" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $750 or less", maxUsd: 750 },
  ],
  predictions: [
    { id: "health", kind: "overall-health", prompt: "What will overall health be at second 130?" },
    { id: "scale", kind: "scale-out", prompt: "At second 130, will the autoscaler be running more app servers than you placed?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 130?" },
  ],
  hints: [
    "Check the design between bursts and during one: the burst doubles every request rate for 20 seconds.",
    "An autoscaler that reacts to average CPU cannot add a ready server within a 20-second burst.",
    "Size for the burst, not the average: enough app servers (catalog sizes help) to take twice the base traffic.",
  ],
  debrief: [
    "Between bursts three app servers carry about 889 requests per second comfortably. During the burst the load doubles, and all three saturate near 99% CPU.",
    "Six compute-optimized app servers stay near 50% even inside the burst; the cache and database stay near 20%. Short bursts are absorbed by capacity that is already running, not by capacity that is still starting.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0, { skuId: "c5.large" }], ["vm2", T.VirtualMachine, 2, 1, { skuId: "c5.large" }],
    ["vm3", T.VirtualMachine, 2, 2, { skuId: "c5.large" }],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1, { skuId: "db.m5.xlarge" }],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "cache"), ["cache", "db"]]),
};

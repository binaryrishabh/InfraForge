import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const peakTrafficV1: ChallengeDefinition = {
  id: "peak-traffic", version: 1, title: "Survive the peak", difficulty: "advanced",
  summary: "Traffic doubles in short bursts. The evaluation lands inside one of them.",
  concepts: ["Traffic bursts", "Autoscaling lag", "Headroom"],
  story: [
    "A ticketing API averages 1.5 million requests an hour, but every two minutes a 20-second burst doubles the load.",
    "The current design looks fine between bursts. The evaluation second falls in the middle of a burst.",
  ],
  objective: "Use catalog sizes and keep every resource out of saturation during the burst at the evaluation second, for $750 a month or less.",
  workload: { targetThroughput: 1_500_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 2, readWriteRatio: 0.85, payloadSize: "medium" },
  workloadNote: "1,500,000 requests per hour with 2× bursts every 120 seconds, 85% reads, medium payloads.",
  evaluationSeconds: 250, evaluationNote: "Checked at simulated second 250, inside the burst that starts at second 240.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 250" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $750 or less", maxUsd: 750 },
  ],
  predictions: [
    { id: "health", kind: "overall-health", prompt: "What will overall health be at second 250?" },
    { id: "scale", kind: "scale-out", prompt: "At second 250, will the autoscaler be running more app servers than you placed?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 250?" },
  ],
  hints: [
    "Watch the run around second 240. Bursts ramp up over 5 seconds and last 20.",
    "The autoscaler reacts only after 5 hot seconds and needs 60 more to bring a replica online, so it cannot catch a 20-second burst.",
    "Provision headroom up front: more or larger app servers so the burst fits, while keeping the database and the budget in check.",
  ],
  debrief: [
    "Bursts double the request rate for 20 seconds. A replica the autoscaler starts during a burst comes online about 65 seconds later, after the burst has ended, so only capacity that already exists counts.",
    "Degraded is acceptable here: the requirement is to stay out of saturation. Six c5.large servers or three c5.xlarge servers both absorb the burst within budget; three c5.large servers do not.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0, { skuId: "c5.large" }], ["vm2", T.VirtualMachine, 2, 1, { skuId: "c5.large" }],
    ["vm3", T.VirtualMachine, 2, 2, { skuId: "c5.large" }],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1, { skuId: "db.m5.xlarge" }],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "cache"), ["cache", "db"]]),
};

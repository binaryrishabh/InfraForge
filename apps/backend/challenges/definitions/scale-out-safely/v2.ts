import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const scaleOutSafelyV2: ChallengeDefinition = {
  engine: "2", id: "scale-out-safely", version: 2, title: "Scale out safely", difficulty: "advanced",
  summary: "Three app servers cannot keep up. Add real capacity, sized from the catalog, within the budget.",
  concepts: ["Horizontal scaling", "Instance catalog", "Headroom"],
  story: [
    "A read-heavy service at 3.4 million requests an hour already uses a cache, but its three app servers cannot keep up.",
    "The team wants catalog instance sizes and enough app servers that none of them runs hot at full traffic.",
  ],
  objective: "Use catalog sizes and avoid saturation at the evaluation second, for $650 a month or less.",
  workload: { targetThroughput: 3_400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "light" },
  workloadNote: "3,400,000 requests per hour (about 944 per second), steady, 95% reads, light payloads.",
  evaluationSeconds: 60, evaluationNote: "Checked at simulated second 60, with traffic at full rate from the start.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 60" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $650 or less", maxUsd: 650 },
  ],
  predictions: [
    { id: "scale", kind: "scale-out", prompt: "At second 60, will the autoscaler be running more app servers than you placed?" },
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 60?" },
  ],
  hints: [
    "Three generic app servers are the bottleneck: check their CPU.",
    "More app servers spread the CPU; a compute-optimized size gives each one more room.",
    "Use catalog sizes and add app servers until each one has headroom, then check the monthly estimate.",
  ],
  debrief: [
    "Three generic app servers each run near 99% CPU and saturate; the cache (about 10%) and the database (about 14%) are fine. The fix is more app capacity.",
    "Seven compute-optimized app servers run near 21% each, well clear of saturation, for about $607 a month.",
    "This model does not count database connections per app server; in a real system each new server also opens its own connections, so check the database's limit as the pool grows.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 1], ["vm3", T.VirtualMachine, 2, 2],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "cache"), ["cache", "db"]]),
};

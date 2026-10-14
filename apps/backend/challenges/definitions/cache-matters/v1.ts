import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const cacheMattersV1: ChallengeDefinition = {
  id: "cache-matters", version: 1, title: "Cache matters", difficulty: "core",
  summary: "A read-heavy API overwhelms its database. Relieve it without buying the biggest instance.",
  concepts: ["Caching", "Read/write mix", "Database load"],
  story: [
    "A catalogue API serves 1.8 million requests an hour, and 95% of them are reads of the same popular items.",
    "The current design sends every request straight to one database. Adding app servers alone has not fixed it.",
  ],
  objective: "Keep the database healthy and every resource out of saturation at the evaluation second, for $400 a month or less.",
  workload: { targetThroughput: 1_800_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "medium" },
  workloadNote: "1,800,000 requests per hour, steady, 95% reads, medium payloads.",
  evaluationSeconds: 150, evaluationNote: "Checked at simulated second 150, after the ramp and the autoscaler's first reactions.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "database", kind: "database-healthy", label: "Every database is healthy at second 150" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 150" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $400 or less", maxUsd: 400 },
  ],
  predictions: [
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 150?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 150?" },
  ],
  hints: [
    "Run the starter once, or reason about it: which resource is at 100% CPU? More app servers do not reduce the number of database queries.",
    "A cache placed between the app servers and the database absorbs most repeated reads in this model.",
    "Connect the app servers to a cache and the cache to the database. Four or five generic app servers are enough for the traffic itself.",
  ],
  debrief: [
    "Without a cache, the database receives one query per read and two per write: about 525 queries per second here, more than double what a generic database handles. Adding app servers spreads CPU but leaves that total unchanged.",
    "When a cache sits upstream, this model serves 80% of reads from it, so the database's query load drops to under a third. A larger database instance would also work, but it costs more than this budget allows.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 1], ["vm3", T.VirtualMachine, 2, 2],
    ["db", T.Database, 3, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "db")]),
};

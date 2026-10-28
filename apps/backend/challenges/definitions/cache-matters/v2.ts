import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const cacheMattersV2: ChallengeDefinition = {
  engine: "2", id: "cache-matters", version: 2, title: "Cache matters", difficulty: "core",
  summary: "A read-heavy API overwhelms its database. Relieve it without buying the biggest instance.",
  concepts: ["Caching", "Read/write mix", "Database load"],
  story: [
    "A catalogue API serves 3.6 million requests an hour, and 95% of them are reads of the same popular items.",
    "The current design sends every request straight to one database. Adding app servers alone has not fixed it.",
  ],
  objective: "Keep the database healthy and every resource out of saturation at the evaluation second, for $400 a month or less.",
  workload: { targetThroughput: 3_600_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "medium" },
  workloadNote: "3,600,000 requests per hour (1,000 per second), steady, 95% reads, medium payloads.",
  evaluationSeconds: 60, evaluationNote: "Checked at simulated second 60, with traffic at full rate from the start.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "database", kind: "database-healthy", label: "Every database is healthy at second 60" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 60" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $400 or less", maxUsd: 400 },
  ],
  predictions: [
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 60?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 60?" },
  ],
  hints: [
    "Run the starter once, or reason about it: every request becomes a database query, however many app servers you add.",
    "A cache between the app servers and the database answers repeated reads without touching the database.",
    "Connect the app servers to a cache and the cache to the database. Four generic app servers carry the traffic itself.",
  ],
  debrief: [
    "Without a cache, all 1,000 requests per second reach the database, which runs near 89% CPU and degrades; the three app servers sit near 90% too. More app servers would spread their CPU but not the database's.",
    "With a cache in front, popular reads are answered from memory: the database drops to about 15% CPU and the cache itself uses about 10%. A larger database would also work, but it costs more than this budget allows.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 1], ["vm3", T.VirtualMachine, 2, 2],
    ["db", T.Database, 3, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "db")]),
};

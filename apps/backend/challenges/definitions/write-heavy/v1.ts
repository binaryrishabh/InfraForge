import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const writeHeavyV1: ChallengeDefinition = {
  id: "write-heavy", version: 1, title: "Write-heavy workload", difficulty: "core",
  summary: "Most traffic writes data. Find out what a cache can and cannot do for you.",
  concepts: ["Write load", "Database sizing", "Instance catalog"],
  story: [
    "An event-ingest API receives 900,000 small requests an hour. Seven in ten are writes.",
    "The team added a cache last quarter and the database is still at its limit. They now want to size the design on real catalog instances.",
  ],
  objective: "Use catalog instance sizes for compute and databases, keep the database healthy and avoid saturation, for $750 a month or less.",
  workload: { targetThroughput: 900_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.3, payloadSize: "light" },
  workloadNote: "900,000 requests per hour, steady, 30% reads, light payloads.",
  evaluationSeconds: 180, evaluationNote: "Checked at simulated second 180.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
    { id: "database", kind: "database-healthy", label: "Every database is healthy at second 180" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 180" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $750 or less", maxUsd: 750 },
  ],
  predictions: [
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 180?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 180?" },
  ],
  hints: [
    "Pick instance sizes in the inspector. A generic resource has no catalog size.",
    "A cache only absorbs reads. With 70% writes, the database's work barely changes with or without it.",
    "Writes count twice for the database in this model. Size the database for that load first, then fit app servers to the remaining budget.",
  ],
  debrief: [
    "About 250 requests per second arrive, and each write costs the database two queries, so it handles about 425 queries per second without a cache. A cache can only remove part of the 30% that are reads, which still leaves about 365.",
    "Keeping that under 70% CPU needs a database tier with roughly 600 or more queries per second of capacity, which in this catalog means a 6- or 8-vCPU tier. The budget then leaves room for modest app servers, not oversized ones.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 2],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "cache"), ["cache", "db"]]),
};

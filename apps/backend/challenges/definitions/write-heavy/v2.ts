import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const writeHeavyV2: ChallengeDefinition = {
  engine: "2", id: "write-heavy", version: 2, title: "Write-heavy workload", difficulty: "core",
  summary: "Most traffic writes data. Find out what a cache can and cannot do for you.",
  concepts: ["Write load", "Database sizing", "Instance catalog"],
  story: [
    "An event-ingest API receives 2.2 million small requests an hour. Seven in ten are writes.",
    "The team added a cache last quarter and things are still slow. They now want to size the design on real catalog instances.",
  ],
  objective: "Use catalog instance sizes for compute and databases, keep the database healthy and avoid saturation, for $750 a month or less.",
  workload: { targetThroughput: 2_200_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.3, payloadSize: "light" },
  workloadNote: "2,200,000 requests per hour (about 611 per second), steady, 30% reads, light payloads.",
  evaluationSeconds: 60, evaluationNote: "Checked at simulated second 60, with traffic at full rate from the start.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
    { id: "database", kind: "database-healthy", label: "Every database is healthy at second 60" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 60" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $750 or less", maxUsd: 750 },
  ],
  predictions: [
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 60?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 60?" },
  ],
  hints: [
    "A cache helps reads. Writes still go through the app servers and on to the database.",
    "Compare the CPU of the app servers with the cache's: which part of the path is doing the work?",
    "Choose catalog sizes for the app servers and the database, and add app servers before buying a bigger cache.",
  ],
  debrief: [
    "Seven in ten requests are writes, so the cache saves little: it runs under 5% CPU while two generic app servers saturate near 100% and the database reaches about 64%.",
    "Three compute-optimized app servers (c5.large) share the work at about 52% CPU each, and a larger database instance drops to about 13%. Sizing the write path, not the cache, is what moves the bottleneck.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 2],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "cache"), ["cache", "db"]]),
};

import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const scaleOutSafelyV1: ChallengeDefinition = {
  id: "scale-out-safely", version: 1, title: "Scale out safely", difficulty: "advanced",
  summary: "More app servers should help, until each one opens its own database connections.",
  concepts: ["Autoscaling", "Connection limits", "Instance catalog"],
  story: [
    "A read-heavy service at 2.4 million requests an hour already uses a cache. The autoscaler keeps adding app servers, but the database still falls over.",
    "Every app server holds its own pool of database connections. Nobody has checked how many the database accepts.",
  ],
  objective: "Use catalog sizes, stay within the database's connection limit and avoid saturation at the evaluation second, for $650 a month or less.",
  workload: { targetThroughput: 2_400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "light" },
  workloadNote: "2,400,000 requests per hour, steady, 95% reads, light payloads.",
  evaluationSeconds: 240, evaluationNote: "Checked at simulated second 240, after the autoscaler has had time to add replicas.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
    { id: "connections", kind: "database-connections", label: "Database connections stay within the instance limit at second 240" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 240" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $650 or less", maxUsd: 650 },
  ],
  predictions: [
    { id: "scale", kind: "scale-out", prompt: "At second 240, will the autoscaler be running more app servers than you placed?" },
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 240?" },
  ],
  hints: [
    "Look at the database's connection count, not only its CPU. Each app server, including autoscaled replicas, opens 20 connections in this model.",
    "A generic database accepts 100 connections. When connections exceed the limit, the model forces the database to at least 95% CPU.",
    "Choose a catalog database whose connection limit covers every app server you expect, and place enough app servers that the autoscaler has nothing left to add.",
  ],
  debrief: [
    "Connections in this model are 20 per app server. The starter's three servers plus the replicas the autoscaler added exceed a generic database's 100-connection limit, and the model then treats the database as saturated regardless of its query load.",
    "Most catalog database tiers accept several hundred connections. With enough fixed app servers, CPU stays below the autoscaler's target, no replicas are added and the connection count stays predictable.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 1], ["vm3", T.VirtualMachine, 2, 2],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "cache"), ["cache", "db"]]),
};

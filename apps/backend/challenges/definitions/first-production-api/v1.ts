import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const firstProductionApiV1: ChallengeDefinition = {
  id: "first-production-api", version: 1, title: "First production API", difficulty: "starter",
  summary: "Put a small API online behind a load balancer and keep it healthy under steady traffic.",
  concepts: ["Load balancing", "Horizontal scaling", "Monthly cost"],
  story: [
    "A small team is launching its first public API. Traffic is modest and steady: about 400,000 requests an hour, mostly reads.",
    "They want it reachable through DNS, spread across more than one app server and backed by a database, without paying for capacity they do not need.",
  ],
  objective: "Run at least two app servers behind a load balancer, stay healthy at the evaluation second and keep the monthly estimate at $250 or less.",
  workload: { targetThroughput: 400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "400,000 requests per hour, steady, 80% reads, medium payloads.",
  evaluationSeconds: 120, evaluationNote: "Checked at simulated second 120, after the 60-second ramp to full traffic.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "servers", kind: "min-app-servers", label: "At least 2 app servers behind a load balancer", count: 2 },
    { id: "health", kind: "overall-health", label: "Overall health is healthy at second 120", allowed: ["healthy"] },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $250 or less", maxUsd: 250 },
  ],
  predictions: [
    { id: "health", kind: "overall-health", prompt: "What will overall health be at second 120?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 120?" },
  ],
  hints: [
    "Traffic enters at DNS, which points at a load balancer. The load balancer spreads requests across the app servers connected to it.",
    "400,000 requests an hour is about 111 requests per second. In this model one generic app server sits near 75% CPU at that rate, which counts as degraded.",
    "Two generic app servers behind the load balancer share the traffic. Connect each of them to the database.",
  ],
  debrief: [
    "A generic app server in this model handles about 160 requests per second at full CPU, and writes add extra work. At 111 requests per second a single server sits in the degraded band (70% CPU or more). Two servers split the load and each stays near 37%.",
    "The database is often the busiest resource here. Every request becomes database work and each write counts twice, so it runs hotter than either app server even though it is never the focus of the brief.",
    MODEL_NOTE,
  ],
  starter: null,
};

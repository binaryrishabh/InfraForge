import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const firstProductionApiV2: ChallengeDefinition = {
  engine: "2", id: "first-production-api", version: 2, title: "First production API", difficulty: "starter",
  summary: "Put a small API online behind a load balancer and keep it healthy under steady traffic.",
  concepts: ["Load balancing", "Horizontal scaling", "Monthly cost"],
  story: [
    "A small team is launching its first public API. Traffic is modest and steady: about 400,000 requests an hour, mostly reads.",
    "They want it reachable through DNS, spread across more than one app server and backed by a database, without paying for capacity they do not need.",
  ],
  objective: "Run at least two app servers behind a load balancer, stay healthy at the evaluation second and keep the monthly estimate at $250 or less.",
  workload: { targetThroughput: 400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "400,000 requests per hour (about 111 per second), steady, 80% reads, medium payloads.",
  evaluationSeconds: 60, evaluationNote: "Checked at simulated second 60, with traffic at full rate from the start.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "servers", kind: "min-app-servers", label: "At least 2 app servers behind a load balancer", count: 2 },
    { id: "health", kind: "overall-health", label: "Overall health is healthy at second 60", allowed: ["healthy"] },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $250 or less", maxUsd: 250 },
  ],
  predictions: [
    { id: "health", kind: "overall-health", prompt: "What will overall health be at second 60?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 60?" },
  ],
  hints: [
    "A load balancer only spreads traffic if it has more than one app server behind it.",
    "Connect DNS to the load balancer, the load balancer to two app servers, and both app servers to the database.",
    "Two generic app servers are plenty here; larger instances only raise the monthly estimate.",
  ],
  debrief: [
    "One generic app server carries all 111 requests per second at about 40% CPU. It works, but a single server is a single point of failure.",
    "With two app servers the load balancer sends requests to each in turn, so each runs near 20% CPU and either can absorb the other's share. The database stays near 14% CPU.",
    MODEL_NOTE,
  ],
  starter: null,
};

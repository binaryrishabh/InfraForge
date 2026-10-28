import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const loseAnAppServerV2: ChallengeDefinition = {
  engine: "2", id: "lose-an-app-server", version: 2, title: "Lose an app server", difficulty: "core",
  summary: "One of two app servers crashes under steady traffic. Keep the rest of the system out of saturation while it is down.",
  concepts: ["Redundancy", "Load distribution", "Headroom"],
  story: [
    "An internal API runs on two app servers behind a load balancer. On a normal day each one sits near half of its CPU.",
    "The team wants to know what happens when one of them fails. InfraForge will crash app-2 at simulated second 30. A crashed server stays down for 30 seconds.",
  ],
  objective: "While app-2 is down, keep every other resource out of saturation at the last second of the outage, for $200 a month or less.",
  workload: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "1,000,000 requests per hour (about 278 per second), steady, 80% reads, medium payloads.",
  evaluationSeconds: 60, evaluationNote: "Checked at simulated second 60, the last second app-2 is down.",
  experiment: {
    fault: DeploymentChaosNames.Crash, atSimulatedSecond: 30, target: { resourceId: "app-2", type: T.VirtualMachine },
    hypothesis: "app-2 crashes at simulated second 30 and stays down for 30 seconds. Will the rest of the system stay out of saturation at second 60?",
  },
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "survivors", kind: "survivors-unsaturated", label: "Apart from app-2, no resource saturated or failed at second 60" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $200 or less", maxUsd: 200 },
  ],
  predictions: [
    { id: "baseline", kind: "baseline-health", prompt: "What will overall health be at second 30, just before app-2 crashes?" },
    { id: "survivors", kind: "survivor-health", prompt: "At second 60, how healthy will the least healthy resource other than app-2 be?" },
  ],
  hints: [
    "Before the crash each app server carries half of the requests. Ask where app-2's half goes when it stops.",
    "The load balancer stops sending work to a server that fails its health checks, so the survivors take everything.",
    "Place spare capacity before the fault, so that losing one server still leaves enough to share the traffic.",
  ],
  debrief: [
    "At about 278 requests per second each of the two generic app servers runs near 50% CPU. When app-2 crashes, the load balancer sends every request to app-1, which then needs about 100% and saturates: requests queue and wait.",
    "With three app servers each one carries a third. Losing one leaves two survivors near 50% CPU, well clear of saturation. The database is unaffected either way at about 33% CPU.",
    "Capacity that already exists is what absorbs a sudden loss: a new server cannot start, pass its health checks and take traffic inside a 30-second outage.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["app-1", T.VirtualMachine, 2, 0], ["app-2", T.VirtualMachine, 2, 2],
    ["db", T.Database, 3, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2"]), ...fanIn(["app-1", "app-2"], "db")]),
};

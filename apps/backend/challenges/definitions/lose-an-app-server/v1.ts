import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const loseAnAppServerV1: ChallengeDefinition = {
  id: "lose-an-app-server", version: 1, title: "Lose an app server", difficulty: "core",
  summary: "One of two app servers crashes under steady traffic. Keep the rest of the system out of saturation while it is down.",
  concepts: ["Redundancy", "Load distribution", "Headroom"],
  story: [
    "An internal API runs on two app servers behind a load balancer. On a normal day each one sits well below half of its capacity.",
    "The team wants to know what happens when one of them fails. InfraForge will crash app-2 at simulated second 60, once traffic has finished ramping up. The model keeps a crashed server down for 30 seconds.",
  ],
  objective: "While app-2 is down, keep every other resource out of saturation at the last second of the outage, for $200 a month or less.",
  workload: { targetThroughput: 468_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "468,000 requests per hour, steady, 80% reads, medium payloads.",
  evaluationSeconds: 90, evaluationNote: "Checked at simulated second 90, the last second app-2 is down.",
  experiment: {
    fault: DeploymentChaosNames.Crash, atSimulatedSecond: 60, target: { resourceId: "app-2", type: T.VirtualMachine },
    hypothesis: "app-2 crashes at simulated second 60 and stays down for 30 seconds. Will the rest of the system stay out of saturation at second 90?",
  },
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "survivors", kind: "survivors-unsaturated", label: "Apart from app-2, no resource saturated or failed at second 90" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $200 or less", maxUsd: 200 },
  ],
  predictions: [
    { id: "baseline", kind: "baseline-health", prompt: "What will overall health be at second 60, just before app-2 crashes?" },
    { id: "survivors", kind: "survivor-health", prompt: "At second 90, how healthy will the least healthy resource other than app-2 be?" },
    { id: "scale", kind: "scale-out", prompt: "By second 90, will the autoscaler have an extra app server running?" },
  ],
  hints: [
    "Before the crash each app server carries half of the traffic. Ask where app-2's half goes when it stops.",
    "The load balancer's pool sends a crashed server's share to the servers still running. The autoscaler reacts after 5 hot seconds, and a new server needs 60 more to come online.",
    "Place spare capacity before the fault, so that losing one server still leaves enough to share the traffic. Watch the database as well.",
  ],
  debrief: [
    "At about 130 requests per second, each of two generic app servers runs near 43% CPU. When app-2 crashes, the pool sends all of the traffic to app-1, which then needs about 86%.",
    "In this model a resource works harder when a neighbour is unhealthy: the database takes extra load while an app server feeding it is failed or degraded, and an app server takes extra load when the database it uses is saturated. With one survivor both cross into saturation. With three app servers the two survivors stay near 43% and the database stays below saturation.",
    "The autoscaler saw the overload within 5 seconds, but a new server takes 60 seconds to start, so at second 90 it was still provisioning. Capacity that already exists is what absorbs a sudden loss.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["app-1", T.VirtualMachine, 2, 0], ["app-2", T.VirtualMachine, 2, 2],
    ["db", T.Database, 3, 1],
  ], [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2"]), ...fanIn(["app-1", "app-2"], "db")]),
};

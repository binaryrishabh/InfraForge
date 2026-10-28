import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter, fanIn, fanOut } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const headroomUnderCpuPressureV2: ChallengeDefinition = {
  engine: "2", id: "headroom-under-cpu-pressure", version: 2, title: "Headroom under CPU pressure", difficulty: "core",
  summary: "A CPU spike adds pressure to app-2 for 20 seconds. Leave enough headroom to keep every resource out of saturation at evaluation.",
  concepts: ["Headroom", "Instance sizing", "Delayed autoscaling"],
  story: [
    "Two app servers share steady API traffic. Their baseline is healthy, but a runaway task will consume CPU on app-2.",
    "At simulated second 30, InfraForge starts a runaway process on app-2 that holds 45% of its CPU cores for 20 seconds. It does not crash the server or remove its share of requests.",
  ],
  objective: "Keep every resource out of saturation or failure at second 50, for a monthly design estimate of $250 or less.",
  workload: { targetThroughput: 1_100_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "1,100,000 requests per hour (about 306 per second), steady, 80% reads, medium payloads.",
  evaluationSeconds: 50, evaluationNote: "Checked at second 50, the last second of the CPU spike. Recovery is not measured.",
  experiment: { fault: DeploymentChaosNames.CpuSpike, atSimulatedSecond: 30, target: { resourceId: "app-2", type: T.VirtualMachine },
    hypothesis: "Will app-2 retain enough CPU headroom, and will the system stay out of saturation while the spike is active?" },
  criteria: [{ id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "pressure", kind: "no-saturation", label: "No resource saturated or failed at second 50" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $250 or less", maxUsd: 250 }],
  predictions: [{ id: "baseline", kind: "baseline-health", prompt: "What will overall health be at second 30, just before the CPU spike?" },
    { id: "target", kind: "target-health", prompt: "What health will app-2 record at second 50, the spike's last active tick?" },
    { id: "health", kind: "overall-health", prompt: "What will overall health be at evaluation second 50?" },
    { id: "scale", kind: "scale-out", prompt: "By second 50, will the pool have an extra active app server?" }],
  hints: [
    "Before the spike each app server sits near 55% CPU. Add 45 points to app-2 and see where it lands.",
    "The load balancer keeps sending app-2 its share of requests during the spike.",
    "Give app-2 more cores, so that 45% of its capacity plus its normal work still leaves headroom.",
  ],
  debrief: [
    "Each generic app server runs near 55% CPU. The runaway process takes 45% of app-2's cores, so app-2 reaches about 96% and saturates: requests queue behind the spike.",
    "With a larger instance for app-2 (c5.xlarge), the same spike leaves it near 59% CPU and the system stays healthy. Headroom is capacity you hold back for the moment something else wants the CPU.",
    MODEL_NOTE,
  ],
  starter: starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 4, targetCpu: 60 } }],
    ["app-1", T.VirtualMachine, 2, 0], ["app-2", T.VirtualMachine, 2, 2], ["db", T.Database, 3, 1]],
  [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2"]), ...fanIn(["app-1", "app-2"], "db")]),
};

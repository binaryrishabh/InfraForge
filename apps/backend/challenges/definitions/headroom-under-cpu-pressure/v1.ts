import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter, fanIn, fanOut } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const headroomUnderCpuPressureV1: ChallengeDefinition = {
  id: "headroom-under-cpu-pressure", version: 1, title: "Headroom under CPU pressure", difficulty: "core",
  summary: "A CPU spike adds pressure to app-2 for 20 seconds. Leave enough headroom to keep every resource out of saturation at evaluation.",
  concepts: ["Headroom", "Instance sizing", "Delayed autoscaling"],
  story: ["Two app servers share steady API traffic. Their baseline is healthy, but a runaway task will consume CPU on app-2.",
    "At simulated second 60, InfraForge applies a 20-second CPU spike. Model 1 adds 45 CPU percentage points before jitter and clamping. It does not crash the server or remove its share of requests."],
  objective: "Keep every resource out of saturation or failure at second 80, for a monthly design estimate of $250 or less.",
  workload: { targetThroughput: 514_800, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "514,800 requests per hour (143 per second), steady, 80% reads, medium payloads.",
  evaluationSeconds: 80, evaluationNote: "Checked at second 80, the last measured tick with the CPU spike active. Recovery is not measured.",
  experiment: { fault: DeploymentChaosNames.CpuSpike, atSimulatedSecond: 60, target: { resourceId: "app-2", type: T.VirtualMachine },
    hypothesis: "Will app-2 retain enough CPU headroom, and will the system stay out of saturation while the spike is active?" },
  criteria: [{ id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "pressure", kind: "no-saturation", label: "No resource saturated or failed at second 80" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $250 or less", maxUsd: 250 }],
  predictions: [{ id: "baseline", kind: "baseline-health", prompt: "What will overall health be at second 60, just before the CPU spike?" },
    { id: "target", kind: "target-health", prompt: "What health will app-2 record at second 80, the spike's last active tick?" },
    { id: "health", kind: "overall-health", prompt: "What will overall health be at evaluation second 80?" },
    { id: "scale", kind: "scale-out", prompt: "By second 80, will the pool have an extra active app server?" }],
  hints: ["Start with app-2's normal traffic CPU and the modeled 45-point addition. A healthy baseline can still leave too little headroom for this fault.",
    "A larger instance reduces the CPU needed for the same requests. The spike still adds 45 points; sizing does not remove the injected fault.",
    "The starter pool reacts to average CPU above 60% after 5 hot seconds. A new server then takes 60 seconds to start: a scale-up requested during this 20-second fault cannot be ready by evaluation. Check the database as well."],
  debrief: ["In the starter, app-2's baseline CPU is around 48%. The spike pushes it into saturation. The database also records added pressure from an unhealthy upstream server; the trace keeps the measurements rather than guessing a latency or error rate.",
    "Additional capacity placed before the experiment can leave room for the modeled spike. Compare the recorded baseline, first tick after application and evaluation; change one thing and predict again.",
    "A pending scale-up is different from an active replica. The sample's pool summary and final snapshot show which one existed when the challenge was judged. The retained window ends on the last active fault tick, so it cannot establish recovery.", MODEL_NOTE],
  starter: starter([["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 4, targetCpu: 60 } }],
    ["app-1", T.VirtualMachine, 2, 0], ["app-2", T.VirtualMachine, 2, 2], ["db", T.Database, 3, 1]],
  [["dns", "lb"], ...fanOut("lb", ["app-1", "app-2"]), ...fanIn(["app-1", "app-2"], "db")]),
};

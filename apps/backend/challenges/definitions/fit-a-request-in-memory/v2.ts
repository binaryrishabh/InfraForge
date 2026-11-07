import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const fitARequestInMemoryV2: ChallengeDefinition = {
  engine: "2", id: "fit-a-request-in-memory", version: 2, title: "Fit a request in memory", difficulty: "core",
  summary: "An idle CPU cannot admit a request whose authored resident allocation exceeds its VM's memory headroom.",
  concepts: ["Resident-memory admission", "Per-request allocation", "CPU versus memory", "Per-instance limits"],
  story: ["A read service offers 100 requests/s through a balancer to a Small VM and a database. Its modeled VM baseline is 1024 MiB, each held request needs 1536 MiB, and active execution adds no extra memory. The Small VM's modeled limit is 2048 MiB.",
    "Even one request cannot fit beside that baseline. Allocation refusals also affect health probes; once the balancer has no healthy backend it refuses callers without delivering them. Spare CPU does not remove this admission bound."],
  objective: "Complete at least 590 callers with no unsuccessful callers through second 6. Test one VM setting change, keeping the workload and database fixed.",
  workload: {targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "100 reads/s with light payloads. Resident memory comes from the authored baseline and per-request amounts, not from payload size or a provider benchmark.",
  evaluationSeconds: 6, evaluationNote: "Score cumulative callers through second 6. A missing completed-request p95 when nothing completes is Unknown, not fast service.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 590 callers without unsuccessful callers through second 6", minCompleted: 590, maxUnsuccessful: 0}],
  predictions: [{id: "database", kind: "database-health", prompt: "Will the database stay Healthy even when the VM cannot admit work?"}],
  hints: ["Compare CPU and whole-run callers in the saved report. Open app: memory measurements and inspect Resident, Limit, Headroom, Holding requests, Active requests, Refused allocations and Peak resident alongside the VM's authored settings.",
    "A request needs its own VM's headroom. Another identical Small VM repeats the same inability to fit a single allocation; the balancer does not combine RAM across machines.",
    "Increase only the VM's instance size, or reduce only its per-held-request MiB in the existing memory settings. Keep memory modeling enabled and compare the same workload."],
  debrief: ["The controlled size change gives each allocation more room; the separate per-request change reduces the required allocation on the original CPU capacity. Both restore caller completions in the calibrated runs. The second identical VM still cannot fit any request.",
    "Health probes share the allocation policy. Refused allocations and failed original callers are different populations: after probes fail, the balancer can refuse a caller without another VM allocation. Do not equate their counts.",
    "The saved report shows CPU, health, cumulative callers and modeled VM memory: Resident, Limit, Headroom, Holding requests, Active requests, Refused allocations and Peak resident. Its generic Memory percentage is unavailable here. Compare the saved memory measurements with authored inputs; caller totals alone do not identify memory as the cause. Missing or null memory readings remain Unknown.",
    "This is reject-allocation admission, not an OOM kill, process restart, leak or measured operating-system footprint. No continuous-health, latency SLO, availability or production sizing guarantee follows.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0],
    ["app", "Virtual Machine", 1, 0, {size: "small", vmMemory: {version: 1, baselineMiB: 1024, requestMiB: 1536, activeMiB: 0}}],
    ["db", "Database", 2, 0]], [["lb", "app"], ["app", "db"]]),
};

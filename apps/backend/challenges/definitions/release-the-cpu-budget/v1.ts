import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const releaseTheCpuBudgetV1: ChallengeDefinition = {
  engine: "2", id: "release-the-cpu-budget", version: 1, title: "Release the CPU budget", difficulty: "core",
  summary: "Low CPU can hide a CPU-time limit. Separate application workers from the budget they share.",
  concepts: ["CPU quota", "Worker concurrency", "Queueing", "Offered versus completed work"],
  story: ["One small app receives 300 reads per second. It has eight active workers and room for 256 waiting requests, but its saved Application CPU limit is 25% of total modeled CPU capacity. There are no dependencies, retries, faults or autoscaling.",
    "Predict overall health, run unchanged and save the report. Inspect CPU, whole-run Completed, Failed and In-flight, and the captured Application CPU limit. CPU is measured against modeled core capacity; a low reading does not prove runnable work has access to the rest."],
  objective: "Through second 6, complete at least 1650 callers with at most 20 unsuccessful callers. Change one saved control and explain why the CPU reading rises when outcomes improve.",
  workload: {targetThroughput: 18000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "300 reads/s and 3 ms app CPU per read are fixed educational inputs. One modeled core, eight workers and a 256-request queue; no database or dependency wait.",
  evaluationSeconds: 6,
  evaluationNote: "Caller outcomes are cumulative from start through second 6. In-flight callers are separate. Neither terminal health nor final-second p95 is a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Pass deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 1650; at most 20 unsuccessful through second 6", minCompleted: 1650, maxUnsuccessful: 20}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record, despite its low app CPU reading?"}],
  hints: ["The queue fills while CPU stays around the saved limit. A worker slot lets work run; it does not grant more CPU time. Compare offered work with completions and unsuccessful callers.",
    "Select app. Change only Application CPU limit (%) from 25 to 100. Keep Active workers at 8, Queued requests at 256 and Instance size unchanged. Review exactly one change, run and compare the saved reports.",
    "For a separate near miss, restore the starter and change only Active workers from 8 to 64. The extra workers still share the same CPU-time budget; they can hold more unfinished work without completing enough callers."],
  debrief: ["The app's scheduler exhausts a CPU-time budget in each fixed 100 ms window. Runnable work then waits for renewal even with unused modeled core capacity. Raising the saved percentage releases that constraint without adding cores or worker slots.",
    "More workers do not increase the shared budget. Here they spread limited service across more in-flight requests, and the queue still fills. A small change in failures alone is not a fix if completions remain far below the requirement.",
    "CPU rises after the fix because the same app can now do more useful work. The reference can still record degraded terminal health under high CPU; this lab scores cumulative caller outcomes rather than requiring a Healthy label. Saved CPU and caller counts support the comparison. Scheduler throttled time is not retained as a saved report measurement.",
    "The limit is an educational percentage of total modeled core capacity, not a claim about a host, operating system quota or provider performance. This is a fixed-horizon experiment, not a whole-run latency guarantee or a universal instruction to remove resource isolation. Memory remains Unknown under partial coverage.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {size: "small", vmCpuQuota: {version: 1, limitPercent: 25},
    vmExecution: {version: 1, workers: 8, queuedRequests: 256}}]], []),
};

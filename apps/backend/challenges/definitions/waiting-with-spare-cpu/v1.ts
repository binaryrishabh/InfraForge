import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const waitingWithSpareCpuV1: ChallengeDefinition = {
  engine: "2", id: "waiting-with-spare-cpu", version: 1, title: "Waiting with spare CPU", difficulty: "starter",
  summary: "Requests can wait even with CPU to spare. Inspect the app's worker slots before buying a bigger box.",
  concepts: ["Worker slots", "Queueing", "CPU utilization"],
  story: ["This app admits only one request at a time. Its worker stays occupied while a database call completes, including the modeled network wait.",
    "At 250 reads/second, requests queue even though app CPU is below full utilization. Keep the CPU size and database unchanged while testing more worker slots."],
  objective: "At second 12, complete requests with p95 at most 100 ms. Inspect CPU and throughput as well as health.",
  workload: {targetThroughput: 15000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "250 requests/second, all reads, light payloads. One small app, one worker slot, no fault or ramp.",
  evaluationSeconds: 12, evaluationNote: "Scored at second 12. Healthy resource labels alone do not meet the response-time requirement.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 12", maxMs: 100}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the design record at second 12, even if requests are slow?"}],
  hints: ["Compare the Healthy label with p95 and completed requests/second; they answer different questions.",
    "Select the app and inspect Active workers under VM execution. One occupied worker cannot start another request while it waits for the database.",
    "Change only Active workers from 1 to 4. Leave Instance size Generic and Queued requests at 256."],
  debrief: ["A worker slot bounds admitted request concurrency. In this profile it stays occupied across dependency calls, so a single slot limits throughput before CPU reaches 100%.",
    "Adding CPU cores alone leaves that one slot unchanged. Four slots overlap request work and waits; the controlled comparison keeps CPU capacity and database settings fixed.",
    "More workers are not a universal fix: they can increase downstream pressure. This run scores last-second completed-request p95, not all requests or a whole-run SLO.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {size: "small", vmExecution: {version: 1, workers: 1, queuedRequests: 256}}],
    ["db", "Database", 1, 0, {size: "small"}]], [["app", "db"]]),
};

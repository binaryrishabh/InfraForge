import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const moveMonitoringSamplesV1: ChallengeDefinition = {
  engine: "2", id: "move-monitoring-samples", version: 1, title: "Move monitoring samples", difficulty: "core",
  summary: "A fresh collector hides an export throughput deficit. Move samples to the backend instead of only enlarging their waiting room.",
  concepts: ["Monitoring export throughput", "Buffer capacity", "Backend measurement age", "One-change experiments"],
  story: ["An agent observes a VM and database once per second. It exports one sample every five seconds. The service itself handles this light workload, but observations wait behind the export limit.",
    "Run unchanged. Compare collector freshness with backend arrivals and backend measurement age. Then test whether more buffer space fixes the sustained export deficit."],
  objective: "Through second 90, generate at least 170 samples and receive at least 128 at the named backend, with zero duplicates and pre-export drops. Both target measurement ages must be at most 10 seconds. Compare one setting change.",
  workload: {targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "Two requests/s, steady, 80% reads and light payloads. Two monitoring targets; no fault or intervention script.",
  evaluationSeconds: 90, evaluationNote: "Cumulative sample counts through second 90; backend age is a terminal measurement, not a continuous freshness guarantee.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "delivery", kind: "monitoring-delivery", label: "Receive 128 samples without drops or duplicates; backend ages at most 10 seconds",
      resourceId: "monitor", backendId: "monitor/backend", targetIds: ["vm", "db"], minGenerated: 170, minReceived: 128, maxBackendAgeUs: 10_000_000}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the unchanged run record in second 90?"}],
  hints: ["Read Monitoring: Generated samples, Dropped before export and collector freshness beside Monitoring backend: Received samples and each target's measurement age.",
    "Buffered samples changes waiting room. A fresh collector label or zero drops does not prove that recent measurements reached the backend.",
    "Select monitor. Change only Export batch size from 1 to 16. Keep Buffered samples at 64, collection at one second and export at five seconds."],
  debrief: ["The controlled pair changes export batch capacity. Two targets generate roughly two samples/s, while the starter exports one every five seconds. A larger batch removes this export throughput deficit under the fixed workload.",
    "Restore the starter and change only Buffered samples from 64 to 256. This near miss can remove drops within the window while leaving few backend arrivals and old backend measurements. Collector freshness advances independently of backend delivery.",
    "The generated floor prevents solving this exercise by collecting less. Received includes duplicate occurrences in the model, so duplicates must also be recorded zero. Some samples can remain buffered even in a passing run.",
    "These are educational monitoring assumptions. This healthy export exercise does not prove real monitoring durability, unique delivery under retry ambiguity, continuous freshness, instrumentation cost, application health or production availability. The health prediction is supported; monitoring-specific hypotheses are ungraded.", MODEL_NOTE],
  starter: starter([["vm", "Virtual Machine", 0, 0], ["monitor", "Monitoring Agent", 1, 0,
    {monitoringPolicy: {version: 2, bufferSamples: 64, batchSamples: 1, exportAttempts: 3, collectionIntervalSeconds: 1, exportIntervalSeconds: 5}}],
    ["db", "Database", 2, 0]], [["monitor", "vm"], ["vm", "db"], ["monitor", "db"]]),
};

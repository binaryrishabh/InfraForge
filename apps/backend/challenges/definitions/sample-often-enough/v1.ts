import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const sampleOftenEnoughV1: ChallengeDefinition = {
  engine: "2", id: "sample-often-enough", version: 1, title: "Sample often enough", difficulty: "core",
  summary: "Exporting every two seconds cannot make a measurement newer than the last time it was taken. Collect more often.",
  concepts: ["Collection interval", "Backend measurement age", "Export versus collection", "One-change experiments"],
  story: ["A monitoring agent observes a VM and a database. It exports every two seconds, but it only takes a new measurement every twenty seconds.",
    "The team wants the backend's view of each target to be at most six seconds old when they look at it."],
  objective: "At second 90, each target's backend measurement must be at most 6 seconds old, with at least 20 samples generated and 20 received, no duplicates and no drops. Change one setting.",
  workload: {targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "Two requests/s, steady. Two monitoring targets; no fault or intervention script.",
  evaluationSeconds: 90, evaluationNote: "Cumulative counts through second 90; backend age is a terminal measurement, not a continuous freshness guarantee.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "delivery", kind: "monitoring-delivery", label: "Receive 20 samples without drops or duplicates; backend ages at most 6 seconds",
      resourceId: "monitor", backendId: "monitor/backend", targetIds: ["vm", "db"], minGenerated: 20, minReceived: 20, maxBackendAgeUs: 6_000_000}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the unchanged run record in second 90?"}],
  hints: ["Read Monitoring: Generated samples and Collection requests beside the backend's Measurement age. An export can only deliver measurements that were already taken.",
    "Exporting more often moves old measurements sooner but does not make them newer.",
    "Select monitor. Change only Collect every (seconds) from 20 to 2. Keep the export interval, batch and buffer unchanged."],
  debrief: ["The backend can be no fresher than the newest measurement the agent has taken. With a twenty-second collection interval the newest one is up to twenty seconds old, however often it is exported.",
    "Shortening only the export interval is the near miss: samples arrive promptly but are still as old as the collection interval allows. Shortening the collection interval makes new measurements exist to export.",
    "Not verified: instrumentation cost of sampling often, real monitoring durability or continuous freshness. These are educational timings.", MODEL_NOTE],
  starter: starter([["vm", "Virtual Machine", 0, 0], ["monitor", "Monitoring Agent", 1, 0,
    {monitoringPolicy: {version: 2, bufferSamples: 64, batchSamples: 16, exportAttempts: 3, collectionIntervalSeconds: 20, exportIntervalSeconds: 2}}],
    ["db", "Database", 2, 0]], [["monitor", "vm"], ["vm", "db"], ["monitor", "db"]]),
};

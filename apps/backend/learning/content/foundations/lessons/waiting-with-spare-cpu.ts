import type { LearningLesson } from "@infraforge/contracts/learning";

export const waitingWithSpareCpu: LearningLesson = {
  id: "waiting-with-spare-cpu", contentVersion: 1, trackId: "foundations", moduleId: "first-runs",
  title: "Read latency alongside CPU", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Use a worker-slot limit to see why spare CPU and Healthy labels can coexist with slow responses.",
  prerequisites: [],
  problem: ["The app has CPU to spare, yet callers wait. Its single worker slot stays occupied while a database request finishes."],
  explanation: ["At 250 reads each second, inspect the starter's completed throughput and p95 alongside its resource health. Healthy is a model label, not a response-time promise.",
    "Select the app. Under VM execution, change Active workers from 1 to 4 while leaving Instance size Generic and Queued requests at 256. Run again under the same workload.",
    "Restore one worker and select c5.xlarge under Instance size. Compare the result: extra CPU cannot admit another request through an unchanged single worker slot."],
  experiment: {challengeId: "waiting-with-spare-cpu", prediction: "Will the starter record Healthy overall health at second 12 even when its p95 is slow?",
    evidenceToInspect: ["Overall health and app CPU at second 12", "Completed requests/second at second 12", "Completed-request p95 at second 12"]},
  limitations: ["A worker represents modeled request concurrency and holds its slot across dependency calls; it is not an operating-system thread benchmark.",
    "Last-second p95 excludes incomplete and failed requests. Inspect throughput as well.",
    "Additional workers can increase downstream demand. This example establishes no general rule that more concurrency is better."],
  followUp: "Explain why app CPU can rise while p95 falls after adding worker slots. Refer to both recorded runs.",
};

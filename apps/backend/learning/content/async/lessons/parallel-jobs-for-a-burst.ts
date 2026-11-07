import type { LearningLesson } from "@infraforge/contracts/learning";

export const parallelJobsForABurst: LearningLesson = {
  id: "parallel-jobs-for-a-burst", contentVersion: 1, trackId: "async", moduleId: "burst-workers",
  title: "Use the worker's spare core", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Test job parallelism during a burst, then challenge a ready-age result with a misleading prefetch change.",
  prerequisites: ["queue-ownership-and-acknowledgement", "keep-waiting-work", "keep-up-with-the-queue", "leave-time-to-acknowledge"],
  problem: ["The worker already has two cores but runs one job at a time. Its ready backlog grows during the burst even though publishing succeeds and worker CPU looks modest."],
  explanation: ["Predict health and run unchanged. At second 140, inspect Ready messages and Oldest ready message age (seconds), then compare acknowledgements with ready, in-flight and scheduled work in the requirements.",
    "Select worker. Under Background worker, change only Jobs in parallel from 1 to 2. Keep size, CPU work, prefetch credit and queue settings fixed. Run again and explain which existing CPU capacity the change makes usable.",
    "As a near miss, restore the starter and increase only Prefetch credit (leased jobs) to its maximum. Run again. Can an empty ready population coexist with too much unfinished work? Use the saved in-flight and acknowledgement counts to explain the difference.",
    "The age requirement accepts either a measured ready age within its limit or a measured empty ready population. Empty means no ready message to age; it does not turn Unknown into zero. Missing observations cannot satisfy the requirement."],
  experiment: {challengeId: "parallel-jobs-for-a-burst", prediction: "Will the starter's modest worker CPU establish that the burst's waiting work is being handled quickly? Predict overall health at second 140.",
    evidenceToInspect: ["Ready messages; Oldest ready message age (seconds); Acknowledged messages; Expired messages", "Queue: ready; Queue: in flight; Queue: scheduled; Queue: acknowledged", "CPU; Whole run: Completed; Whole run: Failed"]},
  limitations: ["Results are educational model outputs. Ready age covers broker-ready messages at one recorded second. Leased jobs are excluded; the sample proves neither a whole-run wait target nor exact backlog drain time.",
    "Parallel jobs use the existing two-core VM; worker count and automatic scaling are unavailable. CPU work per job and burst timing are educational assumptions, not provider benchmarks.",
    "Producer completions establish logical acceptance. Neither an empty ready population nor an acknowledgement proves physical durability, exactly-once business actions or continuous health."],
  check: null,
  followUp: "Next revisit Finish the effect, then acknowledge (leave-time-to-acknowledge). Explain why extra parallel jobs cannot repair an acknowledgement lease that expires too soon.",
};

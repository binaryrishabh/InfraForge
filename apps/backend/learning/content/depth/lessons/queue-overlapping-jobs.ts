import type { LearningLesson } from "@infraforge/contracts/learning";

export const queueOverlappingJobs: LearningLesson = {
  id: "queue-overlapping-jobs", contentVersion: 1, trackId: "depth", moduleId: "resource-pressure",
  title: "Queue overlapping jobs", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Use scheduler overlap policy to preserve a finite burst of jobs while accepting measured start delay.",
  prerequisites: ["keep-up-with-the-queue"],
  problem: ["Timer schedules twenty reads from 100 ms, every 50 ms. A function initializes cold instances for 300 ms and executes each invocation for 100 ms before querying db. Its four slots also serve one foreground read each second.",
    "Complete all twenty timer jobs by second 4, with none missed or outstanding. Timer currently allows overlap with a ceiling of 32 active jobs. Capacities and durations are educational assumptions."],
  explanation: ["Predict overall health and run unchanged. Compare timer due, completed, missed and failed counts with function throttles. Foreground completed requests count a separate population from scheduled jobs.",
    "Change only timer overlap to queue, leaving queue capacity 32 and lateness allowance 10000 ms unchanged. Compare completed jobs, peak active and queued populations, cold starts and downstream database calls.",
    "Inspect delayed-start count and maximum start delay. Queuing preserves this finite burst by delaying work. Try skip as a near miss: it reduces overlap by missing triggers, so it fails the preserve-all-work objective even if terminal health is Healthy."],
  experiment: {challengeId: "queue-overlapping-jobs", prediction: "Will queue preserve more jobs than allow or skip, and what start delay will the saved accounting reveal?",
    evidenceToInspect: ["Timer due, completed, missed, failed and outstanding populations through second 4", "Scheduler delayed starts, maximum start delay, peak active and peak queued", "Function throttles, cold starts and database calls, separate from foreground caller completions"]},
  limitations: ["The slow first run comes from authored cold initialization, not a measured provider outage or an injected delayed scheduler trigger.",
    "The queue and lateness allowance fit this finite burst. Sustained arrivals can fill a queue or miss late work. No universal scheduling deadline follows from the terminal result.",
    "Retries are disabled here. Idempotency, duplicate effects, exactly-once guarantees, physical clock accuracy and production availability remain unverified. A Healthy terminal sample cannot reconstruct earlier successful work."],
  followUp: "Explain the lost jobs in allow and skip using their separate counters, then state the measured delay accepted by queue. Name a workload for which dropping overlap could be reasonable.", check: null,
};

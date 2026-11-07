import type { LearningLesson } from "@infraforge/contracts/learning";

export const diagnoseConsumerCredit: LearningLesson = {
  id: "diagnose-consumer-credit", contentVersion: 1, trackId: "diagnosis", moduleId: "async-and-dependencies",
  title: "Diagnose consumer credit", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Explain a growing backlog with spare worker CPU and no redelivery before testing the credit held by acknowledgements.",
  prerequisites: ["locate-the-missing-wait", "queue-ownership-and-acknowledgement", "keep-up-with-the-queue", "leave-time-to-acknowledge"],
  problem: ["The degraded starter accepts eight uploads/s. A single worker spends 20 CPU ms per job and waits 1500 ms after the result write before acknowledging. It has one parallel job and one prefetch credit; queue visibility is 30 seconds. By second 12, acknowledge at least 80 messages, leave at most 16 outstanding and record no redeliveries."],
  explanation: ["Run unchanged before editing. Read the saved requirement detail: Queue: originals, deliveries, completed object effects, acknowledged, ready, in flight, scheduled and redeliveries. Compare worker CPU with producer Whole run: Completed and Whole run: Failed. A completed upload is separate from a finished background job.",
    "Write a diagnosis first. Which saved populations support insufficient consumer capacity? Combine them with the captured prefetch and acknowledgement-delay settings to propose credit held until acknowledgement. No redeliveries in this window weakens the expired-lease hypothesis. Saved counts alone cannot identify the worker's waiting phase; leave that attribution Unknown without the settings and controlled test.",
    "Change only worker Prefetch credit from 1 to 16. Preserve Jobs in parallel, CPU milliseconds per job, Delay before acknowledgement and queue settings. Compare both saved reports. Receiving later work while earlier acknowledgements wait can reduce ready work even while the in-flight population rises.",
    "Restore the starter. Extend only queue visibility and run again as a wrong fix, then separately try more queue capacity. Explain why neither removes the credit bound. During an unchanged run, inspect Oldest ready message age (seconds) on the live queue panel. Separate that live observation from the saved terminal counts; the saved report does not display age or retain a backlog history."],
  experiment: {challengeId: "diagnose-consumer-credit", prediction: "Can a fast producer and spare worker CPU coexist with old, unacknowledged work?",
    evidenceToInspect: ["Queue: originals; Queue: deliveries; Queue: completed object effects; Queue: acknowledged",
      "Queue: ready; Queue: in flight; Queue: scheduled; Queue: redeliveries; Queue: dead-lettered",
      "CPU; Health; Overall health", "Whole run: Completed; Whole run: Failed; Whole run: In-flight; p95"]},
  limitations: ["Results are educational model outputs. CPU work and acknowledgement delay are authored assumptions, not measured application costs or provider benchmarks. Prefetch limits leased jobs and is separate from jobs actively processing.",
    "Oldest ready age is a live-panel reading, absent from saved report labels. With no ready messages it is Unknown, not zero. Worker phases are engine diagnostics rather than displayed saved measurements. Terminal counts do not prove when backlog grew or exact drain time.",
    "This is a slow consumer throughout the observation window. Scripted background-worker crashes are unavailable in this challenge path; no outage, restart, recovery time or continuous health is proved. The existing prediction checks overall health, not your written diagnosis.",
    "Producer p95 covers producer completions in second 12, not background-job latency or a whole-run SLO. More credit establishes neither delivery ordering nor exactly-once effects, physical durability or production availability."],
  followUp: "Cite both saved reports and the wrong-fix report. Explain why more in-flight work can accompany a smaller backlog. Identify which age observation was live-only and which outage or dependency-wait claims remain Unknown.", check: null,
};

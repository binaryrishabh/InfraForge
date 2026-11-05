import type { LearningLesson } from "@infraforge/contracts/learning";

export const retryingAFullPool: LearningLesson = {
  id: "retrying-a-full-pool", contentVersion: 1, trackId: "scaling", moduleId: "serving-under-load",
  title: "Count useful work before adding retries", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Compare backend admission attempts with offered caller requests while a VM pool remains saturated.",
  prerequisites: ["retries-add-work", "load-balancer-policies"],
  problem: ["A quota-limited VM has four worker slots and two queue places. The load balancer can try each caller request five times while fresh traffic keeps arriving."],
  explanation: ["Run the starter. In lb accounting, add Accepted by backend and Rejected by VM. These count backend admission attempts. Queued at VM overlaps accepted admissions, so do not add it again.",
    "The requirement divides those cumulative attempts by whole-run offered callers: completed + failed + deadline-exceeded + abandoned + in-flight. Last-second offered requests/second is a different population.",
    "Select lb. Under Retry policy, change Maximum attempts from 5 to 2. Keep backoff, jitter, concurrency, quota and worker settings unchanged, then compare both reports.",
    "Inspect useful completions and health even when the budget passes. Try four attempts as a near miss. Reducing repeated admissions does not add service capacity."],
  experiment: {challengeId: "retrying-a-full-pool", prediction: "Will the pool's overall health still be Critical at second 6 after the retry load budget is met?",
    evidenceToInspect: ["Admitted by backend (attempts); Refused by VM (attempts)", "Queued at VM (attempts)", "Completed requests/s; Failed requests/s; CPU; Health", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: ["Results are educational model outputs. The requirement scores repeated backend admissions, not successful capacity restoration or a latency SLO.",
    "Five attempts is aggressive but bounded. Counters count attempts reaching the VM gate, not all selected network attempts or unique callers.",
    "The counts do not establish billed cost or real-cloud performance. Missing cumulative caller or backend counters leaves the budget Unknown."],
  check: null,
  followUp: "Use the two reports to explain why less repeated work need not increase completions. Propose a separate one-change capacity experiment.",
};

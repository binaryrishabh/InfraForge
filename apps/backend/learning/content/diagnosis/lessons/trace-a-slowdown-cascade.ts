import type { LearningLesson } from "@infraforge/contracts/learning";

export const traceASlowdownCascade: LearningLesson = {
  id: "trace-a-slowdown-cascade", contentVersion: 1, trackId: "diagnosis", moduleId: "capstone-cascades",
  title: "Trace a slowdown cascade", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Follow a short database slowdown through cache fills, balancer timeouts and retries, then cut the chain at its source.",
  prerequisites: ["concurrent-cache-misses"],
  problem: ["A database slowdown ends at second 5 but callers keep failing until the end of the run. Run the starter and trace why."],
  explanation: ["Predict overall health and the database's own health after it recovers. Then read, in order, the cache's hits and misses, the app's database fetches, the load balancer's downstream timeouts and retry counts, and the database's queue.",
    "Decide which link is the cause and which are bystanders. Write down one change for each plausible fix before running any.",
    "Select cache and change only Single-flight. Keep the balancer retries, the sizes and the TTL unchanged. Compare the two saved reports and confirm one change.",
    "Restore the starter and try a bigger database or turning retries off as near misses. Both leave the same requests waiting on the same fills, so the failures remain."],
  experiment: {challengeId: "trace-a-slowdown-cascade", prediction: "Will overall health look Healthy after the database recovers even though callers failed?",
    evidenceToInspect: ["Cache: Hits", "Cache: Misses", "Application helper: Database fetches", "Application helper: Coalesced waiters"]},
  limitations: ["Results are educational model outputs with an authored slowdown, sizes and timeouts, not provider benchmarks.",
    "Only the chain recorded here is traced. Real systems add layers this model does not represent, and a passing run does not show the service would survive a different failure.",
    "A reading missing from the report stays Unknown."],
  followUp: "Write the chain in order, cite the starter and the change to sharing one fill, and explain why a bigger database and disabled retries both leave the failures in place.",
  check: null,
};

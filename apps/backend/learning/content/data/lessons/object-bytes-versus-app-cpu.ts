import type { LearningLesson } from "@infraforge/contracts/learning";

export const objectBytesVersusAppCpu: LearningLesson = {
  id: "object-bytes-versus-app-cpu", contentVersion: 1, trackId: "data", moduleId: "object-capacity",
  title: "Object bytes versus app CPU", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Distinguish owned-byte admission from producer CPU, then compare callers and unfinished background work.",
  prerequisites: ["queue-ownership-and-acknowledgement"],
  problem: ["Uploads fail while the producer has spare CPU. Predict the starter's overall health, run unchanged, and identify which resource refuses work before choosing a fix."],
  explanation: [
    "Compare stored bytes with capacity, then puts reaching the capacity check with committed puts and the object-capacity command reason. Admission checks the next owned-byte total before committing. Refused puts do not add owned bytes. Producer CPU alone cannot diagnose this limit.",
    "Write a one-change hypothesis. Select store, open Object storage, and increase only Stored data capacity (MiB), using the challenge's final hint if needed. Keep producer size and worker settings fixed. Run again and check that the real design review counts exactly one change.",
    "Compare the saved reports through second 30: Whole run: Completed and Whole run: Failed describe upload-and-publish callers. Acknowledged messages describes completed background receipts; Ready messages describes the queue at that sample. A passing caller requirement can coexist with waiting jobs and Degraded overall health.",
    "Restore the starter and enlarge only the producer as a near miss. Compare CPU and the same object counts. Explain why more compute does not enlarge stored-byte capacity. Equal checked puts and committed puts provides positive evidence; an absent sparse refusal count stays Unknown. Missing object observations leave the byte diagnosis Unknown even if caller outcomes are scoreable.",
  ],
  experiment: {challengeId: "object-bytes-versus-app-cpu", prediction: "What overall health will the starter record, and will more producer CPU or more storage bytes address the refusals? The health choice is scored; explain the mechanism in your reasoning.",
    evidenceToInspect: ["CPU; Whole run: Completed; Whole run: Failed; Whole run: In-flight",
      "Object stored bytes (current); Object capacity bytes (current)",
      "Puts reaching capacity check (cumulative); Object committed puts (cumulative)",
      "Object capacity refusals (cumulative); Object command reasons (cumulative)",
      "Acknowledged messages; Ready messages"]},
  limitations: [
    "Results are educational model outputs, not cloud benchmarks. This fixed upload helper has no real object-store API, physical durability or provider pricing. The nominal read ratio is not a synchronous database-read workload.",
    "Extra capacity supplies headroom for the recorded horizon; continuing unique uploads can fill it later. The lab proves no sustained throughput, drained queue, transaction spanning object writes and acknowledgements, exactly-once business effect or availability guarantee.",
    "Current inventory is bounded and excludes object content and earlier generations. Puts reaching capacity check excludes failed conditions and cancellation before application. Missing measurements and absent sparse reason counts stay Unknown. A current CPU sample alone does not prove CPU was always spare.",
  ],
  followUp: "Cite the two reports and the near miss. Name the byte admission mechanism, distinguish successful callers from acknowledged jobs, and explain why a different workload could expose another bound.",
  check: null,
};

import type { LessonDefinition } from "@infraforge/contracts/learning";

export const chooseARetryMitigation: LessonDefinition = {
  id: "choose-a-retry-mitigation", contentVersion: 1, trackId: "failures", moduleId: "incident-evidence",
  title: "Choose a mitigation and name its cost", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Compare retry pressure after a dependency partition, including callers that fewer retries fail to finish.", prerequisites: [],
  problem: ["A database-link outage ends, but queued app work and retries can leave later callers waiting. A mitigation can reduce that tail while giving up some whole-run completions."],
  explanation: ["Run the starter with four maximum attempts. Inspect the recorded partition application and end receipt, then second-6 latency and app/database CPU.",
    "Change only lb Maximum attempts to 2 and run again. Restore the starter, change only Maximum attempts to 5 and run a third comparison. All three use the same authored partition and workload.",
    "Compare completed-request p95 in second 6, cumulative accepted backend admissions, queued-at-VM counts and whole-run caller completions/failures. Explain both the lower-pressure benefit and its completion cost before choosing a mitigation."],
  experiment: {challengeId: "choose-a-retry-mitigation", prediction: "Which resource type remains busiest after transport restores, and what modeled health will the terminal sample record?",
    evidenceToInspect: ["Scenario action: exact target, application time, restoration receipt and completed status",
      "Second-6 completed-request p95, app/database CPU and final modeled health",
      "Cumulative LB accepted backend admissions and queued-at-VM counts; whole-run caller outcomes"]},
  limitations: ["p95 covers only completions in second 6. It is not a whole-run SLO, and failures and unfinished callers are a separate population.",
    "The scenario partitions the app-to-database link, not a VM or load-balancer process. This profile provides no packet-level outage evidence or provider availability guarantee.",
    "A verified intervention end is transport restoration. A later Healthy sample does not establish continuous health, recovery time or MTTR. LB admissions and queued-at-VM counters overlap and must not be added."],
  followUp: "Choose two or five attempts for this incident and cite both the tail-latency result and the whole-run completion tradeoff. State what evidence you would still need for a production decision.",
  check: {question: "Does lower second-6 p95 prove more callers completed across the run?", choices: [{id: "separate", text: "No; inspect whole-run outcomes separately"}, {id: "yes", text: "Yes; lower p95 proves more completions"}],
    correctChoiceId: "separate", explanation: "The two counters describe different populations. Fewer retries can reduce latency while some callers fail sooner."},
};

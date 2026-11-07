import type { LearningLesson } from "@infraforge/contracts/learning";

export const monitoringLossAndFreshness: LearningLesson = {
  id: "monitoring-loss-and-freshness", contentVersion: 1, trackId: "observability", moduleId: "monitoring-ownership",
  title: "Separate monitoring loss from freshness", kind: "conceptual-exercise", level: "intermediate", availability: "available",
  summary: "Distinguish collection, local ownership, acknowledged export and independent backend arrival.",
  prerequisites: [], experiment: null,
  problem: ["A teammate says a fresh collector sample means the backend has a complete history. Another says every unconfirmed discard was lost before reaching the backend. Which ownership boundaries must you separate before accepting either claim?"],
  explanation: [
    "Collection requests can fail before a sample exists. Generated samples count successful collections. A full local buffer drops the new sample before export. Buffered samples and samples in flight still belong to the collector; increasing storage does not itself increase export throughput.",
    "Confirmed exports count samples acknowledged to the collector. Discarded unconfirmed counts samples whose local ownership ended after failed export attempts. An acknowledgement can fail after backend arrival. Local ownership discarded combines pre-export drops and unconfirmed discards; adding it again would count the same losses twice.",
    "Backend received counts accepted sample occurrences, including duplicates. Backend refusals count batches. Collector freshness follows the latest successful collection, even if its sample was dropped. Backend measurement age instead follows the newest measurement that arrived. Arrival time and measurement time answer different questions; freshness alone cannot establish a complete history.",
    "Missing age is Unknown, never a newly measured sample with no age. Keep target identities and snapshot windows together. Before a future experiment, predict separately how Buffered samples, Export batch size, Export attempts and collection/export cadence could affect ownership, arrival and age. Change a supported control while holding the rest fixed."
  ],
  check: {question: "Which interpretation respects the collector and backend ownership boundaries?",
    choices: [{id: "fresh", text: "A fresh collection establishes a complete backend history."},
      {id: "discard", text: "An unconfirmed discard establishes that the backend never received that sample."},
      {id: "separate", text: "Check collector loss, acknowledgements and backend arrivals separately; a missing age stays Unknown."}],
    correctChoiceId: "separate", explanation: "Local freshness can advance before a buffer drop. An unconfirmed discard ends local ownership without proving non-arrival. Backend duplicates count sample occurrences, so arrival totals are not confirmed unique exports."},
  limitations: ["Conceptual only: no scored monitoring experiment or measured learner outcome is supplied.",
    "The model represents agent-owned collected metrics. Target instrumentation CPU, physical telemetry persistence and production monitoring guarantees remain unmodeled.",
    "Collector freshness has a modeled threshold; the backend reports measurement age without an authored health threshold. Neither freshness nor a final health sample proves continuous health or recovery time."],
  followUp: "Explain how a collector can have fresh measurements while its backend history is incomplete. Name the missing observation that would prevent you from deciding whether an unconfirmed export arrived.",
};

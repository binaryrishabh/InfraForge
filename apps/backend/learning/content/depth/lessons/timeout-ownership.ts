import type { LearningLesson } from "@infraforge/contracts/learning";

export const timeoutOwnership: LearningLesson = {
  id: "timeout-ownership", contentVersion: 1, trackId: "depth", moduleId: "failure-controls",
  title: "A timeout ends a wait, not every effect", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Separate a caller deadline, an attempt deadline and confirmed cancellation.",
  prerequisites: ["retries-add-work"], experiment: null,
  problem: ["A caller stops waiting and begins a read retry. Must the earlier attempt have stopped using backend resources?"],
  explanation: ["A timeout bounds a particular owner's wait. Connection acquisition, response waiting, an individual client attempt and the original caller can have different deadlines. Name the owner before comparing durations.",
    "Cancellation is a separate request with a separate result. An earlier attempt can outlive its caller and complete work after a replacement attempt starts. Shorter waits can therefore increase overlapping work when retries are allowed.",
    "Model 2 supports read-only client attempt timeouts when client retries are configured. Its final attempt waits for an outcome or the original caller stop. These semantics do not establish that arbitrary writes are safe to retry."],
  check: {question: "What establishes that timed-out work stopped at the entry boundary?", choices: [
    {id: "clock", text: "The caller's wait timer expired."},
    {id: "receipt", text: "The cancellation receipt confirms cancellation at that boundary."}],
    correctChoiceId: "receipt", explanation: "A timer and a cancellation acknowledgement describe different events. Downstream effects still need their own accounting."},
  limitations: ["Conceptual only: timeout counters survive in traffic.clientRetry, but the audited lesson measurement vocabulary does not expose them. A challenge's workload is fixed, so its client attempt timeout is not a learner canvas edit.",
    "Caller outcomes alone cannot identify wasted work or establish application write correctness."],
  followUp: "Name the measurements needed to distinguish a faster caller failure from less backend work.",
};

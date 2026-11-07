import type { LearningLesson } from "@infraforge/contracts/learning";

export const timeoutOwnershipV2: LearningLesson = {
  id: "timeout-ownership", contentVersion: 2, trackId: "depth", moduleId: "failure-controls",
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
  limitations: ["Conceptual only: no editable client-timeout experiment is provided here. A challenge's workload is fixed, so its client attempt timeout is not a learner canvas edit. Saved reports expose Timed-out attempts, Wasted completions, Timeout cancellations requested, Confirmed at entry and Recovered after timeout as audited labels. Missing counters stay Unknown, including in old reports.",
    "Timed-out attempts and Wasted completions count attempts cumulatively through the snapshot. Recovered after timeout counts original callers; requested cancellations count requests and Confirmed at entry counts cancellation receipts at that boundary. Neither establishes downstream cancellation or application write correctness. Attempts/s remains a final-second rate."],
  followUp: "Name the measurements needed to distinguish a faster caller failure from less backend work.",
};

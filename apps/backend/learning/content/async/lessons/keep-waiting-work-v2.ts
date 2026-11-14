import type { LearningLesson } from "@infraforge/contracts/learning";

export const keepWaitingWorkV2: LearningLesson = {
  id: "keep-waiting-work", contentVersion: 2, trackId: "async", moduleId: "first-queue",
  title: "Let waiting work stay", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Keep a burst's messages long enough for a single worker to process them.",
  prerequisites: ["request-journey"],
  problem: ["A quiet queue can hide lost work. A message may disappear because it expired, even though the app successfully published it."],
  explanation: ["The starter has an app, a queue, a worker and an object store. The queue already has space; its message lifetime is too short for the burst's waiting work.",
    "Predict health, run unchanged, then inspect acknowledged and expired messages. Compare these with producer completions. Does an empty queue mean all work finished?",
    "Select queue. Under Upload queue, change only Message retention (seconds) to 60, then run again. Compare Ready messages and Oldest ready message age (seconds) as well as acknowledgements and expirations. Explain why more waiting work can accompany a better result."],
  experiment: {challengeId: "keep-waiting-work", prediction: "Will an empty queue prove that the worker finished the uploads? Predict final health before running.",
    evidenceToInspect: ["Acknowledged messages; Expired messages; Ready messages; Oldest ready message age (seconds)", "Whole run: Completed; Whole run: Failed", "Overall health"]},
  limitations: ["Results are educational model outputs. Retention applies to waiting and in-flight messages; a completed result write is not necessarily an acknowledgement.",
    "Depth and oldest ready age describe the recorded sample. No ready message means no measured age; it does not mean an age of zero. The sample does not establish when the backlog drained.",
    "This model does not prove physical durability, unique effects, real queue performance or continuous health.",
    "A faster worker using 100 ms of CPU work per job also meets these requirements with the original retention. This lesson keeps worker speed fixed to isolate message lifetime."],
  check: null,
  followUp: "Next open Keep up with the queue (keep-up-with-the-queue), an intermediate lab. Test how worker speed changes the backlog when message lifetime is already sufficient.",
};

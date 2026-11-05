import type { LearningLesson } from "@infraforge/contracts/learning";

export const keepUpWithTheQueue: LearningLesson = {
  id: "keep-up-with-the-queue", contentVersion: 1, trackId: "async", moduleId: "queued-work",
  title: "Follow the work after publishing", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Separate producer success from consumer progress, then reduce the worker's assumed CPU work per job.",
  prerequisites: ["queue-ownership-and-acknowledgement"],
  problem: ["The producer can accept uploads while its worker falls behind. Fast producer responses do not prove that background work has finished."],
  explanation: ["Run the starter. In the saved requirements, inspect originals, acknowledged messages, ready messages and in-flight work through second 12. Compare these with producer completions.",
    "Select worker. Under Background worker, change only CPU milliseconds per job from 250 to 50. This models reducing the work each job requires. Run again with the same workload.",
    "Compare outstanding messages and acknowledgements in both reports. As a near miss, restore the starter and increase only queue capacity to 5000 messages; waiting room does not execute jobs."],
  experiment: {challengeId: "keep-up-with-the-queue", prediction: "Can producer requests finish successfully while the worker's outstanding queue work grows?",
    evidenceToInspect: ["Queue: originals; Queue: deliveries; Queue: completed object effects; Queue: acknowledged", "Queue: ready; Queue: in flight; Queue: scheduled", "Completed requests/s; Whole run: Completed; Whole run: Failed; CPU"]},
  limitations: ["Results are educational model outputs. This is steady traffic. Comparing outstanding work at a fixed second does not measure burst absorption or backlog drain time.",
    "CPU milliseconds per job is an authored educational assumption. Changing it represents optimized work; the simulator does not optimize application code or benchmark a provider.",
    "The producer confirms logical queue acceptance after an object upload. Physical persistence, worker scaling, distributed transactions and provider availability are not modeled."],
  followUp: "Cite both saved reports to explain why successful publishing can coexist with an increasing backlog, and which single change improves consumer progress.",
  check: {question: "What does a larger queue change while CPU work per job stays fixed?",
    choices: [{id: "room", text: "The amount of waiting work it can own"}, {id: "work", text: "The CPU work needed to finish each job"}],
    correctChoiceId: "room", explanation: "Queue capacity admits more waiting messages. The worker must still execute each job's unchanged work."},
};

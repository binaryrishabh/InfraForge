import type { LearningLesson } from "@infraforge/contracts/learning";

export const analyticsBurstBuffer: LearningLesson = {
  id: "analytics-burst-buffer", contentVersion: 1, trackId: "missions", moduleId: "background-services",
  title: "Size the waiting room for an event burst", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Compare queue waiting room with worker drain rate when a finite burst arrives and a full queue refuses events.",
  prerequisites: ["keep-up-with-the-queue", "queue-ownership-and-acknowledgement", "leave-time-to-acknowledge"],
  problem: ["An analytics event is modeled as an object write and a queue publish. Five events/second arrive, twenty events/second during the burst, then five again. One worker with 80 ms of CPU per job writes a result object for each event. The queue holds at most 50 waiting messages and refuses publishes when it is full.",
    "By second 170: acknowledge all 1150 offered events, leave at most 10 outstanding and record at most 10 redeliveries. A refused publish is a failed producer request, so that event never enters the pipeline."],
  explanation: ["Predict the overall health, then run the starter. Compare originals, acknowledged messages and the whole-run Failed count. Everything the queue accepted may be processed while overall health is Healthy and events are still lost at the producer.",
    "Select the queue and increase only its message capacity until the burst fits. Run again and compare originals, acknowledged and Failed. Watch ready and in-flight work during the burst in the live view; the saved report shows only cumulative counts at the end.",
    "As a near miss, restore the starter and raise capacity only a little, then count the events still lost. Next, keep ample capacity and slow only the worker's CPU work: room without enough drain rate leaves outstanding work instead of lost events.",
    "A faster worker is another supported answer because it removes the excess instead of storing it. Explain when you would prefer each, and list what this mission leaves unverified."],
  experiment: {challengeId: "analytics-burst-buffer", prediction: "Can overall health be Healthy while the producer is refusing some events?",
    evidenceToInspect: ["Queue: originals; Queue: acknowledged; Queue: ready; Queue: in flight; Queue: redeliveries", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Overall health; CPU; Health"]},
  limitations: ["Results are educational model outputs. Rates, queue capacity and worker CPU work are assumed inputs, not measurements of a real analytics pipeline.",
    "No database write is modeled. A processed event is only a result object, so database throughput, event ordering, unique event IDs and exactly-once counting are not verified by this mission.",
    "The producer does not retry or buffer on its own here, so a refused publish is a lost event. Real producer behavior, physical queue durability and dynamic worker scaling are not modeled.",
    "The saved terminal report shows cumulative counts at second 170. It does not show how long the backlog lasted or whether health stayed Healthy throughout."],
  followUp: "Cite the starter and passing reports to explain which events were lost and why. Name two analytics guarantees this mission leaves unverified.",
  check: {question: "A producer request fails because the queue is full. Will that event be processed later?", choices: [{id: "no", text: "No; it was never accepted into the queue"}, {id: "yes", text: "Yes; the worker will find it eventually"}],
    correctChoiceId: "no", explanation: "A refused publish means the queue never owned the event, so no worker can process it."},
};

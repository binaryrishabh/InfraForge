import type { LearningLesson } from "@infraforge/contracts/learning";

export const notificationRetryStormV2: LearningLesson = {
  id: "notification-retry-storm", contentVersion: 2, trackId: "missions", moduleId: "background-services",
  title: "Keep bad requests from starving good ones", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Find how a queue's delivery limit decides how much worker time failed notification requests can take.",
  prerequisites: ["keep-up-with-the-queue", "leave-time-to-acknowledge", "queue-ownership-and-acknowledgement"],
  problem: ["A notification request is modeled as an object upload and a queue publish. Eight requests/second arrive for the whole run. A worker reads each one, spends CPU on it and writes a result object that stands for a sent notification. One request in five cannot be sent, so the worker fails it and the queue delivers it again.",
    "By second 60: acknowledge at least 350 messages, leave at most 10 outstanding, record at most 250 redeliveries and report Healthy overall health. Educational assumptions: one worker core, eight concurrent jobs, 80 ms of CPU per job and a queue delivery limit of 10."],
  explanation: ["Predict the outcome, then run the starter. Compare acknowledged messages with deliveries and redeliveries, then look at ready and in-flight work. Producer completion only confirms that a request was accepted.",
    "Select the queue and lower only its delivery limit. Run again and compare acknowledged, redelivered and dead-lettered messages with the starter. Restore the starter and, as a near miss, change only the worker to a larger size, then compare its redelivery count with the stated limit.",
    "Find where a delivery limit stops being low enough. In the calibrated runs a limit of one or two meets every requirement; three already leaves the worker saturated, so Healthy health fails, and four or more also miss a queue requirement. A failed delivery costs the worker the same read and CPU time as a good one, so every extra delivery of a bad request is time a good request waits.",
    "A dead-lettered request is kept apart for inspection and is not delivered again. Before calling this a notification service, list what stays unverified."],
  experiment: {challengeId: "notification-retry-storm", prediction: "Can every producer request be accepted while repeated deliveries of bad requests keep good notifications waiting?",
    evidenceToInspect: ["Queue: originals; Queue: deliveries; Queue: acknowledged; Queue: redeliveries; Queue: dead-lettered", "Queue: ready; Queue: in flight; Queue: scheduled", "Overall health; CPU; Health"]},
  limitations: ["Results are educational model outputs. The bad-request share is an assumed input and the engine picks which requests are bad from the run's seed; it is not a measured failure rate.",
    "A sent notification is only a result object write. Provider delivery, recipient rules, ordering, duplicate sends of good messages, rate limits, user consent, payments and distributed transactions are not verified by this mission.",
    "Dead-lettering keeps a failed request logically. This model has no replay, alerting or repair of dead letters, and physical durability is Unknown.",
    "The redelivery limit is an authored waste budget, not a provider rule. The saved terminal report shows cumulative counts at second 60, not the time the backlog cleared or continuous health."],
  followUp: "Use the starter report and your passing report to explain how the delivery limit changed deliveries and dead letters. Name two notification guarantees this mission leaves unverified.",
  check: {question: "What does each extra delivery of a bad request cost?", choices: [{id: "worker", text: "Worker read and CPU time that a good request could have used"}, {id: "nothing", text: "Nothing, because a failed delivery does no work"}],
    correctChoiceId: "worker", explanation: "The worker reads the request and spends CPU before it fails, so every repeat takes capacity from other messages."},
};

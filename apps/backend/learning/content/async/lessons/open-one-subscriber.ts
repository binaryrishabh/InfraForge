import type { LearningLesson } from "@infraforge/contracts/learning";

export const openOneSubscriber: LearningLesson = {
  id: "open-one-subscriber", contentVersion: 1, trackId: "async", moduleId: "queued-work",
  title: "Inspect each fan-out branch", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Repair one queue's listener admission and check that the other subscriber keeps its own delivery progress.",
  prerequisites: ["keep-up-with-the-queue"],
  problem: ["An Event Bus dispatches the same uploads to two queues. The first queue allows no listener ports; its subscriber retries while the second continues."],
  explanation: ["Run the starter. Open bus measurements in the saved report and inspect each subscription's delivered, retry, failed-attempt and exhausted-dispatch counts. Compare each queue's acknowledgements in the requirements.",
    "Select queue. Under TCP listeners, enter 5672 in TCP listener ports and apply the ports. Change only this listener admission; run again.",
    "Check the previously failing branch and compare queue2 across both runs. As a near miss, restore the empty listener and raise only bus maximum attempts from three to five; retrying cannot open a listener."],
  experiment: {challengeId: "open-one-subscriber", prediction: "Will a refused transport on queue stop queue2 from acknowledging its events?",
    evidenceToInspect: ["Bus accepted events and per-subscription delivered, retried, failed-attempt and exhausted counts through second 12",
      "Each queue's originals, completed object effects and acknowledgements in the saved requirements", "Bus dispatch dead letters versus queue consumer dead letters"]},
  limitations: ["The modeled bus dispatches independently and without ordering guarantees. Its logical fan-out does not establish physical durability or provider isolation guarantees.",
    "A bus dispatch dead letter and a queue consumer dead letter belong to different stages. A successful producer request proves neither subscriber completion nor application-level exactly-once effects.",
    "This lab changes one listener's admitted port. It does not test Kafka partitions, stock guarantees, distributed transactions or provider throughput."],
  followUp: "Cite both reports to show the repaired branch changed while the other subscriber's delivery and acknowledgement counts stayed the same.",
  check: {question: "What can raising the retry limit do for a port with no listener?",
    choices: [{id: "repeat", text: "Spend more dispatch attempts on the same refusal"}, {id: "open", text: "Open the subscriber's listener"}],
    correctChoiceId: "repeat", explanation: "Retries repeat transport attempts. Listener admission must change before that port can receive a dispatch."},
};

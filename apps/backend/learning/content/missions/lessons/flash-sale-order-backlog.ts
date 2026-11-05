import type { LearningLesson } from "@infraforge/contracts/learning";

export const flashSaleOrderBacklog: LearningLesson = {
  id: "flash-sale-order-backlog", contentVersion: 1, trackId: "missions", moduleId: "first-applications",
  title: "Absorb a shop's order-event burst", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Combine worker capacity and acknowledgement leases while producer traffic continues after a flash sale.",
  prerequisites: ["keep-up-with-the-queue", "leave-time-to-acknowledge"],
  problem: ["An order event is modeled as an object upload and queue publish. Traffic is four requests/second, sixteen during 120-140, then four again. A worker writes result objects. This supported journey has a direct producer app entry point.",
    "By second 170: acknowledge at least 900 messages, leave at most ten outstanding, record no redeliveries, Healthy overall modeled health and producer completed-request p95 at most 10 ms in that second. Educational capacity assumptions: one worker core, 32 concurrent jobs and prefetch credits, 250 CPU ms/job, a 1500 ms acknowledgement delay, one-second visibility and 300-second retention. Keep all except worker CPU work and queue visibility fixed."],
  explanation: ["Predict the outcome and run the starter. Watch the producer and queue separately. Producer completion confirms modeled upload and logical queue acceptance; it does not confirm background processing or a successful order.",
    "Apply the consumer-capacity lesson: change only worker CPU work to 100 ms/job. Run again, inspecting redeliveries and acknowledgements. Restore the starter; change only queue visibility to five seconds using the acknowledgement lesson. Run and inspect the remaining outstanding work.",
    "Combine both changes. Observe ready and in-flight work near second 140, then inspect the final report at 170. Arrivals continue, so a small in-flight population can remain after excess burst work has drained. Compare all four reports and explain why neither partial fix passes.",
    "Before calling this a shop design, list the application guarantees that remain conceptual. Treat object writes as modeled result effects rather than proof of payment, stock reservation or order correctness."],
  experiment: {challengeId: "flash-sale-order-backlog", prediction: "Can producer responses stay fast while a short acknowledgement lease and insufficient worker capacity prevent progress?",
    evidenceToInspect: ["Cumulative originals, acknowledgements, ready/in-flight/scheduled messages and redeliveries through second 170",
      "Producer completed-request p95 in second 170 and whole-run failed, completed and in-flight callers", "Final app and worker CPU and modeled health; distinguish effects from acknowledgements"]},
  limitations: ["Payments, stock guarantees, distributed transactions and order correctness are conceptual only. This mission does not verify them.",
    "Logical queue acceptance is not physical durability. The worker provides no exactly-once effect guarantee, and repeated deliveries may repeat result writes. Worker CPU work is an assumed optimization, not measured application code.",
    "Live observation can show the burst backlog shrinking. The saved terminal report alone does not measure exact drain time or establish continuous producer health. Its p95 is for completions in second 170, not the whole flash sale.",
    "This upload journey does not support load-balancer health polling before the producer. Frontend routing, dynamic worker scaling, database transactions, real provider performance and production availability are untested."],
  followUp: "Use both partial designs to explain why capacity and lease duration are independently necessary. Cite the final outstanding population and name two shop guarantees still unverified.",
  check: {question: "Does an accepted order-event publish prove stock was reserved?", choices: [{id: "no", text: "No; stock reservation is outside this model"}, {id: "yes", text: "Yes; queue acceptance reserves stock"}],
    correctChoiceId: "no", explanation: "Queue acceptance proves modeled broker ownership of the event. The mission implements no stock or payment transaction."},
};

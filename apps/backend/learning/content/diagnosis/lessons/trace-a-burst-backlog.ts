import type { LearningLesson } from "@infraforge/contracts/learning";

export const traceABurstBacklog: LearningLesson = {
  id: "trace-a-burst-backlog", contentVersion: 1, trackId: "diagnosis", moduleId: "capstone-cascades",
  title: "Trace a burst backlog", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Follow a short burst through a full queue and refused publishes, and see why a faster worker does not recover the lost events.",
  prerequisites: ["queue-ownership-and-acknowledgement"],
  problem: ["After a short burst the worker has caught up, yet many uploads failed and their events were never processed. Run the starter and trace why."],
  explanation: ["Predict overall health. Then trace the chain with these steps, in order, writing one sentence for each before running anything else.",
    "First, size the loss: read Whole run: Failed and Whole run: Completed. Failed uploads are the symptom, not yet a cause. Next, look at the consumer: read CPU on the worker. If it is not saturated outside the burst, the worker is not the lasting problem. Then, look at the queue: compare Queue: originals with Queue: acknowledged and Queue: ready. Events that were never created cannot appear in originals. Last, name the first full resource: the queue reached its message limit during the burst, so every later publish was refused and failed its upload.",
    "Select queue and change only Queue capacity (messages). Keep the worker and the workload unchanged. Compare the two saved reports and confirm one change.",
    "Restore the starter and try a bigger worker and more parallel jobs as near misses. Draining faster helps a little but the burst still outruns it while the queue is full; parallel jobs change nothing because the worker's CPU is the limit."],
  experiment: {challengeId: "trace-a-burst-backlog", prediction: "Will overall health look Healthy at the end even though uploads failed?",
    evidenceToInspect: ["Whole run: Failed", "Whole run: Completed", "CPU", "Queue: originals", "Queue: acknowledged", "Queue: ready"]},
  limitations: ["Results are educational model outputs with an authored burst, queue limit and CPU work, not provider benchmarks.",
    "The producer does not retry or buffer on its own here, so a refused publish is a lost upload. Real producers, durable queues and autoscaling workers are not modeled.",
    "A reading missing from the report stays Unknown."],
  followUp: "Write the chain in four steps with the evidence label for each step, cite the starter and the capacity change, and explain why neither a faster worker nor more parallel jobs recovers the lost events.",
  check: null,
};

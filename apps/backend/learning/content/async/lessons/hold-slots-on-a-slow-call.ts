import type { LearningLesson } from "@infraforge/contracts/learning";

export const holdSlotsOnASlowCall: LearningLesson = {
  id: "hold-slots-on-a-slow-call", contentVersion: 1, trackId: "async", moduleId: "held-capacity",
  title: "Hold slots on a slow call", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Separate idle CPU from idle slots: a worker that waits on an outside service is limited by parallel jobs, not cores.",
  prerequisites: ["queue-ownership-and-acknowledgement", "keep-up-with-the-queue"],
  problem: ["Each job spends 50 CPU milliseconds and then waits 450 milliseconds on an assumed external service. The worker runs one job at a time, so its CPU looks idle while uploads pile up in the queue."],
  explanation: [
    "Predict health, run unchanged and compare CPU with Acknowledged messages and the outstanding total in the requirement. A waiting job spends no CPU but still holds its parallel slot and its lease, so low CPU does not mean spare capacity.",
    "Estimate the cycle: one slot is busy for the CPU time plus the wait of every job, so it finishes far fewer jobs a second than the eight arriving. Work out how many slots eight arrivals need: more than the worker has cores, because waiting uses a slot but no core. Record that diagnosis, then change only Jobs in parallel from 1 to the larger value in the challenge hint (prefetch credit already covers it). Optionally try a smaller increase, such as one job per core: it helps but still leaves a backlog. Run again and compare acknowledgements, outstanding work and CPU.",
    "As a near miss, restore the starter and choose the larger worker size. More cores cannot create slots, so acknowledgements and the backlog barely move while CPU falls further. Check the one-change review for both comparisons.",
    "The wait is an authored assumption in the saved worker settings. Read it as a number you chose, not a measured provider."],
  experiment: {challengeId: "hold-slots-on-a-slow-call", prediction: "Does low worker CPU show the worker keeps up with the arriving uploads? Predict overall health at second 40; only the health choice is scored.",
    evidenceToInspect: ["Acknowledged messages; Queue: ready; Queue: in flight; Queue: scheduled; Queue: acknowledged", "CPU; Whole run: Completed; Whole run: Failed"]},
  limitations: [
    "Results are educational model outputs, not cloud benchmarks. The external wait and CPU per job are authored assumptions; the model has no connection pools, timeouts or retries on that call.",
    "Parallel jobs run inside one VM; worker count and autoscaling are unavailable here. A fixed-second sample proves no continuous behaviour, ordering, durability or exactly-once effects.",
    "A larger worker size adds cores only; it does not change how many jobs may wait at once in this model."],
  check: null,
  followUp: "Cite the starter, improved and larger worker near miss reports. Explain why CPU stayed low while the queue grew, and what a real service would also need (timeouts, limits on the outside call). Compare parallel-jobs-for-a-burst, where the limit is spare CPU cores rather than time spent waiting.",
};

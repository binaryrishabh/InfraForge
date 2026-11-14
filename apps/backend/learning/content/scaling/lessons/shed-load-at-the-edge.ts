import type { LearningLesson } from "@infraforge/contracts/learning";

export const shedLoadAtTheEdge: LearningLesson = {
  id: "shed-load-at-the-edge", contentVersion: 1, trackId: "scaling", moduleId: "edge-admission",
  title: "Shed load at the edge", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Choose who waits when demand exceeds capacity: refuse the excess at the balancer or let it queue inside the app.",
  prerequisites: ["response-time-and-throughput", "one-vm-or-a-pool"],
  problem: ["Demand is far above what the one small app can finish. The balancer forwards nearly everything, so the app is saturated and callers wait in its queue, finish late or fail."],
  explanation: [
    "Predict overall health, run unchanged and read three things together: app CPU, whole-run completed and failed callers, and the final-second p95 in the requirements. A busy app with a long tail and many failures is overloaded, not slow by accident.",
    "Record a diagnosis: the extra demand waits inside the app because the balancer admits it. Select lb, open Load balancer admission and change only Active requests from 1024 to 16. Keep Queued requests, app size and workload fixed. The design review must count one change.",
    "Run again. The app still finishes about the same number of requests, but the excess is refused at the balancer and the admitted requests finish quickly, so the final-second p95 drops. More callers are refused; that is the cost, and the requirement allows it explicitly.",
    "As a near miss, restore the starter and choose a larger app. More capacity completes more callers, yet at this demand the queue still forms and the tail stays above the requirement. Compare both pairs in the saved reports."],
  experiment: {challengeId: "shed-load-at-the-edge", prediction: "What overall health will the starter record at second 10? Only the health choice is scored; explain whether serving some callers slowly makes a design healthy.",
    evidenceToInspect: ["CPU; Whole run: Completed; Whole run: Failed; Whole run: In-flight", "p95"]},
  limitations: [
    "Results are educational model outputs, not cloud benchmarks. Admission limits are authored inputs, not provider defaults.",
    "Refusing excess demand chooses who waits; it adds no capacity and no availability guarantee. Clients that retry or back off are not modeled here.",
    "The final-second p95 excludes refused and unfinished callers, and a fixed-second sample proves no continuous behaviour. At the tested admission limits in this fixed workload, final-second p95 is about 3 ms times the Active requests limit; this is a measured model result, not a general sizing rule."],
  check: null,
  followUp: "Cite the starter, improved and larger app near miss reports. Explain what the refused callers cost, and when a larger app would be the better answer. Then compare open-the-forwarding-gate, where the same Active requests setting is too low and spare backend capacity sits idle.",
};

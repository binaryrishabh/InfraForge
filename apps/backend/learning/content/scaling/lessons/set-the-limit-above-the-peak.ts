import type { LearningLesson } from "@infraforge/contracts/learning";

export const setTheLimitAboveThePeak: LearningLesson = {
  id: "set-the-limit-above-the-peak", contentVersion: 1, trackId: "scaling", moduleId: "edge-admission",
  title: "Set the limit above the peak", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "A rate limit is a policy, not capacity: sized below a legitimate peak it refuses callers while the app sits idle.",
  prerequisites: ["response-time-and-throughput", "shed-load-at-the-edge"],
  problem: ["The balancer refills its rate limit more slowly than a legitimate spike arrives, so part of the spike is refused while the one large app has plenty of CPU left."],
  explanation: [
    "Predict overall health, run unchanged and compare app CPU with the whole-run completed and failed callers in the requirement. Low CPU with thousands of failures points at an admission policy, not at the app.",
    "Record a diagnosis: after the burst allowance is spent, the limiter admits only its sustained rate, so the spike above it is refused. Select lb, open Rate limit and change only Sustained requests per second to a value above the spike rate in the workload. Keep Burst requests, the app and the workload fixed. The design review must count one change.",
    "Run again. Every caller is served and the app CPU rises with the real load.",
    "As a near miss, restore the starter rate and raise only Burst requests. The extra tokens last only a few seconds of the spike, then refusals return. Compare both pairs in the saved reports."],
  experiment: {challengeId: "set-the-limit-above-the-peak", prediction: "What overall health will the starter record at second 140? Only the health choice is scored; explain whether an idle app means callers were served.",
    evidenceToInspect: ["CPU; Overall health", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: [
    "Results are educational model outputs, not cloud benchmarks. The limit values and the scripted peak are authored inputs.",
    "This measures one legitimate peak. It does not model abusive clients, per client fairness or an availability guarantee, and a limit set too high protects nothing.",
    "Whole-run counts through one second prove no continuous behaviour."],
  check: null,
  followUp: "Cite the starter, the improved run and the burst only near miss. Explain why a bigger app cannot admit what the balancer refuses. Then compare shed-load-at-the-edge, where refusing the excess was the goal.",
};

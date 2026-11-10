import type { LearningLesson } from "@infraforge/contracts/learning";
export const keepAFunctionWarm: LearningLesson = {
  id: "keep-a-function-warm", contentVersion: 1, trackId: "depth", moduleId: "function-retention",
  title: "Keep a function warm", summary: "Separate idle-instance retention from concurrency under sparse calls.",
  kind: "executable-lab", level: "intermediate", availability: "available", prerequisites: ["response-time-and-throughput"],
  problem: ["Every sparse function call succeeds, yet the function repeatedly pays cold initialization. More concurrent invocations might sound useful, but no calls overlap."],
  explanation: ["Predict final overall health, run the starter unchanged and keep its report. Inspect Completed invocations, Cold starts, Warm starts, Idle instances expired, Initialization time (us), throttles and peak instances. Record what Healthy leaves unexplained. Function CPU is Unknown.",
    "Start an improvement from the saved starter with a hypothesis. Select fn and change only Warm instance idle expiry (ms) from 100 to the longer value in the challenge hint. Keep concurrency, initialization, body duration, timeout, database and workload unchanged. Review exactly one change, run, then compare the saved requirements and function evidence.",
    "A successful idle instance can serve the next call if its expiry has not fired. The longer expiry can avoid repeated initialization in this fixed sparse workload; the first call still initializes. Compare the recorded cold and warm starts, expiries and cumulative initialization time before attributing the effect.",
    "For a separate near miss, restore the starter and raise only Concurrent invocations from 1 to the larger limit in the challenge hint. Review one change and compare again. A higher ceiling does not prevent idle expiry. Both runs can complete all calls and stay Healthy. The final-second latency sample and the small whole-run population do not establish a whole-run tail target. Missing evidence stays Unknown."],
  experiment: {challengeId: "keep-a-function-warm", prediction: "Predict overall health when every call completes despite repeated cold initialization.",
    evidenceToInspect: ["Function: Completed invocations; Throttled invocations; Timed out", "Cold starts; Warm starts; Idle instances expired", "Peak instances", "Initialization time (us); Total settled duration (us)", "Whole run: Completed; Whole run: Failed"]},
  limitations: ["Results are educational model outputs. This deterministic InfraForge model uses authored elapsed initialization and body times with one invocation per instance. These are teaching assumptions, not physical or provider performance benchmarks.",
    "Warm instance idle expiry is a saved educational control, not a claim that a cloud provider exposes exact retention. Eviction, prewarming, instance CPU/memory and warm-instance cost are Unknown or unmodeled.",
    "The lightly loaded database uses the existing shared source pool. This experiment does not model per-instance pools, arbitrary function fleets or deployment replacement.",
    "Counters cover eight simulated seconds. One terminal latency or health sample proves neither a whole-run tail target nor continuous availability. The first invocation remains cold; retention cannot promise future reuse."],
  followUp: "Use the saved cold starts, expiries and initialization time to explain why the retention change helped and the concurrency change did not. Name a condition that could prevent reuse even with a longer expiry.",
  check: null,
};

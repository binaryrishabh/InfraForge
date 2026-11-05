import type { LearningLesson } from "@infraforge/contracts/learning";

export const boundFunctionPoolPressure: LearningLesson = {
  id: "bound-function-pool-pressure", contentVersion: 1, trackId: "depth", moduleId: "resource-pressure",
  title: "Bound function pool pressure", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Balance useful completions, cold starts, throttling and contention on a shared database connection pool.",
  prerequisites: ["connection-pool-budgets", "budget-app-database-sessions"],
  problem: ["A function receives 3000 reads/s with a 128-invocation ceiling. Each cold instance takes 100 ms to initialize; each body takes 100 ms before querying db. All its instances share one lazy shared pool against a generic one-core database.",
    "Complete at least 800 invocations through second 3, with at most 8500 throttles and no downstream failures. Completed-request p95 in second 3 must be at most 110 ms. Durations and capacities are educational inputs."],
  explanation: ["Predict database health and run unchanged. Inspect cold and warm starts, initialization time, active invocations, database CPU and sessions. Compare the successful callers' connection-wait contribution with their latency tail.",
    "Change only function concurrency from 128 to 32. Keep the workload, initialization, duration and database fixed. Compare the shorter completion tail and lower database CPU with the higher throttle count and lower total completions.",
    "Try concurrency one as a near miss. Its successful calls can be fast while it fails the completion and refusal budgets. Explain why a latency result that omits refused callers would tell an incomplete story."],
  experiment: {challengeId: "bound-function-pool-pressure", prediction: "Will less function concurrency relieve the shared database path while refusing more offered work?",
    evidenceToInspect: ["Cold starts; Warm starts; Throttled invocations; Peak instances", "p95; Completed requests/s; Database wait time (us)", "CPU; Connections; Refused session opens; Whole run: Completed; Whole run: Failed"]},
  limitations: ["The pool is shared per source path, not owned per function instance. Both variants stay below the database's 100-session ceiling and have no session refusals. This is contention, not a session-exhaustion lab.",
    "A session-capacity challenge scenario is refused for this function serving path. The lab makes no connected session-capacity intervention claim and does not change engine validation.",
    "Initialization and body times are elapsed assumptions, not CPU or memory measurements. Provider cold-start timing, billing and per-instance connection behavior are Unknown.",
    "The successful-call p95 is for second 3 only. The passing design still refuses most traffic, with fewer completions than the starter. It proves neither a whole-run SLO nor availability. These counts are educational model outputs."],
  followUp: "Cite latency, connection wait, completed and throttled populations from both runs. Explain why this passing result is an admission tradeoff, then name what would be needed to test actual session exhaustion.", check: null,
};

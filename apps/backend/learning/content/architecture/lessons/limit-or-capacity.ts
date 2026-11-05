import type { LearningLesson } from "@infraforge/contracts/learning";

export const limitOrCapacity: LearningLesson = {
  id: "limit-or-capacity", contentVersion: 1, trackId: "architecture", moduleId: "cross-resource-choices",
  title: "Limit or capacity", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Choose gateway admission control or backend worker capacity and defend the different caller outcomes.",
  prerequisites: ["response-time-and-throughput", "waiting-with-spare-cpu", "protect-one-api-route"],
  problem: ["The gateway offers 1000 reads and 1000 writes/second. Through second 2, complete at least two reads and 250 writes without upstream failures on either route. The read app has spare CPU but one worker and no waiting queue.",
    "The requirement permits refusal. Choose read-route admission control or backend worker capacity; keep the write route, read instance and traffic fixed. Explain the difference between protecting a backend and serving every caller."],
  explanation: ["Run unchanged. Read upstream failures alongside read app CPU. Explain how a worker admission limit can refuse callers while cores remain unused.",
    "Reduce only the read route's burst credits as the challenge hint suggests and compare reports. Then restore the route and add read backend workers. Both changes can meet the protection requirement, while producing very different read completions and CPU use.",
    "Compare route refusals, upstream failures, read CPU and whole-run caller outcomes. Check whether write completions stayed unchanged in these runs. Try an insufficient worker increase as a near miss before defending either valid design."],
  experiment: {challengeId: "limit-or-capacity", prediction: "Will overall health remain unhealthy even if the route protection requirements pass?",
    evidenceToInspect: ["Route throttles (429); Upstream failures (502); Capacity refusals (503); Gateway failures (503)", "CPU; Overall health", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: ["Results are educational model outputs. Synthetic CPU work, route credits and worker settings are educational assumptions rather than production quotas.",
    "Route tokens are independent, but gateway CPU, transport and the global in-flight bound are shared. Equal write completion counts in these runs do not establish general fairness or absence of starvation.",
    "Gateway cost is Unknown in the current estimator. No priced comparison, authentication, production availability or whole-run latency SLO is verified. Passing protection can deliberately reject many callers."],
  followUp: "Defend either passing design with saved caller counts and CPU. State the sacrificed work or extra processing, and one shared bottleneck that independent route credits cannot remove.", check: null,
};

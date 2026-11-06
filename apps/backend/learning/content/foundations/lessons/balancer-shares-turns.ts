import type { LearningLesson } from "@infraforge/contracts/learning";

export const balancerSharesTurns: LearningLesson = {
  id: "balancer-shares-turns", contentVersion: 1, trackId: "foundations", moduleId: "first-runs",
  title: "See how a balancer shares turns", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Run two unequal app servers behind one load balancer and see that round robin shares turns, not capacity.",
  prerequisites: ["request-routing", "virtual-machines"],
  problem: ["A load balancer can only share work among the servers attached to it. What happens when one of those servers is much smaller than the other?"],
  explanation: ["The starter has two app servers behind one load balancer: app-a is a small generic server and app-b is a c5.large. At 800 requests/second, round robin gives each server every other request.",
    "Predict the overall health, then run. Compare CPU on app-a and app-b, then read p95 and Overall health.",
    "First choose a larger Instance size for app-b and run again. Then restore it, select app-a, choose c5.large under Instance size and run again. Compare which change moved the busy server."],
  experiment: {challengeId: "balancer-shares-turns", prediction: "What overall health will the starter record at second 12?",
    evidenceToInspect: ["CPU; Health", "Overall health", "Completed requests/s; Failed requests/s", "p95"]},
  limitations: ["Results are educational model outputs. Instance selection changes assumed cores and default worker slots together; this comparison does not isolate their effects.",
    "Only round robin is used in this lab. Other routing policies distribute work differently and are not compared here. No server fails, so nothing is established about failover.",
    "p95 covers completions in the last second. It excludes unfinished and failed requests and does not prove a whole-run response-time objective."],
  check: null,
  followUp: "Explain, using CPU on both servers, why the load balancer cannot help a server that is too small for its share.",
};

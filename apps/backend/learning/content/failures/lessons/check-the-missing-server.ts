import type { LearningLesson } from "@infraforge/contracts/learning";

export const checkTheMissingServer: LearningLesson = {
  id: "check-the-missing-server", contentVersion: 1, trackId: "failures", moduleId: "first-failure",
  title: "Notice a missing server", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Help requests reach the spare server by checking the crashed server sooner.",
  prerequisites: ["request-journey"],
  problem: ["A spare server can handle the traffic, but requests still fail when the load balancer keeps sending them to its crashed neighbor."],
  explanation: ["Both app servers already have spare CPU. The scripted crash removes app temporarily; the load balancer keeps giving it turns until a health check marks it unhealthy.",
    "Predict health at second 12, then run unchanged. Compare whole-run Completed and Failed with final health. Requests that failed during the outage do not become successful when app returns.",
    "Select lb. In Health checks, change only Check interval (seconds) to 1. Leave the timeout and failure threshold unchanged. Run again and compare caller counts. Explain why the unchanged spare server can now receive more work."],
  experiment: {challengeId: "check-the-missing-server", prediction: "Will final Healthy health prove that callers succeeded during the outage?",
    evidenceToInspect: ["Whole run: Completed; Whole run: Failed; Deadline exceeded; Abandoned", "Overall health", "CPU", "Resolved targets:; Applies at; baseline restore at"]},
  limitations: ["Results are educational model outputs. The crash includes an authored restart; it does not model host repair or a real provider's failure detection time.",
    "Some requests can fail before detection. Cumulative caller counts and final health do not prove zero-loss failover, continuous health or production availability.",
    "The database and load balancer do not fail in this run; the experiment tests only the specified app crash."],
  check: null,
  followUp: "Next open Choose a retry mitigation (choose-a-retry-mitigation), an advanced lab. Compare how retrying work changes caller outcomes and downstream pressure after a partition.",
};

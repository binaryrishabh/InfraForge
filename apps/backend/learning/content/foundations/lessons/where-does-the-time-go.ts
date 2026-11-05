import type { LearningLesson } from "@infraforge/contracts/learning";

export const whereDoesTheTimeGo: LearningLesson = {
  id: "where-does-the-time-go", contentVersion: 1, trackId: "foundations", moduleId: "first-runs",
  title: "Find the first busy resource", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Run one app and one database, predict the busiest resource, and test one size change.",
  prerequisites: ["first-bottleneck"],
  problem: ["A request needs work from both an app and a database. Buying capacity for the wrong resource can leave requests waiting."],
  explanation: ["The starter offers 350 reads each second. Each read asks for 3 ms of app CPU work and 1 ms of database CPU work in this educational profile.",
    "Predict the resource type with the highest CPU, then run. Compare app CPU with database CPU in the final-state table.",
    "In the app's Instance size section, select c5.large and run again. Compare CPU, completed requests/second and p95. Then try a larger database with the original generic app to test your explanation."],
  experiment: {challengeId: "where-does-the-time-go", prediction: "Which resource type will have the highest CPU at second 12, and why?",
    evidenceToInspect: ["Final-state app and database CPU at second 12", "Offered, completed and failed requests/second at second 12", "Completed-request p95 at second 12"]},
  limitations: ["Instance selection changes assumed cores and default worker slots together; this comparison does not isolate their effects.",
    "p95 covers completions in the last second. It excludes unfinished requests and does not prove a whole-run response-time objective.",
    "CPU costs and health thresholds are educational assumptions, not cloud benchmarks."],
  check: null,
  followUp: "Explain why the database-only change leaves the app waiting. Name the measurements that support your explanation.",
};

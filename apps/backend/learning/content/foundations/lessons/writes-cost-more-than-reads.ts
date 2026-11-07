import type { LearningLesson } from "@infraforge/contracts/learning";

export const writesCostMoreThanReads: LearningLesson = {
  id: "writes-cost-more-than-reads", contentVersion: 1, trackId: "foundations", moduleId: "first-runs",
  title: "Follow a request to the database", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Follow requests from DNS to the database and find which hop runs out first when most of them are writes.",
  prerequisites: ["database-read-and-write", "request-journey"],
  problem: ["Opening a note and saving a note both cross the whole request path, but they do not cost the database the same work. In this lab most requests save notes."],
  explanation: ["The starter sends 600 requests/second through DNS, a load balancer and a large app to a small database. Only 30% of them are reads and the rest are writes. In this educational profile a write asks the database for more CPU time than a read does.",
    "Predict the resource type with the highest CPU, then run. Compare app CPU with database CPU, then read the database Health beside p95.",
    "Select db, then under Instance size choose a catalog size with more vCPUs than the starting option (the challenge hint names one), leaving the app and the workload unchanged, and run again. Then put db back to its starting option, add a second app server connected to the load balancer and to the database, and run again. Compare which change moved the wait."],
  experiment: {challengeId: "writes-cost-more-than-reads", prediction: "Which resource type will have the highest CPU at second 12, and why?",
    evidenceToInspect: ["CPU; Health", "Completed requests/s; Failed requests/s", "p95"]},
  limitations: ["Results are educational model outputs. Read and write CPU costs are assumptions of this profile, not measurements of a real database.",
    "A larger Instance size changes assumed capacity as a bundle (CPU cores, memory, connection limit and price), so this comparison does not isolate one factor. Replication, caching, locking and storage durability are not modeled here.",
    "p95 covers completions in the last second. It excludes unfinished and failed requests and does not prove a whole-run response-time objective."],
  check: null,
  followUp: "Explain why a second app server leaves the database waiting. Use CPU and p95 from both runs.",
};

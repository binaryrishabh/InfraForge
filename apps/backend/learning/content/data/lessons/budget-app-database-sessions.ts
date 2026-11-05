import type { LearningLesson } from "@infraforge/contracts/learning";

export const budgetAppDatabaseSessions: LearningLesson = {
  id: "budget-app-database-sessions", contentVersion: 1, trackId: "data", moduleId: "database-pressure",
  title: "Count pools before adding app instances", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Compare actual session occupancy after a slowdown with the number of independently owned app pools.",
  prerequisites: [],
  problem: ["Twelve app pools can collectively ask for more than the database's 85 sessions. A short CPU slowdown gives lazy pools time to open connections, which can remain idle afterward."],
  explanation: ["Run the starter through the scripted slowdown. At second 6, inspect database Connections, Refused session opens and health alongside whole-run caller failures.",
    "Select lb. Under Autoscaling pool, change Minimum from 12 to 4, leaving Maximum at 12. Keep the database and workload unchanged and run again.",
    "Compare actual sessions with the possible pool budget: 12 times 10 versus 4 times 10. Try increasing only app Instance size to m5.2xlarge as a near miss. Examine whole-run latency bounds too; fewer refusals need not mean a shorter latency tail."],
  experiment: {challengeId: "budget-app-database-sessions", prediction: "Can a Healthy database with low second-6 p95 still have no spare session slots?",
    evidenceToInspect: ["Database Connections against the installed tier's 85-session limit at second 6", "Cumulative Refused session opens and active app replica count",
      "Second-6 p95 and completed requests alongside whole-run failures and whole-run percentile bounds", "Exact scripted CPU slowdown application and end receipts"]},
  limitations: ["App-to-database pools are lazy, with a fixed maximum of 10 connections per instance/path and a 10-second idle timeout. Pool size is not a canvas control here.",
    "Minimum replicas controls initial instances in this Model 2 profile. This six-second run ends before the ten-second controller evaluation; it proves no long-run cap.",
    "The reference can still fail callers during the slowdown and have a worse whole-run latency tail. Spare sessions at the final second do not establish whole-run health, recovery time or production availability.",
    "CPU slowdown and the 85-session tier limit are educational assumptions. No database outage, promotion or cache failure is applied."],
  check: null,
  followUp: "Explain why buying app CPU does not close idle database connections. Cite sessions, refusals and whole-run latency from both runs, including the tradeoff.",
};

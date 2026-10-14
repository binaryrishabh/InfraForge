import type { ChallengeBrief, ChallengeEvaluation, ChallengeSummary } from "@infraforge/contracts/challenges";

export const brief: ChallengeBrief = {
  id: "cache-matters", version: 1, title: "Cache matters", difficulty: "core",
  summary: "A read-heavy API overwhelms its database.", concepts: ["Caching", "Database load"],
  story: ["A catalogue API serves 1.8 million requests an hour."], objective: "Keep the database healthy at the evaluation second.",
  workload: { targetThroughput: 1_800_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "medium" },
  workloadNote: "1,800,000 requests per hour.", evaluationSeconds: 150, evaluationNote: "Checked after the ramp.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "database", kind: "database-healthy", label: "Every database is healthy at second 150" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $400 or less", maxUsd: 400 },
  ],
  predictions: [
    { id: "database", kind: "database-health", prompt: "What will the database's health be at second 150?" },
    { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 150?" },
  ],
  hints: ["Which resource is at 100% CPU?", "A cache absorbs repeated reads.", "Connect app servers to a cache."],
  debrief: null,
  starter: { resources: [{ id: "dns", type: "DNS", x: 0, y: 0 }, { id: "vm1", type: "Virtual Machine", x: 0, y: 0 }, { id: "vm2", type: "Virtual Machine", x: 0, y: 0 }, { id: "db", type: "Database", x: 0, y: 0, public: true }], connectionLines: [] },
  specHash: "a".repeat(64), attempts: [], workspaceDesignId: null,
};

export const summary: ChallengeSummary = {
  id: brief.id, version: 1, title: brief.title, difficulty: "core", summary: brief.summary, concepts: brief.concepts,
  evaluationSeconds: 150, requirementCount: 3, attempts: 0, met: false, latest: null, workspaceDesignId: null,
};

export function evaluation(status: ChallengeEvaluation["status"], outcomes: Array<"matched" | "different" | "unknown">): ChallengeEvaluation {
  return {
    challengeId: brief.id, version: 1, title: brief.title, evaluationSeconds: 150, status, statusDetail: "Judged on recorded evidence.",
    definitionMatches: true, metCount: status === "met" ? 3 : 1, total: 3,
    criteria: brief.criteria.map((c, i) => ({ id: c.id, label: c.label, status: status === "met" || i === 0 ? "met" : "not-met", detail: `detail ${c.id}`, sources: ["terminalSnapshot.metrics"] })),
    predictions: brief.predictions.map((q, i) => ({ id: q.id, prompt: q.prompt, predicted: i === 0 ? "saturated" : "Database",
      actual: outcomes[i] === "unknown" ? null : outcomes[i] === "matched" ? (i === 0 ? "saturated" : "Database") : (i === 0 ? "healthy" : "Virtual Machine"),
      outcome: outcomes[i]!, detail: "recorded", sources: ["terminalSnapshot.metrics"] })),
    reasoning: "Every read reaches the database.", predictionSubmittedAt: "2026-10-14T10:00:00.000Z", inspectNext: ["Open db in the final-state table."],
  };
}

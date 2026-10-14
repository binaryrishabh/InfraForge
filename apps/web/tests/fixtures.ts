import { DeploymentChaosNames } from "@infraforge/domain/resource";
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
  specHash: "a".repeat(64), category: "design", latestVersion: 1, attempts: [], workspaceDesignId: null, earlierWorkspace: null,
};

export const summary: ChallengeSummary = {
  id: brief.id, version: 1, category: "design", title: brief.title, difficulty: "core", summary: brief.summary, concepts: brief.concepts,
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
    reasoning: "Every read reaches the database.", predictionSubmittedAt: "2026-10-14T10:00:00.000Z", inspectNext: ["Open db in the final-state table."], experiment: null,
  };
}

// A resilience challenge: one scheduled crash of app-2 at second 60, judged at second 90.
export const resilienceBrief: ChallengeBrief = {
  ...brief, id: "lose-an-app-server", title: "Lose an app server", category: "resilience", evaluationSeconds: 90, evaluationNote: "Checked at simulated second 90.",
  experiment: { fault: DeploymentChaosNames.Crash, atSimulatedSecond: 60, target: { resourceId: "app-2", type: "Virtual Machine" },
    hypothesis: "app-2 crashes at simulated second 60 and stays down for 30 seconds. Will the rest of the system stay out of saturation at second 90?" },
  criteria: [{ id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "survivors", kind: "survivors-unsaturated", label: "Apart from app-2, no resource saturated or failed at second 90" }],
  predictions: [{ id: "baseline", kind: "baseline-health", prompt: "What will overall health be at second 60, just before app-2 crashes?" },
    { id: "survivors", kind: "survivor-health", prompt: "At second 90, how healthy will the least healthy resource other than app-2 be?" }],
};
export const experimentResult: NonNullable<ChallengeEvaluation["experiment"]> = {
  fault: DeploymentChaosNames.Crash, targetResourceId: "app-2", targetType: "Virtual Machine", atSimulatedSecond: 60, durationSimulatedSeconds: 30, state: "ended",
  appliedSimulatedSeconds: 60, appliedAt: "2026-10-15T10:00:00.000Z", endedSimulatedSeconds: 90, baselineOverallHealth: "healthy", targetHealthAtEvaluation: "failed",
  actionId: "fault", detail: "Crash on app-2 was applied at second 60; the model's 30-second fault window ended at second 90. A fault ending is not the same as recovery.",
  sources: ["RunAction.parameters.trigger"],
};

import type { LearningAttempt } from "@infraforge/contracts/challenges";
import { buildRunReport, type StoredRun } from "../reports/report";
import { latestChallenge } from "./registry";
import { readRecordedExperiment } from "./experiment";

export function learningAttempt(row: StoredRun): LearningAttempt {
  if (!row.challengeId) throw new Error("Learning history requires a challenge attempt");
  const report = buildRunReport(row), evaluation = report.challenge;
  const plan = readRecordedExperiment(row.challengeExperiment);
  const current = row.challengeId ? latestChallenge(row.challengeId) : null;
  return { runId: row.id, challengeId: row.challengeId!, version: row.challengeVersion ?? 0,
    title: evaluation?.title ?? row.challengeId!, createdAt: row.createdAt.toISOString(),
    category: row.challengeExperiment == null ? "design" : "resilience", fault: plan?.fault ?? null,
    status: evaluation?.status ?? "unavailable", metCount: evaluation?.metCount ?? 0, total: evaluation?.total ?? 0,
    predictionMatched: evaluation?.predictions.filter((p) => p.outcome === "matched").length ?? 0,
    predictionKnown: evaluation?.predictions.filter((p) => p.outcome !== "unknown").length ?? 0,
    predictionTotal: evaluation?.predictions.length ?? 0, latestVersion: current?.definition.version ?? null,
    canRetry: !!current && current.definition.version >= (row.challengeVersion ?? 0) && !row.runtimeActive && !["pending", "running", "live"].includes(row.status) };
}

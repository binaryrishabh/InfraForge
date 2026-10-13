import type { ConnectionLine, Resource, ResourceType } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

export type ChallengeDifficulty = "starter" | "core" | "advanced";
export type OverallHealth = "healthy" | "degraded" | "saturated" | "critical";

/* Requirements are evaluated by the server from recorded run evidence.
The client renders labels; it never decides whether one was met. */
export type ChallengeCriterion =
  | { id: string; kind: "deployment-checks"; label: string }
  | { id: string; kind: "min-app-servers"; label: string; count: number }
  | { id: string; kind: "catalog-sizes"; label: string }
  | { id: string; kind: "security-clean"; label: string }
  | { id: string; kind: "monthly-budget"; label: string; maxUsd: number }
  | { id: string; kind: "overall-health"; label: string; allowed: OverallHealth[] }
  | { id: string; kind: "no-saturation"; label: string }
  | { id: string; kind: "database-healthy"; label: string }
  | { id: string; kind: "database-connections"; label: string };

export type PredictionQuestion =
  | { id: string; kind: "overall-health"; prompt: string }
  | { id: string; kind: "database-health"; prompt: string }
  | { id: string; kind: "busiest-type"; prompt: string }
  | { id: string; kind: "security-clean"; prompt: string }
  | { id: string; kind: "scale-out"; prompt: string };

export interface PredictionChoice { value: string; label: string }

/* Fixed answer sets. A busiest-type prediction instead chooses among the
resource types present in the design being attempted. */
export const PREDICTION_CHOICES: Record<Exclude<PredictionQuestion["kind"], "busiest-type">, PredictionChoice[]> = {
  "overall-health": [
    { value: "healthy", label: "Healthy" }, { value: "degraded", label: "Degraded" },
    { value: "saturated", label: "Saturated" }, { value: "critical", label: "Critical" },
  ],
  "database-health": [
    { value: "healthy", label: "Healthy" }, { value: "degraded", label: "Degraded" },
    { value: "saturated", label: "Saturated" }, { value: "failed", label: "Failed" },
  ],
  "security-clean": [{ value: "yes", label: "Yes, no issues" }, { value: "no", label: "No, issues found" }],
  "scale-out": [{ value: "yes", label: "Yes, extra VMs active" }, { value: "no", label: "No extra VMs" }],
};
export const PREDICTION_REASONING_MAX = 500;

export interface ChallengeStarter { resources: Resource[]; connectionLines: ConnectionLine[] }

export interface ChallengeDefinition {
  id: string;
  version: number;
  title: string;
  difficulty: ChallengeDifficulty;
  summary: string;
  concepts: string[];
  story: string[];
  objective: string;
  workload: ResolvedWorkloadProfile;
  workloadNote: string;
  evaluationSeconds: number;
  evaluationNote: string;
  criteria: ChallengeCriterion[];
  predictions: PredictionQuestion[];
  hints: string[];
  debrief: string[];
  starter: ChallengeStarter | null;
}

export interface ChallengeAttemptSummary {
  runId: string;
  createdAt: string;
  status: ChallengeStatus;
  metCount: number;
  total: number;
}

export interface ChallengeSummary {
  id: string;
  version: number;
  title: string;
  difficulty: ChallengeDifficulty;
  summary: string;
  concepts: string[];
  evaluationSeconds: number;
  requirementCount: number;
  attempts: number;
  met: boolean;
  latest: ChallengeAttemptSummary | null;
  workspaceDesignId: string | null;
}

// The debrief stays null until the learner has an evaluated attempt.
export interface ChallengeBrief extends Omit<ChallengeDefinition, "debrief"> {
  specHash: string;
  debrief: string[] | null;
  attempts: ChallengeAttemptSummary[];
  workspaceDesignId: string | null;
}

export interface ChallengePrediction {
  answers: Record<string, string>;
  reasoning: string | null;
}

export type ChallengeStatus = "in-progress" | "met" | "not-met" | "not-evaluated" | "unavailable";

export interface ChallengeCriterionResult {
  id: string;
  label: string;
  status: "met" | "not-met" | "not-evaluated" | "pending";
  detail: string;
  sources: string[];
}

export interface PredictionResult {
  id: string;
  prompt: string;
  predicted: string;
  actual: string | null;
  outcome: "matched" | "different" | "unknown";
  detail: string;
  sources: string[];
}

export interface ChallengeEvaluation {
  challengeId: string;
  version: number;
  title: string;
  evaluationSeconds: number;
  status: ChallengeStatus;
  statusDetail: string;
  definitionMatches: boolean;
  criteria: ChallengeCriterionResult[];
  metCount: number;
  total: number;
  predictions: PredictionResult[];
  reasoning: string | null;
  predictionSubmittedAt: string;
  inspectNext: string[];
}

export interface PreflightCheck {
  id: string;
  label: string;
  status: "ok" | "problem" | "during-run";
  detail: string;
}

export interface ChallengePreflight {
  valid: boolean;
  errors: string[];
  warnings: string[];
  monthlyEstimateUsd: number;
  checks: PreflightCheck[];
  resourceTypes: ResourceType[];
}

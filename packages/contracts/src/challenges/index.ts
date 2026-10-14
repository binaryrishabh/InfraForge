import type { ChaosType, ConnectionLine, Resource, ResourceType } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

export type ChallengeDifficulty = "starter" | "core" | "advanced";
// Design challenges judge a design under fixed traffic; resilience challenges add one scheduled fault.
export type ChallengeCategory = "design" | "resilience";
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
  | { id: string; kind: "database-connections"; label: string }
  // Every resource except the experiment's target stays out of saturation and failure.
  | { id: string; kind: "survivors-unsaturated"; label: string };

export type PredictionQuestion =
  | { id: string; kind: "overall-health"; prompt: string }
  | { id: string; kind: "database-health"; prompt: string }
  | { id: string; kind: "busiest-type"; prompt: string }
  | { id: string; kind: "security-clean"; prompt: string }
  | { id: string; kind: "scale-out"; prompt: string }
  // Overall health at the moment the experiment's fault was applied.
  | { id: string; kind: "baseline-health"; prompt: string }
  // The worst health among every resource except the experiment's target.
  | { id: string; kind: "survivor-health"; prompt: string };

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
  "baseline-health": [
    { value: "healthy", label: "Healthy" }, { value: "degraded", label: "Degraded" },
    { value: "saturated", label: "Saturated" }, { value: "critical", label: "Critical" },
  ],
  "survivor-health": [
    { value: "healthy", label: "Healthy" }, { value: "degraded", label: "Degraded" },
    { value: "saturated", label: "Saturated" }, { value: "failed", label: "Failed" },
  ],
};
export const PREDICTION_REASONING_MAX = 500;

export interface ChallengeStarter { resources: Resource[]; connectionLines: ConnectionLine[] }

/* A resilience challenge's controlled experiment: one fault InfraForge applies
itself, at an exact simulated second, to a named resource from the starter. The
fault lasts the model's fixed duration; the attempt is judged on its last active
second. The browser never chooses the fault, the second or the target. */
export interface ChallengeExperiment {
  fault: ChaosType;
  atSimulatedSecond: number;
  target: { resourceId: string; type: ResourceType };
  hypothesis: string;
}

// The plan as recorded on an attempt when it is created. The worker and the report read only this.
export interface RecordedExperiment {
  version: 1;
  fault: ChaosType;
  atSimulatedSecond: number;
  durationSimulatedSeconds: number;
  targetResourceId: string;
  targetType: ResourceType;
}

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
  // Present only on resilience challenges. Optional so earlier definitions keep their exact spec hash.
  experiment?: ChallengeExperiment;
}

export interface ChallengeAttemptSummary {
  runId: string;
  version: number;
  createdAt: string;
  status: ChallengeStatus;
  metCount: number;
  total: number;
}

export interface ChallengeSummary {
  id: string;
  version: number;
  category: ChallengeCategory;
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
  category: ChallengeCategory;
  latestVersion: number;
  debrief: string[] | null;
  attempts: ChallengeAttemptSummary[];
  // The learner's workspace for this version, and the newest workspace they have from an earlier version.
  workspaceDesignId: string | null;
  earlierWorkspace: { designId: string; version: number } | null;
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

/* What happened to a resilience attempt's scheduled fault, from its durable action. */
export interface ExperimentResult {
  fault: ChaosType;
  targetResourceId: string;
  targetType: ResourceType;
  atSimulatedSecond: number;
  durationSimulatedSeconds: number;
  state: "scheduled" | "active" | "ended" | "not-applied";
  appliedSimulatedSeconds: number | null;
  appliedAt: string | null;
  endedSimulatedSeconds: number | null;
  baselineOverallHealth: string | null;
  targetHealthAtEvaluation: string | null;
  actionId: string | null;
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
  experiment: ExperimentResult | null;
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
  // For a resilience challenge: whether the design still contains the experiment's target, as required.
  experiment: { ready: boolean; detail: string } | null;
}

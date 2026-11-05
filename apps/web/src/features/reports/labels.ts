import type { RunAction } from "@infraforge/contracts/actions";
import type { RunComparison, StartingComparison } from "@infraforge/contracts/reports";

// Presentation of the existing server classifier, shared with lesson follow-ups.
export function challengeConditionsLabel(value: RunComparison["challengeConditions"]): string {
  return value === "same" ? "Same challenge version, rules, workload, seed, evaluation second and scheduled fault."
    : value === "different" ? "Different challenge versions or recorded conditions; their results were judged by different rules." : "Unknown";
}

export const GRADE_LABEL: Record<StartingComparison["grade"], string> = {
  "same-starting-point": "Same starting point", "one-change-design": "One change: design", "one-change-workload": "One change: workload",
  "same-setup-different-seed": "Same setup, different seed", "several-things-changed": "Several things changed", "side-by-side-only": "Side-by-side only",
};

/** The three gates every run passes before it goes live, and their recorded states. */
export const STAGE_LABEL: Record<string, string> = { Validate: "Validate design", SecurityScan: "Security scan", CostEstimate: "Cost estimate" };
export const STAGE_STATUS_LABEL: Record<string, string> = { completed: "Done", failed: "Failed", pending: "Not reached", running: "Running" };

// The fault a resilience challenge applies itself, as opposed to one a person requested.
export const isChallengeExperiment = (action: RunAction) => action.kind === "chaos" && (action.parameters as { trigger?: string }).trigger === "challenge-experiment";

export const isScenarioAction = (action: RunAction) => typeof action.scenarioStepId === "string" && action.scenarioStepId.length > 0;

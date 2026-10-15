import type { ReportCheckpoint, ReportStage, ReportStatement, RunSummary } from "./report";
import type { RunAction } from "../actions/index";

export type StartingGrade = "same-starting-point" | "one-change-design" | "one-change-workload" | "same-setup-different-seed" | "several-things-changed" | "side-by-side-only";
export interface FieldDifference { field: string; earlier: unknown; later: unknown }
export interface DesignDifference {
  added: string[]; removed: string[];
  reconfigured: Array<{ id: string; fields: FieldDifference[] }>;
  addedConnections: Array<{ sourceId: string; targetId: string; port: number }>;
  removedConnections: Array<{ sourceId: string; targetId: string; port: number }>;
  resourceOrder: { earlier: string[]; later: string[] } | null;
  connectionOrder: { earlier: Array<{ sourceId: string; targetId: string; port: number }>; later: Array<{ sourceId: string; targetId: string; port: number }> } | null;
}
export interface StartingComparison {
  grade: StartingGrade;
  facets: Record<"inputVersion" | "model" | "catalog" | "workload" | "seed" | "topology" | "resourceOrder", "same" | "different" | "unknown">;
  design: DesignDifference | null; workload: FieldDifference[];
  alignment: { code: "aligned" | "shifted" | "unknown"; aligned: string[]; shifted: Array<{ id: string; earlierPosition: number; laterPosition: number }>; scope: string };
}
export interface DesignChangeReview {
  classification: "no-change" | "one-change" | "several-changes" | "unavailable";
  count: number | null;
  differences: DesignDifference | null;
  starting: StartingComparison;
  inputHash: string;
}
export interface CompareMetric { field: string; unit: string; earlier: number | null; later: number | null; delta: number | null; withheldReason?: string }
export interface RunComparison {
  designChangeReview?: DesignChangeReview | null;
  experimentEvidence?: { comparable: boolean; reason: string; traces: [
    ExperimentCompareTrace, ExperimentCompareTrace
  ] };
  version: 1; runs: [RunSummary, RunSummary];
  available: boolean; unavailableReason: string | null;
  lineage: "source-and-rerun" | "source-and-improvement" | "siblings" | "unrelated";
  headline: "descriptive-only" | "starting-inputs-only" | "matched-pair" | "determinism-match" | "determinism-mismatch";
  starting: StartingComparison;
  conduct: { code: "same" | "different" | "unknown"; actions: [RunAction[], RunAction[]]; speedNote: string; reasons: string[] };
  evidence: { code: "both-exact" | "exact-and-checkpoint" | "checkpoints-only" | "missing"; states: [ReportCheckpoint | null, ReportCheckpoint | null]; matchedDuration: boolean | null; deterministicState: "matches" | "differs" | "not-established" };
  outcomes: CompareMetric[];
  resources: Array<{ id: string; earlierHealth?: string; laterHealth?: string; metrics: CompareMetric[] }>;
  costs: CompareMetric[];
  gates: [ReportStage[], ReportStage[]];
  // Both runs are challenge attempts: whether they ran under identical recorded challenge conditions.
  challengeConditions: "same" | "different" | null;
  observed: ReportStatement[]; interpreted: ReportStatement[]; unknown: ReportStatement[];
}
export interface ExperimentCompareTrace {
  status: import("./experimentTrace").ExperimentTrace["status"];
  start: number | null; end: number | null; count: number; target: string | null;
  highestCpu: { second: number; value: number } | null;
  observation?: import("./experimentTrace").PostFaultObservation;
}

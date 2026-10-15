export const HYPOTHESIS_MAX = 400;
export type LearningIntent = "improvement" | "repeat";
export interface AttemptLearning {
  sourceRunId: string | null;
  hypothesis: string;
  intent: LearningIntent;
}
export interface ImprovementSubmission {
  sourceRunId: string;
  hypothesis: string;
  intent: LearningIntent;
  inputHash: string;
  acknowledgeMultiple: boolean;
}
export interface EvidenceCue {
  id: string;
  kind: "requirement" | "prediction" | "measurement" | "unknown";
  title: string;
  statement: string;
  sources: string[];
  limit: string;
  resourceId?: string;
  simulatedSecond?: number;
}
export interface GuidedReview {
  cues: EvidenceCue[];
  canImprove: boolean;
  unavailableReason: string | null;
}

import type { AdmissionRequest, AuthoringDraft, InternalDesign, Review } from "../internal-model2";
export const LESSON_VERSION = "object-restart/1";
export const phases = { before: { atUs: 8000, label: "Before the process crash" }, during: { atUs: 12000, label: "While the process is unavailable" }, after: { atUs: 18000, label: "After restart readiness returns" } } as const;
export type ReadPhase = keyof typeof phases;
export interface LessonChoice { schema: typeof LESSON_VERSION; infrastructureId: string; expectedDesignUpdatedAt: string; idempotencyKey: string; phase: ReadPhase }
export interface LessonReview { choice: LessonChoice; draft: AuthoringDraft; reviewHash: string; review: Review; image: string; explanation: string[] }
export interface LessonSubmission extends LessonChoice { reviewHash: string }
export interface LessonWorkspace { designs: InternalDesign[]; configured: boolean; profile: typeof LESSON_VERSION; operator: boolean }
export interface LessonSummary { profile: string; phase: string; kind: "Observed" | "Unknown"; readOutcome: string; returnedBytes: number | null; explanation: string; limits: string[] }
export type LessonRequest = AdmissionRequest;

import type { LessonReview, ReadPhase } from "@infraforge/contracts/internal-lessons";
export interface LessonDraft { design: string; phase: ReadPhase; review: LessonReview | null; pending: boolean; lastRun: string }
const key = (owner: string) => `infraforge-object-restart/1:${owner}`;
export function readLessonDraft(owner: string): LessonDraft {
  const empty: LessonDraft = { design: "", phase: "before", review: null, pending: false, lastRun: "" };
  try {
    const raw = sessionStorage.getItem(key(owner));
    if (!raw || raw.length > 262144) return empty;
    const value = JSON.parse(raw);
    if (typeof value.design !== "string" || !["before", "during", "after"].includes(value.phase) || typeof value.pending !== "boolean" || typeof value.lastRun !== "string") return empty;
    if (value.review === null) return value.pending ? empty : value;
    const review = value.review;
    if (review?.choice?.schema !== "object-restart/1" || !["before", "during", "after"].includes(review.choice.phase) ||
      !["infrastructureId", "expectedDesignUpdatedAt", "idempotencyKey"].every((key) => typeof review.choice[key] === "string") ||
      !/^[a-f0-9]{64}$/.test(review.reviewHash) || typeof review.review?.designName !== "string" || !review.review?.request ||
      !Array.isArray(review.review.fields) || !Array.isArray(review.explanation) || !review.explanation.every((text: unknown) => typeof text === "string")) return empty;
    return value;
  } catch { return empty; }
}
export function saveLessonDraft(owner: string, value: LessonDraft) {
  try { const text = JSON.stringify(value); if (text.length > 262144) return false; sessionStorage.setItem(key(owner), text); return true; } catch { return false; }
}

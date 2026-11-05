import type { LearningContent, LearningLesson } from "@infraforge/contracts/learning";
import type { LearningRun } from "../learning/progress";
import { learningContent } from "../learning/content";
import { answers, attemptRow, definition, legacyDefinition, tier } from "./challengeHarness";

/** Test-only labs: no published reading text or challenge definitions are changed. */
export function progressContent(): LearningContent {
  const reading = learningContent.lessons[0]!;
  const intro: LearningLesson = { ...reading, id: "intro", trackId: "test-track", moduleId: "basics", prerequisites: [] };
  const lab: LearningLesson = { ...intro, id: "api-lab", kind: "executable-lab", prerequisites: [intro.id],
    experiment: { challengeId: "first-production-api", prediction: null } };
  const follow: LearningLesson = { ...lab, id: "cache-lab", moduleId: "later", prerequisites: [lab.id],
    experiment: { challengeId: "cache-matters", prediction: null } };
  const draft: LearningLesson = { ...lab, id: "draft-lab", availability: "draft" };
  return { tracks: [{ id: "test-track", title: "Test path", summary: "Test-only lesson wrappers.", availability: "available", modules: [
    { id: "basics", title: "Basics", summary: "Reading and first lab.", availability: "available", lessonIds: [intro.id, lab.id, draft.id] },
    { id: "later", title: "Later", summary: "Follow-up lab.", availability: "available", lessonIds: [follow.id] },
  ] }], lessons: [follow, draft, lab, intro] };
}

type Design = "one" | "two" | "expensive" | "earlier";
const cache = new Map<Design, LearningRun>();
export function progressAttempt(design: Design = "one", changes: Partial<LearningRun> = {}): LearningRun {
  let row = cache.get(design);
  if (!row) {
    const d = design === "earlier" ? legacyDefinition("first-production-api") : definition("first-production-api");
    const layout = design === "expensive" ? tier(1, { dbSku: "db.m5.2xlarge" }) : tier(design === "one" ? 1 : 2);
    row = { ...attemptRow(d, layout, answers(d, { health: "healthy", busiest: "Database" })), ownerId: "alice" };
    cache.set(design, row);
  }
  return { ...structuredClone(row), id: "run-1", createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:01:00Z"), ...changes };
}

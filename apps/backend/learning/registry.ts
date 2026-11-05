import type { LearningContent, LearningLesson } from "@infraforge/contracts/learning";
import { validateLearningContent } from "./validate";
import { learningContent } from "./content";

export interface LessonFilter { trackId?: string; moduleId?: string; challengeId?: string }

/** A learner-facing projection. Draft tracks, modules and lessons never escape it. */
export function buildLearningRegistry(source: LearningContent) {
  const errors = validateLearningContent(source);
  if (errors.length) throw new Error(`Invalid learning content:\n${errors.join("\n")}`);
  const snapshot = structuredClone(source);
  const visible = (l: LearningLesson) => l.availability === "available" && snapshot.tracks.some((t) =>
    t.id === l.trackId && t.availability === "available" && t.modules.some((m) =>
      m.id === l.moduleId && m.availability === "available"));
  const lessons = snapshot.lessons.filter(visible);
  const versions = [...lessons, ...(snapshot.archivedLessons ?? []).filter(visible)];
  const ids = new Set(lessons.map((l) => l.id));
  const tracks = snapshot.tracks.filter((t) => t.availability === "available").map((t) => ({
    ...t, modules: t.modules.filter((m) => m.availability === "available").map((m) => ({
      ...m, lessonIds: m.lessonIds.filter((id) => ids.has(id)),
    })).filter((m) => m.lessonIds.length > 0),
  })).filter((t) => t.modules.length > 0);
  return {
    listTracks: () => structuredClone(tracks),
    findTrack: (id: string) => structuredClone(tracks.find((t) => t.id === id) ?? null),
    findModule: (trackId: string, moduleId: string) => structuredClone(tracks.find((t) => t.id === trackId)?.modules.find((m) => m.id === moduleId) ?? null),
    listLessons: (filter: LessonFilter = {}) => structuredClone(lessons.filter((l) =>
      (filter.trackId === undefined || l.trackId === filter.trackId) &&
      (filter.moduleId === undefined || l.moduleId === filter.moduleId) &&
      (filter.challengeId === undefined || (l.kind === "executable-lab" && l.experiment.challengeId === filter.challengeId)))),
    findLesson: (id: string, contentVersion?: number) => structuredClone((contentVersion === undefined ? lessons : versions)
      .find((l) => l.id === id && (contentVersion === undefined || l.contentVersion === contentVersion)) ?? null),
  };
}

export const LEARNING_REGISTRY = buildLearningRegistry(learningContent);
export const listLearningTracks = LEARNING_REGISTRY.listTracks;
export const findLearningTrack = LEARNING_REGISTRY.findTrack;
export const findLearningModule = LEARNING_REGISTRY.findModule;
export const listLearningLessons = LEARNING_REGISTRY.listLessons;
export const findLearningLesson = LEARNING_REGISTRY.findLesson;

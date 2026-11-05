import { Router } from "express";
import type { LearningCatalog, LearningLessonDetail, LearningLessonSummary } from "@infraforge/contracts/learning";
import { selectLearningSuggestions } from "@infraforge/contracts/learning";
import { latestChallenge } from "../challenges/registry";
import { NotFoundError } from "../utils/errors";
import { LEARNING_REGISTRY } from "./registry";
import { deriveLessonProgress } from "./progress";
import { readLearningAttempts } from "./attempts";

export function createLearningRouter({ registry = LEARNING_REGISTRY, readAttempts = readLearningAttempts } = {}) {
  const router = Router();
  router.get("/", async (_req, res) => {
    const ownerId: string = res.locals.userId;
    const tracks = registry.listTracks(), lessons = registry.listLessons();
    const rows = await readAttempts(ownerId, lessons.flatMap((l) => l.kind === "executable-lab" ? [l.experiment.challengeId] : []));
    const progress = deriveLessonProgress(ownerId, lessons, rows);
    const summaries: LearningLessonSummary[] = lessons.map(({ id, contentVersion, trackId, moduleId, title, summary, kind, level,
      availability, prerequisites, experiment, limitations }) => ({ id, contentVersion, trackId, moduleId, title, summary, kind, level,
      availability, prerequisites, experiment, limitations }));
    const catalog: LearningCatalog = { tracks, lessons: summaries, progress, suggestions: selectLearningSuggestions(tracks, lessons, progress) };
    res.json({ success: true, ...catalog });
  });
  router.get("/lessons/:id", async (req, res) => {
    // Deliberately current-only. Draft parents and lessons are hidden by the registry.
    const lesson = registry.findLesson(req.params.id);
    if (!lesson) throw new NotFoundError("Lesson not found");
    const ownerId: string = res.locals.userId;
    const linked = lesson.kind === "executable-lab" ? latestChallenge(lesson.experiment.challengeId) : null;
    const rows = await readAttempts(ownerId, lesson.kind === "executable-lab" ? [lesson.experiment.challengeId] : []);
    const detail: LearningLessonDetail = { lesson, progress: deriveLessonProgress(ownerId, [lesson], rows)[0] ?? null,
      challenge: linked ? { id: linked.definition.id, version: linked.definition.version, specHash: linked.hash,
        title: linked.definition.title, summary: linked.definition.summary, evaluationSeconds: linked.definition.evaluationSeconds,
        requirementCount: linked.definition.criteria.length, executable: linked.definition.engine === "2" } : null };
    res.json({ success: true, ...detail });
  });
  return router;
}

export const learningRouter = createLearningRouter();

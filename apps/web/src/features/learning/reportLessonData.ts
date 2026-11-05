import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { availableLessons } from "./discovery";
import { getLearningCatalog, getLearningLesson } from "./learning.api";

export async function findReportLesson(challengeId: string): Promise<LearningLessonDetail | null> {
  const catalog = await getLearningCatalog();
  const lesson = availableLessons(catalog).find((l) => l.kind === "executable-lab" && l.experiment?.challengeId === challengeId);
  if (!lesson) return null;
  const detail = await getLearningLesson(lesson.id);
  return detail.lesson.kind === "executable-lab" && detail.lesson.experiment.challengeId === challengeId ? detail : null;
}

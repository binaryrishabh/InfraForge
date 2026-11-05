import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { useRequest } from "@/api/useRequest";
import { Loading } from "@/ui/Page";
import { availableLessons } from "./discovery";
import { getLearningCatalog, getLearningLesson } from "./learning.api";
import { LearningFailure, type LearningRequest } from "./LearningPage";

export async function findReportLesson(challengeId: string): Promise<LearningLessonDetail | null> {
  const catalog = await getLearningCatalog();
  const lesson = availableLessons(catalog).find((l) => l.kind === "executable-lab" && l.experiment?.challengeId === challengeId);
  if (!lesson) return null;
  const detail = await getLearningLesson(lesson.id);
  return detail.lesson.kind === "executable-lab" && detail.lesson.experiment.challengeId === challengeId ? detail : null;
}

export function ReportLessonContent({ data, loading, error, retry }: LearningRequest<LearningLessonDetail>) {
  if (loading) return <Loading label="Finding this challenge’s lesson…" />;
  if (error) return <LearningFailure error={error} retry={retry} />;
  if (!data || data.lesson.kind !== "executable-lab") return null;
  return <aside aria-label="Lesson follow-up" className="mt-5 text-sm">
    <Link className="text-accent hover:underline" to={`/learning/lessons/${encodeURIComponent(data.lesson.id)}`}>Part of lesson {data.lesson.title}</Link>
    {data.lesson.followUp && <p className="mt-2">{data.lesson.followUp}</p>}
  </aside>;
}

export function ReportLesson({ challengeId }: { challengeId: string }) {
  const load = useCallback(() => findReportLesson(challengeId), [challengeId]);
  return <ReportLessonContent {...useRequest(load, "The lesson follow-up could not be loaded.")} />;
}

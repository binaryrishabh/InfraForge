import { Link } from "react-router-dom";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { Loading } from "@/ui/Page";
import { useReportLesson } from "./hooks";
import { LearningFailure, type LearningRequest } from "./LearningPage";
import { reportLessonView, requestView } from "./viewModels";

export function ReportLessonContent({ data, loading, error, retry }: LearningRequest<LearningLessonDetail>) {
  const request = requestView({ data, loading, error }, "The lesson follow-up could not be loaded.", "empty");
  if (request.state === "loading") return <Loading label="Finding this challenge’s lesson…" />;
  if (request.state === "error") return <LearningFailure error={request.error} retry={retry} />;
  const view = reportLessonView(request.state === "ready" ? request.data : null);
  if (!view) return null;
  return <aside aria-label="Lesson follow-up" className="mt-5 text-sm">
    <Link className="text-accent hover:underline" to={view.href}>Part of lesson {view.title}</Link>
    {view.followUp && <p className="mt-2">{view.followUp}</p>}
  </aside>;
}

export function ReportLesson({ challengeId }: { challengeId: string }) {
  return <ReportLessonContent {...useReportLesson(challengeId)} />;
}

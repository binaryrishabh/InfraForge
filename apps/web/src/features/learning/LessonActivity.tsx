import { Link } from "react-router-dom";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import { BeginImprovement } from "@/features/challenges/components/BeginImprovement";
import { GuidedReview } from "@/features/challenges/components/GuidedReview";
import { Loading, Section } from "@/ui/Page";
import { LearningFailure, type LearningRequest } from "./LearningPage";
import { useLessonActivity, useLessonComparison } from "./hooks";
import { comparisonView, requestView } from "./viewModels";
import { LessonRunSummary } from "./LessonRunSummary";
import type { LearningLesson } from "@infraforge/contracts/learning";

export function LessonComparisonContent({ data, loading, error, retry }: LearningRequest<RunComparison>) {
  const request = requestView({ data, loading, error }, "Eligible comparisons could not be loaded.", "empty");
  if (request.state === "loading") return <Loading label="Finding eligible recorded runs…" />;
  if (request.state === "error") return <LearningFailure error={request.error} retry={retry} />;
  const view = comparisonView(request.state === "ready" ? request.data : null);
  if (!view) return <p className="mt-3 text-sm text-ink-3">Two eligible recorded attempts are needed to compare. No comparison is claimed.</p>;
  return <div className="mt-4 text-sm">
    <Link className="text-accent hover:underline" to={view.href}>Compare recorded attempts</Link>
    <p className="mt-2">Challenge conditions: {view.conditions}</p>
  </div>;
}

function LessonComparison({ report }: { report: RunReport }) {
  return <><LessonComparisonContent {...useLessonComparison(report)} />
    <p className="mt-2 text-xs text-ink-3">Candidates come from the existing comparison list, up to 100 finished runs.</p></>;
}

export function LessonActivityContent({ data, loading, error, retry, suggestion, lesson }: LearningRequest<RunReport> & { suggestion?: string; lesson?: LearningLesson }) {
  const request = requestView({ data, loading, error }, "Your recorded cues could not be loaded.", "empty");
  if (request.state === "loading") return <Loading label="Loading your latest recorded cues…" />;
  if (request.state === "error") return <LearningFailure error={request.error} retry={retry} />;
  if (request.state === "empty") return null;
  const report = request.data;
  return <><Section title="Your latest recorded attempt" className="mt-6">
    <Link className="text-accent hover:underline" to={`/runs/${encodeURIComponent(report.run.id)}`}>Read the recorded report</Link>
    {report.guidedReview ? <GuidedReview report={report} readOnly withImprovement={false} />
      : <p className="mt-3">No guided review cues were retained. Inspect the report’s evidence limits; no measured outcome is claimed here.</p>}
    <div className="mt-4"><BeginImprovement key={report.run.id} report={report} suggestion={suggestion} /></div>
    <LessonComparison report={report} />
  </Section>{lesson && <LessonRunSummary report={report} lesson={lesson} />}</>;
}

export function LessonActivity({ detail }: { detail: LearningLessonDetail }) {
  return <LessonActivityContent {...useLessonActivity(detail)} suggestion={detail.lesson.followUp} lesson={detail.lesson} />;
}

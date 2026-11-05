import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import { useRequest } from "@/api/useRequest";
import { BeginImprovement } from "@/features/challenges/components/BeginImprovement";
import { GuidedReview } from "@/features/challenges/components/GuidedReview";
import { challengeConditionsLabel } from "@/features/reports/labels";
import { Loading, Section } from "@/ui/Page";
import { LearningFailure, type LearningRequest } from "./LearningPage";
import { getLatestLessonReport, getLessonComparison } from "./lessonActivityData";

export function LessonComparisonContent({ data, loading, error, retry }: LearningRequest<RunComparison>) {
  if (loading) return <Loading label="Finding eligible recorded runs…" />;
  if (error) return <LearningFailure error={error} retry={retry} />;
  if (!data?.available || data.runs.length !== 2 || data.runs[0].id === data.runs[1].id) return <p className="mt-3 text-sm text-ink-3">Two eligible recorded attempts are needed to compare. No comparison is claimed.</p>;
  return <div className="mt-4 text-sm">
    <Link className="text-accent hover:underline" to={`/runs/compare?a=${encodeURIComponent(data.runs[0].id)}&b=${encodeURIComponent(data.runs[1].id)}`}>Compare recorded attempts</Link>
    <p className="mt-2">Challenge conditions: {challengeConditionsLabel(data.challengeConditions)}</p>
  </div>;
}

function LessonComparison({ report }: { report: RunReport }) {
  const load = useCallback(() => getLessonComparison(report), [report]);
  return <><LessonComparisonContent {...useRequest(load, "Eligible comparisons could not be loaded. No comparison is known.")} />
    <p className="mt-2 text-xs text-ink-3">Candidates come from the existing comparison list, up to 100 finished runs.</p></>;
}

export function LessonActivityContent({ data, loading, error, retry, suggestion }: LearningRequest<RunReport> & { suggestion?: string }) {
  if (loading) return <Loading label="Loading your latest recorded cues…" />;
  if (error) return <LearningFailure error={error} retry={retry} />;
  if (!data) return null;
  return <Section title="Your latest recorded attempt" className="mt-6">
    <Link className="text-accent hover:underline" to={`/runs/${encodeURIComponent(data.run.id)}`}>Read the recorded report</Link>
    {data.guidedReview ? <GuidedReview report={data} readOnly withImprovement={false} />
      : <p className="mt-3">No guided review cues were retained. Inspect the report’s evidence limits; no measured outcome is claimed here.</p>}
    <div className="mt-4"><BeginImprovement key={data.run.id} report={data} suggestion={suggestion} /></div>
    <LessonComparison report={data} />
  </Section>;
}

export function LessonActivity({ detail }: { detail: LearningLessonDetail }) {
  const load = useCallback(() => getLatestLessonReport(detail), [detail]);
  return <LessonActivityContent {...useRequest(load, "Your recorded cues could not be loaded. No outcome is known.")} suggestion={detail.lesson.followUp} />;
}

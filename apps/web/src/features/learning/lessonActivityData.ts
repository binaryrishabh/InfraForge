import { isActiveRunStatus } from "@infraforge/contracts/deployment";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import { getComparison, getCompareOptions, getRunReport } from "@/api/reports.api";

export function latestLessonRun(detail: LearningLessonDetail): string | null {
  const { lesson, progress } = detail;
  return lesson.kind === "executable-lab" && progress?.lessonId === lesson.id && progress.challengeId === lesson.experiment.challengeId
    ? progress.lastRunId : null;
}

export async function getLatestLessonReport(detail: LearningLessonDetail): Promise<RunReport | null> {
  const id = latestLessonRun(detail);
  if (!id) return null;
  const report = await getRunReport(id);
  if (report.run.id !== id || report.challenge?.challengeId !== detail.lesson.experiment?.challengeId) throw Error("The recorded attempt does not belong to this lesson.");
  return report;
}

export async function getLessonComparison(report: RunReport): Promise<RunComparison | null> {
  if (isActiveRunStatus(report.run.status) || !report.challenge) return null;
  // The existing endpoint supplies inactive, same-owner candidates (up to 100).
  const options = (await getCompareOptions(report.run.id)).filter((r) => r.id !== report.run.id && !isActiveRunStatus(r.status)
    && r.challenge?.id === report.challenge!.challengeId);
  const other = options.find((r) => r.id === report.run.learning?.sourceRunId) ?? options[0];
  if (!other) return null;
  const comparison = await getComparison(report.run.id, other.id);
  // Eligibility comes from the server classifier, not the progress count or a guessed conditions key.
  return comparison.available && comparison.runs.length === 2 && comparison.runs.some((r) => r.id === report.run.id)
    && comparison.runs.some((r) => r.id === other.id) ? comparison : null;
}

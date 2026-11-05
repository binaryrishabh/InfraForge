import type { LearningLesson } from "@infraforge/contracts/learning";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportSection } from "@/features/reports/components/ReportSection";
import { StatusMark } from "@/ui/StatusMark";
import { lessonRunMeasurements } from "./runSummaryData";

export function LessonRunSummary({ report, lesson }: { report: RunReport; lesson: LearningLesson }) {
  if (lesson.kind !== "executable-lab" || report.challenge?.challengeId !== lesson.experiment.challengeId) return null;
  const result = report.challenge;
  const measurements = lessonRunMeasurements(report, lesson.experiment.evidenceToInspect ?? []);
  return <ReportSection title="What did my run show?">
    <p>Run {report.run.id} · challenge version {result.version}</p>
    <p className="mt-2">Requirements: <StatusMark kind={result.status} /> · {result.metCount} of {result.total} met</p>
    <ul className="mt-2">{result.criteria.map(criterion => <li key={criterion.id}>
      {criterion.label}: <StatusMark kind={criterion.status} />
    </li>)}</ul>
    <p className="mt-3">Exact terminal snapshot: {report.terminal?.simulatedSeconds === undefined ? "Unknown" : `second ${report.terminal.simulatedSeconds}`}</p>
    <dl className="mt-2 space-y-2">{measurements.map(({ label, value }, index) => <div key={`${index}-${label}`}>
      <dt className="font-medium">{label}</dt><dd>{value}</dd>
    </div>)}</dl>
    <div className="mt-3">{lesson.limitations.map(limit => <p key={limit}>{limit}</p>)}</div>
  </ReportSection>;
}

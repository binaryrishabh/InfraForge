import type { LearningLesson } from "@infraforge/contracts/learning";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportSection } from "@/features/reports/components/ReportSection";
import { StatusMark } from "@/ui/StatusMark";
import { lessonRunSummaryView } from "./viewModels";

export function LessonRunSummary({ report, lesson }: { report: RunReport; lesson: LearningLesson }) {
  const view = lessonRunSummaryView(report, lesson);
  if (!view) return null;
  const { result, measurements } = view;
  return <ReportSection title="What did my run show?">
    <p>Run {view.runId} · challenge version {result.version}</p>
    <p className="mt-2">Requirements: <StatusMark kind={result.status} /> · {result.metCount} of {result.total} met</p>
    <ul className="mt-2">{result.criteria.map(criterion => <li key={criterion.id}>
      {criterion.label}: <StatusMark kind={criterion.status} />
    </li>)}</ul>
    <p className="mt-3">Exact terminal snapshot: {view.terminalLabel}</p>
    <dl className="mt-2 space-y-2">{measurements.map(({ label, value }, index) => <div key={`${index}-${label}`}>
      <dt className="font-medium">{label}</dt><dd>{value}</dd>
    </div>)}</dl>
    <div className="mt-3">{view.limitations.map(limit => <p key={limit}>{limit}</p>)}</div>
  </ReportSection>;
}

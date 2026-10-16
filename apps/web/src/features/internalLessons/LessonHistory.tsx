import { Link } from "react-router-dom";
import { phases } from "@infraforge/contracts/internal-lessons";
import type { RunSummary } from "@infraforge/contracts/internal-model2";
export function LessonHistory({ value }: { value: RunSummary[] }) {
  return <ul className="space-y-3">{value.map((run) => {
    const phase = run.lesson?.phase, label = phase && phase !== "Unknown" ? phases[phase].label : run.lesson ? "Lesson phase Unknown" : "Advanced internal run";
    return <li key={run.id}><Link className="underline" title={`Run ${run.id}`} to={`?run=${encodeURIComponent(run.id)}`}>{label} · {run.status}</Link><p className="text-sm text-ink-3"><time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time></p></li>;
  })}</ul>;
}

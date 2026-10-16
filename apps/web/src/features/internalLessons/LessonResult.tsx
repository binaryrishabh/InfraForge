import type { LessonSummary } from "@infraforge/contracts/internal-lessons";
export function LessonResult({ value }: { value: LessonSummary }) {
  return <section aria-label="Lesson result" className="space-y-3 rounded-md border border-line p-5">
    <h3 className="text-xl font-semibold">Your recorded read</h3>
    <p>{value.phase} · {value.kind}: {value.readOutcome}{value.returnedBytes !== null ? ` · ${value.returnedBytes} returned object bytes` : " · returned object bytes Unknown"}</p>
    <p>{value.explanation}</p><ul className="list-disc pl-5 text-sm">{value.limits.map((text) => <li key={text}>{text}</li>)}</ul>
  </section>;
}

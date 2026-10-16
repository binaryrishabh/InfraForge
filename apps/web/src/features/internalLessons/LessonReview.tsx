import { useState } from "react";
import { phases } from "@infraforge/contracts/internal-lessons";
import type { LessonReview as Review } from "@infraforge/contracts/internal-lessons";
import { Button } from "@/ui/Button";
export function LessonReview({ value, pending, busy, submit, edit }: { value: Review; pending: boolean; busy: boolean; submit: () => void; edit: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <section className="space-y-4 rounded-md border border-line p-5" aria-label="Lesson review">
    <h2 className="text-xl font-semibold">Review your restart experiment</h2>
    <p>{value.review.designName} · {phases[value.choice.phase].label} at {phases[value.choice.phase].atUs} modeled us.</p>
    <ul className="list-disc space-y-2 pl-5">{value.explanation.map((text) => <li key={text}>{text}</li>)}</ul>
    <p>Write at 2,000 us; crash at 10,000 us; readiness returns at 16,000 us; delete at 30,000 us. The modeled horizon is 40,000 us.</p>
    <p>This is an authored educational scenario. It does not predict cloud outages, physical data durability, security, latency or pricing.</p>
    <details><summary className="cursor-pointer underline">Inspect all authored inputs, assumptions and execution limits</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details>
    {pending ? <p role="status">Submission outcome is uncertain. Retry this exact reviewed request, including after refresh.</p> : <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I accept the teaching assumptions and want to run this recorded experiment.</label>}
    <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={!pending && !confirmed} loading={busy} onClick={submit}>{pending ? "Retry exact lesson submission" : "Run reviewed lesson"}</Button><Button disabled={pending || busy} onClick={edit}>Change read phase</Button></div>
  </section>;
}

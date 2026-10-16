import { useState } from "react";
import type { AuthoringDraft, Review } from "@infraforge/contracts/internal-model2";
import { Button } from "@/ui/Button";
export function ReviewPanel({ review, draft, pending, busy, submit, edit }: { review: Review; draft: AuthoringDraft; pending: boolean; busy: boolean; submit: () => void; edit: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <section aria-labelledby="review-title" className="space-y-5 rounded-md border border-line p-5">
    <h2 id="review-title" className="text-xl font-semibold">Review the exact execution</h2>
    <p>{review.designName} · saved revision <time>{review.revision}</time> · {review.arrivals} recorded application arrivals</p>
    <p className="break-all text-sm text-ink-3">Reviewed request identity: {review.requestHash}</p>
    <p className="text-sm">Server compilation passed. Admission recompiles and checks the same saved revision. No execution has been admitted by validation.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Authored values, units and origins</caption><thead><tr><th className="p-2">Setting</th><th className="p-2">Value / unit</th><th className="p-2">Origin</th></tr></thead><tbody>{review.fields.map((f) => <tr key={f.field} className="border-t border-line"><th scope="row" className="p-2 font-medium">{f.field}</th><td className="p-2">{f.value} {f.unit}</td><td className="p-2">{f.origin}</td></tr>)}</tbody></table></div>
    <h3 className="font-semibold">Behavior, supported limits and Unknown</h3><ul className="list-disc space-y-2 pl-5 text-sm">{review.assumptions.map((s) => <li key={s}>{s}</li>)}</ul>
    <p className="text-sm">Identities: caller {draft.callerAddress} → VM {draft.vmAddress} → objects {draft.objectAddress}; zone {draft.zone}. Plain TCP is explicit.</p>
    <h3 className="font-semibold">Recorded object schedule</h3><ul className="space-y-2 text-sm">{draft.commands.length ? draft.commands.map((c, i) => <li key={i}>{c.at} us: {c.kind} {c.namespace}/{c.key}{c.kind === "put" ? `, ${c.bytes} bytes, content “${c.content}”` : ""}</li>) : <li>No recorded object commands.</li>}</ul>
    <p className="text-sm">{draft.crash ? `Object-process crash at ${draft.crashAt} us for ${draft.crashDuration} us; restart ${draft.restart} us. Logical retention only.` : "No process fault scheduled."}</p>
    <details><summary className="cursor-pointer text-sm underline">Inspect exact generated contract and workload</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all p-3 text-xs">{JSON.stringify(review.request, null, 2)}</pre></details>
    {pending ? <p role="status">The prior submission outcome is uncertain. Retrying preserves its exact request and idempotency key, including after refresh. Do not create a replacement request.</p> : <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I reviewed this saved revision, every authored value, command, assumption and Unknown. Execute only this internal scenario.</label>}
    <div className="flex flex-wrap gap-3"><Button variant="primary" loading={busy} disabled={!pending && !confirmed} onClick={submit}>{pending ? "Retry exact submission" : "Execute reviewed Model-2 run"}</Button><Button disabled={busy || pending} onClick={edit}>Back to edit</Button></div>
  </section>;
}

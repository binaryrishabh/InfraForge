import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Field, Select } from "@/ui/Field";
import { Button } from "@/ui/Button";
import { Page, PageHeader, Notice, Loading } from "@/ui/Page";
import { useAuthoring } from "./useAuthoring";
import { educationalExample } from "./draft";
import { AuthoringFields } from "./AuthoringFields";
import { ReviewPanel } from "./ReviewPanel";
import { InternalReport } from "./InternalReport";
function Workspace({ owner }: { owner: string }) {
  const [query, setQuery] = useSearchParams(), [reportDenied, setReportDenied] = useState(false);
  const onRun = useCallback((id: string) => setQuery({ run: id }), [setQuery]);
  const state = useAuthoring(owner, onRun), errorFocus = useRef<HTMLDivElement>(null), reviewFocus = useRef<HTMLDivElement>(null);
  const blocked = useCallback(() => setReportDenied(true), []);
  const selected = state.designs.find((d) => d.id === state.saved.design), run = query.get("run");
  useEffect(() => { if (state.message || state.errors.length) errorFocus.current?.focus(); }, [state.message, state.errors]);
  useEffect(() => { if (state.saved.review) reviewFocus.current?.focus(); }, [state.saved.review]);
  if (state.loading) return <Page><Loading label="Checking internal workspace authorization…" /></Page>;
  if (state.denied || reportDenied) return <Page><Notice tone="fail" role="alert">Internal workspace unavailable for this session. Sign in with an explicitly granted account. No grant control is available here.</Notice><Link className="mt-4 block underline" to="/home">Return home</Link></Page>;
  return <Page>
    <PageHeader eyebrow="Model 2 · INTERNAL" title="Author, review and execute." lede="One saved VM and atomic current-object store. Model 1 remains active for normal runs. Production is parked." />
    <Notice>Authored educational simulation only. Physical throughput, cloud timing, reliability and full pricing remain Unknown. Saved designs are never rewritten here.</Notice>
    <div ref={errorFocus} tabIndex={-1} className="my-4 outline-none" aria-live="polite">{state.message && <Notice tone="fail" role="alert">{state.message}</Notice>}{state.errors.length > 0 && <Notice tone="fail" role="alert"><p className="font-semibold">Server validation refused this input. Correct these fields:</p><ul className="list-disc pl-5">{state.errors.map((e, i) => <li key={i}><strong>{e.path}</strong> · {e.code}: {e.message}</li>)}</ul></Notice>}</div>
    {state.saved.review ? <div ref={reviewFocus} tabIndex={-1} className="outline-none"><ReviewPanel key={state.saved.review.requestHash} review={state.saved.review} draft={state.saved.draft} pending={state.saved.pending} busy={state.busy} submit={() => { void state.submit(); }} edit={state.edit} /></div> : <form noValidate onSubmit={(e) => { e.preventDefault(); void state.validate(); }} className="space-y-6">
      <fieldset disabled={state.busy} className="space-y-6">
        <Field label="Saved infrastructure design" hint="Up to 100 of your latest designs. Support assessment is a structural precheck; server compilation is authoritative.">{({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={state.saved.design} onChange={(e) => state.update(state.saved.draft, e.target.value)}><option value="">Choose a saved design</option>{state.designs.map((d) => <option value={d.id} key={d.id}>{d.name} — {d.supported ? "supported shape" : "unsupported"}</option>)}</Select>}</Field>
        <div className="flex flex-wrap gap-3"><Button size="sm" onClick={() => { void state.refresh(); }}>Refresh saved revisions</Button><Link className="self-center text-sm underline" to="/designs">Manage saved designs</Link></div>
        {selected && <Notice tone={selected.supported ? "info" : "fail"}>{selected.supported ? `Supported authored shape: ${selected.vm} → ${selected.objects}, TCP port ${selected.port}. Review exact saved revision ${selected.updatedAt}.` : selected.reasons.join(" ")}</Notice>}
        <details className="rounded-md border border-line p-4"><summary className="cursor-pointer font-medium">Need an explicit authored starting point?</summary><p className="my-3 text-sm text-ink-3">The educational example fills visible fields only after your action. It models an authored 40,000 us scenario, no provider calibration. It never creates or edits your saved design. Review every value; its listener is 8080.</p><Button size="sm" onClick={() => state.update(educationalExample())}>Load authored educational example</Button></details>
        <AuthoringFields draft={state.saved.draft} change={state.update} errors={state.errors} />
      </fieldset>
      <p className="text-sm text-ink-3">Edits and uncertain submissions are stored in this tab for this account. No request is submitted on refresh. Validation is read-only. An unresolved submission must be retried with its original key.</p>
      <Button type="submit" variant="primary" loading={state.busy} disabled={!selected?.supported}>Validate and review on server</Button>
    </form>}
    <section className="mt-10 border-t border-line pt-6" aria-label="Internal run history"><h2 className="text-xl font-semibold">Your internal runs</h2><p className="my-2 text-sm text-ink-3">Latest 20 retained runs. No automatic history polling.</p><Button size="sm" onClick={() => { void state.refresh(); }}>Refresh internal history</Button>
      {state.runs.length === 0 ? <p className="mt-3 text-sm">No internal runs are listed.</p> : <ul className="mt-3 divide-y divide-line">{state.runs.map((r) => <li key={r.id} className="py-3"><Link className="break-all text-sm underline" to={`?run=${encodeURIComponent(r.id)}`}>{r.id}</Link><p className="text-sm text-ink-3">{r.status} · capture {r.sequence} · through {r.throughUs} us</p></li>)}</ul>}
    </section>
    {run && <InternalReport key={run} id={run} blocked={blocked} />}
  </Page>;
}
export function InternalWorkspace() {
  const owner = useAuthStore((s) => s.user?.id);
  return owner ? <Workspace key={owner} owner={owner} /> : null;
}

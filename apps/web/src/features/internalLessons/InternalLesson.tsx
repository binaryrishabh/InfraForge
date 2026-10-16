import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { phases } from "@infraforge/contracts/internal-lessons";
import type { ReadPhase } from "@infraforge/contracts/internal-lessons";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Page, PageHeader, Notice, Loading } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Field, Select } from "@/ui/Field";
import { InternalReport } from "@/features/internalModel2/InternalReport";
import { useLesson } from "./useLesson";
import { LessonReview } from "./LessonReview";
import { LessonHistory } from "./LessonHistory";
function Lesson({ owner }: { owner: string }) {
  const [query, setQuery] = useSearchParams(), [blocked, setBlocked] = useState(false), focus = useRef<HTMLDivElement>(null);
  const onRun = useCallback((id: string) => setQuery({ run: id }), [setQuery]), denied = useCallback(() => setBlocked(true), []);
  const state = useLesson(owner, onRun), selected = state.workspace?.designs.find((d) => d.id === state.saved.design), run = query.get("run");
  useEffect(() => { if (state.saved.review || state.message) focus.current?.focus(); }, [state.saved.review, state.message]);
  if (blocked || state.denied) return <Page><Notice tone="fail" role="alert">This internal lesson is unavailable for your session. An operator must grant access separately.</Notice></Page>;
  if (!state.workspace && !state.message) return <Page><Loading label="Checking lesson access…" /></Page>;
  return <Page>
    <PageHeader eyebrow="Model 2 · INTERNAL preview candidate" title="Will your read survive a process restart?" lede="Write one current object, restart its process, and inspect a recorded read. Choose when the read happens." />
    <Notice>Model 1 ACTIVE · Model 2 INTERNAL · production PARKED. This authored lesson models logical state retention. Physical durability remains Unknown.</Notice>
    <div ref={focus} tabIndex={-1} className="my-5 outline-none" aria-live="polite">{state.message && <Notice tone="fail" role="alert">{state.message}</Notice>}</div>
    {state.workspace && !state.workspace.configured && <Notice tone="fail">The isolated runner is unavailable. Review and execution are disabled until an operator provisions it.</Notice>}
    {state.saved.review ? <LessonReview key={state.saved.review.reviewHash} value={state.saved.review} pending={state.saved.pending} busy={state.busy} submit={() => { void state.submit(); }} edit={() => state.update({ review: null })} /> : <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void state.review(); }}>
      <fieldset disabled={state.busy} className="space-y-5">
        <Field label="Saved design">{({ id }) => <Select id={id} value={state.saved.design} onChange={(e) => state.update({ design: e.target.value })}><option value="">Select your lesson design</option>{state.workspace?.designs.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.supported ? "supported" : "unsupported"}</option>)}</Select>}</Field>
        <div className="flex flex-wrap gap-3"><Button onClick={() => { void state.create(); }}>Create lesson design</Button><Button onClick={() => { void state.refresh(); }}>Refresh designs and history</Button></div>
        <p className="text-sm">Creates one separate VM → object-store design for this account. Existing saved designs keep every field.</p>
        {selected && !selected.supported && <Notice tone="fail">{selected.reasons.join(" ")}</Notice>}
        <Field label="When should the read happen?">{({ id }) => <Select id={id} value={state.saved.phase} onChange={(e) => state.update({ phase: e.target.value as ReadPhase })}>{Object.entries(phases).map(([key, phase]) => <option key={key} value={key}>{phase.label}</option>)}</Select>}</Field>
      </fieldset>
      <Button type="submit" variant="primary" loading={state.busy} disabled={!selected?.supported || !state.workspace?.configured}>Review lesson</Button>
    </form>}
    <section aria-label="Lesson history" className="mt-8 space-y-3"><h2 className="text-xl font-semibold">Your retained runs</h2><LessonHistory value={state.runs} /></section>
    {state.workspace?.operator && <Link className="mt-5 block underline" to="/internal/model2">Open advanced internal authoring</Link>}
    {run && <InternalReport key={run} id={run} blocked={denied} />}
  </Page>;
}
export function InternalLesson() { const owner = useAuthStore((s) => s.user?.id); return owner ? <Lesson key={owner} owner={owner} /> : null; }

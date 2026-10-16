import { useCallback, useEffect, useRef, useState } from "react";
import { LESSON_VERSION } from "@infraforge/contracts/internal-lessons";
import type { LessonWorkspace } from "@infraforge/contracts/internal-lessons";
import type { RunSummary } from "@infraforge/contracts/internal-model2";
import * as api from "@/api/internalLesson.api";
import { internalError, internalRuns } from "@/api/internalModel2.api";
import { readLessonDraft, saveLessonDraft } from "./lessonDraft";
import type { LessonDraft } from "./lessonDraft";
export function useLesson(owner: string, onRun: (id: string) => void) {
  const [saved, setSaved] = useState(() => readLessonDraft(owner)), [workspace, setWorkspace] = useState<LessonWorkspace | null>(null), [runs, setRuns] = useState<RunSummary[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [denied, setDenied] = useState(false);
  const current = useRef(saved), lock = useRef(false), control = useRef(new AbortController()), mounted = useRef(false);
  const store = (value: LessonDraft, required = false) => {
    if (!saveLessonDraft(owner, value) && required) throw Error("Enable tab session storage before submitting so an uncertain request can be retried safely.");
    current.current = value; setSaved(value);
  };
  const fail = useCallback((error: unknown) => {
    const detail = internalError(error);
    if (mounted.current) { setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : detail.message); if (detail.denied) { setDenied(true); setWorkspace(null); setRuns([]); } }
    return detail;
  }, []);
  const refresh = useCallback(async () => {
    const [value, history] = await Promise.all([api.lessonWorkspace(control.current.signal), internalRuns(control.current.signal)]);
    if (mounted.current) { setWorkspace(value); setRuns(history); setDenied(false); }
  }, []);
  useEffect(() => { mounted.current = true; control.current = new AbortController(); void refresh().catch(fail); return () => { mounted.current = false; control.current.abort(); }; }, [refresh, fail]);
  const action = async (run: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage("");
    try { await run(); } catch (error) { fail(error); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const review = () => action(async () => {
    const selected = workspace?.designs.find((d) => d.id === current.current.design);
    if (!selected?.supported) throw Error("Select a supported owned design first.");
    const value = await api.reviewLesson({ schema: LESSON_VERSION, infrastructureId: selected.id, expectedDesignUpdatedAt: selected.updatedAt, phase: current.current.phase, idempotencyKey: crypto.randomUUID() }, control.current.signal);
    if (mounted.current) store({ ...current.current, review: value });
  });
  const submit = () => action(async () => {
    const snapshot = current.current;
    if (!snapshot.review) return;
    store({ ...snapshot, pending: true }, true);
    try {
      const result = await api.submitLesson({ ...snapshot.review.choice, reviewHash: snapshot.review.reviewHash }, control.current.signal);
      if (!mounted.current) return;
      store({ ...snapshot, pending: false, review: null, lastRun: result.id }, true); onRun(result.id); await refresh();
    } catch (error) { if (internalError(error).definitive && mounted.current) store({ ...snapshot, pending: false, review: null }); throw error; }
  });
  return { saved, workspace, runs, busy, denied, message, review, submit,
    update: (value: Partial<LessonDraft>) => { if (!lock.current && !current.current.pending) store({ ...current.current, ...value, review: null }); },
    refresh: () => action(refresh),
    create: () => action(async () => { const id = await api.createLessonDesign(control.current.signal); if (mounted.current && !current.current.pending) store({ ...current.current, design: id, review: null }); await refresh(); }) };
}

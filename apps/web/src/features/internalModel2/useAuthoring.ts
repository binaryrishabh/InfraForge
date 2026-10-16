import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthoringDraft, Diagnostic, InternalDesign, RunSummary } from "@infraforge/contracts/internal-model2";
import * as api from "@/api/internalModel2.api";
import { readDraft, saveDraft, type SavedDraft } from "./draft";
export function useAuthoring(owner: string, onRun: (id: string) => void) {
  const [saved, setSaved] = useState(() => readDraft(owner));
  const [designs, setDesigns] = useState<InternalDesign[]>([]), [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const [message, setMessage] = useState(""), [errors, setErrors] = useState<Diagnostic[]>([]);
  const lock = useRef(false), mounted = useRef(false), current = useRef(saved), requests = useRef(new AbortController());
  const store = useCallback((value: SavedDraft, required = false) => {
    if (!saveDraft(owner, value) && required) throw Error("Browser storage is unavailable. Enable session storage before submitting so an uncertain request can be retried safely.");
    current.current = value; setSaved(value);
  }, [owner]);
  const fail = useCallback((error: unknown) => {
    if (!mounted.current) return;
    const detail = api.internalError(error); setMessage(error instanceof Error && !('isAxiosError' in error) ? error.message : detail.message); setErrors(detail.diagnostics);
    if (detail.denied) { setDenied(true); setDesigns([]); setRuns([]); }
    return detail;
  }, []);
  const refresh = useCallback(async (signal = requests.current.signal) => {
    try { const [workspace, history] = await Promise.all([api.workspace(signal), api.internalRuns(signal)]);
      if (!signal.aborted && mounted.current) { setDesigns(workspace.designs); setRuns(history); setDenied(false); setMessage(""); }
    } catch (error) { if (!signal.aborted) fail(error); }
    finally { if (!signal.aborted && mounted.current) setLoading(false); }
  }, [fail]);
  useEffect(() => {
    mounted.current = true; const control = new AbortController(); requests.current = control; void refresh(control.signal);
    return () => { mounted.current = false; control.abort(); };
  }, [refresh]);
  const update = (draft: AuthoringDraft, design = saved.design) => { if (lock.current || current.current.pending) return; store({ ...current.current, draft, design, review: null }); setErrors([]); setMessage(""); };
  const validate = async () => {
    if (lock.current || current.current.pending) return;
    lock.current = true; setBusy(true); setMessage(""); setErrors([]);
    try {
      const selected = designs.find((d) => d.id === current.current.design);
      if (!selected) throw Error("Select a saved design, then complete the authored fields.");
      const review = await api.validateAuthoring({ infrastructureId: selected.id, expectedDesignUpdatedAt: selected.updatedAt, idempotencyKey: crypto.randomUUID(), authoring: current.current.draft }, requests.current.signal);
      if (mounted.current) store({ ...current.current, review });
    } catch (error) { fail(error); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = async () => {
    const snapshot = current.current;
    if (lock.current || !snapshot.review) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      store({ ...snapshot, pending: true }, true);
      const result = await api.admitInternal(snapshot.review.request, requests.current.signal);
      if (!mounted.current) return;
      store({ ...snapshot, pending: false, review: null, lastRun: result.id }, true);
      onRun(result.id); await refresh();
    } catch (error) {
      const detail = fail(error);
      if (detail?.definitive && mounted.current) store({ ...snapshot, pending: false, review: null });
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return { saved, designs, runs, loading, busy, denied, message, errors, update, validate, submit, refresh,
    edit: () => { if (!current.current.pending) store({ ...current.current, review: null }); } };
}

import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { PREDICTION_REASONING_MAX, type ChallengeBrief, type ChallengePreflight, type PredictionQuestion } from "@infraforge/contracts/challenges";
import { errorMessage } from "@/api/errorMessage";
import { describeWorkload } from "@/lib/format";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { Field, Textarea } from "@/ui/Field";
import { Notice } from "@/ui/Page";
import { cx } from "@/ui/cx";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { startAttempt } from "../startAttempt";
import { RequirementList } from "./RequirementList";
import { predictionChoices } from "../predictionChoices";

export function PredictionQuestionField({ question, index, value, onChange, designTypes }: { question: PredictionQuestion; index: number; value: string; onChange: (v: string) => void; designTypes: string[] }) {
  return (
    <fieldset className="rounded-md border border-line px-4 pt-3 pb-4">
      <legend className="px-1 text-sm font-semibold text-ink"><span className="if-num mr-1.5 text-ink-3">{index + 1}.</span>{question.prompt}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {predictionChoices(question, designTypes).map((choice) => (
          <label key={choice.value} className={cx("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
            value === choice.value ? "border-ink bg-marker-soft text-ink" : "border-line-strong text-ink-2 hover:border-ink-3")}>
            <input type="radio" name={`prediction-${question.id}`} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} className="accent-[var(--if-ink)]" />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* Predict before running. Answers are written with the attempt and cannot be
changed afterwards; they are compared with the recorded run but never affect
whether the requirements were met. */
export function AttemptDialog({ brief, preflight, open, onOpenChange }: { brief: ChallengeBrief; preflight: ChallengePreflight | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const resources = useCanvasStore((s) => s.resources);
  const saved = useCanvasStore((s) => s.currentLayoutSaved);
  const designTypes = [...new Set(resources.map((r) => r.type))];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reasoning, setReasoning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = (preflight?.valid ?? true) && resources.length > 0;
  const answered = brief.predictions.every((q) => predictionChoices(q, designTypes).some((c) => c.value === answers[q.id]));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!answered || !valid || busy) return;
    setBusy(true); setError(null);
    try {
      await startAttempt(brief, { answers, reasoning: reasoning.trim() || null });
      toast.success("Prediction locked. The attempt is starting.");
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "The attempt could not be started. Your prediction was not recorded."));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy} guarded size="lg" eyebrow={`Challenge · ${brief.title}`} title="Predict, then run"
      description="Commit to what you expect before the simulator runs. Your answers are locked when the attempt starts."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Keep designing</Button>
        <Button type="submit" form="attempt-form" variant="primary" loading={busy} disabled={!answered || !valid} icon={<Lock size={14} aria-hidden="true" />}>Lock prediction and run</Button>
      </>}>
      <form id="attempt-form" onSubmit={submit} className="flex flex-col gap-5">
        <section aria-labelledby="attempt-conditions" className="rounded-md bg-surface px-4 py-3">
          <h3 id="attempt-conditions" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Lock size={13} aria-hidden="true" /> Fixed for every attempt</h3>
          <p className="mt-1 text-sm text-ink-2">{describeWorkload(brief.workload)}. Evaluated at simulated second {brief.evaluationSeconds}; the run stops there automatically.</p>
          <p className="mt-1 text-xs text-ink-3">During the attempt only speed and stop are available: load, faults, scaling and live edits would change what is being judged.</p>
        </section>
        {!valid && <Notice tone="fail" title="The design cannot run yet">{preflight?.errors.join(" ") || "Add resources to the canvas first."}</Notice>}
        {preflight && (
          <details className="rounded-md border border-line px-4 py-2.5">
            <summary className="text-sm font-medium text-ink">Requirements and readiness</summary>
            <div className="mt-3"><RequirementList criteria={brief.criteria} checks={preflight.checks} compact /></div>
          </details>
        )}
        {brief.predictions.map((question, index) => (
          <PredictionQuestionField key={question.id} question={question} index={index} value={answers[question.id] ?? ""} designTypes={designTypes}
            onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))} />
        ))}
        <Field label="Why do you expect this?" optional hint={`${reasoning.length}/${PREDICTION_REASONING_MAX} characters. Shown next to the result.`}>
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={reasoning} maxLength={PREDICTION_REASONING_MAX} onChange={(e) => setReasoning(e.target.value)} rows={3} />}
        </Field>
        {!saved && <p className="text-xs text-ink-3">Unsaved canvas changes are saved to this challenge design first.</p>}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
      </form>
    </Dialog>
  );
}

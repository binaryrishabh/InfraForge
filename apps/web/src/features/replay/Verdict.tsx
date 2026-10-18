import { Check, Minus, X } from "lucide-react";
import type { ChallengeEvaluation } from "@infraforge/contracts/challenges";
import { cx } from "@/ui/cx";

const STATUS: Record<string, { word: string; tone: string }> = {
  met: { word: "Met", tone: "text-ok" },
  "not-met": { word: "Not met", tone: "text-fail" },
  "not-evaluated": { word: "Not judged", tone: "text-ink-2" },
  unavailable: { word: "Unavailable", tone: "text-ink-2" },
  "in-progress": { word: "Still running", tone: "text-ink-2" },
};

/* The two answers a learner looks for first, side by side and at the same size: did the
design meet the brief, and did the locked prediction match what was recorded. Neither
one changes the other. */
export function Verdict({ evaluation }: { evaluation: ChallengeEvaluation }) {
  const status = STATUS[evaluation.status] ?? STATUS.unavailable!;
  const matched = evaluation.predictions.filter((p) => p.outcome === "matched").length;
  const unknown = evaluation.predictions.filter((p) => p.outcome === "unknown").length;
  return (
    <div className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2">
      <section aria-label="Challenge result" className="bg-bg p-5">
        <p className="if-eyebrow">Your design</p>
        <p className={cx("if-display mt-2 text-[40px]", status.tone)}>{status.word}</p>
        <p className="mt-1 text-sm text-ink-2"><span className="if-num">{evaluation.metCount} of {evaluation.total}</span> requirements met at <span className="if-num">{evaluation.evaluationSeconds}s</span></p>
        <ul className="mt-4 space-y-1.5 text-sm">
          {evaluation.criteria.map((c) => (
            <li key={c.id} className="flex gap-2">
              <Mark status={c.status} />
              <span className={c.status === "not-met" ? "text-ink" : "text-ink-2"}>{c.label}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Prediction result" className="bg-bg p-5">
        <p className="if-eyebrow">Your prediction</p>
        <p className="if-display mt-2 text-[40px] text-accent"><span className="if-num">{matched}</span><span className="text-ink-3"> / </span><span className="if-num">{evaluation.predictions.length}</span></p>
        <p className="mt-1 text-sm text-ink-2">matched what was recorded{unknown ? ` · ${unknown} could not be checked` : ""}. Predictions never change the result.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {evaluation.predictions.map((p) => (
            <li key={p.id} className="flex gap-2">
              <Mark status={p.outcome === "matched" ? "met" : p.outcome === "different" ? "not-met" : "not-evaluated"} />
              <span className="min-w-0 text-ink-2">{p.prompt}<span className="mt-0.5 block text-ink">
                You said <strong className="font-semibold text-accent">{p.predicted}</strong> · recorded <strong className="font-semibold">{p.actual ?? "unknown"}</strong>
              </span></span>
            </li>
          ))}
        </ul>
        {evaluation.reasoning && <blockquote className="mt-4 border-l-2 border-accent pl-3 text-sm text-ink-2">“{evaluation.reasoning}”</blockquote>}
      </section>
    </div>
  );
}

function Mark({ status }: { status: string }) {
  const Icon = status === "met" ? Check : status === "not-met" ? X : Minus;
  return <Icon size={16} strokeWidth={2.4} aria-label={status === "met" ? "Met" : status === "not-met" ? "Not met" : "Not checked"}
    className={cx("mt-0.5 shrink-0", status === "met" ? "text-ok" : status === "not-met" ? "text-fail" : "text-ink-3")} />;
}

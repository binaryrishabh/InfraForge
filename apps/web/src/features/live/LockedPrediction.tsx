import { Lock } from "lucide-react";
import { PREDICTION_CHOICES, type ChallengeBrief, type ChallengePrediction } from "@infraforge/contracts/challenges";

const answerLabel = (brief: ChallengeBrief, id: string, value: string) => {
  const question = brief.predictions.find((q) => q.id === id);
  if (!question || question.kind === "busiest-type") return value;
  return PREDICTION_CHOICES[question.kind].find((c) => c.value === value)?.label ?? value;
};

/* The prediction recorded with this attempt. It cannot be edited; the result
compares against it after the evaluation second. */
export function LockedPrediction({ brief, prediction }: { brief: ChallengeBrief; prediction: ChallengePrediction }) {
  return (
    <section className="border-b border-line px-4 py-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Lock size={13} aria-hidden="true" /> Your prediction is locked</h3>
      <dl className="mt-3 flex flex-col gap-2.5">
        {brief.predictions.map((q) => (
          <div key={q.id}>
            <dt className="text-xs text-ink-3">{q.prompt}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-accent">{answerLabel(brief, q.id, prediction.answers[q.id] ?? "—")}</dd>
          </div>
        ))}
      </dl>
      {prediction.reasoning && <p className="mt-3 border-l-2 border-line-strong pl-2.5 text-sm italic text-ink-2">“{prediction.reasoning}”</p>}
    </section>
  );
}

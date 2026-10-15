import type { PredictionQuestion } from "@infraforge/contracts/challenges";
import { predictionPhases } from "../predictionChoices";

/* The questions a learner commits to. A resilience challenge separates what they
expect before the fault from what they expect while it is active. */
export function PredictionList({ predictions, postFault = false }: { predictions: PredictionQuestion[]; postFault?: boolean }) {
  const groups = predictionPhases(predictions);
  const list = (items: PredictionQuestion[]) => <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-2">{items.map((q) => <li key={q.id}>{q.prompt}</li>)}</ul>;
  if (!groups) return list(predictions);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div><h3 className="if-eyebrow mb-1.5">Before the fault</h3>{list(groups.before)}</div>
      <div><h3 className="if-eyebrow mb-1.5">{postFault ? "At post-fault evaluation" : "While it is active"}</h3>{list(groups.during)}</div>
    </div>
  );
}

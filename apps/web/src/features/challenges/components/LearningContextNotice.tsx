import { Link } from "react-router-dom";
import { useChallengeImprovement } from "../learningContext";

export function LearningContextNotice() {
  const context = useChallengeImprovement();
  if (!context) return null;
  return <aside aria-label="Your improvement experiment" className="flex shrink-0 items-baseline gap-3 border-b border-line bg-marker-soft px-4 py-2 text-[13px] text-ink">
    <Link className="shrink-0 font-semibold text-accent underline" to={`/runs/${context.sourceRunId}`}>Source attempt</Link>
    <p className="min-w-0 truncate" title={context.hypothesis}>Your hypothesis: {context.hypothesis}</p>
    <span className="ml-auto shrink-0 text-xs">Review changes → predict → run</span>
  </aside>;
}

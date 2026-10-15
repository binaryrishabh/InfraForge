import type { DesignChangeReview } from "@infraforge/contracts/reports";
import type { ChallengeImprovementContext } from "../learningContext";
import { DesignChangeSummary } from "./DesignChangeSummary";

export function ImprovementReview({ context, review, error, acceptedHash, onAccept }: { context: ChallengeImprovementContext; review: DesignChangeReview | null;
  error: string | null; acceptedHash: string | null; onAccept: (hash: string | null) => void }) {
  const consent = review?.classification === "no-change" || review?.classification === "several-changes";
  return <section aria-labelledby="learning-review" className="min-w-0 break-words rounded-md border border-line-strong p-4">
    <h3 id="learning-review" className="font-semibold">Review what changed</h3>
    <p className="mt-1 text-sm">Your hypothesis: {context.hypothesis}</p>
    <p className="mt-1 break-all text-xs text-ink-3">Compared with source attempt {context.sourceRunId}. Same challenge version {context.version}.</p>
    {review ? <>
      <p role="status" className="mt-3 text-sm font-semibold">{review.classification === "no-change" ? "No simulation-relevant change" : review.classification === "one-change" ? "One simulation-relevant change" : review.classification === "several-changes" ? "Several things changed" : "Changes cannot be verified"}</p>
      <DesignChangeSummary review={review} />
      {consent && <div className="mt-3">
        <p role="alert" className="text-sm text-warn">{review.classification === "no-change" ? "Nothing that affects this simulation changed. Keep editing, or deliberately run a repeat experiment." : "You changed several things. The next comparison will be harder to interpret."}</p>
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={acceptedHash === review.inputHash} onChange={(e) => onAccept(e.target.checked ? review.inputHash : null)} />{review.classification === "no-change" ? "Run an unchanged repeat, with a new prediction" : "Continue deliberately with these changes"}</label>
      </div>}
    </> : <p role={error ? "alert" : "status"} className="mt-2 text-sm">{error ?? "Checking the current design against the captured starting design…"}</p>}
    <p className="mt-3 text-xs text-ink-3">Answer again below. Your previous prediction is not copied.</p>
  </section>;
}

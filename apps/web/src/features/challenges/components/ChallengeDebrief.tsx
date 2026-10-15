import { Link } from "react-router-dom";
import { PREDICTION_CHOICES, type ChallengeBrief, type ChallengeEvaluation, type PredictionResult } from "@infraforge/contracts/challenges";
import { formatDate } from "@/lib/format";
import { StatusMark } from "@/ui/StatusMark";
import { cx } from "@/ui/cx";
import { RESULT_LABEL, EVIDENCE_LABEL } from "../challengeLabels";
import { ExperimentDebrief } from "./ExperimentDebrief";
import type { ExperimentTrace } from "@infraforge/contracts/reports";

const VERDICT: Record<ChallengeEvaluation["status"], string> = {
  met: "Every requirement was met.",
  "not-met": "Not every requirement was met.",
  "in-progress": "The attempt is still running.",
  "not-evaluated": "Some requirements could not be judged.",
  unavailable: "This attempt is not judged.",
};

function label(brief: ChallengeBrief | null, p: PredictionResult, value: string | null) {
  if (value === null) return "Not recorded";
  const kind = brief?.predictions.find((q) => q.id === p.id)?.kind;
  if (!kind || kind === "busiest-type") return value;
  return value.split(" / ").map((v) => PREDICTION_CHOICES[kind].find((c) => c.value === v)?.label ?? v).join(" / ");
}

// For a resilience challenge, which side of the fault a question was about.
function phase(brief: ChallengeBrief | null, p: PredictionResult) {
  if (!brief?.experiment) return null;
  return brief.predictions.find((q) => q.id === p.id)?.kind === "baseline-health" ? "Before the fault" :
    brief.experiment.postFaultObservationSeconds ? "At post-fault evaluation" : "While it was active";
}

function Sources({ sources }: { sources: string[] }) {
  return <p className="mt-1 text-xs text-ink-3">Evidence: {sources.map((s, i) => <span key={s} title={s}>{i ? ", " : ""}{EVIDENCE_LABEL[s] ?? s}</span>)}</p>;
}

/* Two separate verdicts. The challenge result says whether the design met its
requirements; the prediction says whether you foresaw what was recorded. A
failed design can carry an accurate prediction and the reverse. */
export function ChallengeDebrief({ evaluation, brief, trace }: { evaluation: ChallengeEvaluation; brief: ChallengeBrief | null; trace?: ExperimentTrace }) {
  const matched = evaluation.predictions.filter((p) => p.outcome === "matched").length;
  const briefLink = brief && brief.version < brief.latestVersion ? `/challenges/${evaluation.challengeId}?version=${brief.version}` : `/challenges/${evaluation.challengeId}`;
  return (
    <section aria-labelledby="debrief-title" className="mt-8">
      <p className="if-eyebrow">Judged against {evaluation.title}, version {evaluation.version}</p>
      <h2 id="debrief-title" className="sr-only">Challenge result and prediction</h2>
      <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-2">
        <div className="bg-raised p-5">
          <h3 className="if-eyebrow">Challenge result</h3>
          <p className="mt-2 flex items-center gap-2 text-[22px]"><StatusMark kind={evaluation.status} label={RESULT_LABEL[evaluation.status]} className="!text-[20px] if-title" /></p>
          <p className="mt-1 text-sm text-ink-2">{VERDICT[evaluation.status]} {evaluation.total > 0 && <span className="font-medium text-ink tabular-nums">{evaluation.metCount} of {evaluation.total} met.</span>}</p>
          <p className="mt-2 text-xs text-ink-3">{evaluation.statusDetail}</p>
        </div>
        <div className="bg-raised p-5">
          <h3 className="if-eyebrow">Your prediction</h3>
          <p className="if-title mt-2 text-[20px] text-ink">{evaluation.predictions.length ? `${matched} of ${evaluation.predictions.length} matched` : "Not compared"}</p>
          <p className="mt-1 text-sm text-ink-2">Locked {evaluation.predictionSubmittedAt ? formatDate(evaluation.predictionSubmittedAt) : "at the start of the attempt"}. It does not change the challenge result.</p>
          {evaluation.reasoning && <p className="mt-2 border-l-2 border-line-strong pl-2.5 text-sm italic text-ink-2">“{evaluation.reasoning}”</p>}
        </div>
      </div>

      {evaluation.experiment && <ExperimentDebrief experiment={evaluation.experiment} evaluationSeconds={evaluation.evaluationSeconds} trace={trace} showTrace={evaluation.status !== "in-progress"} />}

      {evaluation.criteria.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[15px] font-semibold text-ink">Requirements, judged at second {evaluation.evaluationSeconds}</h3>
          <ol className="mt-2 divide-y divide-line border-y border-line">
            {evaluation.criteria.map((c, i) => (
              <li key={c.id} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_10rem]">
                <span className="if-num text-xs text-ink-3">{i + 1}.</span>
                <div className="min-w-0"><p className="text-[15px] text-ink">{c.label}</p><p className="mt-0.5 text-sm text-ink-2">{c.detail}</p><Sources sources={c.sources} /></div>
                <div className="sm:text-right"><StatusMark kind={c.status} /></div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {evaluation.predictions.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[15px] font-semibold text-ink">Prediction against the record</h3>
          {/* Narrow screens: one short list per prediction. Wider: the same facts as a table. */}
          <ul className="mt-2 divide-y divide-line rounded-md border border-line sm:hidden">
            {evaluation.predictions.map((p) => (
              <li key={p.id} className="px-3 py-3 text-sm">
                {phase(brief, p) && <p className="if-eyebrow mb-1">{phase(brief, p)}</p>}
                <p className="text-ink">{p.prompt}</p>
                <p className="mt-0.5 text-xs text-ink-3">{p.detail}</p>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
                  <dt className="text-xs text-ink-3">You predicted</dt>
                  <dd><span className="rounded-xs bg-marker px-1.5 font-semibold text-[#17191D]">{label(brief, p, p.predicted)}</span></dd>
                  <dt className="text-xs text-ink-3">Recorded</dt>
                  <dd className={cx("font-semibold", p.actual === null ? "text-ink-3" : "text-ink")}>{label(brief, p, p.actual)}</dd>
                  <dt className="text-xs text-ink-3">Outcome</dt>
                  <dd><StatusMark size="sm" kind={p.outcome} /></dd>
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-2 overflow-hidden rounded-md border border-line max-sm:hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">Each prediction beside the recorded value</caption>
              <thead className="bg-surface text-left text-xs text-ink-3">
                <tr><th scope="col" className="px-3 py-2 font-medium">Question</th><th scope="col" className="px-3 py-2 font-medium">You predicted</th><th scope="col" className="px-3 py-2 font-medium">Recorded</th><th scope="col" className="px-3 py-2 font-medium">Outcome</th></tr>
              </thead>
              <tbody>
                {evaluation.predictions.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <th scope="row" className="px-3 py-2.5 text-left font-normal text-ink">{phase(brief, p) && <span className="if-eyebrow mb-0.5 block">{phase(brief, p)}</span>}{p.prompt}<span className="mt-0.5 block text-xs text-ink-3">{p.detail}</span></th>
                    <td className="px-3 py-2.5"><span className="rounded-xs bg-marker px-1.5 font-semibold text-[#17191D]">{label(brief, p, p.predicted)}</span></td>
                    <td className={cx("px-3 py-2.5 font-semibold", p.actual === null ? "text-ink-3" : "text-ink")}>{label(brief, p, p.actual)}</td>
                    <td className="px-3 py-2.5"><StatusMark size="sm" kind={p.outcome} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {evaluation.inspectNext.length > 0 && (
          <div><h3 className="text-[15px] font-semibold text-ink">Inspect next</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{evaluation.inspectNext.map((s) => <li key={s}>{s}</li>)}</ul></div>
        )}
        {brief?.debrief && (
          <div><h3 className="text-[15px] font-semibold text-ink">Why the model behaves this way</h3><div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">{brief.debrief.map((p) => <p key={p}>{p}</p>)}</div></div>
        )}
      </div>
      {evaluation.experiment && <p className="mt-6 max-w-[70ch] text-sm text-ink-2">Every new attempt runs the same experiment: the same fault, target, second, workload and seed. Change the design, predict again, and compare the two attempts.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link to={briefLink} className="text-sm font-medium text-accent hover:underline">Brief and all attempts</Link>
      </div>
    </section>
  );
}

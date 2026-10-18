import type { RunReport } from "@infraforge/contracts/reports";
import { BeginImprovement } from "@/features/challenges/components/BeginImprovement";

/* The loop closes here: having seen what was recorded, write down what you will change
and why, then run the same experiment again. The pointers come from the server's reading
of the record; the browser adds no advice of its own. */
export function NextExperiment({ report }: { report: RunReport }) {
  const evaluation = report.challenge!;
  return (
    <section aria-labelledby="next-title" className="mt-6 grid gap-6 border border-line bg-surface p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div>
        <h2 id="next-title" className="if-title text-[22px] text-ink">Change one thing, then run it again</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-ink-2">The next attempt keeps the same workload, the same {evaluation.experiment ? "fault at the same second" : "evaluation second"} and the same seed, so the difference you see comes from your change.</p>
        {evaluation.inspectNext.length > 0 && <ul className="mt-3 space-y-1 text-sm text-ink-2">
          {evaluation.inspectNext.map((s) => <li key={s} className="flex gap-2"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 bg-accent" />{s}</li>)}
        </ul>}
      </div>
      <div className="md:pb-1"><BeginImprovement report={report} /></div>
    </section>
  );
}

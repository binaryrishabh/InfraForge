import type { ExperimentResult } from "@infraforge/contracts/challenges";
import { StatusMark } from "@/ui/StatusMark";
import { faultLabel } from "../experiment";

const STATE = {
  scheduled: { kind: "pending", label: "Scheduled" },
  active: { kind: "in-progress", label: "Applied" },
  ended: { kind: "finished", label: "Applied; fault window ended" },
  "not-applied": { kind: "not-evaluated", label: "Not applied" },
} as const;
const health = (value: string | null) => value ? value[0]!.toUpperCase() + value.slice(1) : "Not recorded";

/* What InfraForge did to the design and what is recorded about it. Only the
intervention is stated; nothing here claims why the rest of the system behaved
as it did, or that it recovered. */
export function ExperimentDebrief({ experiment, evaluationSeconds }: { experiment: ExperimentResult; evaluationSeconds: number }) {
  const state = STATE[experiment.state];
  return (
    <div className="mt-6">
      <h3 className="text-[15px] font-semibold text-ink">The experiment</h3>
      <div className="mt-2 rounded-md border border-line bg-raised p-4">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-[15px] font-semibold text-ink">{faultLabel(experiment.fault)} on {experiment.targetResourceId}</span>
          <StatusMark size="sm" kind={state.kind} label={state.label} /></p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-xs text-ink-3">Target</dt><dd className="text-ink">{experiment.targetResourceId} <span className="text-ink-3">· {experiment.targetType}</span></dd></div>
          <div><dt className="text-xs text-ink-3">Scheduled for</dt><dd className="if-num text-ink">second {experiment.atSimulatedSecond}</dd></div>
          <div><dt className="text-xs text-ink-3">Applied at</dt><dd className="if-num text-ink">{experiment.appliedSimulatedSeconds === null ? "not applied" : `second ${experiment.appliedSimulatedSeconds}`}</dd></div>
          <div><dt className="text-xs text-ink-3">Active for</dt><dd className="if-num text-ink">{experiment.durationSimulatedSeconds} simulated seconds <span className="font-sans text-ink-3">(the model's duration)</span></dd></div>
          <div><dt className="text-xs text-ink-3">Fault window ended</dt><dd className="if-num text-ink">{experiment.endedSimulatedSeconds === null ? "not recorded" : `second ${experiment.endedSimulatedSeconds}`}</dd></div>
          <div><dt className="text-xs text-ink-3">Overall health when applied</dt><dd className="text-ink">{health(experiment.baselineOverallHealth)}</dd></div>
          <div><dt className="text-xs text-ink-3">{experiment.targetResourceId} at second {evaluationSeconds}</dt><dd className="text-ink">{health(experiment.targetHealthAtEvaluation)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-ink-2">{experiment.detail}</p>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-[13px] font-semibold text-ink">Evidence</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>The fault is a durable action, listed under Actions in this report and marked as the challenge experiment, with the second it was requested, applied and closed.</li>
            <li>The state at second {evaluationSeconds} is the exact terminal snapshot captured when the attempt stopped.</li>
            <li>The design, workload and seed are the inputs captured when the attempt was created.</li>
          </ul>
        </div>
        <div>
          <h4 className="text-[13px] font-semibold text-ink">What this experiment cannot show</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>How the system moved between second {experiment.atSimulatedSecond} and second {evaluationSeconds}: only the moment of the fault and the final state are kept, not a continuous series.</li>
            <li>Recovery. A fault window ending says the model stopped applying the fault, not that anything recovered.</li>
            <li>A production or real-cloud result. InfraForge's simulator is an educational model with fixed rules.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

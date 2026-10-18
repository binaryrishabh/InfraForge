import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { ExperimentTimeline } from "@/features/challenges/components/ExperimentTimeline";
import { experimentPhase, type ExperimentPlan } from "@/features/challenges/experiment";

/* The resilience attempt's schedule under the run bar: where the simulated clock
is relative to the baseline, the scheduled fault and the judging second. */
export function ExperimentStrip({ plan, evaluationSeconds, compact = false }: { plan: ExperimentPlan; evaluationSeconds: number; compact?: boolean }) {
  const seconds = useSimulationStore((s) => s.simulatedSeconds);
  const active = useSimulationStore((s) => s.activeChaos.find((c) => c.resourceId === plan.target && c.chaosType === plan.fault));
  const phase = experimentPhase(plan, seconds, active, evaluationSeconds);
  // With the timetable open, the schedule is already drawn there; the strip keeps only the sentence.
  if (compact) return (
    <section aria-label="Experiment" className="shrink-0 border-b border-line bg-surface px-3 py-2 sm:px-4">
      <p className={phase.kind === "active" ? "text-sm font-semibold text-fail" : "text-sm text-ink-2"}><span className="if-num font-normal text-ink-3">Now {Math.min(seconds, evaluationSeconds)} s · </span>{phase.message}</p>
    </section>
  );
  return (
    <section aria-label="Experiment" className="shrink-0 border-b border-line bg-surface px-3 pt-1 pb-2.5 sm:px-4">
      <ExperimentTimeline plan={plan} evaluationSeconds={evaluationSeconds} seconds={seconds} phase={phase} className="mx-auto max-w-[900px]" />
    </section>
  );
}

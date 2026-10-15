import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { ExperimentTimeline } from "@/features/challenges/components/ExperimentTimeline";
import { experimentPhase, type ExperimentPlan } from "@/features/challenges/experiment";

/* The resilience attempt's schedule under the run bar: where the simulated clock
is relative to the baseline, the scheduled fault and the judging second. */
export function ExperimentStrip({ plan, evaluationSeconds }: { plan: ExperimentPlan; evaluationSeconds: number }) {
  const seconds = useSimulationStore((s) => s.simulatedSeconds);
  const active = useSimulationStore((s) => s.activeChaos.find((c) => c.resourceId === plan.target && c.chaosType === plan.fault));
  return (
    <section aria-label="Experiment" className="shrink-0 border-b border-line bg-surface px-3 pt-1 pb-2.5 sm:px-4">
      <ExperimentTimeline plan={plan} evaluationSeconds={evaluationSeconds} seconds={seconds} phase={experimentPhase(plan, seconds, active, evaluationSeconds)} className="mx-auto max-w-[900px]" />
    </section>
  );
}

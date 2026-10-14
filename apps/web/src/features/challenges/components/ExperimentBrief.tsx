import type { ChallengeExperiment } from "@infraforge/contracts/challenges";
import { StatusMark } from "@/ui/StatusMark";
import { faultLabel, planOf } from "../experiment";
import { ExperimentTimeline } from "./ExperimentTimeline";

/* What a resilience challenge will do, stated before anything runs: the hypothesis
to predict against, the schedule and the one resource that must stay in the design. */
export function ExperimentBrief({ experiment, evaluationSeconds, readiness, compact = false }: {
  experiment: ChallengeExperiment; evaluationSeconds: number; readiness?: { ready: boolean; detail: string } | null; compact?: boolean;
}) {
  const plan = planOf(experiment);
  return (
    <div>
      <p className={compact ? "text-sm text-ink" : "text-[15px] leading-relaxed text-ink"}>{experiment.hypothesis}</p>
      <ExperimentTimeline plan={plan} evaluationSeconds={evaluationSeconds} className="mt-1" />
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        InfraForge applies the {faultLabel(plan.fault).toLowerCase()} itself, at exactly second {plan.at}, to <span className="if-num text-ink-2">{plan.target}</span> ({plan.targetType}) from the starter.
        Keep {plan.target} in your design and connected; if it is missing the experiment cannot run, and nothing else is chosen in its place.
      </p>
      {readiness && <div className="mt-2"><StatusMark size="sm" kind={readiness.ready ? "ok" : "problem"} label={readiness.ready ? `${plan.target} is ready for the experiment` : readiness.detail} /></div>}
    </div>
  );
}

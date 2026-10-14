import type { ChallengeCriterion, PreflightCheck } from "@infraforge/contracts/challenges";
import { StatusMark } from "@/ui/StatusMark";

/* Requirements as authored. In the designer, each carries its readiness state:
ready, needs work, or only checkable once the attempt runs. */
export function RequirementList({ criteria, checks, compact = false }: { criteria: ChallengeCriterion[]; checks?: PreflightCheck[] | null; compact?: boolean }) {
  return (
    <ol className="flex flex-col gap-2">
      {criteria.map((criterion, index) => {
        const check = checks?.find((c) => c.id === criterion.id);
        return (
          <li key={criterion.id} className="grid grid-cols-[1.5rem_1fr] gap-x-1">
            <span className="if-num pt-0.5 text-xs text-ink-3">{index + 1}.</span>
            <div className="min-w-0">
              <p className={compact ? "text-[13px] text-ink" : "text-sm text-ink"}>{criterion.label}</p>
              {check && <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2"><StatusMark size="sm" kind={check.status} /><span className="text-xs text-ink-3">{check.detail}</span></div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

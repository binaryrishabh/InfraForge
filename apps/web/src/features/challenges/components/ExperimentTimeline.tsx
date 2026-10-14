import { cx } from "@/ui/cx";
import { faultLabel, type ExperimentPhase, type ExperimentPlan } from "../experiment";

const ANNOUNCE: Record<ExperimentPhase["kind"], (plan: ExperimentPlan) => string> = {
  baseline: () => "Baseline running.",
  waiting: (p) => `${faultLabel(p.fault)} on ${p.target} is due.`,
  active: (p) => `${faultLabel(p.fault)} on ${p.target} is now active.`,
  ended: (p) => `Fault ended at second ${p.at + p.duration}.`,
};

/* Baseline, the scheduled fault and the judging second on one short track. The
ordered list carries the plan for every reader; the track only draws it. With a
live clock it marks the current simulated second and states the phase in words. */
export function ExperimentTimeline({ plan, evaluationSeconds, seconds, phase, className }: {
  plan: ExperimentPlan; evaluationSeconds: number; seconds?: number; phase?: ExperimentPhase; className?: string;
}) {
  const end = Math.max(evaluationSeconds, plan.at + plan.duration, 1);
  const pct = (s: number) => `${(Math.min(Math.max(s, 0), end) / end) * 100}%`;
  const now = seconds === undefined ? null : Math.min(seconds, end);
  const label = `${faultLabel(plan.fault)} on ${plan.target}`;
  const step = phase ? (phase.kind === "baseline" ? 0 : phase.kind === "ended" ? 2 : 1) : null;
  const marks = [{ s: 0, align: "left" }, { s: plan.at, align: "center" }, { s: evaluationSeconds, align: "right" }] as const;
  return (
    <figure className={cx("w-full", className)}>
      <figcaption className="sr-only">Experiment timeline in simulated seconds</figcaption>
      <div aria-hidden="true" className="relative mx-1 mt-5 h-3">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
        <div className="absolute top-0 h-3 rounded-sm border border-fail/60 bg-fail-soft [background-image:repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_srgb,var(--if-fail)_18%,transparent)_4px_6px)]"
          style={{ left: pct(plan.at), width: pct(plan.duration) }} />
        {now !== null && <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent" style={{ width: pct(now) }} />}
        {marks.map((m) => (
          <span key={m.align} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-2" style={{ left: pct(m.s) }}>
            <span className={cx("if-num absolute bottom-full mb-1 text-[11px] whitespace-nowrap text-ink-2",
              m.align === "left" ? "left-0" : m.align === "right" ? "right-0" : "left-1/2 -translate-x-1/2")}>{m.s} s</span>
          </span>
        ))}
        {now !== null && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-raised bg-accent" style={{ left: pct(now) }} />}
      </div>
      {/* From the small breakpoint the legend's columns follow the track's segments. */}
      {/* While live on a phone the track and the phase sentence carry it; the list stays for screen readers. */}
      <ol className={cx("mt-3 grid gap-x-3 gap-y-1 text-xs sm:[grid-template-columns:var(--if-legend)]", phase && "max-sm:sr-only")}
        style={{ ["--if-legend" as string]: `minmax(0,${plan.at}fr) minmax(0,${Math.max(end - plan.at, 1)}fr)` }}>
        <li aria-current={step === 0 ? "step" : undefined} className={cx(step === 0 && "font-semibold")}>
          <span className="text-ink">Baseline</span> <span className="if-num whitespace-nowrap text-ink-3">0–{plan.at} s</span>
        </li>
        <li aria-current={step === 1 ? "step" : undefined} className={cx(step === 1 && "font-semibold")}>
          <span className="text-fail">{label}</span> <span className="if-num whitespace-nowrap text-ink-3">{plan.at}–{plan.at + plan.duration} s</span>
        </li>
        <li aria-current={step === 2 ? "step" : undefined} className={cx("sm:col-span-2 sm:text-right", step === 2 && "font-semibold")}>
          <span className="text-ink">Judged at <span className="if-num">{evaluationSeconds} s</span></span>
          {evaluationSeconds === plan.at + plan.duration && <span className="text-ink-3">, the fault's last second</span>}
        </li>
      </ol>
      {phase && <>
        <p className={cx("mt-2 text-sm", phase.kind === "active" ? "font-semibold text-fail" : "text-ink-2")}>
          {now !== null && <span className="if-num text-ink-3">Now {now} s · </span>}{phase.message}
        </p>
        {/* Announced once per phase, not every second. */}
        <p aria-live="polite" className="sr-only">{ANNOUNCE[phase.kind](plan)}</p>
      </>}
    </figure>
  );
}

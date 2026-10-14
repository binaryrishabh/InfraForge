import type { ChallengeExperiment, RecordedExperiment } from "@infraforge/contracts/challenges";
import type { ChaosEffect } from "@infraforge/contracts/telemetry";
import { FAULTS } from "@/features/live/faults";

export const faultLabel = (fault: string) => FAULTS.find((f) => f.id === fault)?.label ?? fault;
export const faultSeconds = (fault: string) => FAULTS.find((f) => f.id === fault)?.seconds ?? 0;

// The same shape for an authored experiment (a brief) and a recorded one (a run).
export interface ExperimentPlan { fault: string; at: number; duration: number; target: string; targetType: string }
export const planOf = (e: ChallengeExperiment): ExperimentPlan =>
  ({ fault: e.fault, at: e.atSimulatedSecond, duration: faultSeconds(e.fault), target: e.target.resourceId, targetType: e.target.type });
export const recordedPlan = (e: RecordedExperiment): ExperimentPlan =>
  ({ fault: e.fault, at: e.atSimulatedSecond, duration: e.durationSimulatedSeconds, target: e.targetResourceId, targetType: e.targetType });

export type ExperimentPhaseKind = "baseline" | "active" | "waiting" | "ended";
export interface ExperimentPhase { kind: ExperimentPhaseKind; remaining: number | null; message: string }

/* Where a live resilience attempt stands, from the simulated clock and the fault the
simulator reports as active. Text first; any animation only repeats it. A fault
window closing is "fault ended", never "recovered". */
export function experimentPhase(plan: ExperimentPlan, seconds: number, active: ChaosEffect | undefined): ExperimentPhase {
  const what = `${faultLabel(plan.fault)} on ${plan.target}`;
  const end = plan.at + plan.duration;
  if (active) return { kind: "active", remaining: active.remainingTicks,
    message: `${what} active · ${active.remainingTicks} simulated ${active.remainingTicks === 1 ? "second" : "seconds"} remaining` };
  if (seconds >= end) return { kind: "ended", remaining: 0, message: `Fault ended at second ${end} (${what})` };
  if (seconds >= plan.at) return { kind: "waiting", remaining: null, message: `${what} is due; waiting for the simulator to record it` };
  return { kind: "baseline", remaining: plan.at - seconds, message: `Baseline · ${what} scheduled at second ${plan.at}, in ${plan.at - seconds} simulated seconds` };
}

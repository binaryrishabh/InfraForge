import type { ChallengeDifficulty, ChallengeStatus } from "@infraforge/contracts/challenges";
import type { StatusKind } from "@/ui/status";

export const DIFFICULTY_LABEL: Record<ChallengeDifficulty, string> = { starter: "Starter", core: "Core", advanced: "Advanced" };

export const RESULT_LABEL: Record<ChallengeStatus, string> = {
  met: "All requirements met",
  "not-met": "Not met yet",
  "in-progress": "Attempt running",
  "not-evaluated": "Not evaluated",
  unavailable: "Recorded under other rules",
};

export const statusKind = (status: ChallengeStatus | null | undefined): StatusKind => status ?? "not-started";

/** What a brief's evaluation note adds beyond the second itself, e.g. "After the ramp to full traffic." */
export function evaluationContext(note: string, seconds: number) {
  const lead = `Checked at simulated second ${seconds}`;
  const rest = (note.startsWith(lead) ? note.slice(lead.length).replace(/^[,.]\s*/, "") : note).trim();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : "";
}

/** Readable names for the recorded evidence a verdict was judged on. */
export const EVIDENCE_LABEL: Record<string, string> = {
  runInputs: "the design as submitted",
  "runInputs.resources": "submitted resources",
  "runInputs.connectionLines": "submitted connections",
  stages: "recorded gates",
  "stages.SecurityScan": "security scan",
  "stages.SecurityScan.issues": "security scan findings",
  "stages.CostEstimate": "cost estimate",
  "stages.CostEstimate.monthlyEstimate": "monthly cost estimate",
  terminalSnapshot: "final snapshot",
  "terminalSnapshot.metrics": "final resource measurements",
  "terminalSnapshot.overallHealth": "final overall health",
  "terminalSnapshot.installedSkus": "final instance sizes",
  "terminalSnapshot.pools": "final pool sizes",
  timeline: "run timeline",
};

export type StatusKind =
  | "met" | "not-met" | "in-progress" | "not-evaluated" | "unavailable" | "not-started" | "pending"
  | "matched" | "different" | "unknown" | "ok" | "problem" | "during-run" | "finished" | "failed";

export const STATUS: Record<StatusKind, { label: string; tone: string }> = {
  met: { label: "Met", tone: "text-ok" },
  "not-met": { label: "Not met", tone: "text-fail" },
  "in-progress": { label: "In progress", tone: "text-accent" },
  "not-evaluated": { label: "Not evaluated", tone: "text-ink-3" },
  unavailable: { label: "Not judged", tone: "text-ink-3" },
  "not-started": { label: "Not started", tone: "text-ink-3" },
  pending: { label: "Waiting", tone: "text-accent" },
  matched: { label: "Matched", tone: "text-ok" },
  different: { label: "Different", tone: "text-hot" },
  unknown: { label: "Unknown", tone: "text-ink-3" },
  ok: { label: "Ready", tone: "text-ok" },
  problem: { label: "Needs work", tone: "text-fail" },
  "during-run": { label: "Checked during the run", tone: "text-accent" },
  finished: { label: "Finished", tone: "text-ink-2" },
  failed: { label: "Failed", tone: "text-fail" },
};

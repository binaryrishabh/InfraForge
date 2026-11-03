import type { ReplayQueueStatus } from "@infraforge/contracts/deployment";

// Measured on a development PC for the sample design: a rough guide, not a promise.
export const REPLAY_SECONDS_PER_SIMULATED_SECOND = 0.15;
export const MAX_REPLAY_QUEUE_ROWS = 256;

export interface ReplayQueueRow {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  browserSubmission: unknown;
}
export interface ReplayQueueLimits { active: number; queued: number }

export function isReplay(run: Pick<ReplayQueueRow, "status" | "browserSubmission">) {
  return (run.status === "pending" || run.status === "running") && run.browserSubmission != null;
}

export function unknownQueueStatus(reason: string): ReplayQueueStatus {
  return { state: "unknown", position: null, runsAhead: null, estimatedWaitSeconds: null, basis: `Unknown: ${reason}` };
}

function stopSecond(submission: unknown): number | null {
  if (!submission || typeof submission !== "object" || Array.isArray(submission)) return null;
  const value = (submission as Record<string, unknown>).stopAtSecond;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 3600 ? value : null;
}

/** Pure bounded snapshot calculation. Rows may include other server work occupying the same slots. */
export function queueStatus(id: string, rows: readonly ReplayQueueRow[], limits: ReplayQueueLimits): ReplayQueueStatus {
  if (![limits.active, limits.queued].every(value => Number.isSafeInteger(value) && value > 0)) return unknownQueueStatus("invalid replay limits.");
  if (rows.length > MAX_REPLAY_QUEUE_ROWS || rows.length > limits.active + limits.queued) return unknownQueueStatus("bounded queue snapshot exceeded its limits.");
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !Number.isFinite(row.createdAt.getTime()) || !Number.isFinite(row.updatedAt.getTime()))) {
    return unknownQueueStatus("queue ordering is unreadable or duplicated.");
  }
  const pending = rows.filter(row => row.status === "pending");
  const active = rows.filter(row => row.status !== "pending");
  if (pending.length > limits.queued || active.length > limits.active) return unknownQueueStatus("queue snapshot exceeded active or queued limits.");
  const target = rows.find(row => row.id === id && isReplay(row));
  if (!target) return unknownQueueStatus("run is not in the current replay snapshot.");
  // Pending updatedAt records submission, while createdAt records browser start. Retries may reorder actual dispatch.
  const queued = pending.filter(isReplay).sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()
    || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = queued.findIndex(row => row.id === id);
  const ahead = target.status === "running" ? [] : [...active, ...queued.slice(0, index)];
  const durations = [...ahead, target].map(row => stopSecond(row.browserSubmission));
  const otherWork = target.status === "pending" && rows.some(row => !isReplay(row));
  const readable = !otherWork && durations.every((value): value is number => value !== null);
  const own = durations.at(-1)!;
  const estimate = readable ? durations.slice(0, -1).reduce<number>((sum, value) => sum + value!, 0) * REPLAY_SECONDS_PER_SIMULATED_SECOND / limits.active
    + own! * REPLAY_SECONDS_PER_SIMULATED_SECOND : null;
  const basis = `Sum of full stopAtSecond * ${REPLAY_SECONDS_PER_SIMULATED_SECOND} for runs ahead / ${limits.active} active slots + own full replay cost. `
    + "Measured on a development PC for the sample design; rough guide, not a promise. Includes own replay, not just time to start; active progress is not deducted. "
    + "Pending order: updatedAt, createdAt, id; dispatch retries and overhead may change the wait."
    + (readable ? "" : otherWork ? " Unknown: other server work occupies the queue or slots without a replay cost." : " Unknown: a required stopAtSecond is missing or unreadable.");
  return target.status === "running"
    ? { state: "replaying", position: null, runsAhead: 0, estimatedWaitSeconds: estimate, basis }
    : { state: "queued", position: index + 1, runsAhead: ahead.length, estimatedWaitSeconds: estimate, basis };
}

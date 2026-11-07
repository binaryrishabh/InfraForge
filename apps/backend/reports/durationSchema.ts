import { z } from "zod";

const duration = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = duration.int();
const id = z.string().min(1).max(256);
const phases = z.object({ queued: duration, lock: duration, cpu: duration, io: duration, wait: duration, commit: duration }).strict();
const resource = z.object({ id, kind: z.enum(["compute", "async-worker", "relational"]),
  busySlotUs: duration.nullable(), consumedCoreUs: duration.nullable(), cancelled: count.nullable(), phasesUs: phases.nullable(),
}).strict().superRefine((row, ctx) => {
  if (!row.phasesUs) return;
  const { queued: _queued, ...held } = row.phasesUs;
  const total = Object.values(held).reduce((n, v) => n + v, 0);
  // CPU calendars use floating point. Permit rounding only, not a missing phase.
  if (row.kind !== "relational" || row.busySlotUs === null || Math.abs(total - row.busySlotUs) > Math.max(0.000001, total * 1e-12)) {
    ctx.addIssue({code: "custom", message: "Active transaction phase durations must conserve measured slot hold"});
  }
});
const path = z.object({ id, source: id, target: id,
  reachedPhaseUs: z.object({ connectionWaitUs: duration, requestTransportUs: duration, remoteServiceUs: duration, responseTransportUs: duration }).strict(),
  offered: count, completed: count, failed: count, cancelled: count, live: count, pendingAcquisitions: count,
  unfinishedAcquisitionUs: z.null(),
}).strict();
export const DurationEvidenceSchema = z.object({version: z.literal(1), fromUs: z.literal(0), throughUs: duration,
  timestampComplete: z.boolean().nullable(), resources: z.array(resource).max(64), resourcesOmitted: count,
  paths: z.array(path).max(64), pathsOmitted: count,
}).strict().refine(e => new Set(e.resources.map(r => r.id)).size === e.resources.length && new Set(e.paths.map(p => p.id)).size === e.paths.length,
  "Duration owners and paths must be unique");

import { z } from "zod";
import { digestPattern, imagePattern } from "./isolationPolicy";
import type { PoolClient } from "pg";

// Held in the same transaction as the immutable recovery receipt. A live
// verifier or executor refuses offline closure, even if a run is in recovery.
export async function requireOfflineRecovery(db: Pick<PoolClient, "query">) {
  for (const id of [12, 10]) {
    const row = (await db.query("SELECT pg_try_advisory_xact_lock(186542854,$1) AS held", [id])).rows[0];
    if (row?.held !== true) throw Error("Stop verifier and executor before operator recovery");
  }
}

const reviewFields = { token: z.string().min(1).max(256), image: z.string().regex(imagePattern),
  reviewer: z.string().trim().min(1).max(256), proof: z.string().trim().min(1).max(500) };
export const submissionRecoverySchema = z.union([
  z.object({ ...reviewFields, daemon: z.string().regex(digestPattern), cleanup: z.enum(["removed", "not-created"]) }).strict(),
  z.object({ ...reviewFields, kind: z.literal("process-service-stopped/1"), token: z.uuid(), generation: z.uuid(),
    source: z.string().regex(digestPattern), termination: z.literal("confirmed") }).strict(),
]);
export function recoveryMatches(run: any, review: z.infer<typeof submissionRecoverySchema>) {
  return run.token === review.token && run.engine.image === review.image && ("generation" in review ?
    run.daemon === null && run.generation === review.generation && run.engine.source === review.source :
    run.generation == null && run.daemon === review.daemon);
}

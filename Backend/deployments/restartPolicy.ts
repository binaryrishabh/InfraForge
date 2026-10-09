import { prisma } from "../lib/prisma";
import { publishDeploymentFailed } from "../infra/pubsub";

export const INTERRUPTED_RUN_MESSAGE = "Simulation interrupted by worker restart. Checkpoints are diagnostic only; create a new deployment to run again.";
export const LEGACY_RUN_MESSAGE = "Original run inputs are unavailable for this legacy deployment. Create a new deployment; its architecture cannot be reconstructed safely.";

export async function retireInterruptedRuns() {
  // Called only after exclusive worker ownership has been acquired.
  const interrupted = await prisma.$queryRaw<Array<{ id: string; status: string; legacy: boolean }>>`
    UPDATE "Deployment" SET
      status = CASE WHEN status = 'live' OR ("runInputs" IS NULL AND status IN ('pending', 'running')) THEN 'failed' ELSE status END,
      "runtimeActive" = false,
      timeline = COALESCE(timeline::jsonb, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'timestamp', CURRENT_TIMESTAMP,
        'event', 'Simulation Interrupted',
        'message', CASE WHEN "runInputs" IS NULL THEN ${LEGACY_RUN_MESSAGE} ELSE ${INTERRUPTED_RUN_MESSAGE} END
      )),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE status = 'live' OR "runtimeActive" OR ("runInputs" IS NULL AND status IN ('pending', 'running'))
    RETURNING id, status, "runInputs" IS NULL AS legacy
  `;
  for (const run of interrupted) {
    if (run.status !== "failed") continue;
    try { await publishDeploymentFailed(run.id, run.legacy ? LEGACY_RUN_MESSAGE : INTERRUPTED_RUN_MESSAGE); }
    catch { console.error(`Could not publish interruption for ${run.id}; persisted status remains authoritative.`); }
  }
}

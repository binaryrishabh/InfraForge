import { prisma } from "../lib/prisma";
import { operationalLimits } from "../deployments/operationalLimits";

export const ABANDONED_RUN_MESSAGE = "The browser never submitted this run within its lifetime (the tab was closed or lost its connection), so it has no recorded result.";

// A browser run never submitted within the run lifetime is closed without a result, saying why.
export async function closeAbandonedBrowserRuns(now = Date.now(), limits = operationalLimits) {
  const cutoff = new Date(now - limits.lifetimeSeconds * 1000);
  return prisma.$executeRaw`UPDATE "Deployment" SET status = 'failed', "updatedAt" = CURRENT_TIMESTAMP,
    timeline = COALESCE(timeline::jsonb, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'timestamp', CURRENT_TIMESTAMP, 'event', 'Deployment Failed', 'message', ${ABANDONED_RUN_MESSAGE}::text))
    WHERE status = 'browser' AND "createdAt" < ${cutoff}`;
}

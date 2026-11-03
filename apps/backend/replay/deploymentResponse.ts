import type { Prisma } from "../lib/generated/prisma/client";
import type { ReplayQueueStatus } from "@infraforge/contracts/deployment";
import { operationalLimits, serverWorkWhere } from "../deployments/operationalLimits";
import { ReplayQueueStatusSchema } from "./contract";
import { isReplay, MAX_REPLAY_QUEUE_ROWS, queueStatus, type ReplayQueueLimits, type ReplayQueueRow } from "./queueStatus";

// Global aggregate only: selecting no ownership, names, inputs or results from other runs.
export const replayQueueQuery = {
  where: serverWorkWhere,
  select: { id: true, status: true, createdAt: true, updatedAt: true, browserSubmission: true },
  orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
} satisfies Prisma.DeploymentFindManyArgs;

export async function deploymentReadResponse<T extends Pick<ReplayQueueRow, "id" | "status" | "browserSubmission">>(
  deployment: T,
  readQueue: (take: number) => Promise<ReplayQueueRow[]>,
  limits: ReplayQueueLimits = operationalLimits,
): Promise<{ success: true; deployment: T; replay?: ReplayQueueStatus }> {
  if (!isReplay(deployment)) return { success: true, deployment };
  // One extra row detects overflow instead of silently inventing a position from a truncated queue.
  const take = Math.min(MAX_REPLAY_QUEUE_ROWS, limits.active + limits.queued) + 1;
  const rows = await readQueue(take);
  return { success: true, deployment, replay: ReplayQueueStatusSchema.parse(queueStatus(deployment.id, rows, limits)) };
}

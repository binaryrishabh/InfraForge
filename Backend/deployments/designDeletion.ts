import type { Prisma } from "../lib/generated/prisma/client";
import { ConflictError } from "../utils/errors";

export async function assertNoActiveRuns(tx: Prisma.TransactionClient, infrastructureId?: string) {
  const active = await tx.deployment.count({
    where: {
      infrastructureId,
      OR: [{ status: { in: ["pending", "running", "live"] } }, { runtimeActive: true }],
    },
  });
  if (active) throw new ConflictError("Stop active runs and wait for the simulator to stop before deleting the design.");
}

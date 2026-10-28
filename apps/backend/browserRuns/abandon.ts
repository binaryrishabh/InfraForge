import { DeploymentStatus } from "@infraforge/contracts/deployment";
import { prisma } from "../lib/prisma";
import { operationalLimits } from "../deployments/operationalLimits";

// A browser run never submitted within the run lifetime (tab closed, connection lost) is closed without a result.
export async function closeAbandonedBrowserRuns(now = Date.now(), limits = operationalLimits) {
  const cutoff = new Date(now - limits.lifetimeSeconds * 1000);
  return (await prisma.deployment.updateMany({ where: { status: DeploymentStatus.BROWSER, createdAt: { lt: cutoff } },
    data: { status: DeploymentStatus.FAILED } })).count;
}

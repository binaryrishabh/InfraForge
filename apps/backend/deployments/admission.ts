import type { Prisma } from "../lib/generated/prisma/client";
import { AppError, ConflictError, ValidationError } from "../utils/errors";
import { lifetimeExpired, operationalLimits, reservationWhere, type OperationalLimits } from "./operationalLimits";

// All admission and pending -> running transitions use this transaction lock.
// Deployment rows ARE the durable reservations: no separate expiring lease can
// release capacity while work remains alive. Rollback removes work and outbox together.
async function lockAdmission(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(186542854, 20)::text`;
}
export async function admitDeployment(tx: Prisma.TransactionClient, data: Prisma.DeploymentUncheckedCreateInput,
  limits: OperationalLimits = operationalLimits) {
  if (!data.ownerId) throw new ValidationError("A run owner is required.");
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > limits.inputBytes) throw new ValidationError("Run admission byte budget exceeded.");
  await lockAdmission(tx);
  if (data.challengeId && await tx.deployment.count({ where: { ...reservationWhere, ownerId: data.ownerId, challengeId: data.challengeId } })) {
    throw new ConflictError("An attempt at this challenge is still running. Stop it or let it reach the evaluation second first.");
  }
  const [owner, global, queued] = await Promise.all([
    tx.deployment.count({ where: { ...reservationWhere, ownerId: data.ownerId } }),
    tx.deployment.count({ where: reservationWhere }),
    tx.deployment.count({ where: { status: "pending" } }),
  ]);
  if (owner >= limits.perOwner || global >= limits.global || queued >= limits.queued) {
    throw new AppError("Simulation capacity is busy. Stop an existing run or retry later.", 429);
  }
  const run = await tx.deployment.create({ data });
  await tx.outbox.create({ data: { eventType: "deployment-created", payload: { deploymentId: run.id } } });
  return run;
}
export async function claimDeployment(tx: Prisma.TransactionClient, id: string, limits = operationalLimits) {
  await lockAdmission(tx);
  const run = await tx.deployment.findUnique({ where: { id }, select: { status: true, createdAt: true, runtimeActive: true } });
  if (run?.status !== "pending") return "retired";
  if (lifetimeExpired(run.createdAt, Date.now(), limits)) {
    await tx.deployment.updateMany({ where: { id, status: "pending", runtimeActive: false }, data: { status: "failed" } });
    return "retired";
  }
  const active = await tx.deployment.count({ where: { OR: [{ status: { in: ["running", "live"] } }, { runtimeActive: true }] } });
  if (active >= limits.active) return "busy";
  const claimed = await tx.deployment.updateMany({ where: { id, status: "pending" }, data: { status: "running" } });
  return claimed.count === 1 ? "claimed" : "retired";
}

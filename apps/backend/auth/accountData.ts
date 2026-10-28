import { ACTIVE_RUN_STATUSES } from "@infraforge/contracts/deployment";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { AppError } from "../utils/errors";
import { ACCOUNT_EXPORT_SECTIONS, type AccountExportSection } from "@infraforge/contracts/auth";

// The profile is erased; immutable run ownership/inputs/results are retained
// under the opaque, disabled user ID. This is pseudonymisation, not full erasure
// of arbitrary personal text that a user may have submitted inside a run.
export async function deleteAccount(db: PrismaClient, userId: string) {
  await db.$transaction(async tx => {
    const users = await tx.$queryRaw<Array<{ id: string; email: string; deletedAt: Date | null }>>`
      SELECT id, email, "deletedAt" FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!users[0] || users[0].deletedAt) throw new AppError("Sign in to continue", 401);
    const [deployments, internal, firstStack] = await Promise.all([
      tx.deployment.count({ where: { ownerId: userId, OR: [{ status: { in: [...ACTIVE_RUN_STATUSES] } }, { runtimeActive: true }] } }),
      tx.internalModel2Run.count({ where: { ownerId: userId, status: { in: ["queued", "running"] } } }),
      tx.firstStackRun.count({ where: { ownerId: userId, work: { status: { not: "terminal" } } } }),
    ]);
    if (deployments || internal || firstStack) throw new AppError("Stop or finish all active runs before deleting your account", 409);
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.verification.deleteMany({ where: { value: userId } });
    // Native email login records are keyed by mailbox, not user ID. Retire them
    // before freeing the address so an old proof cannot enter a new account.
    await tx.verification.deleteMany({ where: { OR: [
      { identifier: `sign-in-otp-${users[0].email}` },
      { value: JSON.stringify({ type: "magic-link", email: users[0].email }) },
    ] } });
    await tx.accountEmailToken.deleteMany({ where: { userId } });
    await tx.accountMailOutbox.deleteMany({ where: { userId } });
    await tx.accountMailIntent.deleteMany({ where: { userId } });
    await tx.internalModel2Grant.deleteMany({ where: { userId } });
    // Keep referenced design IDs/owners because FirstStackRun is append-only.
    await tx.infrastructure.updateMany({ where: { ownerId: userId }, data: { name: "Deleted design", layout: {}, userId: "deleted" } });
    await tx.user.update({ where: { id: userId }, data: { name: "Deleted account", email: `${randomUUID()}@deleted.invalid`,
      username: null, image: null, emailVerified: false, deletedAt: new Date() } });
  }, { isolationLevel: "Serializable", timeout: 15000 });
}

export const exportSections = ACCOUNT_EXPORT_SECTIONS;
export type ExportSection = AccountExportSection;
export type ExportCursor = { id: string; sequence?: number };
// One record per page bounds memory even for large submitted inputs/evidence.
// Every section filters by the authenticated parent owner, including results.
export async function exportAccountPage(db: PrismaClient, ownerId: string, section: ExportSection, after?: ExportCursor) {
  const page = { take: 1, orderBy: { id: "asc" as const }, where: { ownerId, ...(after ? { id: { gt: after.id } } : {}) } };
  let rows: Array<Record<string, unknown>>;
  switch (section) {
    case "designs": rows = await db.infrastructure.findMany(page); break;
    case "runs": rows = await db.deployment.findMany(page); break;
    case "internalRuns": rows = await db.internalModel2Run.findMany({ ...page,
      select: { id: true, ownerId: true, infrastructureId: true, input: true, inputHash: true, status: true,
        sequence: true, throughUs: true, evidence: true, reason: true, createdAt: true, updatedAt: true } }); break;
    case "firstStackRuns": rows = await db.firstStackRun.findMany(page); break;
    case "actions": rows = await db.runAction.findMany({ take: 1, orderBy: { id: "asc" },
      where: { deployment: { ownerId }, ...(after ? { id: { gt: after.id } } : {}) } }); break;
    case "samples": rows = await db.runEvidenceSample.findMany({ take: 1, orderBy: [{ deploymentId: "asc" }, { simulatedSeconds: "asc" }],
      where: { deployment: { ownerId }, ...(after ? { OR: [{ deploymentId: { gt: after.id } },
        { deploymentId: after.id, simulatedSeconds: { gt: after.sequence ?? -1 } }] } : {}) } }); break;
    case "cuts": rows = await db.firstStackCut.findMany({ take: 1, orderBy: [{ runId: "asc" }, { sequence: "asc" }],
      where: { run: { ownerId }, ...(after ? { OR: [{ runId: { gt: after.id } }, { runId: after.id, sequence: { gt: after.sequence ?? -1 } }] } : {}) } }); break;
    case "results": rows = await db.firstStackResult.findMany({ take: 1, orderBy: { runId: "asc" },
      where: { run: { ownerId }, ...(after ? { runId: { gt: after.id } } : {}) } }); break;
    case "lessons": rows = await db.internalModel2LessonRun.findMany({ take: 1, orderBy: { runId: "asc" },
      where: { run: { ownerId }, ...(after ? { runId: { gt: after.id } } : {}) } }); break;
  }
  // Scored results keep a complete server-only audit (rubric, hidden workload inputs, evidence, receipts).
  const row = section === "results" && rows[0] ? exportResult(rows[0]) : rows[0];
  const next: ExportCursor | null = row ? { id: String(row.id ?? row.deploymentId ?? row.runId),
    ...(section === "samples" ? { sequence: Number(row.simulatedSeconds) } : section === "cuts" ? { sequence: Number(row.sequence) } : {}) } : null;
  return { schema: "infraforge-account-export/1" as const, section, records: row ? [row] : [], next };
}

function exportResult(row: Record<string, unknown>): Record<string, unknown> {
  // The scored first-stack feature was removed before it opened; its server-only audit is still never exported.
  const { score: _audit, ...body } = (row.body ?? {}) as Record<string, unknown>;
  return { ...row, body };
}

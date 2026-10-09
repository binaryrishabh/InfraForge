import type { PrismaClient } from "../lib/generated/prisma/client";
import { assertNoActiveRuns } from "../deployments/designDeletion";

export async function recoverOwnership(prisma: PrismaClient, input: {
  designId: string; userId: string; expectedLegacyUserId: string; evidence: string; apply: boolean;
}) {
  if (!input.evidence.trim()) throw new Error("An ownership evidence reference is required");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${input.designId} FOR UPDATE`;
    const design = await tx.infrastructure.findUnique({ where: { id: input.designId } });
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!design || design.ownerId || design.userId !== input.expectedLegacyUserId) {
      throw new Error("Design is missing, already assigned, or its historical owner marker changed");
    }
    if (!user?.emailVerified) throw new Error("Target must be an existing account with verified email");
    await assertNoActiveRuns(tx, input.designId);
    if (input.apply) await tx.infrastructure.update({ where: { id: input.designId, ownerId: null }, data: { ownerId: user.id } });
    return { designId: design.id, legacyUserId: design.userId, ownerId: user.id, evidence: input.evidence,
      applied: input.apply, message: input.apply ? "Ownership assigned; historical data preserved" : "Dry run; no data changed" };
  });
}

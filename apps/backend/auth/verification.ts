import { createHash } from "node:crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";

export const verificationHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const EMAIL_TOKEN_SECONDS = 1800;
// Better Auth issues and verifies the JWT. This ledger adds atomic single use
// without storing the bearer token, or resetting a consumed same-second JWT.
export async function registerVerification(db: PrismaClient, token: string, userId: string) {
  await db.$transaction(async tx => {
    // Insert first: its FK waits for native signup to commit. This function is
    // invoked only by the background dispatcher, never awaited inside signup.
    await tx.accountEmailToken.upsert({ where: { hash: verificationHash(token) }, update: {},
      create: { hash: verificationHash(token), userId, expiresAt: new Date(Date.now() + EMAIL_TOKEN_SECONDS * 1000) } });
    const rows = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`SELECT "deletedAt" FROM "User" WHERE id = ${userId} FOR SHARE`;
    if (!rows[0] || rows[0].deletedAt) throw Error("Account unavailable");
  });
}
export async function consumeVerification(db: PrismaClient, token: string) {
  if (!token || token.length > 4096) return false;
  const now = new Date();
  const result = await db.accountEmailToken.updateMany({ where: { hash: verificationHash(token), usedAt: null,
    expiresAt: { gt: now }, user: { deletedAt: null } }, data: { usedAt: now } });
  return result.count === 1;
}

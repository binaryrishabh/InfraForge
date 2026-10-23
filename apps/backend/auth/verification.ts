import { createHash } from "node:crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";

export const verificationHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const EMAIL_TOKEN_SECONDS = 1800;
// Better Auth issues and verifies the JWT. This ledger adds atomic single use
// without storing the bearer token, or resetting a consumed same-second JWT.
export async function registerVerification(db: PrismaClient, token: string, userId: string) {
  const hash = verificationHash(token), expiresAt = new Date(Date.now() + EMAIL_TOKEN_SECONDS * 1000);
  // One statement owns the lock and insert. No detached interactive transaction
  // can reserve a pool connection while waiting for work on another connection.
  // FOR SHARE serializes with deletion; ON CONFLICT never revives a used token.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH live_account AS MATERIALIZED (
      SELECT id FROM "User" WHERE id = ${userId} AND "deletedAt" IS NULL FOR SHARE
    ), issued AS (
      INSERT INTO "AccountEmailToken" (hash, "userId", "expiresAt")
      SELECT ${hash}, id, ${expiresAt} FROM live_account
      ON CONFLICT (hash) DO NOTHING RETURNING hash
    ) SELECT id FROM live_account`;
  if (rows.length !== 1) throw Error("Account unavailable");
}
export async function consumeVerification(db: PrismaClient, token: string) {
  if (!token || token.length > 4096) return false;
  const now = new Date();
  const result = await db.accountEmailToken.updateMany({ where: { hash: verificationHash(token), usedAt: null,
    expiresAt: { gt: now }, user: { deletedAt: null } }, data: { usedAt: now } });
  return result.count === 1;
}

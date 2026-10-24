import { createHash, createHmac } from "node:crypto";
import { createEmailVerificationToken } from "better-auth/api";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "../lib/generated/prisma/client";
import { accountEmail } from "./emailTemplate";
import { registerVerification } from "./verification";

export type MailKind = "signup" | "reset" | "verify";
export type MailSettings = { secret: string; baseURL: string; origins: string[] };
export type MailIntent = {
  id: string;
  kind: string;
  payload: string;
  expiresAt: Date;
};
export type MailPayload = { email: string; callbackURL: string; verificationToken?: string };
export interface MailRequests {
  admit(kind: MailKind, email: string, callbackURL: string): Promise<void>;
}

// Matches Better Auth 1.7.7 verification.storeIdentifier = "hashed".
export const storedIdentifier = (identifier: string) =>
  createHash("sha256").update(identifier).digest("base64url");

// A database reader knows the nonce, but cannot derive the bearer without the
// server key. Neither the bearer nor an encrypted copy of it is persisted.
export function mailCredential(intent: Pick<MailIntent, "id" | "kind">, secret: string) {
  return createHmac("sha256", secret)
    .update(`infraforge-mail-credential/1\0${intent.kind}\0${intent.id}`)
    .digest("base64url");
}

export async function readMailPayload(payload: string, secret: string): Promise<MailPayload> {
  return JSON.parse(await symmetricDecrypt({ key: secret, data: payload }));
}

// Called inside the same transaction that changes pending -> ready. A restart
// cannot reissue a consumed credential: preparation is committed exactly once.
export async function prepareMailIntent(
  tx: Prisma.TransactionClient,
  intent: MailIntent,
  settings: MailSettings,
): Promise<{ payload: string; userId: string | null } | null> {
  const data = await readMailPayload(intent.payload, settings.secret);
  const remaining = Math.floor((intent.expiresAt.getTime() - Date.now()) / 1000);
  if (remaining <= 0) return null;

  // Signup proof delivery never consults User or the requested username.
  if (intent.kind === "signup") {
    await tx.verification.create({ data: {
      id: `mail:${intent.id}`,
      identifier: storedIdentifier(`signup-proof:${mailCredential(intent, settings.secret)}`),
      value: data.email,
      expiresAt: intent.expiresAt,
    } });
    return { payload: intent.payload, userId: null };
  }

  const users = await tx.$queryRaw<Array<{ id: string; emailVerified: boolean }>>`
    SELECT id, "emailVerified" FROM "User"
    WHERE email = ${data.email} AND "deletedAt" IS NULL FOR SHARE`;
  const user = users[0];
  if (!user || intent.kind === "verify" && user.emailVerified) return null;

  if (intent.kind === "reset") {
    await tx.verification.create({ data: {
      id: `mail:${intent.id}`,
      identifier: storedIdentifier(`reset-password:${mailCredential(intent, settings.secret)}`),
      value: user.id,
      expiresAt: intent.expiresAt,
    } });
    return { payload: intent.payload, userId: user.id };
  }

  const token = await createEmailVerificationToken(settings.secret, data.email, undefined, remaining);
  await registerVerification(tx as PrismaClient, token, user.id);
  const payload = await symmetricEncrypt({
    key: settings.secret,
    data: JSON.stringify({ ...data, verificationToken: token }),
  });
  return { payload, userId: user.id };
}

export async function renderMailIntent(intent: MailIntent, settings: MailSettings) {
  const data = await readMailPayload(intent.payload, settings.secret);
  const token = mailCredential(intent, settings.secret);
  if (intent.kind === "signup") {
    const link = new URL(data.callbackURL || "/signup", settings.origins[0]);
    link.searchParams.set("emailProof", token);
    return accountEmail(data.email, link.href, "signup", settings.origins);
  }
  const base = `${settings.baseURL}/api/auth`;
  const url = intent.kind === "reset"
    ? `${base}/reset-password/${token}?callbackURL=${encodeURIComponent(data.callbackURL)}`
    : `${base}/verify-email?token=${data.verificationToken}&callbackURL=${encodeURIComponent(data.callbackURL)}`;
  return accountEmail(data.email, url, intent.kind === "reset" ? "reset" : "verify", settings.baseURL);
}

import { createHash, createHmac } from "node:crypto";
import { createEmailVerificationToken } from "better-auth/api";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "../lib/generated/prisma/client";
import { accountEmail } from "./emailTemplate";
import { registerVerification } from "./verification";

export type MailKind = "signup" | "reset" | "verify" | "magic" | "otp";
export type MailSettings = { secret: string; baseURL: string; origins: string[] };
export type MailIntent = {
  id: string;
  kind: string;
  payload: string;
  expiresAt: Date;
};
export type MailPayload = {
  email: string; callbackURL: string; verificationToken?: string; handoffHash?: string;
};
export interface MailRequests {
  admit(kind: MailKind, email: string, callbackURL: string, handoffHash?: string): Promise<void>;
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

export function mailOTP(intent: Pick<MailIntent, "id" | "kind">, secret: string) {
  const bytes = createHmac("sha256", secret).update(`infraforge-mail-otp/1\0${intent.id}`).digest();
  return String(bytes.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

// A database reader cannot brute-force a six-digit code without the server key.
export const otpDigest = (otp: string, secret: string) =>
  createHmac("sha256", secret).update(`infraforge-otp-digest/1\0${otp}`).digest("base64url");

export const loginProofHash = (kind: string, email: string, proof: string, secret: string) =>
  createHmac("sha256", secret).update(`infraforge-login-proof/1\0${kind}\0${email}\0${proof}`).digest("hex");

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
    if (data.handoffHash) await tx.verification.create({ data: {
      id: `handoff:${intent.id}`,
      identifier: `signup-handoff-proof:${storedIdentifier(mailCredential(intent, settings.secret))}`,
      value: data.handoffHash, expiresAt: intent.expiresAt,
    } });
    await tx.verification.create({ data: {
      id: `mail:${intent.id}`,
      identifier: storedIdentifier(`signup-proof:${mailCredential(intent, settings.secret)}`),
      value: data.email,
      expiresAt: intent.expiresAt,
    } });
    return { payload: intent.payload, userId: null };
  }

  const users = intent.kind === "otp" ? await tx.$queryRaw<Array<{ id: string; emailVerified: boolean }>>`
    SELECT id, "emailVerified" FROM "User"
    WHERE email = ${data.email} AND "deletedAt" IS NULL FOR UPDATE`
    : await tx.$queryRaw<Array<{ id: string; emailVerified: boolean }>>`
    SELECT id, "emailVerified" FROM "User"
    WHERE email = ${data.email} AND "deletedAt" IS NULL FOR SHARE`;
  const user = users[0];
  if (!user || intent.kind === "verify" && user.emailVerified) return null;

  if (intent.kind === "magic" || intent.kind === "otp") {
    // Email login never adopts an unverified pre-registration or creates users.
    if (!user.emailVerified) return null;
    const magic = intent.kind === "magic";
    await tx.accountEmailToken.create({ data: {
      hash: loginProofHash(intent.kind, magic ? "" : data.email,
        magic ? mailCredential(intent, settings.secret) : mailOTP(intent, settings.secret), settings.secret),
      userId: user.id, expiresAt: intent.expiresAt,
    } });
    const identifier = magic ? `magic-link:${storedIdentifier(mailCredential(intent, settings.secret))}`
      : `sign-in-otp-${data.email}`;
    if (!magic) await tx.verification.deleteMany({ where: { identifier } });
    await tx.verification.create({ data: {
      id: `mail:${intent.id}`, identifier,
      value: magic ? JSON.stringify({ type: "magic-link", email: data.email })
        : `${otpDigest(mailOTP(intent, settings.secret), settings.secret)}:0`,
      expiresAt: intent.expiresAt,
    } });
    return { payload: intent.payload, userId: user.id };
  }

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
  if (intent.kind === "otp") {
    return { to: data.email, subject: "Your InfraForge sign-in code", sensitive: true,
      text: `Your sign-in code is ${mailOTP(intent, settings.secret)}. It expires within 10 minutes. `
        + "Use it once. If you did not request it, ignore this email." };
  }
  if (intent.kind === "magic") {
    const url = `${settings.baseURL}/api/auth/magic-link/verify?token=${token}`
      + `&callbackURL=${encodeURIComponent(data.callbackURL)}`;
    return accountEmail(data.email, url, "magic", settings.baseURL);
  }
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

import { createHmac, randomBytes } from "node:crypto";
import { APIError, createAuthEndpoint, originCheckMiddleware, formCsrfMiddleware } from "better-auth/api";
import type { GenericEndpointContext } from "@better-auth/core";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { storedIdentifier } from "./mailIntent";
import { EMAIL_TOKEN_SECONDS } from "./verification";

export const invalidProof = () => new APIError("BAD_REQUEST", {
  code: "INVALID_EMAIL_PROOF", message: "Request a new signup link",
});
export const HANDOFF_COOKIE = "infraforge_signup_handoff";
const cookieOptions = (secure: boolean) => ({ httpOnly: true, secure, sameSite: "lax" as const,
  path: "/api/auth/signup-handoff", maxAge: EMAIL_TOKEN_SECONDS });
export const handoffIdentifier = (hash: string) => `signup-handoff:${hash}`;
export const handoffBinding = (proof: string) => `signup-handoff-proof:${storedIdentifier(proof)}`;
const handoffHash = (secret: string, key: string) => createHmac("sha256", key)
  .update(`infraforge-signup-handoff/1\0${secret}`).digest("base64url");

export async function startHandoff(ctx: GenericEndpointContext, key: string, secure: boolean) {
  const secret = randomBytes(32).toString("base64url");
  const hash = handoffHash(secret, key);
  await ctx.context.internalAdapter.createVerificationValue({ identifier: handoffIdentifier(hash),
    value: "", expiresAt: new Date(Date.now() + EMAIL_TOKEN_SECONDS * 1000) });
  ctx.setCookie(HANDOFF_COOKIE, secret, cookieOptions(secure));
  return hash;
}

export async function clearHandoff(ctx: GenericEndpointContext, proof: string) {
  const adapter = ctx.context.internalAdapter;
  const binding = await adapter.findVerificationValue(handoffBinding(proof));
  if (binding) {
    await adapter.deleteVerificationByIdentifier(handoffIdentifier(binding.value));
    await adapter.deleteVerificationByIdentifier(handoffBinding(proof));
  }
}

export function clearHandoffCookie(ctx: GenericEndpointContext, secure: boolean) {
  ctx.setCookie(HANDOFF_COOKIE, "", { ...cookieOptions(secure), maxAge: 0 });
}

export async function signupProof(ctx: GenericEndpointContext, proof: unknown) {
  if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw invalidProof();
  const row = await ctx.context.internalAdapter.findVerificationValue(`signup-proof:${proof}`);
  if (!row || row.expiresAt <= new Date()) throw invalidProof();
  return row;
}

export function signupHandoff(key: string) {
  return { id: "signup-handoff", endpoints: {
    confirmSignupHandoff: createAuthEndpoint("/signup-handoff/confirm", { method: "POST" }, async ctx => {
      await originCheckMiddleware(ctx);
      await formCsrfMiddleware(ctx);
      const proof = ctx.body?.emailProof;
      const row = await signupProof(ctx, proof);
      const adapter = ctx.context.internalAdapter;
      const binding = await adapter.findVerificationValue(handoffBinding(proof));
      if (binding && binding.expiresAt > new Date()) {
        // Update only: a completion racing this request must never recreate it.
        await adapter.updateVerificationByIdentifier(handoffIdentifier(binding.value), {
          value: await symmetricEncrypt({ key, data: proof }),
        });
      }
      ctx.setHeader("Cache-Control", "no-store");
      return ctx.json({ email: row.value });
    }),
    signupHandoffStatus: createAuthEndpoint("/signup-handoff/status", { method: "GET" }, async ctx => {
      ctx.setHeader("Cache-Control", "no-store");
      const cookie = ctx.getCookie(HANDOFF_COOKIE);
      if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return ctx.json({ state: "expired" as const });
      const row = await ctx.context.internalAdapter.findVerificationValue(handoffIdentifier(handoffHash(cookie, key)));
      if (!row || row.expiresAt <= new Date()) return ctx.json({ state: "expired" as const });
      if (!row.value) return ctx.json({ state: "pending" as const });
      const proof = await symmetricDecrypt({ key, data: row.value });
      // Never return a consumed or expired proof, including a confirm/complete race.
      const email = await ctx.context.internalAdapter.findVerificationValue(`signup-proof:${proof}`);
      if (!email || email.expiresAt <= new Date()) return ctx.json({ state: "expired" as const });
      return ctx.json({ state: "confirmed" as const, email: email.value, emailProof: proof });
    }),
  } };
}

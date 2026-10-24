import { APIError, createAuthMiddleware, originCheckMiddleware, formCsrfMiddleware } from "better-auth/api";
import { z } from "zod";
import type { MailRequests, MailSettings } from "./mailIntent";

export const acceptedMail = { status: true, message: "If eligible, check your email for the link" };
export const invalidProof = () => new APIError("BAD_REQUEST", {
  code: "INVALID_EMAIL_PROOF", message: "Request a new signup link",
});

// Initial public requests commit generic work before any account/plugin lookup.
export function mailAdmission(queue: MailRequests, settings: MailSettings) {
  return createAuthMiddleware(async ctx => {
    const kind = ctx.path === "/sign-up/email" ? "signup"
      : ctx.path === "/request-password-reset" ? "reset"
        : ctx.path === "/send-verification-email" ? "verify" : undefined;
    if (!kind) return;
    await originCheckMiddleware(ctx);
    await formCsrfMiddleware(ctx);
    const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !z.email().safeParse(email).success) {
      throw new APIError("BAD_REQUEST", { message: "Enter a valid email" });
    }
    ctx.body.email = email;
    if (kind === "signup" && ctx.body.emailProof !== undefined) {
      const proof = ctx.body.emailProof;
      if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw invalidProof();
      const row = await ctx.context.internalAdapter.findVerificationValue(`signup-proof:${proof}`);
      if (!row || row.value !== email || row.expiresAt <= new Date()) throw invalidProof();
      return;
    }
    const rawCallback = (kind === "reset" ? ctx.body.redirectTo : ctx.body.callbackURL)
      ?? (kind === "signup" ? "/signup" : "/");
    let callback: URL;
    try { callback = new URL(rawCallback, settings.origins[0]); }
    catch { throw new APIError("BAD_REQUEST", { message: "Invalid callback URL" }); }
    if (!settings.origins.includes(callback.origin) || callback.username || callback.password) {
      throw new APIError("FORBIDDEN", { message: "Invalid callback URL" });
    }
    try { await queue.admit(kind, email, callback.href); }
    catch { throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" }); }
    return ctx.json(acceptedMail);
  });
}

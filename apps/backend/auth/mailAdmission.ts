import { APIError, originCheckMiddleware, formCsrfMiddleware } from "better-auth/api";
import type { GenericEndpointContext } from "@better-auth/core";
import { z } from "zod";
import type { MailRequests, MailSettings } from "./mailIntent";
import { invalidProof, signupProof, startHandoff } from "./signupHandoff";
export { invalidProof };

export const acceptedMail = { status: true, message: "If eligible, check your email for the link" };

// Initial public requests commit generic work before any account/plugin lookup.
export function mailAdmission(queue: MailRequests, settings: MailSettings) {
  return async (ctx: GenericEndpointContext) => {
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
      const row = await signupProof(ctx, proof);
      if (row.value !== email) throw invalidProof();
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
    const handoff = kind === "signup"
      ? await startHandoff(ctx, settings.secret, settings.baseURL.startsWith("https:")) : undefined;
    try { await queue.admit(kind, email, callback.href, handoff); }
    catch { throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" }); }
    return ctx.json(acceptedMail);
  };
}

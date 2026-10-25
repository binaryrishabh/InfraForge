import { APIError, createAuthMiddleware, originCheckMiddleware, formCsrfMiddleware } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { z } from "zod";
import type { MailRequests } from "./mailIntent";
import { acceptedMail } from "./mailAdmission";
import type { readAuthSettings } from "./settings";

// Reject ambiguous spellings before WHATWG URL normalization or another decode.
// Relative paths are rooted on the first application, never on an arbitrary host.
export function returnURL(value: unknown, origins: string[]) {
  if (typeof value !== "string" || !value || /[\s\\%\u0000-\u001f\u007f]/.test(value)
    || value.startsWith("//")) throw Error("Invalid return URL");
  if (!value.startsWith("/") && !/^https?:\/\//.test(value)) throw Error("Invalid return URL");
  const url = new URL(value, origins[0]);
  if (!origins.includes(url.origin) || url.username || url.password) throw Error("Invalid return URL");
  return url.href;
}

// Installed core/types/init-options.d.mts: user.validateUserInfo is called for
// redirect-based implicit and explicit linking, with the fresh verified flag.
// The native direct ID-token path skips this hook and is refused below.
export const validateLink: NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]> =
  async ({ user, source }, ctx) => {
    if (source.action !== "link-account") return;
    const local = typeof user.id === "string" ? await ctx.context.internalAdapter.findUserById(user.id) : null;
    if (source.method !== "oauth" || !["google", "github"].includes(source.oauth?.providerId ?? "")
      || user.emailVerified !== true || !local?.emailVerified
      || typeof user.email !== "string" || user.email.trim().toLowerCase() !== local.email.trim().toLowerCase()) {
      return { error: "UNVERIFIED_ACCOUNT_LINK", errorDescription: "Verify both accounts before linking" };
    }
  };

export function loginMethodPolicy(settings: ReturnType<typeof readAuthSettings>, queue?: MailRequests) {
  const methods = settings.loginMethods;
  return createAuthMiddleware(async ctx => {
    if (Object.values(methods).some(Boolean)) {
      for (const values of [ctx.body, ctx.query]) {
        for (const field of ["callbackURL", "newUserCallbackURL", "errorCallbackURL", "redirectTo", "returnTo"]) {
          if (values?.[field] === undefined) continue;
          try { values[field] = returnURL(values[field], settings.returnOrigins); }
          catch { throw new APIError("FORBIDDEN", { message: "Invalid return URL" }); }
        }
      }
      // Native handlers otherwise synthesize backend-relative return destinations.
      if (["/magic-link/verify", "/sign-in/social", "/link-social"].includes(ctx.path)) {
        const values = ctx.path === "/magic-link/verify" ? ctx.query : ctx.body;
        values.callbackURL ??= returnURL("/", settings.returnOrigins);
        values.errorCallbackURL ??= values.callbackURL;
        values.newUserCallbackURL ??= values.callbackURL;
      }
    }
    if (methods.linking && ctx.path === "/link-social" && !methods.settings) {
      throw new APIError("NOT_FOUND", { message: "Not found" });
    }
    if (methods.linking && ctx.path === "/link-social" && ctx.body?.idToken !== undefined) {
      throw new APIError("BAD_REQUEST", { message: "Use redirect-based account linking" });
    }
    const magic = methods.magicLink && ctx.path === "/sign-in/magic-link";
    const otp = methods.emailOtp && ctx.path === "/email-otp/send-verification-otp";
    if (methods.emailOtp && ctx.path === "/sign-in/email-otp" && typeof ctx.body?.email === "string") {
      ctx.body.email = ctx.body.email.trim().toLowerCase();
    }
    if (!magic && !otp) return;
    await originCheckMiddleware(ctx);
    await formCsrfMiddleware(ctx);
    if (otp && ctx.body?.type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" });
    const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !z.email().safeParse(email).success) {
      throw new APIError("BAD_REQUEST", { message: "Enter a valid email" });
    }
    const callback = returnURL(ctx.body?.callbackURL ?? "/", settings.returnOrigins);
    try {
      if (!queue) throw Error("Email unavailable");
      await queue.admit(magic ? "magic" : "otp", email, callback);
    } catch { throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" }); }
    return ctx.json(acceptedMail);
  });
}

// Opening an email is not consent to consume its proof. A same-backend GET form
// obtains a fresh, single-use Turnstile assertion before native redemption.
export function magicConfirmation(settings: ReturnType<typeof readAuthSettings>, request?: Request) {
  if (!request) return;
  const url = new URL(request.url);
  if (request.headers.has("x-turnstile-token") || url.searchParams.has("cf-turnstile-response")) return;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const fields = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"]
    .filter(name => url.searchParams.has(name))
    .map(name => `<input type="hidden" name="${name}" value="${escape(url.searchParams.get(name) ?? "")}">`)
    .join("");
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Confirm sign-in</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><h1>Confirm sign-in</h1>
<p>Complete the security check, then continue to InfraForge.</p>
<form method="get" action="/api/auth/magic-link/verify">${fields}
<div class="cf-turnstile" data-sitekey="${escape(settings.accountEssentials.siteKey ?? "")}"
data-action="email_login_redeem"></div><button type="submit">Continue</button></form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; script-src https://challenges.cloudflare.com; "
        + "frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  });
}

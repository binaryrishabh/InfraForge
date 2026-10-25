import { APIError, createAuthMiddleware, originCheckMiddleware, formCsrfMiddleware } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { z } from "zod";
import type { MailRequests } from "./mailIntent";
import { acceptedMail } from "./mailAdmission";
import type { readAuthSettings } from "./settings";

export const HOSTED_LOGIN_ORIGIN = "https://auth.infraforge.lapwork.in";
export const LOGIN_FLAGS = ["AUTH_ACCOUNT_LINKING_ENABLED", "AUTH_MAGIC_LINK_ENABLED", "AUTH_EMAIL_OTP_ENABLED",
  "AUTH_METHOD_SETTINGS_ENABLED", "AUTH_HOSTED_LOGIN_ENABLED"] as const;

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
// both implicit and explicit linking, with the provider's fresh verified flag.
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
          try { returnURL(values[field], settings.returnOrigins); }
          catch { throw new APIError("FORBIDDEN", { message: "Invalid return URL" }); }
        }
      }
    }
    if (methods.linking && ctx.path === "/link-social" && !methods.settings) {
      throw new APIError("NOT_FOUND", { message: "Not found" });
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

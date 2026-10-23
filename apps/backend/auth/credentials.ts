import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Request, Response, RequestHandler } from "express";
import { LOGIN_ERROR, PASSWORD_MIN, PASSWORD_MAX, validUsername } from "@infraforge/contracts/auth";
import { z } from "zod";

// 1.7.7 provides separate native email/username handlers. Adapt the single
// identifier here; the original handler still performs CSRF, rate limiting,
// password verification and cookie/session creation. Never resolve a user here.
export function identifierSignIn(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res) => {
    const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
    if (!identifier || identifier.length > 254) {
      res.status(401).json({ code: "INVALID_CREDENTIALS", message: LOGIN_ERROR }); return;
    }
    const email = identifier.includes("@");
    req.body = { [email ? "email" : "username"]: identifier, password: req.body?.password };
    const original = req.url;
    req.url = `/api/auth/sign-in/${email ? "email" : "username"}`;
    try { await handler(req, res); }
    finally { req.url = original; }
  };
}

// The native username plugin makes usernames optional for OAuth users. Require
// one only on credential registration, without changing historical identities.
export const credentialValidation = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-up/email") {
    if (typeof ctx.body?.username !== "string" || !validUsername(ctx.body.username)) {
      throw new APIError("BAD_REQUEST", { code: "INVALID_USERNAME", message: "Use 3–30 letters, numbers or underscores, starting with a letter." });
    }
  }
  if (ctx.path === "/sign-up/email" || ctx.path === "/sign-in/email") {
    if (typeof ctx.body?.email === "string") ctx.body.email = ctx.body.email.trim().toLowerCase();
    if (typeof ctx.body?.email === "string" && ctx.body.email.length > 254) {
      throw new APIError("BAD_REQUEST", { code: "INVALID_EMAIL", message: "Enter a valid email address." });
    }
  }
  if (ctx.path === "/sign-up/email") {
    // Validate before the username plugin's duplicate lookup, so malformed
    // input errors cannot themselves disclose membership.
    if (!z.email().safeParse(ctx.body?.email).success) throw new APIError("BAD_REQUEST", { code: "INVALID_EMAIL", message: "Enter a valid email address." });
    if (typeof ctx.body?.password !== "string" || ctx.body.password.length < PASSWORD_MIN || ctx.body.password.length > PASSWORD_MAX) {
      throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Enter a password within the supported length." });
    }
    if (!z.object({ name: z.string(), image: z.string().optional(), callbackURL: z.string().optional(), rememberMe: z.boolean().optional() }).safeParse(ctx.body).success) {
      throw new APIError("BAD_REQUEST", { code: "INVALID_SIGNUP", message: "Enter valid account details." });
    }
    for (const value of [ctx.body?.callbackURL, ctx.body?.redirectTo, ctx.body?.errorCallbackURL, ctx.body?.newUserCallbackURL]) {
      if (value && (typeof value !== "string" || !ctx.context.isTrustedOrigin(value, { allowRelativePaths: true }))) {
        throw new APIError("FORBIDDEN", { code: "INVALID_CALLBACK_URL", message: "Invalid callback URL" });
      }
    }
  }
  if (ctx.path === "/sign-in/email" || ctx.path === "/sign-in/username") {
    if (typeof ctx.body?.password !== "string" || ctx.body.password.length > PASSWORD_MAX) {
      throw new APIError("UNAUTHORIZED", { code: "INVALID_CREDENTIALS", message: LOGIN_ERROR });
    }
    if (ctx.path === "/sign-in/username") {
      if (typeof ctx.body?.username !== "string") {
        throw new APIError("UNAUTHORIZED", { code: "INVALID_CREDENTIALS", message: LOGIN_ERROR });
      }
      ctx.body.username = ctx.body.username.trim();
      if (!validUsername(ctx.body.username)) {
        throw new APIError("UNAUTHORIZED", { code: "INVALID_CREDENTIALS", message: LOGIN_ERROR });
      }
    }
  }
});

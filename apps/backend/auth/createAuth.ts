import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { PASSWORD_MIN, PASSWORD_MAX, USERNAME_MIN, USERNAME_MAX, validUsername, normalizeUsername } from "@infraforge/contracts/auth";
import { credentialValidation } from "./credentials";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { readAuthSettings } from "./settings";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailDispatcher } from "./email";
import { registerVerification, consumeVerification, EMAIL_TOKEN_SECONDS } from "./verification";
import { enforceAccountPolicy, type AccountQuota } from "./accountPolicy";
import { queueAfterTransactionHook } from "@better-auth/core/context";

export function createAuth(prisma: PrismaClient, settings: ReturnType<typeof readAuthSettings>, quota?: AccountQuota) {
  const essentials = settings.accountEssentials;
  const deliver = essentials.enabled && essentials.email ? emailDispatcher(essentials.email) : undefined;
  return betterAuth({
    appName: "InfraForge",
    baseURL: settings.baseURL,
    secret: settings.secret,
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    trustedOrigins: settings.origins,
    socialProviders: settings.socialProviders,
    emailAndPassword: { enabled: true, minPasswordLength: PASSWORD_MIN, maxPasswordLength: PASSWORD_MAX,
      requireEmailVerification: !!deliver, autoSignIn: !deliver,
      ...(deliver ? { resetPasswordTokenExpiresIn: EMAIL_TOKEN_SECONDS, revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
          deliver({ to: user.email, subject: "Reset your InfraForge password", text: `Reset your password within 30 minutes: ${url}` });
        } } : {}) },
    ...(deliver ? { emailVerification: { sendOnSignUp: true, sendOnSignIn: false, expiresIn: EMAIL_TOKEN_SECONDS,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }: { user: { id: string; email: string }; url: string; token: string }) => {
        // Native signup invokes this before its user transaction commits. A
        // detached promise still races that commit; the FK cannot wait for a
        // row invisible to its snapshot. Queue only after native commit, and
        // then hand off to the bounded sender without holding a transaction.
        await queueAfterTransactionHook(async () => {
          deliver({ to: user.email, subject: "Verify your InfraForge email", text: `Verify your email within 30 minutes: ${url}` },
            () => registerVerification(prisma, token, user.id));
        });
      } } } : {}),
    plugins: [username({ displayUsername: false, immutableUsername: true,
      minUsernameLength: USERNAME_MIN, maxUsernameLength: USERNAME_MAX,
      usernameValidator: validUsername, usernameNormalization: normalizeUsername })],
    disabledPaths: ["/is-username-available", "/delete-user", "/delete-user/callback",
      ...(!deliver ? ["/send-verification-email", "/verify-email", "/request-password-reset", "/reset-password", "/reset-password/:token"] : [])],
    hooks: { before: createAuthMiddleware(async ctx => {
      await credentialValidation(ctx);
      if (ctx.path === "/request-password-reset" || ctx.path === "/send-verification-email") {
        if (typeof ctx.body?.email === "string") ctx.body.email = ctx.body.email.trim().toLowerCase();
        if (typeof ctx.body?.email !== "string" || ctx.body.email.length > 254) throw new APIError("BAD_REQUEST", { message: "Enter a valid email" });
      }
      await enforceAccountPolicy({ path: ctx.path, body: ctx.body, token: ctx.body?.token ?? ctx.query?.token,
        ip: ctx.headers?.get("x-infraforge-client-ip") ?? "unknown", enabled: essentials.enabled, challenge: essentials.challenge, quota });
      if (ctx.path === "/verify-email" && (!deliver || !await consumeVerification(prisma, String(ctx.query?.token ?? "")))) {
        throw new APIError("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid or expired link" });
      }
    }) },
    // Keep operational errors visible without routine login/signup identifiers.
    // Neither the application nor auth middleware logs credential request bodies.
    logger: { level: "error", log: () => console.error("Authentication operation failed") },
    session: { cookieCache: { enabled: false }, disableSessionRefresh: true },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    rateLimit: { enabled: true },
    advanced: { useSecureCookies: settings.secure, disableOriginCheck: false, disableCSRFCheck: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" } },
  });
}

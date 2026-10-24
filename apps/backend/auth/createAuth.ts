import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { PASSWORD_MIN, PASSWORD_MAX, USERNAME_MIN, USERNAME_MAX, validUsername, normalizeUsername } from "@infraforge/contracts/auth";
import { credentialValidation } from "./credentials";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { readAuthSettings } from "./settings";
import { APIError, createAuthMiddleware, originCheckMiddleware, formCsrfMiddleware } from "better-auth/api";
import { AccountEmailRequests } from "./mailRequests";
import type { MailRequests } from "./mailIntent";
import { mailAdmission, invalidProof, acceptedMail } from "./mailAdmission";
import { consumeVerification, EMAIL_TOKEN_SECONDS } from "./verification";
import { enforceAccountPolicy, type AccountQuota } from "./accountPolicy";

export function createAuth(prisma: PrismaClient, settings: ReturnType<typeof readAuthSettings>, quota?: AccountQuota, mailQueue?: MailRequests) {
  const essentials = settings.accountEssentials;
  const deliver = (essentials.emailEnabled || essentials.enabled) && essentials.email
    ? mailQueue ?? new AccountEmailRequests(prisma, essentials.email, settings) : undefined;
  return betterAuth({
    appName: "InfraForge",
    baseURL: settings.baseURL,
    secret: settings.secret,
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    trustedOrigins: settings.origins,
    socialProviders: settings.socialProviders,
    verification: {
      storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed", "signup-proof:": "hashed" } },
    },
    emailAndPassword: {
      enabled: true, minPasswordLength: PASSWORD_MIN, maxPasswordLength: PASSWORD_MAX,
      requireEmailVerification: !!deliver && essentials.verificationRequired !== false, autoSignIn: !deliver,
      resetPasswordTokenExpiresIn: EMAIL_TOKEN_SECONDS, revokeSessionsOnPasswordReset: true,
    },
    ...(deliver ? { emailVerification: {
      sendOnSignUp: false, sendOnSignIn: false, expiresIn: EMAIL_TOKEN_SECONDS,
      autoSignInAfterVerification: false,
    } } : {}),
    databaseHooks: { user: { create: { before: async (user, ctx) => {
      if (!deliver || ctx?.path !== "/sign-up/email") return;
      // Native signup's transaction includes proof consumption and user creation.
      const proof = ctx.body?.emailProof;
      if (typeof proof !== "string") throw invalidProof();
      const row = await ctx.context.internalAdapter.consumeVerificationValue(`signup-proof:${proof}`);
      if (!row || row.value !== user.email || row.expiresAt <= new Date()) throw invalidProof();
      return { data: { ...user, emailVerified: true } };
    } } } },
    plugins: [username({ displayUsername: false, immutableUsername: true,
      minUsernameLength: USERNAME_MIN, maxUsernameLength: USERNAME_MAX,
      usernameValidator: validUsername, usernameNormalization: normalizeUsername })],
    disabledPaths: ["/is-username-available", "/delete-user", "/delete-user/callback",
      ...(!deliver ? ["/send-verification-email", "/verify-email", "/request-password-reset", "/reset-password", "/reset-password/:token"] : [])],
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === "/sign-up/email") {
        // These native middleware checks must also precede the username
        // plugin's early duplicate response, including form/Fetch Metadata.
        await originCheckMiddleware(ctx);
        await formCsrfMiddleware(ctx);
      }
      await enforceAccountPolicy({
        path: ctx.path, body: ctx.body, token: ctx.body?.token ?? ctx.query?.token,
        ip: ctx.headers?.get("x-infraforge-client-ip") ?? "unknown",
        enabled: essentials.enabled || !!deliver, challenge: essentials.challenge, quota,
      });
      if (deliver) {
        await mailAdmission(deliver, settings)(ctx);
        const initialSignup = ctx.path === "/sign-up/email" && ctx.body?.emailProof === undefined;
        if (initialSignup || ctx.path === "/request-password-reset" || ctx.path === "/send-verification-email") {
          return ctx.json(acceptedMail);
        }
      }
      await credentialValidation(ctx);
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

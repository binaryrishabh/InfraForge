import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { PASSWORD_MIN, PASSWORD_MAX, USERNAME_MIN, USERNAME_MAX, validUsername, normalizeUsername } from "@infraforge/contracts/auth";
import { credentialValidation } from "./credentials";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { readAuthSettings } from "./settings";

export function createAuth(prisma: PrismaClient, settings: ReturnType<typeof readAuthSettings>) {
  return betterAuth({
    appName: "InfraForge",
    baseURL: settings.baseURL,
    secret: settings.secret,
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    trustedOrigins: settings.origins,
    socialProviders: settings.socialProviders,
    emailAndPassword: { enabled: true, minPasswordLength: PASSWORD_MIN, maxPasswordLength: PASSWORD_MAX,
      requireEmailVerification: false, autoSignIn: true },
    plugins: [username({ displayUsername: false, immutableUsername: true,
      minUsernameLength: USERNAME_MIN, maxUsernameLength: USERNAME_MAX,
      usernameValidator: validUsername, usernameNormalization: normalizeUsername })],
    disabledPaths: ["/is-username-available"],
    hooks: { before: credentialValidation },
    // Keep operational errors visible without routine login/signup identifiers.
    // Neither the application nor auth middleware logs credential request bodies.
    logger: { level: "error" },
    session: { cookieCache: { enabled: false }, disableSessionRefresh: true },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    rateLimit: { enabled: true },
    advanced: { useSecureCookies: settings.secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" } },
  });
}

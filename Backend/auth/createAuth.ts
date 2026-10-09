import { betterAuth } from "better-auth";
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
    emailAndPassword: { enabled: false },
    session: { cookieCache: { enabled: false }, disableSessionRefresh: true },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    rateLimit: { enabled: true },
    advanced: { useSecureCookies: settings.secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" } },
  });
}

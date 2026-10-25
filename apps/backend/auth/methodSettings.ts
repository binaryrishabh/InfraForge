import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import type { createAuth } from "./createAuth";
import type { PrismaClient } from "../lib/generated/prisma/client";
import type { AccountQuota } from "./accountPolicy";
import type { readAuthSettings } from "./settings";
import { AppError } from "../utils/errors";

export async function unlinkMethod(db: PrismaClient, userId: string, sessionId: string,
  accountId: string, providers: string[]) {
  await db.$transaction(async tx => {
    // Serializes concurrent removals and account deletion. A stale request cannot
    // act after its re-authenticated session has been revoked in the meantime.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND "deletedAt" IS NULL FOR UPDATE`;
    const session = await tx.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } } });
    if (!session) throw new AppError("Sign in to continue", 401);
    const accounts = await tx.account.findMany({ where: { userId } });
    const selected = accounts.find(a => a.id === accountId);
    if (!selected) throw new AppError("Login method not found", 404);
    const remaining = accounts.filter(a => a.id !== accountId
      && (a.providerId === "credential" ? !!a.password : providers.includes(a.providerId)));
    if (!remaining.length) throw new AppError("Keep at least one usable login method", 409);
    await tx.account.deleteMany({ where: { id: accountId, userId } });
  });
}

export function methodSettingsRouter(db: PrismaClient,
  auth: { api: Pick<ReturnType<typeof createAuth>["api"], "getSession" | "verifyPassword"> },
  quota: AccountQuota, settings: ReturnType<typeof readAuthSettings>) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    if (!settings.loginMethods.settings) { res.status(404).json({ success: false }); return; }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true } });
    if (!session) { res.status(401).json({ success: false }); return; }
    res.locals.authSession = session;
    try {
      const ipAllowed = await quota.allow("method-settings:ip", req.ip ?? "unknown", 60);
      const userAllowed = await quota.allow("method-settings:user", session.user.id, 30);
      if (!ipAllowed || !userAllowed) { res.status(429).json({ success: false }); return; }
    } catch { res.status(503).json({ success: false }); return; }
    next();
  });
  router.get("/methods", async (_req, res) => {
    const { user } = res.locals.authSession;
    const methods = await db.account.findMany({ where: { userId: user.id },
      select: { id: true, providerId: true, createdAt: true }, orderBy: { id: "asc" } });
    res.json({ methods, emailLogin: { magicLink: user.emailVerified && settings.loginMethods.magicLink,
      emailOtp: user.emailVerified && settings.loginMethods.emailOtp } });
  });
  router.post("/unlink", async (req, res) => {
    const body = z.object({ accountId: z.string().min(1).max(128),
      password: z.string().min(1).max(128) }).strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ success: false }); return; }
    try { await auth.api.verifyPassword({ headers: fromNodeHeaders(req.headers), body: { password: body.data.password } }); }
    catch { res.status(403).json({ success: false, message: "Re-authentication failed" }); return; }
    const { user, session } = res.locals.authSession;
    await unlinkMethod(db, user.id, session.id, body.data.accountId, Object.keys(settings.socialProviders));
    res.json({ success: true });
  });
  router.get("/sessions", async (req, res) => {
    const parsed = z.object({ after: z.string().min(1).max(128).optional() }).strict().safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ success: false }); return; }
    const { user, session } = res.locals.authSession;
    const rows = await db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() },
      ...(parsed.data.after ? { id: { gt: parsed.data.after } } : {}) }, orderBy: { id: "asc" }, take: 100,
      select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true } });
    res.json({ sessions: rows.map(row => ({ ...row, current: row.id === session.id })),
      next: rows.length === 100 ? rows.at(-1)!.id : null });
  });
  router.post("/sessions/revoke", async (req, res) => {
    const body = z.object({ sessionId: z.string().min(1).max(128) }).strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ success: false }); return; }
    const result = await db.session.deleteMany({ where: { id: body.data.sessionId,
      userId: res.locals.authSession.user.id } });
    res.status(result.count ? 200 : 404).json({ success: result.count === 1 });
  });
  router.post("/sessions/revoke-others", async (_req, res) => {
    const { user, session } = res.locals.authSession;
    await db.session.deleteMany({ where: { userId: user.id, id: { not: session.id } } });
    res.json({ success: true });
  });
  return router;
}

import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import type { createAuth } from "./createAuth";
import type { PrismaClient } from "../lib/generated/prisma/client";
import type { AccountQuota } from "./accountPolicy";
import { deleteAccount, exportAccountPage, exportSections } from "./accountData";

export function accountRouter(db: PrismaClient, auth: ReturnType<typeof createAuth>, quota: AccountQuota, enabled: boolean) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    if (!enabled) { res.status(404).json({ success: false }); return; }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
    if (!session) { res.status(401).json({ success: false }); return; }
    res.locals.userId = session.user.id;
    try {
      const scope = req.path === "/export" ? "export" : "delete";
      const ipAllowed = await quota.allow(`account:${scope}:ip`, req.ip ?? "unknown", scope === "export" ? 600 : 30);
      const userAllowed = await quota.allow(`account:${scope}:user`, session.user.id, scope === "export" ? 600 : 10);
      if (!ipAllowed || !userAllowed) { res.status(429).json({ success: false, message: "Try again later" }); return; }
    } catch { res.status(503).json({ success: false, message: "Account service unavailable" }); return; }
    next();
  });
  router.post("/delete", async (req, res) => {
    const body = z.object({ confirmation: z.literal("DELETE"), password: z.string().min(1).max(128) }).strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ success: false, message: "Enter your current password and DELETE" }); return; }
    try { await auth.api.verifyPassword({ headers: fromNodeHeaders(req.headers), body: { password: body.data.password } }); }
    catch { res.status(403).json({ success: false, message: "Re-authentication failed" }); return; }
    await deleteAccount(db, res.locals.userId);
    // The authoritative sessions have been deleted in the same transaction.
    res.json({ success: true });
  });
  router.get("/export", async (req, res) => {
    const query = z.object({ section: z.enum(exportSections), after: z.string().max(512).optional() }).strict().safeParse(req.query);
    if (!query.success) { res.status(400).json({ success: false, message: "Choose an export section" }); return; }
    let after: { id: string; sequence?: number } | undefined;
    if (query.data.after) {
      try { after = z.object({ id: z.string().min(1).max(128), sequence: z.number().int().nonnegative().optional() }).strict()
        .parse(JSON.parse(Buffer.from(query.data.after, "base64url").toString("utf8"))); }
      catch { res.status(400).json({ success: false, message: "Invalid export cursor" }); return; }
    }
    const page = await exportAccountPage(db, res.locals.userId, query.data.section, after);
    res.setHeader("Content-Disposition", 'attachment; filename="infraforge-account.json"');
    res.json({ ...page, next: page.next ? Buffer.from(JSON.stringify(page.next)).toString("base64url") : null });
  });
  return router;
}

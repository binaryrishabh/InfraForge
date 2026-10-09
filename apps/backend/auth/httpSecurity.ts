import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, authSettings } from "./auth";

export const checkOrigin: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  const allowed = origin !== undefined && authSettings.origins.includes(origin);
  if ((origin !== undefined && !allowed) || (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowed)) {
    res.status(403).json({ success: false, message: "Request origin is not permitted" });
    return;
  }
  next();
};

export const requireSession: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
  if (!session) {
    res.status(401).json({ success: false, message: "Sign in to continue" });
    return;
  }
  res.locals.userId = session.user.id;
  next();
};

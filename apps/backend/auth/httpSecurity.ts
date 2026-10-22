import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, authSettings } from "./auth";
import { createOriginCheck } from "./origin";

export const checkOrigin = createOriginCheck(authSettings.origins);

export const requireSession: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
  if (!session) {
    res.status(401).json({ success: false, message: "Sign in to continue" });
    return;
  }
  res.locals.userId = session.user.id;
  next();
};

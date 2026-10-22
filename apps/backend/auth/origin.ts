import type { RequestHandler } from "express";

export function createOriginCheck(origins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    const allowed = origin !== undefined && origins.includes(origin);
    if ((origin !== undefined && !allowed) || (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowed)) {
      res.status(403).json({ success: false, message: "Request origin is not permitted" }); return;
    }
    next();
  };
}

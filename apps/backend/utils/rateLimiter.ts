import type { RequestHandler } from "express";

// Bound unique-IP memory without evicting an existing IP's sliding-window quota.
export function createRateLimiter({ maxRequests = 1000, maxClients = 2048,
  windowMs = 15 * 60 * 1000, now = Date.now, sweepIntervalMs = 60000 } = {}) {
  const clients = new Map<string, number[]>();
  const sweep = () => {
    const cutoff = now() - windowMs;
    for (const [ip, timestamps] of clients) if (timestamps.at(-1)! <= cutoff) clients.delete(ip);
  };
  const timer = setInterval(sweep, sweepIntervalMs);
  timer.unref();
  const middleware: RequestHandler = (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const time = now();
    const timestamps = (clients.get(ip) ?? []).filter(stamp => time - stamp < windowMs);
    if (!clients.has(ip) && clients.size >= maxClients) {
      res.setHeader("Retry-After", 60);
      res.status(503).json({ success: false, message: "Request capacity reached; try again later" });
      return;
    }
    const accepted = timestamps.length < maxRequests;
    if (accepted) timestamps.push(time);
    clients.set(ip, timestamps);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", maxRequests - timestamps.length);
    res.setHeader("X-RateLimit-Reset", timestamps[0]! + windowMs);
    if (accepted) { next(); return; }
    res.setHeader("Retry-After", Math.ceil((timestamps[0]! + windowMs - time) / 1000));
    res.status(429).json({ success: false, message: "Too many requests" });
  };
  return { middleware, close: () => clearInterval(timer) };
}

export const rateLimiter = createRateLimiter().middleware;

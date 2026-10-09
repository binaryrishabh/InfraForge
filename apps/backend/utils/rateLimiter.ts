/**
 * CURRENT: Sliding Window Log - In-Memory Map
 *
 * KNOWN ISSUES TO FIX (Phase 5 - Docker/Deployment):
 *
 * 1. Trust Proxy: Behind Nginx, req.ip resolves to Nginx's internal IP.
 *    FIX: app.set('trust proxy', 1) + use X-Forwarded-For header.
 *
 * 2. Multi-Instance: In-memory state doesn't scale beyond single process.
 *    FIX: Redis sorted sets (ZADD + ZREMRANGEBYSCORE + ZCARD).
 *    Each IP gets a sorted set. Score = timestamp. Expired entries auto-removed.
 *    ioredis already in dependencies for BullMQ (Phase 2).
 *
 * 3. Memory: Map grows with unique IPs. Cleanup interval handles idle IPs,
 *    but high-traffic IPs keep full arrays. In production with 100K+ IPs,
 *    Redis with EXPIRE handles TTL automatically.
 *
 * MIGRATION PLAN: Replace in-memory Map with Redis sorted sets during Phase 5.
 * Algorithm stays Sliding Window Log. Storage layer changes.
 */
import type { Request, Response, NextFunction } from "express";

const MAX_REQUESTS = 1000;
const TIME_WINDOW_MAX_SIZE = 15 * 60 * 1000; // 15 minutes

// Rate limiting algorithm: Sliding Window Log
const ipMap = new Map<string, number[]>();

// Clean up ip's who never visited within TIME_WINDOW_MAX_SIZE minutes after there last interaction
// which helps to keep the map with interacting ips only.
setInterval(() => {
  for (const [key, value] of ipMap) {
    if (
      value.length === 0 ||
      Date.now() - value[value.length - 1]! > TIME_WINDOW_MAX_SIZE
    ) {
      ipMap.delete(key);
    }
  }
}, TIME_WINDOW_MAX_SIZE);

export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
  if(req.path === "/health") { // Skip the health route
    next();
    return;
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let timeStamp = ipMap.get(ip) || [];

  timeStamp = timeStamp.filter(
    (timeStampLog) => now - timeStampLog < TIME_WINDOW_MAX_SIZE,
  );

  if (timeStamp.length < MAX_REQUESTS) {
    timeStamp = [...timeStamp, now];
    ipMap.set(ip, timeStamp);
    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", MAX_REQUESTS - timeStamp.length);
    res.setHeader("X-RateLimit-Reset", timeStamp[0]! + TIME_WINDOW_MAX_SIZE);
    next();
    return;
  } else {
    res.setHeader(
      "Retry-After",
      Math.ceil((timeStamp[0]! + TIME_WINDOW_MAX_SIZE - now) / 1000),
    ); // in seconds
    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", timeStamp[0]! + TIME_WINDOW_MAX_SIZE);
    res.status(429).json({
      success: false,
      message: "Too many requests",
    });
    return;
  }
};

// Rate limiting algorithm: Fixed Window Counter
/* 
const ipMap = new Map<string, { count: number; resetTime: number }>();

// Clean up ip's who never visited within 15 minutes after there interaction which helps to keep the map size with interacting ips only.
setInterval(() => {
    for(const [key, value] of ipMap) {
        if(value.resetTime < Date.now()) {
            ipMap.delete(key);
        }
    }
}, TIME_WINDOW_MAX_SIZE)

// Per IP: 100 requests per 15-minute window
// Resets when window expires
export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    const now = Date.now();

    const entry = ipMap.get(ip);

    if(req.path === "/health") {
        next();
        return;
    }

    if(!entry || entry.resetTime < now) { // ip not exists or window time has past so reset
        ipMap.set(ip, { count: 1, resetTime: now + TIME_WINDOW_MAX_SIZE })
        res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
        res.setHeader("X-RateLimit-Remaining", MAX_REQUESTS - 1);
        res.setHeader("X-RateLimit-Reset", now + TIME_WINDOW_MAX_SIZE);
        next();
        return;
    }
    else if(entry && entry.resetTime > now && entry.count < MAX_REQUESTS) { // within window and count is also valid
        entry.count += 1;
        res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
        res.setHeader("X-RateLimit-Remaining", MAX_REQUESTS - entry.count);
        res.setHeader("X-RateLimit-Reset", entry.resetTime);
        next();
        return;
    }
    else { // if ip exists && reset time >= now &&  count > MAX_REQUESTS: reject as already filled
        res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("Retry-After", Math.ceil((entry.resetTime - now) / 1000)) // in seconds
        res.setHeader("X-RateLimit-Reset", entry.resetTime);
        res.status(429).json({
            success: false,
            message: "Too many requests"
        })
        return;
    }
}
 */

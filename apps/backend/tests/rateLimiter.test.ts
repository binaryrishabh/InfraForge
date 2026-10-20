import { expect, test } from "bun:test";
import type { Request, Response } from "express";
import { createRateLimiter } from "../utils/rateLimiter";

test("identity floods cannot evict an existing quota and expired identities release capacity", async () => {
  let now = 0;
  const limiter = createRateLimiter({ maxRequests: 2, maxClients: 2, windowMs: 100, now: () => now, sweepIntervalMs: 5 });
  const request = (ip: string) => {
    let status = 200;
    const headers: Record<string, unknown> = {};
    const res = { setHeader: (key: string, value: unknown) => { headers[key] = value; },
      status: (code: number) => { status = code; return res; }, json: () => {} };
    limiter.middleware({ ip } as Request, res as unknown as Response, () => {});
    return { status, headers };
  };
  try {
    expect(request("one").status).toBe(200);
    expect(request("one").status).toBe(200);
    expect(request("one").status).toBe(429);
    expect(request("two").status).toBe(200);
    for (let i = 0; i < 50; i++) expect(request(`flood-${i}`).status).toBe(503);
    expect(request("one").status).toBe(429);
    now = 101;
    await Bun.sleep(15);
    expect(request("three").status).toBe(200);
    expect(request("three").headers["X-RateLimit-Remaining"]).toBe(0);
  } finally { limiter.close(); }
});

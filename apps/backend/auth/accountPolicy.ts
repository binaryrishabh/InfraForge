import { createHmac } from "node:crypto";
import { APIError } from "better-auth/api";
import type { SignupChallenge } from "./turnstile";

export interface AccountQuota { allow(scope: string, identity: string, maximum: number): Promise<boolean> }
interface RedisCounter { eval(script: string, keys: number, ...args: Array<string | number>): Promise<unknown> }
export class RedisAccountQuota implements AccountQuota {
  constructor(private redis: RedisCounter, private secret: string) {}
  async allow(scope: string, identity: string, maximum: number) {
    const key = createHmac("sha256", this.secret).update(`${scope}\0${identity}`).digest("hex");
    const count = await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", 1, `account-quota:${key}`);
    return Number(count) <= maximum;
  }
}
export async function enforceAccountPolicy(input: { path: string; body?: Record<string, unknown>; token?: string; ip: string;
  enabled: boolean; challenge?: SignupChallenge; quota?: AccountQuota }) {
  const { path, enabled, challenge, quota, ip, body } = input;
  const signup = path === "/sign-up/email";
  const emailRequest = path === "/request-password-reset" || path === "/send-verification-email";
  const redeem = path === "/verify-email" || path === "/reset-password";
  if (!(signup && challenge || enabled && (emailRequest || redeem || signup))) return;
  if (!quota) throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" });
  try {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const scope = signup ? "signup" : emailRequest ? "email-request" : "redeem";
    const ipAllowed = await quota.allow(`${scope}:ip`, ip, redeem ? 30 : 20);
    const accountAllowed = await quota.allow(`${scope}:account`, emailRequest || signup ? email : input.token ?? "", emailRequest || signup ? 3 : 5);
    if (!ipAllowed || !accountAllowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Try again later" });
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" });
  }
  if (challenge && (signup || path === "/request-password-reset")) {
    const token = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
    let accepted = false;
    try { accepted = await challenge.verify(token, signup ? "signup" : "password_reset", ip); } catch { /* fail closed */ }
    if (!accepted) throw new APIError("FORBIDDEN", { message: "Complete the security check" });
  }
}

// Uniform public email requests, even with an authenticated cookie. Provider
// latency is excluded by emailDispatcher. The floor covers native DB/JWT work;
// it is not a hard real-time guarantee under infrastructure overload.
export function accountAuthHandler(handler: (request: Request) => Promise<Response>, enabled: boolean,
  now = Date.now, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  return async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/\/$/, "").toLowerCase();
    const uniform = enabled && request.method === "POST" && ["/api/auth/send-verification-email", "/api/auth/request-password-reset"].includes(path);
    const start = now();
    if (uniform) {
      request = new Request(request);
      // Bun 1.3.14 merges RequestInit headers with the original request. Delete
      // from the cloned Request itself so the cookie is actually absent.
      request.headers.delete("cookie");
    }
    let response = await handler(request);
    if (uniform) {
      await sleep(Math.max(0, 750 - (now() - start)));
      // Keep input/challenge/quota/CSRF errors; native successful requests share
      // one body. Delivery failures never escape the asynchronous dispatcher.
      if (response.ok) response = Response.json({ status: true, message: "If eligible, check your email for the link" });
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store"); headers.set("Referrer-Policy", "no-referrer");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

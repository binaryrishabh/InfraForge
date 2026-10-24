import { createHmac } from "node:crypto";
import { APIError } from "better-auth/api";
import type { SignupChallenge } from "./turnstile";
import { acceptedMail } from "./mailAdmission";

export interface AccountQuota { allow(scope: string, identity: string, maximum: number): Promise<boolean> }
interface RedisCounter { eval(script: string, keys: number, ...args: Array<string | number>): Promise<unknown> }
export class RedisAccountQuota implements AccountQuota {
  constructor(private redis: RedisCounter, private secret: string) {}
  async allow(scope: string, identity: string, maximum: number) {
    const key = createHmac("sha256", this.secret).update(`${scope}\0${identity}`).digest("hex");
    const script = "local n=redis.call('INCR',KEYS[1]); "
      + "if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n";
    const count = await this.redis.eval(script, 1, `account-quota:${key}`);
    return Number(count) <= maximum;
  }
}
export async function enforceAccountPolicy(input: {
  path: string; body?: Record<string, unknown>; token?: string; ip: string;
  enabled: boolean; proofSignup?: boolean; challenge?: SignupChallenge; quota?: AccountQuota }) {
  const { path, enabled, challenge, quota, ip, body } = input;
  const signup = path === "/sign-up/email";
  const completion = input.proofSignup === true && signup && body?.emailProof !== undefined;
  const emailRequest = path === "/request-password-reset" || path === "/send-verification-email";
  const redeem = path === "/verify-email" || path === "/reset-password";
  if (!(signup && challenge || enabled && (emailRequest || redeem || signup))) return;
  if (!quota) throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" });
  try {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const scope = completion ? "signup-complete" : signup ? "signup" : emailRequest ? "email-request" : "redeem";
    const ipAllowed = await quota.allow(`${scope}:ip`, ip, redeem || completion ? 30 : 20);
    const identity = completion ? String(body?.emailProof).slice(0, 100)
      : emailRequest || signup ? email : input.token ?? "";
    const accountAllowed = await quota.allow(`${scope}:account`, identity,
      completion ? 5 : emailRequest || signup ? 3 : 5);
    if (!ipAllowed || !accountAllowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Try again later" });
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError("SERVICE_UNAVAILABLE", { message: "Account service unavailable" });
  }
  if (challenge && (signup && !completion || path === "/request-password-reset" && challenge.protectReset !== false)) {
    const token = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
    let accepted = false;
    try { accepted = await challenge.verify(token, signup ? "signup" : "password_reset", ip); }
    catch { /* fail closed */ }
    if (!accepted) throw new APIError("FORBIDDEN", { message: "Complete the security check" });
  }
}

// Uniform public signup/email requests, even with an authenticated cookie.
// Provider latency is excluded by the durable queue. The floor covers DB/JWT work;
// it is not a hard real-time guarantee under infrastructure overload.
export function accountAuthHandler(handler: (request: Request) => Promise<Response>, enabled: boolean,
  now = Date.now, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  return async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/\/$/, "").toLowerCase();
    // Better Auth's disabledPaths compares literal URLs, not route patterns.
    if (!enabled && path.startsWith("/api/auth/reset-password/")) {
      return new Response("Not Found", { status: 404,
        headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }
    const signup = enabled && request.method === "POST" && path === "/api/auth/sign-up/email";
    const emailRequest = ["/api/auth/send-verification-email", "/api/auth/request-password-reset"].includes(path);
    let uniform = enabled && request.method === "POST" && (signup || emailRequest);
    const start = now();
    let signupBody: { emailProof?: unknown } | undefined;
    if (signup) {
      const copy = request.clone();
      signupBody = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
        ? { emailProof: new URLSearchParams(await copy.text()).get("emailProof") ?? undefined }
        : await copy.json().catch(() => undefined) as { emailProof?: unknown } | undefined;
      if (signupBody?.emailProof !== undefined) uniform = false;
    }
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
      // one body. Provider delivery is separate from durable queue insertion.
      if (response.ok) response = Response.json(acceptedMail);
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store"); headers.set("Referrer-Policy", "no-referrer");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

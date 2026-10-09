import { readFile } from "node:fs/promises";
import { makeSignature } from "better-auth/crypto";
import { auth } from "../auth/auth";
import { prisma } from "../lib/prisma";

if (process.env.RELEASE_REHEARSAL !== "owned-local" || !/^postgresql:\/\/postgres@postgres\/infraforge_release_[a-f0-9]{8}$/.test(process.env.DATABASE_URL || "")) {
  throw new Error("TLS/session rehearsal requires its isolated disposable Compose database");
}
const ca = await readFile("/fixture/tls/cert.pem", "utf8");
const origin = "https://app.example.invalid";
const request = (path: string, cookie = "", method = "GET") => fetch(`https://proxy:8443${path}`, {
  method, headers: { Origin: origin, Cookie: cookie, "X-Forwarded-Proto": "http", "X-Forwarded-Host": "attacker.invalid" },
  tls: { ca }, redirect: "error", signal: AbortSignal.timeout(5000),
});
const context = await auth.$context;
const user = await context.internalAdapter.createUser({ name: "Release fixture", email: `${crypto.randomUUID()}@infraforge.test`, emailVerified: true }, { method: "fixture" });
try {
  const session = await context.internalAdapter.createSession(user.id);
  if (!session) throw new Error("Database session creation failed");
  const signed = await makeSignature(session.token, process.env.BETTER_AUTH_SECRET!);
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signed}`)}`;
  const attributes = context.authCookies.sessionToken.attributes;
  if (!attributes.secure || !attributes.httpOnly || attributes.sameSite !== "lax" || attributes.domain) throw new Error("Unsafe session cookie policy");
  const response = await request("/api/auth/get-session", cookie);
  const result = await response.json() as { user?: { id?: string } };
  if (!response.ok || result.user?.id !== user.id || !response.headers.get("strict-transport-security")) throw new Error("TLS proxy/session/HTTPS header validation failed");
  const socket = new WebSocket("wss://proxy:8443/ws", { tls: { ca }, headers: { Origin: origin, Cookie: cookie } });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Trusted fixture WSS connection failed")), { once: true });
  });
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code), { once: true }));
  await prisma.session.delete({ where: { id: session.id } });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<number>((resolve) => { timeout = setTimeout(() => { socket.close(); resolve(-1); }, 5000); });
  const code = await Promise.race([closed, expired]);
  clearTimeout(timeout);
  if (code !== 1008) throw new Error("Revoked HTTPS session did not close its WS connection safely");
  const unauthenticated = await request("/api/infrastructure");
  if (unauthenticated.status !== 401) throw new Error("TLS proxy exposed unauthenticated infrastructure");
  const rejected = await fetch("https://proxy:8443/api/auth/get-session", { tls: { ca }, headers: { Origin: "https://attacker.invalid" } });
  if (rejected.status !== 403) throw new Error("Proxy bypassed exact Origin validation");
  console.log("TLS proxy, real Secure session, authenticated WS, revocation, Origin and anonymous rejection passed");
} finally { await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect(); }
process.exit(0);

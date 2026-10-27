import { expect, test, spyOn } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricEncrypt } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { createAuth } from "../auth/createAuth";
import { readAuthSettings } from "../auth/settings";
import { accountAuthHandler } from "../auth/accountPolicy";
import { FakeEmail } from "../auth/email";
import { prepareMailIntent, renderMailIntent, type MailKind } from "../auth/mailIntent";

import { mockPasswordBreachService } from "./passwordBreachFixture";
import { passwordAcceptable, passwordChecks } from "@infraforge/contracts/auth";
import { HANDOFF_COOKIE } from "../auth/signupHandoff";
const breach = mockPasswordBreachService();
export const password = "Fixture-only-password-8!";
export function admissionFixture(secure = false, limits = false) {
  const database: { user: any[]; account: any[]; session: any[]; verification: any[] } = { user: [], account: [], session: [], verification: [] };
  const settings = readAuthSettings({
    BETTER_AUTH_SECRET: "fixture-only-secret-at-least-32-characters",
    BETTER_AUTH_URL: secure ? "https://api.example.test" : "http://localhost:3100", APP_ORIGINS: "http://localhost:5173",
  });
  const mail = new FakeEmail();
  const intents: any[] = [];
  let failing = false;
  const queue = {
    // Retain the old hook only to reproduce the reviewed behavior before wiring.
    enqueue: async (message: any) => {
      if (failing) throw Error("fixture admission unavailable");
      await mail.send(message);
    },
    admit: async (kind: MailKind, email: string, callbackURL: string, handoffHash?: string) => {
      if (failing) throw Error("fixture admission unavailable");
      intents.push({ id: randomUUID(), kind, expiresAt: new Date(Date.now() + 1800_000),
        payload: await symmetricEncrypt({ key: settings.secret, data: JSON.stringify({ email, callbackURL, handoffHash }) }) });
    },
  };
  const counts = new Map<string, number>();
  const quota = { allow: async (scope: string, identity: string, max: number) => {
    const key = `${scope}:${identity}`, count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count); return !limits || count <= max;
  } };
  const options = createAuth({} as any, { ...settings, accountEssentials: {
    ...settings.accountEssentials, emailEnabled: true, email: mail,
  } }, quota, queue).options;
  const auth = betterAuth({ ...options, database: memoryAdapter(database), rateLimit: { enabled: false } });
  const handler = accountAuthHandler(auth.handler, true, Date.now, async () => {});
  const call = (path: string, body?: object, headers: Record<string, string> = {}) => handler(new Request(`${settings.baseURL}/api/auth/${path}`, {
    method: body ? "POST" : "GET", headers: { Origin: settings.origins[0]!, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const drain = async () => {
    for (const intent of intents.splice(0)) {
      const tx = {
        verification: { create: async ({ data }: any) => database.verification!.push(data) },
        $queryRaw: async (_parts: unknown, email: string) => database.user!.filter(u => u.email === email),
      };
      const prepared = await prepareMailIntent(tx as any, intent, settings);
      if (prepared) await mail.send(await renderMailIntent({ ...intent, ...prepared }, settings));
    }
  };
  const signup = (username = "learner", email = "learner@example.test", emailProof?: string) =>
    call("sign-up/email", { username, email, emailProof, name: "Fixture", password });
  return { database, call, signup, mail, intents, drain, settings, fail: () => { failing = true; } };
}

test("initial signup sends mailbox proof equally for taken and free usernames without creating accounts", async () => {
  const f = admissionFixture();
  f.database.user!.push({ id: "existing", username: "taken", email: "existing@example.test", emailVerified: false });
  for (const username of ["taken", "free_name"]) {
    const response = await f.signup(username, `${username}@example.test`);
    expect(response.status).toBe(200);
    expect(f.intents).toHaveLength(1);
    await f.drain();
  }
  expect(f.mail.messages).toHaveLength(2);
  expect(f.mail.messages.every(m => m.text.includes("emailProof="))).toBe(true);
  expect(f.database.user).toHaveLength(1);
});

test("admission outages fail uniformly before account creation or reset token issuance", async () => {
  for (const path of ["sign-up/email", "request-password-reset", "send-verification-email"]) {
    const f = admissionFixture();
    f.database.user!.push({ id: "existing", username: "taken", email: "existing@example.test", emailVerified: false });
    f.fail();
    const responses = [];
    for (const email of ["existing@example.test", "absent@example.test"]) {
      const result = await f.call(path, { email, username: "free_name", name: "Fixture", password });
      responses.push({ status: result.status, body: await result.text() });
    }
    expect(responses[0]!.status).toBe(503);
    expect(responses[1]).toEqual(responses[0]);
    expect(f.database.user).toHaveLength(1);
    expect(f.database.verification.every(row => row.identifier.startsWith("signup-handoff:"))).toBe(true);
    expect(f.intents).toHaveLength(0);
  }
});

test("accepted reset leaves recoverable intent before token generation or provider delivery", async () => {
  const f = admissionFixture();
  f.database.user!.push({ id: "existing", email: "existing@example.test", emailVerified: true });
  expect((await f.call("request-password-reset", { email: "existing@example.test" })).status).toBe(200);
  expect(f.intents).toHaveLength(1);
  expect(f.database.verification).toHaveLength(0);
  expect(f.mail.messages).toHaveLength(0);
  await f.drain();
  expect(f.database.verification).toHaveLength(1);
  expect(f.mail.messages).toHaveLength(1);
});

test("mailbox proof binds email, expires, redeems once and precedes username availability", async () => {
  const f = admissionFixture();
  f.database.user!.push({ id: "existing", username: "taken", email: "existing@example.test", emailVerified: true });
  await f.signup("taken");
  await f.drain();
  const proof = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  expect((await f.signup("taken", "learner@example.test", "x".repeat(43))).status).toBe(400);
  expect((await f.signup("free_name", "other@example.test", proof)).status).toBe(400);
  const taken = await f.signup("taken", "learner@example.test", proof);
  expect((await taken.json() as { code?: string }).code).toBe("USERNAME_IS_ALREADY_TAKEN");
  expect(f.database.verification).toHaveLength(3);
  const completed = await f.signup("free_name", "learner@example.test", proof);
  expect(completed.status).toBe(200);
  expect(completed.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(completed.headers.get("set-cookie")).not.toContain("session_token");
  expect(f.database.user!.find(u => u.email === "learner@example.test").emailVerified).toBe(true);
  expect(f.database.verification).toHaveLength(0);
  expect((await f.signup("another", "learner@example.test", proof)).status).toBe(400);
  await f.signup("expired", "expired@example.test");
  await f.drain();
  const expired = new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  for (const row of f.database.verification!) row.expiresAt = new Date(0);
  expect((await f.signup("expired", "expired@example.test", expired)).status).toBe(400);
});

test("intent-issued reset redeems through native hashing, consumes once and revokes sessions", async () => {
  const f = admissionFixture();
  await f.signup(); await f.drain();
  const proof = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  expect((await f.signup("learner", "learner@example.test", proof)).status).toBe(200);
  expect((await f.call("sign-in/email", { email: "learner@example.test", password })).status).toBe(200);
  expect(f.database.session!.length).toBeGreaterThan(0);
  await f.call("request-password-reset", { email: "learner@example.test" }); await f.drain();
  const token = new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!).pathname.split("/").at(-1)!;
  const stored = f.database.verification![0].identifier;
  expect((await f.call("reset-password", { token: stored, newPassword: password })).status).toBe(400);
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(200);
  expect(f.database.session).toHaveLength(0);
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(400);
});

const proofFrom = (f: ReturnType<typeof admissionFixture>) =>
  new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
const cookieFrom = (response: Response) => response.headers.get("set-cookie")!.split(";")[0]!;

test("initial signup sets a fresh scoped handoff cookie even before mail delivery, with unchanged generic JSON", async () => {
  for (const secure of [false, true]) {
    const f = admissionFixture(secure);
    const first = await f.signup();
    expect(await first.json()).toEqual({ status: true, message: "If eligible, check your email for the link" });
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^infraforge_signup_handoff=[A-Za-z0-9_-]{43};/);
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/api/auth/signup-handoff", "Max-Age=1800"]) {
      expect(cookie).toContain(attribute);
    }
    expect(cookie.includes("Secure")).toBe(secure);
    expect(f.mail.messages).toHaveLength(0);
    expect(JSON.stringify(f.database.verification)).not.toContain(cookieFrom(first).split("=")[1]!);
    expect(cookieFrom(await f.signup())).not.toBe(cookieFrom(first));
  }
});

test("email confirmation on another device resumes only the original browser and completion erases handoff", async () => {
  const f = admissionFixture();
  const cookie = cookieFrom(await f.signup());
  const otherCookie = cookieFrom(await f.signup("other", "other@example.test"));
  const status = (Cookie?: string) => f.call("signup-handoff/status", undefined, Cookie ? { Cookie } : {});
  expect(await (await status(cookie)).json()).toEqual({ state: "pending" });
  await f.drain();
  const proof = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  for (let n = 0; n < 2; n++) {
    const confirmed = await f.call("signup-handoff/confirm", { emailProof: proof });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ email: "learner@example.test" });
  }
  const confirmed = await status(cookie);
  expect(confirmed.headers.get("cache-control")).toBe("no-store");
  expect(await confirmed.json()).toEqual({ state: "confirmed", email: "learner@example.test", emailProof: proof });
  expect(await (await status(otherCookie)).json()).toEqual({ state: "pending" });
  expect(await (await status()).json()).toEqual({ state: "expired" });
  expect(await (await status(`${HANDOFF_COOKIE}=${"x".repeat(43)}`)).json()).toEqual({ state: "expired" });
  expect(JSON.stringify(f.database.verification)).not.toContain(proof);
  expect((await f.signup("learner", "learner@example.test", proof)).headers.get("set-cookie")).toContain("Max-Age=0");
  expect(await (await status(cookie)).json()).toEqual({ state: "expired" });
  expect((await f.call("signup-handoff/confirm", { emailProof: proof })).status).toBe(400);
  expect(await (await status(otherCookie)).json()).toEqual({ state: "pending" });
});

test("handoff rejects invalid and expired proofs and cannot outlive proof expiry", async () => {
  const f = admissionFixture();
  const cookie = cookieFrom(await f.signup()); await f.drain();
  const proof = proofFrom(f);
  for (const emailProof of [null, "short", "x".repeat(43)]) {
    const response = await f.call("signup-handoff/confirm", { emailProof });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_PROOF" });
  }
  expect((await f.call("signup-handoff/confirm", { emailProof: proof })).status).toBe(200);
  for (const row of f.database.verification) row.expiresAt = new Date(0);
  expect(await (await f.call("signup-handoff/status", undefined, { Cookie: cookie })).json()).toEqual({ state: "expired" });
  expect((await f.call("signup-handoff/confirm", { emailProof: proof })).status).toBe(400);
});

test("username availability validates public handles and has a 120 per IP quota", async () => {
  const f = admissionFixture(false, true);
  f.database.user.push({ id: "existing", username: "taken", email: "existing@example.test" });
  expect(await (await f.call("is-username-available", { username: "Taken" })).json()).toEqual({ available: false });
  expect(await (await f.call("is-username-available", { username: "free_name" })).json()).toEqual({ available: true });
  for (const username of ["aa", "1name", "a".repeat(31), "bad name"]) {
    const response = await f.call("is-username-available", { username });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_USERNAME" });
  }
  for (let n = 6; n < 120; n++) expect((await f.call("is-username-available", { username: "free_name" })).status).toBe(200);
  expect((await f.call("is-username-available", { username: "free_name" })).status).toBe(429);
});

test("handoff confirmation enforces origin, Fetch Metadata and quotas; polling permits 30 minutes", async () => {
  const f = admissionFixture(false, true);
  const cookie = cookieFrom(await f.signup()); await f.drain();
  for (const path of ["signup-handoff/confirm", "is-username-available"]) {
    const body = { emailProof: proofFrom(f), username: "learner" };
    expect((await f.call(path, body, { Origin: "https://evil.invalid" })).status).toBe(403);
    expect((await f.call(path, body, { Origin: "", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" })).status).toBe(403);
  }
  for (let n = 0; n < 30; n++) expect((await f.call("signup-handoff/confirm", { emailProof: proofFrom(f) })).status).toBe(200);
  expect((await f.call("signup-handoff/confirm", { emailProof: proofFrom(f) })).status).toBe(429);
  for (let n = 0; n < 601; n++) {
    expect((await f.call("signup-handoff/status", undefined, { Cookie: cookie })).status).toBe(200);
  }
});

test("shared password checklist covers length and each composition rule", () => {
  const cases: [string, string[]][] = [
    ["Ab1!", ["length"]], ["a".repeat(125) + "Ab1!", ["length"]],
    ["ABCDEFG1!", ["lower"]], ["abcdefg1!", ["upper"]], ["Abcdefg!!", ["digit"]],
    ["Abcdefg12", ["symbol"]], ["Abcdefg1é", ["symbol"]], ["Abcdefg1９", ["symbol"]],
    ["Abcdef1!", []], ["a".repeat(124) + "Ab1!", []], ["Abcdef1 ", []], ["Abcdef1💡", []],
  ];
  for (const [value, failed] of cases) {
    expect(passwordChecks(value).filter(check => !check.ok).map(check => check.id)).toEqual(failed);
    expect(passwordAcceptable(value)).toBe(failed.length === 0);
  }
});

test("weak signup/reset/change passwords are rejected before hashing and leave proofs usable", async () => {
  const f = admissionFixture(); await f.signup(); await f.drain();
  const emailProof = proofFrom(f);
  const rejected = await f.call("sign-up/email", { emailProof, email: "learner@example.test", username: "learner", name: "Fixture", password: "alllowercase" });
  expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ code: "PASSWORD_TOO_WEAK" });
  expect(breach.requests).toHaveLength(0);
  expect((await f.signup("learner", "learner@example.test", emailProof)).status).toBe(200);
  await f.call("request-password-reset", { email: "learner@example.test" }); await f.drain();
  const token = new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!).pathname.split("/").at(-1)!;
  for (const path of ["reset-password", "change-password"]) {
    const response = await f.call(path, { token, newPassword: "alllowercase", currentPassword: password });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "PASSWORD_TOO_WEAK" });
  }
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(200);
});

test("HIBP rejects compromised passwords using only a hash prefix and fails open with a fixed log", async () => {
  const f = admissionFixture(); await f.signup(); await f.drain();
  const proof = proofFrom(f);
  breach.compromised = password;
  const refused = await f.signup("learner", "learner@example.test", proof);
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ code: "PASSWORD_COMPROMISED", message: "This password appeared in a data breach. Choose another." });
  expect(f.database.user).toHaveLength(0);
  expect(breach.requests).toHaveLength(1);
  expect(breach.requests[0]).toMatch(/^https:\/\/api.pwnedpasswords.com\/range\/[A-F0-9]{5}$/);
  breach.unavailable = true;
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await f.signup("learner", "learner@example.test", proof)).status).toBe(200);
    expect(log.mock.calls).toEqual([["Password breach check unavailable"]]);
  } finally { log.mockRestore(); }
});

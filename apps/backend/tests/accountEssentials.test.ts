import { expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { createAuth } from "../auth/createAuth";
import { readAuthSettings } from "../auth/settings";
import { FakeEmail, ResendEmail, SesEmail, emailDispatcher } from "../auth/email";
import { FakeChallenge, Turnstile, readChallenge } from "../auth/turnstile";
import { accountAuthHandler, enforceAccountPolicy, RedisAccountQuota, type AccountQuota } from "../auth/accountPolicy";
import { verificationHash, consumeVerification, registerVerification } from "../auth/verification";
import { deleteAccount, exportAccountPage, exportSections } from "../auth/accountData";
import { symmetricEncrypt } from "better-auth/crypto";
import { prepareMailIntent, renderMailIntent } from "../auth/mailIntent";
import { createOriginCheck } from "../auth/origin";

const config = { BETTER_AUTH_SECRET: "fixture-only-secret-at-least-32-characters", BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: "http://localhost:5173" };
const password = "fixture-only-password-long-enough";
let requestSequence = 0;
class Quota implements AccountQuota {
  counts = new Map<string, number>();
  async allow(scope: string, identity: string, max: number) {
    const key = `${scope}:${identity}`, count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count); return count <= max;
  }
}
function fixture(enabled = true, verificationRequired = true) {
  const mail = new FakeEmail(), challenge = new FakeChallenge(), quota = new Quota();
  const ledger = new Map<string, { expiresAt: Date; usedAt: Date | null }>();
  const tokenStore = {
    upsert: async (q: any) => { if (!ledger.has(q.where.hash)) ledger.set(q.where.hash, { ...q.create, usedAt: null }); },
    updateMany: async (q: any) => { const row = ledger.get(q.where.hash);
      if (!row || q.where.usedAt === null && row.usedAt || q.where.expiresAt?.gt && row.expiresAt <= q.where.expiresAt.gt) return { count: 0 };
      row.usedAt = q.data.usedAt; return { count: 1 }; },
  };
  const prisma = { accountEmailToken: tokenStore,
    $queryRaw: async (_sql: TemplateStringsArray, userId: string, hash: string, expiresAt: Date) => {
      if (!ledger.has(hash)) ledger.set(hash, { expiresAt, usedAt: null });
      return [{ id: userId }];
    },
  } as unknown as PrismaClient;
  const defaults = readAuthSettings(config);
  const settings = { ...defaults, accountEssentials: { ...defaults.accountEssentials, enabled, emailEnabled: enabled, verificationRequired, email: mail, challenge: enabled ? challenge : undefined, siteKey: undefined } };
  const database: { user: any[]; session: any[]; account: any[]; verification: any[] } = {
    user: [], session: [], account: [], verification: [],
  };
  const admission = { wait: async () => {} };
  const options = createAuth(prisma, settings, quota, { admit: async (kind, email, callbackURL) => {
    await admission.wait();
    const intent = { id: crypto.randomUUID(), kind, expiresAt: new Date(Date.now() + 1800_000),
      payload: await symmetricEncrypt({ key: settings.secret, data: JSON.stringify({ email, callbackURL }) }) };
    const tx = { verification: { create: async ({ data }: any) => database.verification.push(data) },
      $queryRaw: async (parts: TemplateStringsArray, ...args: any[]) => parts.join("").trimStart().startsWith('SELECT id, "emailVerified"')
        ? database.user.filter(u => u.email === args[0]) : (prisma.$queryRaw as any)(parts, ...args) };
    const prepared = await prepareMailIntent(tx as any, intent, settings);
    if (prepared) await mail.send(await renderMailIntent({ ...intent, ...prepared }, settings));
  } }).options;
  // Exercise the actual pinned library handlers/hashing/tokens. Only persistence
  // and external delivery/challenge verification are replaced in this unit suite.
  const auth = betterAuth({ ...options, database: memoryAdapter(database) });
  const handler = accountAuthHandler(auth.handler, enabled, Date.now, async () => {});
  const call = (path: string, body?: object, extra: Record<string, string> = {}) => {
    const ip = `198.18.${Math.floor(++requestSequence / 250)}.${requestSequence % 250 + 1}`;
    return handler(new Request(`${config.BETTER_AUTH_URL}/api/auth/${path}`, {
    method: body ? "POST" : "GET", headers: { Origin: config.APP_ORIGINS, "Content-Type": "application/json",
      "x-forwarded-for": ip, "x-infraforge-client-ip": ip, ...extra }, body: body ? JSON.stringify(body) : undefined,
  })); };
  const signup = async () => {
    const body = { username: "Learner", name: "Test learner", email: "learner@example.test",
      password, turnstileToken: "fixture-pass" };
    const begun = await call("sign-up/email", body);
    if (!enabled || !begun.ok) return begun;
    const emailProof = link(mail).searchParams.get("emailProof");
    return call("sign-up/email", { ...body, emailProof });
  };
  const legacyUnverified = async () => {
    await signup(); database.user[0].emailVerified = false;
    await call("send-verification-email", { email: "learner@example.test" });
  };
  return { auth, call, signup, legacyUnverified, ledger, prisma, database, mail, quota, challenge, admission };
}
const link = (mail: FakeEmail) => new URL(mail.messages.at(-1)!.text.split(" ").at(-1)!);
const delivered = () => new Promise(resolve => setTimeout(resolve, 5));

test("account essentials default off; partial and fake provider configs fail startup", () => {
  expect(readAuthSettings(config).accountEssentials.enabled).toBe(false);
  for (const extra of [{ ACCOUNT_ESSENTIALS_ENABLED: "true" }, { TRANSACTIONAL_EMAIL_PROVIDER: "fake" },
    { TRANSACTIONAL_EMAIL_PROVIDER: "resend" }, { TURNSTILE_SECRET_KEY: "incomplete" }, { ACCOUNT_ESSENTIALS_ENABLED: "yes" }]) {
    expect(() => readAuthSettings({ ...config, ...extra })).toThrow();
  }
  expect(readChallenge({})).toBeUndefined();
});

test("native credential flow stays sessionful when essentials are disabled", async () => {
  const f = fixture(false), response = await f.signup();
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("session_token");
  expect(f.mail.messages).toHaveLength(0);
  for (const path of ["request-password-reset", "send-verification-email", "reset-password", "delete-user"]) {
    expect((await f.call(path, { email: "learner@example.test" })).status).toBe(404);
  }
  expect((await f.call("reset-password/unissued-fixture?callbackURL=http%3A%2F%2Flocalhost%3A5173")).status).toBe(404);
});

test("native signup challenge fails closed before user creation", async () => {
  const f = fixture(); f.challenge.accepted = false;
  expect((await f.signup()).status).toBe(403);
  expect(f.database.user).toHaveLength(0); expect(f.mail.messages).toHaveLength(0);
  expect(f.challenge.calls[0]).toEqual({ token: "fixture-pass", action: "signup" });
});

test("native email verification expires and redeems once, including concurrent replay", async () => {
  const f = fixture(), signup = await f.signup();
  f.database.user[0].emailVerified = false;
  await f.call("send-verification-email", { email: "learner@example.test" });
  expect(signup.status).toBe(200); expect(signup.headers.get("set-cookie")).toBeNull();
  expect(f.database.user[0].emailVerified).toBe(false);
  const token = link(f.mail).searchParams.get("token")!;
  expect(f.ledger.has(verificationHash(token))).toBe(true);
  const responses = await Promise.all([f.call(`verify-email?token=${token}`), f.call(`verify-email?token=${token}`)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  expect(f.database.user[0].emailVerified).toBe(true);
  expect(JSON.stringify([...f.ledger])).not.toContain(token);
  const expired = fixture(); await expired.legacyUnverified();
  for (const row of expired.ledger.values()) row.expiresAt = new Date(0);
  expect((await expired.call(`verify-email?token=${link(expired.mail).searchParams.get("token")}`)).status).toBe(400);
  expect(expired.database.user[0].emailVerified).toBe(false);
});

test("native reset uses expiring single-use tokens and revokes old sessions", async () => {
  const f = fixture(); await f.signup(); await delivered();
  await f.call(`verify-email?token=${link(f.mail).searchParams.get("token")}`);
  expect((await f.call("sign-in/email", { email: "learner@example.test", password })).status).toBe(200);
  expect(f.database.session.length).toBeGreaterThan(0);
  expect((await f.call("request-password-reset", { email: "learner@example.test", redirectTo: `${config.APP_ORIGINS}/reset`, turnstileToken: "fixture-pass" })).status).toBe(200);
  await delivered();
  const token = link(f.mail).pathname.split("/").at(-1)!;
  expect((await f.call("reset-password", { token, newPassword: "new-fixture-password-long-enough" })).status).toBe(200);
  expect(f.database.session).toHaveLength(0);
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(400);
  await f.call("request-password-reset", { email: "learner@example.test", turnstileToken: "fixture-pass" }); await delivered();
  for (const v of f.database.verification!) v.expiresAt = new Date(0);
  expect((await f.call("reset-password", { token: link(f.mail).pathname.split("/").at(-1), newPassword: password })).status).toBe(400);
});

test("stored reset identifiers cannot redeem the emailed reset credential", async () => {
  const f = fixture();
  await f.signup();
  await f.call("request-password-reset", {
    email: "learner@example.test", turnstileToken: "fixture-pass",
  });
  const token = link(f.mail).pathname.split("/").at(-1)!;
  const stored = f.database.verification.at(-1)!.identifier;
  expect(stored).not.toContain(token);
  expect(JSON.stringify(f.database.verification)).not.toContain(token);
  expect((await f.call("reset-password", {
    token: stored.replace(/^reset-password:/, ""), newPassword: password,
  })).status).toBe(400);
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(200);
});

test("email requests return identical responses for absent, verified and unverified accounts, with cookies", async () => {
  for (const verified of [false, true]) {
    const f = fixture(); await f.signup(); await delivered();
    f.database.user[0].emailVerified = verified;
    for (const path of ["request-password-reset", "send-verification-email"]) {
      const existing = await f.call(path, { email: "learner@example.test", turnstileToken: "fixture-pass" }, { Cookie: "irrelevant=fixture" });
      const absent = await f.call(path, { email: "absent@example.test", turnstileToken: "fixture-pass" });
      expect(existing.status).toBe(200); expect(await existing.text()).toBe(await absent.text());
    }
  }
});

test("email wrapper pads successful and rejected requests and removes session-dependent branching", async () => {
  const waits: number[] = [];
  const wrapped = accountAuthHandler(async req => { expect(req.headers.has("cookie")).toBe(false); return Response.json({ status: true }); }, true,
    () => 100, async ms => { waits.push(ms); });
  const response = await wrapped(new Request("http://localhost/api/auth/request-password-reset", { method: "POST", headers: { Cookie: "fixture" } }));
  expect(waits).toEqual([750]); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

test("per-account quota is case-normalized and independent of IP; IP quota bounds distinct accounts", async () => {
  const quota = new Quota();
  for (let i = 0; i < 3; i++) await enforceAccountPolicy({ path: "/request-password-reset", body: { email: " Alice@Example.test " }, ip: `${i}`, enabled: true, quota });
  await expect(enforceAccountPolicy({ path: "/request-password-reset", body: { email: "alice@example.test" }, ip: "new-ip", enabled: true, quota })).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
  const other = new Quota();
  for (let i = 0; i < 20; i++) await enforceAccountPolicy({ path: "/request-password-reset", body: { email: `${i}@example.test` }, ip: "same-ip", enabled: true, quota: other });
  await expect(enforceAccountPolicy({ path: "/request-password-reset", body: { email: "new@example.test" }, ip: "same-ip", enabled: true, quota: other })).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
});

test("configured challenges and quota outages fail closed", async () => {
  const quota = new Quota(), challenge = new FakeChallenge(false);
  await expect(enforceAccountPolicy({ path: "/request-password-reset", enabled: true, ip: "fixture", quota, challenge })).rejects.toMatchObject({ status: "FORBIDDEN" });
  await expect(enforceAccountPolicy({ path: "/request-password-reset", enabled: true, ip: "fixture", quota: { allow: async () => { throw Error("private provider data"); } } })).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
});

test("native email/reset routes enforce trusted callback origins", async () => {
  const f = fixture();
  expect((await f.call("request-password-reset", { email: "absent@example.test", redirectTo: "http://evil.invalid/reset", turnstileToken: "fixture" })).status).toBe(403);
  expect((await f.call("send-verification-email", { email: "absent@example.test", callbackURL: "http://evil.invalid/verify" })).status).toBe(403);
  expect(f.mail.messages).toHaveLength(0);
});

test("outer origin guard rejects missing/forbidden origins on unsafe auth and account requests", () => {
  for (const origin of [undefined, "", "null", "http://evil.invalid", config.APP_ORIGINS]) {
    let status = 200, continued = false;
    const response: any = { status: (n: number) => { status = n; return response; }, json: () => {} };
    createOriginCheck([config.APP_ORIGINS])({ method: "POST", headers: { origin } } as any, response, () => { continued = true; });
    expect(continued).toBe(origin === config.APP_ORIGINS);
    expect(status).toBe(origin === config.APP_ORIGINS ? 200 : 403);
  }
});

test("email dispatcher bounds in-flight work without returning provider details", async () => {
  let release!: () => void, errors = 0, sends = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const dispatch = emailDispatcher({ send: async () => { sends++; await waiting; } }, () => { errors++; });
  for (let n = 0; n < 40; n++) dispatch({ to: "fixture@example.test", subject: "fixture", text: "fixture" });
  await delivered(); expect(sends).toBe(32); expect(errors).toBe(8);
  release(); await delivered();
});

test("signup waits for durable admission before accepting or delivering", async () => {
  const f = fixture();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.admission.wait = () => waiting;
  let accepted = false;
  const signup = f.signup().then(response => { accepted = true; return response; });
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(accepted).toBe(false); expect(f.mail.messages).toHaveLength(0);
  release(); expect((await signup).status).toBe(200); expect(f.mail.messages).toHaveLength(1);
});

test("verified-email signup masks duplicate username, email and absent identifiers with no session", async () => {
  const f = fixture();
  await f.signup();
  const expected = JSON.stringify({ status: true, message: "If eligible, check your email for the link" });
  for (const [username, email] of [["Learner", "fresh@example.test"], ["fresh_name", "learner@example.test"], ["fresh_name", "fresh@example.test"]]) {
    const response = await f.call("sign-up/email", { username, email, name: "Name", password, turnstileToken: "fixture" });
    expect(response.status).toBe(200); expect(await response.text()).toBe(expected);
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  expect(f.database.user).toHaveLength(1);
  expect(f.database.account).toHaveLength(1);
  expect(f.mail.messages).toHaveLength(4);
});

test("invalid signup input is rejected consistently before username membership lookup", async () => {
  const f = fixture(); await f.signup();
  for (const bad of [{ email: "invalid", password }, { email: "x".repeat(255) + "@example.test", password }]) {
    const responses = await Promise.all(["Learner", "new_name"].map(username => f.call("sign-up/email", { username, name: "Name", ...bad, turnstileToken: "fixture" })));
    expect(responses[0]!.status).toBe(400);
    expect(await responses[0]!.text()).toBe(await responses[1]!.text());
  }
});

test("optional verification sends mail and keeps signup generic while allowing password sign-in", async () => {
  const f = fixture(true, false);
  expect((await f.signup()).headers.get("set-cookie")).toBeNull();
  expect(f.mail.messages).toHaveLength(1);
  expect((await f.call("sign-in/email", { email: "learner@example.test", password })).status).toBe(200);
  const taken = await f.call("sign-up/email", { username: "Learner", email: "another@example.test", name: "Name", password, turnstileToken: "fixture" });
  expect(await taken.json()).toEqual({ status: true, message: "If eligible, check your email for the link" });
});

test("signup callback rejection cannot enumerate usernames", async () => {
  const f = fixture(); await f.signup();
  for (const bad of [{ callbackURL: "https://evil.invalid", name: "Name" }]) {
    const responses = await Promise.all(["Learner", "fresh_name"].map(username => f.call("sign-up/email", { username, email: "fresh@example.test", password, turnstileToken: "fixture", ...bad })));
    expect(responses[0]!.status).toBe(responses[1]!.status);
    expect(responses[0]!.ok).toBe(false);
    expect(await responses[0]!.text()).toBe(await responses[1]!.text());
  }
});

test("shared Redis quotas store only keyed hashes with expiry", async () => {
  const calls: any[] = [];
  const quota = new RedisAccountQuota({ eval: async (...args) => { calls.push(args); return 4; } }, "fixture-key");
  expect(await quota.allow("reset", "private@example.test", 3)).toBe(false);
  expect(JSON.stringify(calls)).not.toContain("private@example.test");
  expect(calls[0][0]).toContain("EXPIRE"); expect(calls[0][2]).toMatch(/^account-quota:[a-f0-9]{64}$/);
});

test("Turnstile checks hostname and action and rejects replay/error/timeout responses", async () => {
  for (const result of [{ success: false }, { success: true, hostname: "evil.test", action: "signup" }, { success: true, hostname: "app.test", action: "wrong" },
    { success: true, hostname: "app.test", action: "signup" }]) {
    const adapter = new Turnstile("fixture-secret", ["app.test"], (async () => Response.json(result)) as unknown as typeof fetch);
    expect(await adapter.verify("token", "signup")).toBe(result.success && result.hostname === "app.test" && result.action === "signup");
    expect(await adapter.verify("", "signup")).toBe(false);
  }
  expect(await new Turnstile("fixture", ["app.test"], (async () => { throw Error("secret"); }) as unknown as typeof fetch).verify("token", "signup")).toBe(false);
});

test("email transports use fixed HTTPS endpoints and sanitize all provider failures", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const transport = (async (url: string, init: RequestInit) => { requests.push({ url, init }); return Response.json({}); }) as typeof fetch;
  const message = { to: "fixture@example.test", subject: "fixture", text: "fixture token" };
  await new ResendEmail("fixture-key", "sender@example.test", transport).send(message);
  await new SesEmail({ region: "us-east-1", accessKey: "fixture-access", secretKey: "fixture-secret", from: "sender@example.test" }, transport, () => new Date("2026-10-22T00:00:00Z")).send(message);
  expect(requests.map(r => r.url)).toEqual(["https://api.resend.com/emails", "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails"]);
  expect((requests[1]!.init.headers as any).authorization).toContain("20261022/us-east-1/ses/aws4_request");
  const bad = (async () => { throw Error("private@example.test secret body"); }) as unknown as typeof fetch;
  await expect(new ResendEmail("fixture", "sender@example.test", bad).send(message)).rejects.toThrow("Transactional email delivery failed");
  const errors: string[] = [];
  const send = emailDispatcher({ send: async () => { throw Error("private@example.test secret body"); } }, () => { errors.push("fixed failure"); });
  send(message); await delivered(); expect(errors).toEqual(["fixed failure"]);
});

test("deletion refuses active runs before touching profile, credentials or history", async () => {
  for (const active of ["deployment", "internalModel2Run", "firstStackRun"]) {
    const tx: any = { $queryRaw: async () => [{ id: "alice", deletedAt: null }] };
    for (const model of ["deployment", "internalModel2Run", "firstStackRun"]) tx[model] = { count: async () => model === active ? 1 : 0 };
    await expect(deleteAccount({ $transaction: async (work: any) => work(tx) } as PrismaClient, "alice")).rejects.toMatchObject({ statusCode: 409 });
  }
});

test("every export section includes authenticated parent ownership and excludes worker credentials", async () => {
  for (const section of exportSections) {
    const queries: any[] = [], fake: any = {};
    for (const model of ["infrastructure", "deployment", "runAction", "runEvidenceSample", "internalModel2Run", "internalModel2LessonRun", "firstStackRun", "firstStackCut", "firstStackResult"]) {
      fake[model] = { findMany: async (q: any) => { queries.push(q); return []; } };
    }
    expect((await exportAccountPage(fake, "alice", section)).records).toEqual([]);
    expect(JSON.stringify(queries[0].where)).toContain('"ownerId":"alice"');
    if (section === "internalRuns") expect(queries[0].select.token).toBeUndefined();
  }
});

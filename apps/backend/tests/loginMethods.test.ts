import { expect, test } from "bun:test";
import { readAuthSettings } from "../auth/settings";
import { HOSTED_LOGIN_ORIGIN, LOGIN_FLAGS, returnURL } from "../auth/loginMethods";
import { loginEnvironment, loginFixture } from "./loginMethodsFixture";
import { emailOTP } from "better-auth/plugins";
import { accountAuthHandler, enforceAccountPolicy } from "../auth/accountPolicy";

test("new settings default off, explicit off is identical, and partial email login fails closed", () => {
  expect(readAuthSettings(loginEnvironment)).toEqual(readAuthSettings({ ...loginEnvironment,
    ...Object.fromEntries(LOGIN_FLAGS.map(flag => [flag, "false"])) }));
  for (const flag of LOGIN_FLAGS) expect(() => readAuthSettings({ ...loginEnvironment, [flag]: "yes" })).toThrow();
  for (const flag of ["AUTH_MAGIC_LINK_ENABLED", "AUTH_EMAIL_OTP_ENABLED"]) {
    expect(() => readAuthSettings({ ...loginEnvironment, [flag]: "true" })).toThrow("Resend and Turnstile");
  }
  const hosted = readAuthSettings({ ...loginEnvironment, AUTH_HOSTED_LOGIN_ENABLED: "true" });
  expect(hosted.origins).toContain(HOSTED_LOGIN_ORIGIN);
  expect(hosted.returnOrigins).toEqual([loginEnvironment.APP_ORIGINS]);
  expect(hosted.baseURL).toBe(loginEnvironment.BETTER_AUTH_URL);
});

export const rejectedReturns = ["https://evil.test", "//evil.test", "///evil.test", "\\\\evil.test",
  "https://localhost:5173@evil.test", "http://user@localhost:5173/", "http://localhost:5173.evil.test/",
  "http://localhost:5173\\@evil.test", "javascript:alert(1)", "data:text/html,hi",
  "%2f%2fevil.test", "/%2f%2fevil.test", "/%252f%252fevil.test", "https%3a%2f%2fevil.test",
  "http://local%68ost:5173", "/%5cevil.test", "/\nevil", " http://localhost:5173", "https://evil.test/#@localhost:5173"];
test("return URLs reject every ambiguous form and allow only configured app origins", async () => {
  const f = loginFixture({ AUTH_MAGIC_LINK_ENABLED: "true", AUTH_HOSTED_LOGIN_ENABLED: "true" });
  for (const value of rejectedReturns) {
    expect(() => returnURL(value, f.settings.returnOrigins)).toThrow();
    const response = await f.call("sign-in/magic-link", { email: "victim@example.test", callbackURL: value });
    expect(response.status).toBe(403);
  }
  expect(f.intents).toHaveLength(0);
  expect(returnURL("/designs?tab=saved", f.settings.returnOrigins)).toBe("http://localhost:5173/designs?tab=saved");
  expect(returnURL("http://localhost:5173/designs", f.settings.returnOrigins)).toBe("http://localhost:5173/designs");
});

test("magic and OTP requests are generic durable admissions with challenge and quota", async () => {
  for (const [flag, path, extra] of [
    ["AUTH_MAGIC_LINK_ENABLED", "sign-in/magic-link", {}],
    ["AUTH_EMAIL_OTP_ENABLED", "email-otp/send-verification-otp", { type: "sign-in" }],
  ] as const) {
    const f = loginFixture({ [flag]: "true" }); f.addUser(); f.addUser("unverified@example.test", false);
    const responses = [];
    for (const email of ["victim@example.test", "absent@example.test", "unverified@example.test"]) {
      const response = await f.call(path, { email, ...extra });
      responses.push([response.status, await response.text(), response.headers.get("set-cookie")]);
    }
    expect(responses[0]).toEqual(responses[1]); expect(responses[1]).toEqual(responses[2]);
    expect(responses[0]![0]).toBe(200); expect(responses[0]![2]).toBeNull();
    expect(f.intents).toHaveLength(3); expect(f.database.verification).toHaveLength(0);
    expect(f.challenge.calls).toHaveLength(3); expect(f.challenge.calls[0]!.action).toBe("email_login");
    expect(f.scopes).toContain("email-request:account");
    await f.drain(); expect(f.mail.messages).toHaveLength(1); expect(f.database.user).toHaveLength(2);
    f.challenge.accepted = false;
    expect((await f.call(path, { email: "victim@example.test", ...extra })).status).toBe(403);
    f.challenge.accepted = true; f.fail();
    for (const email of ["victim@example.test", "absent@example.test"]) {
      expect((await f.call(path, { email, ...extra })).status).toBe(503);
    }
    f.denyQuota(); expect((await f.call(path, { email: "victim@example.test", ...extra })).status).toBe(429);
  }
});

test("magic tokens are hashed, expire and mint at most one session through native redemption", async () => {
  const f = loginFixture({ AUTH_MAGIC_LINK_ENABLED: "true" }); f.addUser();
  await f.call("sign-in/magic-link", { email: " VICTIM@example.test " }); await f.drain();
  const url = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!);
  const token = url.searchParams.get("token")!;
  expect(JSON.stringify(f.database.verification)).not.toContain(token);
  expect(f.database.verification![0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(900_000);
  const path = url.href.split("/api/auth/")[1]!;
  const results = await Promise.all([f.call(path), f.call(path)]);
  expect(results.filter(r => r.headers.has("set-cookie"))).toHaveLength(1);
  expect(f.database.session).toHaveLength(1);
  await f.call("sign-in/magic-link", { email: "victim@example.test" }); await f.drain();
  f.database.verification![0].expiresAt = new Date(0);
  const expired = new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!);
  expect((await f.call(expired.href.split("/api/auth/")[1]!)).headers.has("set-cookie")).toBe(false);
});

test("OTP is six digits, keyed at rest, expires, locks after three wrong attempts and is single use", async () => {
  const f = loginFixture({ AUTH_EMAIL_OTP_ENABLED: "true" }); f.addUser();
  const issue = async () => {
    await f.call("email-otp/send-verification-otp", { email: "victim@example.test", type: "sign-in" });
    await f.drain(); return f.mail.messages.at(-1)!.text.match(/\b\d{6}\b/)![0];
  };
  const redeem = (otp: string) => f.call("sign-in/email-otp", { email: " VICTIM@example.test ", otp });
  let otp = await issue();
  expect(JSON.stringify(f.database.verification)).not.toContain(otp);
  expect(f.database.verification![0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600_000);
  const wrong = otp === "000000" ? "000001" : "000000";
  const absent = await f.call("sign-in/email-otp", { email: "absent@example.test", otp: wrong });
  const failure = [absent.status, await absent.text()];
  for (let i = 0; i < 3; i++) {
    const response = await redeem(wrong); expect([response.status, await response.text()]).toEqual(failure);
  }
  const locked = await redeem(otp); expect([locked.status, await locked.text()]).toEqual(failure);
  expect(f.database.session).toHaveLength(0);
  otp = await issue();
  const results = await Promise.all([redeem(otp), redeem(otp)]);
  expect(results.filter(r => r.ok)).toHaveLength(1); expect(f.database.session).toHaveLength(1);
  otp = await issue(); f.database.verification![0].expiresAt = new Date(0);
  expect((await redeem(otp)).ok).toBe(false);
  expect((await f.call("email-otp/check-verification-otp", { email: "victim@example.test", otp, type: "sign-in" })).status)
    .toBe(404);
});

test("email login timing floor and cookie stripping do not depend on account membership", async () => {
  for (const path of ["sign-in/magic-link", "email-otp/send-verification-otp"]) {
    const delays: number[] = [];
    const handler = accountAuthHandler(async request => {
      expect(request.headers.has("cookie")).toBe(false); return Response.json({ status: true });
    }, true, () => 100, async ms => { delays.push(ms); }, { magicLink: true, emailOtp: true });
    for (const email of ["victim@example.test", "absent@example.test"]) {
      const response = await handler(new Request(`${loginEnvironment.BETTER_AUTH_URL}/api/auth/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", cookie: "fixture-session" },
        body: JSON.stringify({ email }),
      }));
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(delays).toEqual([750, 750]);
  }
});

test("shared OTP quota bounds even concurrent guesses and resends to three attempts per email", async () => {
  const counts = new Map<string, number>();
  const quota = { allow: async (scope: string, identity: string, maximum: number) => {
    const key = `${scope}:${identity}`, n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n <= maximum;
  } };
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => enforceAccountPolicy({
    path: "/sign-in/email-otp", body: { email: " VICTIM@example.test ", otp: String(i) },
    ip: `fixture-${i}`, enabled: true, loginMethods: { magicLink: false, emailOtp: true }, quota,
  })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
});

test("negative controls demonstrate OTP attempts and native-plus-ledger single use", async () => {
  const unsafe = loginFixture({ AUTH_EMAIL_OTP_ENABLED: "true" }, options => {
    options.plugins = options.plugins.map((p: any) => p.id === "email-otp"
      ? emailOTP({ ...p.options, allowedAttempts: 99 }) : p);
  });
  unsafe.addUser();
  await unsafe.call("email-otp/send-verification-otp", { email: "victim@example.test", type: "sign-in" });
  await unsafe.drain();
  const otp = unsafe.mail.messages[0]!.text.match(/\b\d{6}\b/)![0];
  for (let i = 0; i < 3; i++) {
    await unsafe.call("sign-in/email-otp", { email: "victim@example.test", otp: otp === "000000" ? "000001" : "000000" });
  }
  expect((await unsafe.call("sign-in/email-otp", { email: "victim@example.test", otp })).ok).toBe(true);
  const replay = loginFixture({ AUTH_MAGIC_LINK_ENABLED: "true" }, options => {
    delete options.databaseHooks.session;
  });
  replay.addUser();
  const ctx = await replay.auth.$context;
  ctx.internalAdapter.consumeVerificationValue = ctx.internalAdapter.findVerificationValue;
  await replay.call("sign-in/magic-link", { email: "victim@example.test" }); await replay.drain();
  const path = new URL(replay.mail.messages[0]!.text.split("\n").at(-1)!).href.split("/api/auth/")[1]!;
  expect((await replay.call(path)).headers.has("set-cookie")).toBe(true);
  expect((await replay.call(path)).headers.has("set-cookie")).toBe(true);
  expect(replay.database.session).toHaveLength(2);
});

test("prepared email proofs cannot create sessions for a replacement mailbox owner", async () => {
  const f = loginFixture({ AUTH_MAGIC_LINK_ENABLED: "true" }); const user = f.addUser();
  await f.call("sign-in/magic-link", { email: user.email }); await f.drain();
  const path = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!).href.split("/api/auth/")[1]!;
  // Simulate an in-flight native record surviving deletion. The second guard
  // still binds its successful session to the originally verified user ID.
  user.email = "deleted@deleted.invalid"; f.addUser();
  expect((await f.call(path)).headers.has("set-cookie")).toBe(false);
  expect(f.database.session).toHaveLength(0);
});

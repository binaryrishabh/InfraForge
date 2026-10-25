import { expect, test } from "bun:test";
import { readAuthSettings } from "../auth/settings";
import { HOSTED_LOGIN_ORIGIN, LOGIN_FLAGS, returnURL } from "../auth/loginMethods";
import { loginEnvironment, loginFixture } from "./loginMethodsFixture";

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
  for (let i = 0; i < 3; i++) expect((await redeem(wrong)).ok).toBe(false);
  expect((await redeem(otp)).ok).toBe(false); expect(f.database.session).toHaveLength(0);
  otp = await issue();
  const results = await Promise.all([redeem(otp), redeem(otp)]);
  expect(results.filter(r => r.ok)).toHaveLength(1); expect(f.database.session).toHaveLength(1);
  otp = await issue(); f.database.verification![0].expiresAt = new Date(0);
  expect((await redeem(otp)).ok).toBe(false);
  expect((await f.call("email-otp/check-verification-otp", { email: "victim@example.test", otp, type: "sign-in" })).status)
    .toBe(404);
});

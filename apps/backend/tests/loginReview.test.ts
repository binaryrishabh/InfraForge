import { expect, test, spyOn } from "bun:test";
import { loginFixture, loginEnvironment } from "./loginMethodsFixture";
import { accountAuthHandler } from "../auth/accountPolicy";
import { readMailPayload } from "../auth/mailIntent";

async function proof(f: ReturnType<typeof loginFixture>, magic: boolean) {
  await f.call(magic ? "sign-in/magic-link" : "email-otp/send-verification-otp",
    { email: "victim@example.test", type: "sign-in" });
  await f.drain();
  const text = f.mail.messages.at(-1)!.text;
  const path = magic ? new URL(text.split("\n").at(-1)!).href.split("/api/auth/")[1]! : "sign-in/email-otp";
  const body = magic ? undefined : { email: "victim@example.test", otp: text.match(/\b\d{6}\b/)![0] };
  return { path, body };
}

test("all non-login OTP public endpoints and legacy aliases are disabled", async () => {
  const f = loginFixture({ AUTH_EMAIL_OTP_ENABLED: "true" }); f.addUser();
  f.challenge.accepted = false; f.denyQuota();
  for (const path of ["email-otp/check-verification-otp", "email-otp/verify-email", "forget-password/email-otp",
    "email-otp/forget-password", "email-otp/request-password-reset", "email-otp/reset-password",
    "email-otp/request-email-change", "email-otp/change-email"]) {
    for (const email of ["victim@example.test", "absent@example.test"]) {
      expect((await f.call(path, { email, otp: "123456", password: "fixture-long-password",
        newEmail: "other@example.test", type: "forget-password" })).status).toBe(404);
    }
  }
  expect(f.database.verification).toHaveLength(0);
  expect(f.intents).toHaveLength(0);
  for (const type of ["email-verification", "forget-password", "change-email"]) {
    const allowed = loginFixture({ AUTH_EMAIL_OTP_ENABLED: "true" });
    expect((await allowed.call("email-otp/send-verification-otp", { email: "victim@example.test", type })).ok).toBe(false);
    expect(allowed.intents).toHaveLength(0);
  }
});

test("redemption requires a fresh challenge before consuming either proof", async () => {
  for (const magic of [true, false]) {
    const f = loginFixture({ [magic ? "AUTH_MAGIC_LINK_ENABLED" : "AUTH_EMAIL_OTP_ENABLED"]: "true" }); f.addUser();
    const consumed = new Set<string>();
    f.challenge.verify = async (token, action) => {
      f.challenge.calls.push({ token, action });
      if (action === "email_login") return true;
      if (action !== "email_login_redeem" || !token.startsWith("fresh-") || consumed.has(token)) return false;
      consumed.add(token); return true;
    };
    let p = await proof(f, magic);
    const rows = structuredClone(f.database.verification);
    for (const token of [null, "", "invalid"]) {
      const response = await f.call(p.path, p.body, undefined, token);
      if (magic && token === null) {
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('method="get"'); expect(html).toContain('data-action="email_login_redeem"');
        expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
      } else expect(response.ok).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(f.database.session).toHaveLength(0);
      expect(f.database.verification).toEqual(rows);
    }
    expect((await f.call(p.path, p.body, undefined, "fresh-first")).headers.has("set-cookie")).toBe(true);
    p = await proof(f, magic);
    const replay = await f.call(p.path, p.body, undefined, "fresh-first");
    expect(replay.headers.has("set-cookie")).toBe(false); expect(f.database.session).toHaveLength(1);
    expect(f.database.verification).toHaveLength(1);
    // Exercise the browser confirmation form's query field, not only the API header.
    const success = magic ? await f.call(`${p.path}&cf-turnstile-response=fresh-second`, undefined, undefined, null)
      : await f.call(p.path, { ...p.body!, turnstileToken: "fresh-second" }, undefined, null);
    expect(success.headers.has("set-cookie")).toBe(true); expect(f.database.session).toHaveLength(2);
    expect(f.challenge.calls.some(c => c.action === "email_login_redeem")).toBe(true);
  }
});

test("native magic redirects use canonical app URLs for success, error and omitted callbacks with hosted login", async () => {
  for (const callback of ["/designs", undefined]) {
    const f = loginFixture({ AUTH_MAGIC_LINK_ENABLED: "true", AUTH_HOSTED_LOGIN_ENABLED: "true" }); f.addUser();
    const p = await proof(f, true), url = new URL(`${loginEnvironment.BETTER_AUTH_URL}/api/auth/${p.path}`);
    url.searchParams.delete("callbackURL");
    if (callback) url.searchParams.set("callbackURL", callback);
    url.searchParams.set("errorCallbackURL", "/login-error");
    const path = url.href.split("/api/auth/")[1]!;
    const success = await f.call(path);
    expect(success.headers.get("location")).toBe(`http://localhost:5173${callback ?? "/"}`);
    const failure = await f.call(path);
    expect(failure.headers.get("location")).toBe("http://localhost:5173/login-error?error=INVALID_TOKEN");
    const defaults = await f.call("magic-link/verify?token=invalid");
    expect(defaults.headers.get("location")).toBe("http://localhost:5173/?error=INVALID_TOKEN");
  }
});

test("production admission caps both login lifetimes and persists only encrypted request metadata", async () => {
  const f = loginFixture({ AUTH_MAGIC_LINK_ENABLED: "true", AUTH_EMAIL_OTP_ENABLED: "true" });
  const clock = spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  try {
    for (const [path, maximum] of [["sign-in/magic-link", 900_000], ["email-otp/send-verification-otp", 600_000]] as const) {
      await f.call(path, { email: "absent@example.test", type: "sign-in" });
      const row = f.intents.at(-1);
      expect(row.expiresAt.getTime() - Date.now()).toBe(maximum);
      expect(Object.keys(row).sort()).toEqual(["availableAt", "expiresAt", "id", "kind", "payload", "retrySafe"]);
      expect(JSON.stringify(row)).not.toContain("absent@example.test");
      expect(await readMailPayload(row.payload, f.settings.secret)).toEqual({
        email: "absent@example.test", callbackURL: "http://localhost:5173/",
      });
      expect(f.database.verification).toHaveLength(0); expect(f.ledger).toHaveLength(0);
    }
  } finally { clock.mockRestore(); }
});

test("removing the original owner before redemption never creates a new user", async () => {
  for (const magic of [true, false]) {
    const f = loginFixture({ [magic ? "AUTH_MAGIC_LINK_ENABLED" : "AUTH_EMAIL_OTP_ENABLED"]: "true" }); f.addUser();
    const p = await proof(f, magic);
    f.database.user!.splice(0); f.database.account!.splice(0);
    const response = await f.call(p.path, p.body);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(f.database.user).toHaveLength(0); expect(f.database.session).toHaveLength(0);
  }
});

test("OTP redemption failures strip cookies and share the 750ms timing floor", async () => {
  const delays: number[] = [];
  for (const status of [400, 401, 403]) {
    const handler = accountAuthHandler(async request => {
      expect(request.headers.has("cookie")).toBe(false);
      return Response.json({ code: "fixture-native-error" }, { status });
    }, true, () => 100, async ms => { delays.push(ms); }, { magicLink: false, emailOtp: true });
    const response = await handler(new Request(`${loginEnvironment.BETTER_AUTH_URL}/api/auth/sign-in/email-otp`, {
      method: "POST", headers: { cookie: "fixture-session" }, body: "{}",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "INVALID_OTP", message: "Invalid or expired code" });
  }
  expect(delays).toEqual([750, 750, 750]);
});

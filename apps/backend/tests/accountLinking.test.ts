import { expect, test } from "bun:test";
import { loginFixture } from "./loginMethodsFixture";
import { createHmac } from "node:crypto";

async function oauth(localVerified: boolean, providerVerified: boolean, provider = "google",
  email = "victim@example.test", change?: (options: any) => void, explicit = false, direct = false) {
  const f = loginFixture({ AUTH_ACCOUNT_LINKING_ENABLED: "true", AUTH_METHOD_SETTINGS_ENABLED: "true",
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    GITHUB_CLIENT_ID: "fixture", GITHUB_CLIENT_SECRET: "fixture" }, options => {
    options.socialProviders.google.verifyIdToken = async () => true;
    change?.(options);
  });
  const local = f.addUser("victim@example.test", localVerified);
  const ctx = await f.auth.$context;
  const adapter = ctx.socialProviders.find(p => p.id === provider)!;
  adapter.validateAuthorizationCode = async () => ({ accessToken: "fixture-access-token",
    refreshToken: "fixture-refresh-token", idToken: "fixture-id-token" });
  adapter.getUserInfo = async () => ({ user: { email, emailVerified: providerVerified,
    name: "Victim" }, data: { sub: "provider-user", id: "provider-user" } });
  const oldSession = await ctx.internalAdapter.createSession(local.id);
  const signature = createHmac("sha256", f.settings.secret).update(oldSession.token).digest("base64");
  const sessionCookie = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${oldSession.token}.${signature}`)}`;
  const start = await f.call(explicit ? "link-social" : "sign-in/social", { provider, callbackURL: "/",
    ...(direct ? { idToken: { token: "fixture-id-token" } } : {}) }, explicit ? sessionCookie : undefined);
  if (direct) return { ...f, response: start, local, oldSession };
  const location = new URL((await start.json() as { url: string }).url);
  const cookie = [sessionCookie, ...start.headers.getSetCookie().map(c => c.split(";")[0])].join("; ");
  const response = await f.call(`callback/${provider}?code=fixture&state=${location.searchParams.get("state")}`, undefined, cookie);
  return { ...f, response, local, oldSession };
}

test("verified Google and GitHub link to one verified account without changing existing session authority", async () => {
  for (const provider of ["google", "github"]) {
    const f = await oauth(true, true, provider, "VICTIM@example.test");
    expect(f.response.headers.get("location")).toBe("http://localhost:5173/");
    expect(f.database.user).toHaveLength(1);
    expect(f.database.account!.filter(a => a.providerId === provider).map(a => a.userId)).toEqual([f.local.id]);
    expect(f.database.session!.find(s => s.id === f.oldSession.id)).toEqual(f.oldSession);
    expect(f.database.session!.every(s => s.userId === f.local.id)).toBe(true);
  }
});

test("explicit redirect linking requires both verified emails and preserves session authority", async () => {
  for (const provider of ["google", "github"]) {
    for (const [localVerified, providerVerified] of [[true, true], [true, false], [false, true], [false, false]]) {
      const f = await oauth(localVerified!, providerVerified!, provider, "victim@example.test", undefined, true);
      const allowed = localVerified && providerVerified;
      expect(f.database.account).toHaveLength(allowed ? 2 : 1);
      expect(f.database.user).toHaveLength(1);
      expect(f.database.session).toEqual([f.oldSession]);
      if (allowed) {
        expect(f.response.headers.get("location")).toBe("http://localhost:5173/");
        const account = f.database.account!.find(a => a.providerId === provider);
        expect(account.userId).toBe(f.local.id);
        expect(account.accessToken).not.toBe("fixture-access-token");
        expect(account.refreshToken).not.toBe("fixture-refresh-token");
        expect(account.idToken).toBe("fixture-id-token");
      } else expect(f.response.headers.get("location")).toContain("error=");
    }
  }
});

test("direct ID-token linking is refused for every verification combination", async () => {
  for (const [localVerified, providerVerified] of [[true, true], [true, false], [false, true], [false, false]]) {
    const f = await oauth(localVerified!, providerVerified!, "google", "victim@example.test", undefined, true, true);
    expect(f.response.status).toBe(400);
    expect(f.database.account).toHaveLength(1);
    expect(f.database.session).toEqual([f.oldSession]);
  }
});

test("victim OAuth never adopts attacker pre-registration or upgrades its session", async () => {
  const f = await oauth(false, true);
  expect(f.response.headers.get("location")).toContain("error=account_not_linked");
  expect(f.database.account).toHaveLength(1);
  expect(f.database.session).toEqual([f.oldSession]);
  expect(f.local.emailVerified).toBe(false);
  expect(f.response.headers.getSetCookie().some(c => c.includes("session_token"))).toBe(false);
});

test("trusted provider with email_verified=false cannot link; plus and Unicode variants do not merge", async () => {
  for (const provider of ["google", "github"]) {
    const f = await oauth(true, false, provider);
    expect(f.response.headers.get("location")).toContain("error=UNVERIFIED_ACCOUNT_LINK");
    expect(f.database.account).toHaveLength(1); expect(f.database.session).toEqual([f.oldSession]);
  }
  for (const email of ["victim+tag@example.test", "vıctim@example.test", "victim@exаmple.test"]) {
    const f = await oauth(true, true, "google", email);
    expect(f.database.account!.filter(a => a.providerId === "google").every(a => a.userId !== f.local.id)).toBe(true);
    expect(f.database.session!.find(s => s.id === f.oldSession.id)).toEqual(f.oldSession);
  }
});

test("link guard negative controls expose both takeover conditions", async () => {
  const unsafeProvider = await oauth(true, false, "google", "victim@example.test", options => {
    delete options.user;
  });
  expect(unsafeProvider.database.account).toHaveLength(2);
  const unsafeLocal = await oauth(false, true, "google", "victim@example.test", options => {
    delete options.user; options.account.accountLinking.requireLocalEmailVerified = false;
  });
  expect(unsafeLocal.database.account).toHaveLength(2);
});

import { expect, test } from "bun:test";
import { loginFixture } from "./loginMethodsFixture";

async function oauth(localVerified: boolean, providerVerified: boolean, provider = "google",
  email = "victim@example.test", change?: (options: any) => void) {
  const f = loginFixture({ AUTH_ACCOUNT_LINKING_ENABLED: "true", AUTH_METHOD_SETTINGS_ENABLED: "true",
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    GITHUB_CLIENT_ID: "fixture", GITHUB_CLIENT_SECRET: "fixture" }, change);
  const local = f.addUser("victim@example.test", localVerified);
  const ctx = await f.auth.$context;
  const adapter = ctx.socialProviders.find(p => p.id === provider)!;
  adapter.validateAuthorizationCode = async () => ({ accessToken: "fixture-provider-token" });
  adapter.getUserInfo = async () => ({ user: { email, emailVerified: providerVerified,
    name: "Victim" }, data: { sub: "provider-user", id: "provider-user" } });
  const oldSession = await ctx.internalAdapter.createSession(local.id);
  const start = await f.call("sign-in/social", { provider, callbackURL: "http://localhost:5173/" });
  const location = new URL((await start.json() as { url: string }).url);
  const cookie = start.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
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

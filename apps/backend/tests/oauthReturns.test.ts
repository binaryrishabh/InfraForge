import { expect, test } from "bun:test";
import { LOGIN_FLAGS, HOSTED_LOGIN_ORIGIN } from "../auth/settings";
import { loginFixture } from "./loginMethodsFixture";

const provider = { GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture" };

async function startOAuth(f: ReturnType<typeof loginFixture>, callbacks: object = {}) {
  const start = await f.call("sign-in/social", { provider: "google", ...callbacks });
  expect(start.status).toBe(200);
  const url = new URL((await start.json() as { url: string }).url);
  const state = url.searchParams.get("state")!;
  expect(state).toBeTruthy();
  const cookie = start.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  return { state, cookie };
}

test("strict OAuth fallback stays on an app origin for missing, invalid and expired native state", async () => {
  for (const flags of [
    ...LOGIN_FLAGS.map(flag => ({ [flag]: "true" })),
    { AUTH_ACCOUNT_LINKING_ENABLED: "true", AUTH_HOSTED_LOGIN_ENABLED: "true" },
  ]) {
    for (const scenario of ["missing", "invalid", "expired"]) {
      const f = loginFixture({ ...provider, ...flags });
      let suffix = scenario === "invalid" ? "&state=invalid-state" : "", cookie: string | undefined;
      if (scenario === "expired") {
        const flow = await startOAuth(f);
        suffix = `&state=${flow.state}`; cookie = flow.cookie;
        expect(f.database.verification).toHaveLength(1);
        f.database.verification![0].expiresAt = new Date(0);
        const value = JSON.parse(f.database.verification![0].value);
        value.expiresAt = 0;
        f.database.verification![0].value = JSON.stringify(value);
      }
      const response = await f.call(`callback/google?error=access_denied${suffix}`, undefined, cookie);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`http://localhost:5173/?error=${
        scenario === "missing" ? "state_not_found" : "state_mismatch"}`);
      expect(f.database.user).toHaveLength(0);
      expect(f.database.account).toHaveLength(0);
      expect(f.database.session).toHaveLength(0);
      expect(response.headers.getSetCookie().some(c => c.includes("session_token"))).toBe(false);
    }
  }
});

test("native OAuth valid state retains canonical success and error returns with hosted login", async () => {
  for (const outcome of ["success", "error"]) {
    for (const explicit of [false, true]) {
      const f = loginFixture({ ...provider, AUTH_ACCOUNT_LINKING_ENABLED: "true", AUTH_HOSTED_LOGIN_ENABLED: "true" });
      expect(f.settings.origins).toContain(HOSTED_LOGIN_ORIGIN);
      expect(f.settings.returnOrigins).not.toContain(HOSTED_LOGIN_ORIGIN);
      const local = f.addUser();
      const ctx = await f.auth.$context;
      const google = ctx.socialProviders.find(p => p.id === "google")!;
      google.validateAuthorizationCode = async () => ({ accessToken: "fixture-access-token" });
      google.getUserInfo = async () => ({ user: { email: local.email, emailVerified: true,
        name: "Fixture" }, data: { sub: "provider-user" } });
      const { state, cookie } = await startOAuth(f, explicit
        ? { callbackURL: "/designs", errorCallbackURL: "/login", newUserCallbackURL: "/welcome" } : {});
      const response = await f.call(`callback/google?state=${state}&${
        outcome === "success" ? "code=fixture" : "error=access_denied"}`, undefined, cookie);
      expect(response.status).toBe(302);
      const path = explicit ? outcome === "success" ? "/designs" : "/login" : "/";
      expect(response.headers.get("location")).toBe(`http://localhost:5173${path}${
        outcome === "error" ? "?error=access_denied" : ""}`);
      expect(f.database.session).toHaveLength(outcome === "success" ? 1 : 0);
      expect(f.database.account).toHaveLength(outcome === "success" ? 2 : 1);
    }
  }
});

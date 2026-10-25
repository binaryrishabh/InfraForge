import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "../auth/createAuth";
import { accountAuthHandler } from "../auth/accountPolicy";
import { readAuthSettings } from "../auth/settings";
import { loginEnvironment } from "./loginMethodsFixture";

export async function compatibilityResponses(factory = createAuth, flags: Record<string, string> = {}) {
  const result = [];
  for (const emailEnabled of [false, true]) {
    const settings = readAuthSettings({ ...loginEnvironment, ...flags, ...(emailEnabled ? {
      AUTH_EMAIL_ENABLED: "true", NODE_ENV: "test", TRANSACTIONAL_EMAIL_PROVIDER: "local",
    } : {}) });
    const options = factory({} as any, settings, { allow: async () => true }, { admit: async () => {} }).options;
    const auth = betterAuth({ ...options, database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
      rateLimit: { enabled: false } });
    const handler = accountAuthHandler(auth.handler, emailEnabled, () => 0, async () => {}, settings.loginMethods);
    for (const [path, body] of [
      ["get-session", undefined], ["sign-in/email", { email: "absent@example.test", password: "fixture-long-password" }],
      ["sign-up/email", { email: "invalid", username: "!", password: "short" }],
      ["request-password-reset", { email: "absent@example.test" }],
      ["send-verification-email", { email: "absent@example.test" }],
      ["sign-in/magic-link", { email: "absent@example.test" }],
      ["email-otp/send-verification-otp", { email: "absent@example.test", type: "sign-in" }],
    ] as const) {
      const response = await handler(new Request(`${settings.baseURL}/api/auth/${path}`, {
        method: body ? "POST" : "GET", headers: { Origin: settings.origins[0]!, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      result.push({ emailEnabled, path, status: response.status,
        headers: [...response.headers].sort(), body: await response.text() });
    }
  }
  return result;
}

// The same request matrix runs against an unmodified main auth source tree when
// capturing the fixture. Record response bytes and observable policy side effects.
export async function challengeCompatibilityResponses(flags: Record<string, string> = {},
  implementation = { createAuth, readAuthSettings, accountAuthHandler }) {
  const result = [];
  const settings = implementation.readAuthSettings({ ...loginEnvironment, NODE_ENV: "test",
    AUTH_EMAIL_ENABLED: "true", TRANSACTIONAL_EMAIL_PROVIDER: "local", ...flags });
  const attempts: object[] = [], admissions: object[] = [];
  settings.accountEssentials.challenge = { verify: async (token, action, ip) => {
    attempts.push({ token, action, ip }); return token === "fixture-pass";
  } };
  const options = implementation.createAuth({} as any, settings, { allow: async () => true }, {
    admit: async (kind, email, callback) => { admissions.push({ kind, email, callback }); },
  }).options;
  const database = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({ ...options, database: memoryAdapter(database), rateLimit: { enabled: false } });
  const handler = implementation.accountAuthHandler(auth.handler, true, () => 0, async () => {}, settings.loginMethods);
  for (const path of ["sign-up/email", "request-password-reset"]) {
    for (const [name, bodyToken, header, query] of [
      ["body-only", "fixture-pass"],
      ["body-with-invalid-header", "fixture-pass", "invalid"],
      ["body-with-invalid-query", "fixture-pass", undefined, "invalid"],
      ["header-only", undefined, "fixture-pass"],
      ["query-only", undefined, undefined, "fixture-pass"],
      ["invalid-body-valid-header", "invalid", "fixture-pass"],
      ["invalid-body-valid-query", "invalid", undefined, "fixture-pass"],
      ["no-token"],
    ] as const) {
      attempts.length = 0; admissions.length = 0;
      const url = new URL(`${settings.baseURL}/api/auth/${path}`);
      if (query !== undefined) url.searchParams.set("cf-turnstile-response", query);
      const response = await handler(new Request(url.href, { method: "POST", headers: {
        Origin: settings.origins[0]!, "Content-Type": "application/json",
        ...(header === undefined ? {} : { "x-turnstile-token": header }),
      }, body: JSON.stringify({ email: "absent@example.test", username: "fixtureuser",
        password: "fixture-long-password", turnstileToken: bodyToken }) }));
      result.push({ path, name, status: response.status, headers: [...response.headers].sort(),
        body: await response.text(), attempts: [...attempts], admissions: [...admissions], database });
    }
  }
  // No usable OAuth state: all-off behavior must retain main's backend fallback.
  for (const suffix of ["", "&state=invalid-state"]) {
    const response = await handler(new Request(`${settings.baseURL}/api/auth/callback/google?error=access_denied${suffix}`));
    result.push({ path: `callback/google?error=access_denied${suffix}`, status: response.status,
      headers: [...response.headers].sort(), body: await response.text() });
  }
  return result;
}

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

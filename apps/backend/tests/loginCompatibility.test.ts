import { expect, test } from "bun:test";
import { compatibilityResponses, challengeCompatibilityResponses } from "./loginCompatibility";
import { LOGIN_FLAGS } from "../auth/settings";
import baseline from "./fixtures/loginMethodsOff.json";
import challengeBaseline from "./fixtures/loginChallengeOff.json";
import { createHmac } from "node:crypto";
import { loginEnvironment } from "./loginMethodsFixture";

// W66 deliberately adds a handoff cookie and expiring row to accepted signup.
// Verify that addition exactly, then retain the historical challenge/body checks.
function withoutVerifiedHandoffs(responses: Awaited<ReturnType<typeof challengeCompatibilityResponses>>) {
  const identifiers: string[] = [];
  return responses.map(response => {
    if (!("database" in response) || !response.database) return response;
    const cookies = response.headers.filter(([name]) => name === "set-cookie");
    if (response.path === "sign-up/email" && response.status === 200) {
      expect(cookies).toHaveLength(1);
      const cookie = cookies[0]![1]!;
      expect(cookie).toMatch(/^infraforge_signup_handoff=[A-Za-z0-9_-]{43}; Max-Age=1800; Path=\/api\/auth\/signup-handoff; HttpOnly; SameSite=Lax$/);
      const secret = cookie.split(";")[0]!.split("=")[1]!;
      const hash = createHmac("sha256", loginEnvironment.BETTER_AUTH_SECRET)
        .update(`infraforge-signup-handoff/1\0${secret}`).digest("base64url");
      identifiers.push(`signup-handoff:${hash}`);
    } else expect(cookies).toHaveLength(0);
    const rows = response.database.verification as { identifier: string; value: string; expiresAt: Date }[];
    expect(rows.map(row => row.identifier)).toEqual(identifiers);
    for (const row of rows) {
      expect(row.value).toBe("");
      expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(1700_000);
      expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(1800_000);
    }
    return { ...response, headers: response.headers.filter(([name]) => name !== "set-cookie"),
      database: { ...response.database, verification: [] } };
  });
}

test("all new flags off preserves pre-W53 response bytes, status and headers", async () => {
  expect(JSON.stringify(await compatibilityResponses())).toBe(JSON.stringify(baseline));
  expect(JSON.stringify(await compatibilityResponses(undefined, Object.fromEntries(LOGIN_FLAGS.map(flag => [flag, "false"])))))
    .toBe(JSON.stringify(baseline));
});

test("all new flags absent or false matches main with conflicting and transport-only challenges", async () => {
  for (const flags of [{}, Object.fromEntries(LOGIN_FLAGS.map(flag => [flag, "false"]))]) {
    expect(JSON.stringify(withoutVerifiedHandoffs(await challengeCompatibilityResponses(flags)))).toBe(JSON.stringify(challengeBaseline.responses));
  }
});

test("enabled email login still preserves main's body-only legacy signup and reset challenges", async () => {
  const responses = await challengeCompatibilityResponses({ AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_EMAIL_OTP_ENABLED: "true", TRANSACTIONAL_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "fixture-only",
    TRANSACTIONAL_EMAIL_FROM: "auth@example.test", TURNSTILE_DEV_BYPASS: "true" });
  expect(JSON.stringify(withoutVerifiedHandoffs(responses).filter(r => !r.path.startsWith("callback/"))))
    .toBe(JSON.stringify(challengeBaseline.responses.filter(r => !r.path.startsWith("callback/"))));
});

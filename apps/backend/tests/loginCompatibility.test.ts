import { expect, test } from "bun:test";
import { compatibilityResponses, challengeCompatibilityResponses } from "./loginCompatibility";
import { LOGIN_FLAGS } from "../auth/settings";
import baseline from "./fixtures/loginMethodsOff.json";
import challengeBaseline from "./fixtures/loginChallengeOff.json";

test("all new flags off preserves pre-W53 response bytes, status and headers", async () => {
  expect(JSON.stringify(await compatibilityResponses())).toBe(JSON.stringify(baseline));
  expect(JSON.stringify(await compatibilityResponses(undefined, Object.fromEntries(LOGIN_FLAGS.map(flag => [flag, "false"])))))
    .toBe(JSON.stringify(baseline));
});

test("all new flags absent or false matches main with conflicting and transport-only challenges", async () => {
  for (const flags of [{}, Object.fromEntries(LOGIN_FLAGS.map(flag => [flag, "false"]))]) {
    expect(JSON.stringify(await challengeCompatibilityResponses(flags))).toBe(JSON.stringify(challengeBaseline.responses));
  }
});

test("enabled email login still preserves main's body-only legacy signup and reset challenges", async () => {
  const responses = await challengeCompatibilityResponses({ AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_EMAIL_OTP_ENABLED: "true", TRANSACTIONAL_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "fixture-only",
    TRANSACTIONAL_EMAIL_FROM: "auth@example.test", TURNSTILE_DEV_BYPASS: "true" });
  expect(JSON.stringify(responses.filter(r => !r.path.startsWith("callback/"))))
    .toBe(JSON.stringify(challengeBaseline.responses.filter(r => !r.path.startsWith("callback/"))));
});

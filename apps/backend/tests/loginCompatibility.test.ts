import { expect, test } from "bun:test";
import { compatibilityResponses } from "./loginCompatibility";
import { LOGIN_FLAGS } from "../auth/settings";
import baseline from "./fixtures/loginMethodsOff.json";

test("all new flags off preserves pre-W53 response bytes, status and headers", async () => {
  expect(JSON.stringify(await compatibilityResponses())).toBe(JSON.stringify(baseline));
  expect(JSON.stringify(await compatibilityResponses(undefined, Object.fromEntries(LOGIN_FLAGS.map(flag => [flag, "false"])))))
    .toBe(JSON.stringify(baseline));
});

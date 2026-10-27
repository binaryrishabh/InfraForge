import { expect, spyOn, test } from "bun:test";
import { APIError } from "better-auth/api";
import { createLogger } from "@better-auth/core/env";
import { createAuth } from "../auth/createAuth";
import { readAuthSettings } from "../auth/settings";

test("auth logs retain safe reasons and error classes without identifiers or credentials", () => {
  const settings = readAuthSettings({ BETTER_AUTH_SECRET: "fixture-only-secret-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: "http://localhost:5173" });
  const logger = createLogger(createAuth({} as never, settings).options.logger);
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    const privateText = "email=person@example.test username=private_user token=abcdefghijklmnopqrstuvwxyz0123456789"
      + " cookie=short-cookie code=abc123 otp=123456 ip=192.0.2.12 https://example.test/?secret=private"
      + ' {"body":"private payload"}';
    logger.error(`account_not_linked ${privateText}`, new APIError("BAD_REQUEST", {
      code: "INVALID_TOKEN", message: `Invalid token ${privateText}`,
    }), { request: privateText });
    logger.error("Failed to parse state", Object.assign(new Error(privateText), { code: "state_mismatch" }));
    logger.error(new TypeError(`Connection terminated unexpectedly ${privateText}`) as never);
    logger.error("x".repeat(10000) + privateText, { message: privateText, email: "person@example.test" });
    logger.error(Object.assign(new Error(privateText), { name: privateText }) as never);
    const logged = output.mock.calls.map(call => JSON.stringify(call));
    expect(logged[0]).toContain("error");
    expect(logged[0]).toContain("account_not_linked");
    expect(logged[0]).toContain("INVALID_TOKEN");
    expect(logged[0]).toContain("APIError");
    expect(logged[1]).toContain("Failed to parse state");
    expect(logged[1]).toContain("state_mismatch");
    expect(logged[1]).toContain("Error");
    expect(logged[2]).toContain("Connection terminated unexpectedly");
    expect(logged[2]).toContain("TypeError");
    for (const line of logged) {
      expect(line.length).toBeLessThan(700);
      for (const secret of ["person@example.test", "private_user", "abcdefghijklmnopqrstuvwxyz0123456789",
        "short-cookie", "abc123", "123456", "192.0.2.12", "https://", "private payload"]) {
        expect(line).not.toContain(secret);
      }
    }
  } finally { output.mockRestore(); }
});

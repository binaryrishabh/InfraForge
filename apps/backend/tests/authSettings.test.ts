import { expect, test } from "bun:test";
import { readAuthSettings } from "../auth/settings";

const settings = { BETTER_AUTH_SECRET: "fixture-only-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: "http://localhost:5173" };
test("auth has no default secret and allows only exact origins", () => {
  for (const value of [undefined, "", "short"]) expect(() => readAuthSettings({ ...settings, BETTER_AUTH_SECRET: value })).toThrow();
  for (const value of ["*", "https://*.example.test", "http://localhost:5173/", "https://example.test/path", "null"]) {
    expect(() => readAuthSettings({ ...settings, APP_ORIGINS: value })).toThrow();
  }
  expect(readAuthSettings(settings).socialProviders).toEqual({});
  expect(() => readAuthSettings({ ...settings, GOOGLE_CLIENT_ID: "incomplete" })).toThrow();
  expect(() => readAuthSettings({ ...settings, NODE_ENV: "production" })).toThrow();
  for (const value of ["https://localhost", "https://127.0.0.1", "https://[::1]"]) {
    const production = { ...settings, NODE_ENV: "production", BETTER_AUTH_URL: "https://api.example.invalid", APP_ORIGINS: "https://app.example.invalid" };
    expect(() => readAuthSettings({ ...production, BETTER_AUTH_URL: value })).toThrow("public");
    expect(() => readAuthSettings({ ...production, APP_ORIGINS: value })).toThrow("public");
  }
});

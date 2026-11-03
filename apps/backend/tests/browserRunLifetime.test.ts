import { expect, test } from "bun:test";
import { CancelSchema } from "../browserRuns/submission";
import { lifetimeExpired, lifetimeRemainingSeconds, readOperationalLimits } from "../deployments/operationalLimits";

const limits = readOperationalLimits({});
const created = new Date("2026-11-03T10:00:00.000Z");
const at = (seconds: number) => created.getTime() + seconds * 1000;

test("the learner is told the real seconds left, consistent with when the server closes the run", () => {
  expect(limits.lifetimeSeconds).toBe(1800);
  expect(lifetimeRemainingSeconds(created, at(0), limits)).toBe(1800);
  expect(lifetimeRemainingSeconds(created, at(600), limits)).toBe(1200);
  expect(lifetimeRemainingSeconds(created, at(1799.5), limits)).toBe(0);
  expect(lifetimeRemainingSeconds(created, at(5000), limits)).toBe(0);
  // Time left reaches zero exactly when the server starts treating the run as expired.
  expect([lifetimeRemainingSeconds(created, at(1799), limits), lifetimeExpired(created, at(1799), limits)]).toEqual([1, false]);
  expect([lifetimeRemainingSeconds(created, at(1800), limits), lifetimeExpired(created, at(1800), limits)]).toEqual([0, true]);
});

test("a cancel says why only with the one known reason, and refuses anything else", () => {
  expect(CancelSchema.parse({})).toEqual({});
  expect(CancelSchema.parse({ reason: "browser-error" })).toEqual({ reason: "browser-error" });
  for (const body of [{ reason: "anything" }, { reason: "browser-error", extra: 1 }, { message: "text" }]) expect(CancelSchema.safeParse(body).success).toBe(false);
});

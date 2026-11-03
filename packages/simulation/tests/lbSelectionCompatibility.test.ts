import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched d299be5 before selection changes. Never regenerate.
const pins = [
  ["legacy", "4563650d387bec91741009e8fa75073a9ad41a39eba25e457ffe7167b2030ef8", "eb9aa86a763e44f8a2e7f7817eb1fdf5b29a0ea68955a3656e2a0a2590accebb", "2fdaf3866da45437241bb92ee777ca5c932244dd5066bfe8b678d8ddab4433c7", "55fc7c3d8854b3b78783a4072a2462037469897f94196d8c5174d21b40fc4e29"],
  ["retry-breaker", "3706e7157e5e05785aa08021de55121c2ad66ae6ad64e23a220dee3f65cb0dcb", "a1c10a919a5f795d20ad263f3102de3bfdf9284c3007bc320b5a435ccc01b6bb", "032f2a0464eac5c09315da1f4d59e2f67a4ca0d64bd3e1bb81fc7fe51068d26b", "7b46bc22eead29a6e18fa91ff51194d9b8950af2c917817fc9638370832386c8"],
] as const;
for (const [mode, ...expected] of pins) test(`pre-selection contract, compiled input, assumptions and evidence stay pinned: ${mode}`, () => {
  const d = lbDesign();
  if (mode === "retry-breaker") Object.assign(d.resources[0]!, {
    retry: { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 1, retryOn: ["backendFailure"] },
    circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 100 },
  });
  const f = prepareLb(d); f.runtime.advanceTo(3000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});

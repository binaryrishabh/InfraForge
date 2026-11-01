import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched e2661635e1201ba4cb6e224dd7ea997aff1e3ce0. Never regenerate.
const accepted = [
  ["legacy-lb", "4563650d387bec91741009e8fa75073a9ad41a39eba25e457ffe7167b2030ef8", "eb9aa86a763e44f8a2e7f7817eb1fdf5b29a0ea68955a3656e2a0a2590accebb", "2fdaf3866da45437241bb92ee777ca5c932244dd5066bfe8b678d8ddab4433c7", "55fc7c3d8854b3b78783a4072a2462037469897f94196d8c5174d21b40fc4e29"],
  ["retry-breaker", "3706e7157e5e05785aa08021de55121c2ad66ae6ad64e23a220dee3f65cb0dcb", "a1c10a919a5f795d20ad263f3102de3bfdf9284c3007bc320b5a435ccc01b6bb", "032f2a0464eac5c09315da1f4d59e2f67a4ca0d64bd3e1bb81fc7fe51068d26b", "7b46bc22eead29a6e18fa91ff51194d9b8950af2c917817fc9638370832386c8"],
  ["data-depth-5", "7abcb11c147c03cc49f2fc725a1f1a09203e4cf2d565edc1eba6a2b32b9cbb1a", "b2432283e4f0258919078aee58feb474314b1e6c6a427eed300ae609d81ed2f4", "556a22dd9da4f00153411bdb2b3dc1e3dc56ee483d338f9c5b774f0e2e8ed8ca", "a275da4e415294451adaab95e2b5676c2e901eea34eddf39a65cd9973080f9dd"],
] as const;

for (const [mode, ...pins] of accepted) test(`pre-admission contract, compiled input, assumptions and evidence stay frozen: ${mode}`, () => {
  const d = mode === "data-depth-5" ? keyspaceDesign(10) : lbDesign();
  if (mode === "retry-breaker") Object.assign(d.resources[0]!, {
    retry: { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 1, retryOn: ["backendFailure"] },
    circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 100 },
  });
  if (mode === "data-depth-5") d.resources[2]!.dbConcurrency = { version: 1, activeQueries: 1, queuedQueries: 2 };
  const f = mode === "data-depth-5" ? prepareKeyspace(d, "lb-admission-proof") : prepareLb(d);
  f.runtime.advanceTo(3000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
  if (mode !== "data-depth-5") expect(f.compiled.input.resources.find(r => r.kind === "load-balancer")).toMatchObject({ maxOutstanding: { value: 1024 }, maxPending: { value: 256 }, pendingTimeout: { value: 1000000 } });
});

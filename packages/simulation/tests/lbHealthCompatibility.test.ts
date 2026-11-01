import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched 612850e97a167b45a10009896f1ea9bbc7d2afe0. Never regenerate.
const accepted = [
  ["legacy", "4563650d387bec91741009e8fa75073a9ad41a39eba25e457ffe7167b2030ef8", "eb9aa86a763e44f8a2e7f7817eb1fdf5b29a0ea68955a3656e2a0a2590accebb", "2fdaf3866da45437241bb92ee777ca5c932244dd5066bfe8b678d8ddab4433c7", "55fc7c3d8854b3b78783a4072a2462037469897f94196d8c5174d21b40fc4e29"],
  ["admission", "ae3fff203c1896f81fda2057edd971d801ab53778b7138510d553aba98873b77", "a37918c27c182a4de253369e363d7b294e1e296c856555649c7a965cfbb723c9", "fde75d2206a2a8821211bb417b3e990c2cb23f7c3f6997c7f1e9876144439fa2", "fa65382e4121e1a1e8956b03cf994e93801242fe86cebca4c4070ce85949c5d0"],
  ["retry-breaker", "3706e7157e5e05785aa08021de55121c2ad66ae6ad64e23a220dee3f65cb0dcb", "a1c10a919a5f795d20ad263f3102de3bfdf9284c3007bc320b5a435ccc01b6bb", "032f2a0464eac5c09315da1f4d59e2f67a4ca0d64bd3e1bb81fc7fe51068d26b", "7b46bc22eead29a6e18fa91ff51194d9b8950af2c917817fc9638370832386c8"],
] as const;

for (const [mode, ...pins] of accepted) test(`pre-health contract, compiled input, assumptions and evidence stay frozen: ${mode}`, () => {
  const d = lbDesign();
  if (mode === "admission") d.resources[0]!.lbAdmission = { version: 1, maxActive: 1, maxQueued: 32, queueWaitMs: 1000 };
  if (mode === "retry-breaker") Object.assign(d.resources[0]!, {
    retry: { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 1, retryOn: ["backendFailure"] },
    circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 100 },
  });
  const f = prepareLb(d); f.runtime.advanceTo(3000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
  expect(f.compiled.input.resources.find(r => r.kind === "load-balancer")).toMatchObject({ health: {
    interval: { value: 5000000 }, timeout: { value: 1000000 }, unhealthy: { value: 1 }, healthy: { value: 1 }, operation: "health", initial: "eligible",
  } });
});

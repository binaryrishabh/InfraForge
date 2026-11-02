import { expect, test } from "bun:test";
import { tokenBucketState, takeToken, projectTokens } from "../src/model2/composition/token-bucket-core";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { loadBalancer } from "../src/model2/network/load-balancer";
import { EventKernel } from "../src/model2/time";
import { identity } from "../src/model2/workload/arrivals";
import type { pathTransport } from "../src/model2/network/transport";
import type { LoadBalancer } from "../src/model2/network/contracts";
import { createProductModel2 } from "../src/model2/product/run";

test("shared pure bucket conserves exact tokens, bounds refill, and preserves unspent refill time", () => {
  let state = tokenBucketState(3, 3, 1, 100, 0);
  for (let i = 0; i < 3; i++) { const next = takeToken(state, 0); expect(next.admitted).toBe(true); state = next.state; }
  let next = takeToken(state, 99); expect(next.admitted).toBe(false); state = next.state;
  next = takeToken(state, 100); expect(next.admitted).toBe(true); state = next.state;
  expect(projectTokens(state, 1000000).tokens).toBe(3);
  expect(state.tokens).toBe(0);
  for (const time of [150, 200, 205, 299, 300, 9999999]) {
    state = takeToken(state, time).state;
    expect(state.tokens + state.admitted).toBe(3 + state.retainedRefillTokens);
    expect(state.received).toBe(state.admitted + state.rejected);
  }
});

test("LB spends before backend work, rejects empty buckets distinctly, refills, and never refunds failure/cancellation", () => {
  const d = lbDesign(); d.resources[0]!.lbRateLimit = { version: 1, burstRequests: 2, sustainedRequestsPerSecond: 10 };
  const f = prepareLb(d), config = f.compiled.input.resources.find(r => r.kind === "load-balancer") as LoadBalancer;
  const clock = new EventKernel(10000); let backend = 0;
  const paths = new Map([[JSON.stringify(["lb", "app"]), { exchange: (_w: unknown, done: (v: unknown) => void, options?: { healthCheck?: boolean }) => {
    if (options?.healthCheck) done({ ok: true, ambiguous: false }); else { backend++; if (backend === 1) done({ ok: false, reason: "backend-rejected", ambiguous: false }); }
    return { admitted: true, state: () => "waiting", cancel: () => "cancelled" };
  } } as unknown as ReturnType<typeof pathTransport>]]);
  const lb = loadBalancer(config, clock, paths, new Map(f.compiled.input.operations.map(o => [o.id, o])), "limiter", 1000000, () => {}, undefined, "failure-cause/1");
  const work = (i: number) => ({ rootId: String(i), callId: identity(i), operation: "read", attempt: 0, offeredAt: clock.now });
  lb.accept(work(0), () => {}); const second = lb.accept(work(1), () => {}); second.cancel();
  const causes: unknown[] = []; expect(lb.accept({ ...work(2), attempt: 99 }, (_o, cause) => causes.push(cause)).admitted).toBe(false);
  expect(backend).toBe(2); expect(causes).toEqual([{ rootReason: "rate-limited", rootResource: "lb", depth: 0 }]);
  expect(lb.measure().rateLimit).toMatchObject({ received: 3, admitted: 2, rejected: 1, availableTokens: 0 });
  clock.advanceTo(100000); lb.accept(work(3), () => {}); expect(backend).toBe(3);
  expect(lb.measure().rateLimit).toMatchObject({ received: 4, admitted: 3, rejected: 1, availableTokens: 0, burstCapacity: 2, sustainedRequestsPerSecond: 10 });
});

test("normal product limiter composes with Poisson and retries, with deterministic replay", () => {
  const d = lbDesign(); d.resources[0]!.lbRateLimit = { version: 1, burstRequests: 3, sustainedRequestsPerSecond: 10 };
  d.resources[0]!.retry = { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 2, retryOn: ["backendFailure"] };
  d.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  const f = prepareLb(d); f.runtime.advanceTo(1000000); const e = f.runtime.evidence(), lb = e.network.loadBalancers[0]!;
  expect(lb.rateLimit!.admitted).toBeLessThanOrEqual(13); expect(lb.rateLimit!.rejected).toBeGreaterThan(100);
  expect(lb.rateLimit!.received).toBe(lb.rateLimit!.admitted + lb.rateLimit!.rejected);
  expect(lb.attempts).toBeLessThanOrEqual(lb.rateLimit!.admitted * 2);
  expect(e.network.trace.events.some(r => r.rootReason === "rate-limited")).toBe(true);
  const replay = createProductModel2(f.compiled); replay.advanceTo(1000000); expect(replay.evidence()).toEqual(e);
});

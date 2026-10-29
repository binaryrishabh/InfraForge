import { test, expect } from "bun:test";
import { loadBalancer } from "../src/model2/network/load-balancer";
import { networkTrace } from "../src/model2/network/trace";
import { EventKernel } from "../src/model2/time";
import type { LoadBalancer, TransportResult } from "../src/model2/network/contracts";
import type { Invocation, OperationClass, RemoteOutcome } from "../src/model2/workload/contracts";
import type { pathTransport } from "../src/model2/network/transport";
import { quantities } from "./workloadFixture";

function fixture(options: { max?: number; budget?: number; jitter?: number; timeout?: number; operations?: boolean; write?: boolean; legacy?: boolean; result?: (attempt: number) => TransportResult } = {}) {
  const { q } = quantities(), kernel = new EventKernel(10000), selected: Array<{ at: number; backend: string; work: Invocation }> = [];
  let leases = 0;
  const config: LoadBalancer = { id: "lb", kind: "load-balancer", backends: ["a", "b"], policy: "least-outstanding", maxOutstanding: q("out", 100, "count"), maxPending: q("pending", 100, "count"), pendingTimeout: q("pt", 10000, "us"),
    health: { interval: q("hi", 100000, "us"), timeout: q("ht", 100, "us"), healthy: q("yes", 1, "count"), unhealthy: q("no", 1, "count"), operation: "health", initial: "eligible" },
    retry: { ...(options.legacy ? {} : { profile: "canvas-retries/1" as const, enforceCallerDeadline: true, reserveBackoffBudget: true, preferDifferentBackend: true }), ...(options.operations ? { operations: ["read"] } : {}), maxAttempts: q("tries", options.max ?? 3, "count"), backoff: q("backoff", 100, "us"), jitter: q("jitter", options.jitter ?? 0, "ratio"), maxConcurrentRetries: q("budget", options.budget ?? 4, "count"), retryOn: ["reset", "backend-rejected"], allowAmbiguousNonIdempotent: false },
  };
  const paths = new Map(config.backends.map((backend) => [JSON.stringify(["lb", backend]), {
    exchange(work: Invocation, done: (r: TransportResult) => void) {
      let terminal = false; leases++;
      if (work.operation !== "health") selected.push({ at: kernel.now, backend, work });
      const cancel = kernel.schedule(kernel.now + 1, 1, work.callId, () => {
        terminal = true; leases--;
        done(work.operation === "health" ? { ok: true, ambiguous: false } : options.result?.(work.attempt) ?? { ok: false, reason: "reset", ambiguous: false });
      });
      return { admitted: true, state: () => terminal ? "finished" : "waiting", cancel: () => { if (terminal) return "already-finished"; terminal = true; cancel(); leases--; done({ ok: false, reason: "reset", ambiguous: false }); return "cancelled"; } };
    },
  } as ReturnType<typeof pathTransport>]));
  const op: OperationClass = { id: "read", entry: "lb", callerTimeout: q("timeout", options.timeout ?? 10000, "us"), idempotency: options.write ? "non-idempotent" : "read-only", onCallerStop: "request-cancellation" };
  const causal: unknown[] = [], trace = networkTrace(kernel, 1000, (e) => causal.push(e));
  const lb = loadBalancer(config, kernel, paths, new Map([[op.id, op]]), "retry-proof", 1000, trace.emit);
  const outcomes: RemoteOutcome[] = [];
  const accept = (id = "r") => lb.accept({ callId: JSON.stringify([id]), rootId: id, offeredAt: kernel.now, operation: "read", attempt: 1 }, (r) => outcomes.push(r));
  return { lb, kernel, selected, accept, outcomes, trace, causal, leases: () => leases };
}

test("a transient failure succeeds through a different backend on the second real attempt", () => {
  const f = fixture({ result: (n) => n === 1 ? { ok: false, reason: "reset", ambiguous: false } : { ok: true, ambiguous: false } });
  f.accept(); f.kernel.advanceTo(1000);
  expect(f.outcomes).toEqual(["completed"]); expect(f.selected.map((r) => [r.at,r.backend])).toEqual([[0,"a"],[101,"b"]]);
  expect(f.lb.measure()).toMatchObject({ attempts: 2, retries: 1, retriesWaiting: 0, activeRetries: 0 }); expect(f.leases()).toBe(0);
});
test("retry exhaustion uses exact exponential backoff and causal suppression", () => {
  const f = fixture(); f.accept(); f.kernel.advanceTo(1000);
  expect(f.selected.map((r) => r.at)).toEqual([0,101,302]); expect(f.outcomes).toEqual(["rejected"]);
  expect(f.lb.measure().suppressedByReason?.["max-attempts"]).toBe(1);
  expect(f.causal.filter((e) => (e as {kind:string}).kind === "retry-scheduled")).toHaveLength(2);
  expect(f.causal.filter((e) => (e as {kind:string}).kind === "retry-suppressed")).toHaveLength(1);
});
test("same seed yields identical bounded jitter and evidence", () => {
  const run = () => { const f = fixture({jitter:0.2}); f.accept(); f.kernel.advanceTo(1000); return {events:f.trace.measure(), selected:f.selected}; };
  const a = run(); expect(a).toEqual(run());
  const delays = a.events.events.filter((e) => e.kind === "retry-scheduled").map((e) => Number(e.detail.split(":")[1]!.replace("us","")));
  expect(delays[0]).toBeGreaterThanOrEqual(80); expect(delays[0]).toBeLessThanOrEqual(120);
  expect(delays[1]).toBeGreaterThanOrEqual(160); expect(delays[1]).toBeLessThanOrEqual(240);
});
test("backoff reservations and executing retries share one bounded budget", () => {
  const f = fixture({budget:1}); f.accept("one"); f.accept("two"); f.kernel.advanceTo(1);
  expect(f.lb.measure()).toMatchObject({retriesWaiting:1, activeRetries:0, suppressedByReason:{budget:1}});
  f.kernel.advanceTo(101); expect(f.lb.measure()).toMatchObject({retriesWaiting:0,activeRetries:1});
  f.accept("three"); f.kernel.advanceTo(1000);
  expect(f.lb.measure().retriesWaiting).toBe(0); expect(f.leases()).toBe(0);
});
for (const operations of [false,true]) test(`caller deadline stops scheduling with operations=${operations}`, () => {
  const f=fixture({timeout:100,operations}); f.accept(); f.kernel.advanceTo(1000);
  expect(f.selected).toHaveLength(1); expect(f.lb.measure().suppressedByReason?.deadline).toBe(1);
});
for (const write of [false,true]) test(`ambiguous backend rejection obeys write safety: write=${write}`, () => {
  const f=fixture({write,result:()=>({ok:false,reason:"backend-rejected",ambiguous:true})}); f.accept();f.kernel.advanceTo(1000);
  expect(f.selected).toHaveLength(write ? 1 : 3); if(write) expect(f.lb.measure().suppressedByReason?.["ambiguous-write"]).toBe(1);
});
test("cancelling backoff releases its reservation, timer and leases", () => {
  const f=fixture(); const r=f.accept(); f.kernel.advanceTo(2); expect(f.lb.measure().retriesWaiting).toBe(1);
  r.cancel(); expect(f.kernel.pending).toBe(0); expect(f.leases()).toBe(0); expect(f.lb.measure()).toMatchObject({retriesWaiting:0,activeRetries:0,active:0});
  f.kernel.advanceTo(1000); expect(f.selected).toHaveLength(1); expect(f.outcomes).toEqual(["cancelled"]);
});
test("non-retryable failure is explained only under the opt-in evidence profile", () => {
  for(const legacy of [false,true]) {
    const f=fixture({legacy,result:()=>({ok:false,reason:"pool-overflow",ambiguous:false})}); f.accept(); f.kernel.advanceTo(1000);
    expect(f.trace.measure().events.filter((e)=>e.kind==="retry-suppressed")).toHaveLength(legacy?0:1);
    if(!legacy) expect(f.lb.measure().suppressedByReason?.["non-retryable"]).toBe(1);
  }
});

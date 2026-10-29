import { expect, test } from "bun:test";
import { circuitBreaker } from "../src/model2/network/circuit-breaker";
import { pathTransport } from "../src/model2/network/transport";
import { networkLink } from "../src/model2/network/link";
import { networkTrace } from "../src/model2/network/trace";
import { EventKernel } from "../src/model2/time";
import type { Invocation, Receipt } from "../src/model2/workload/contracts";
import type { CircuitBreakerPolicy, TransportResult, FailureReason } from "../src/model2/network/contracts";
import { quantities } from "./workloadFixture";
import { networkFixture } from "./networkFixture";

const work = (id: string): Invocation => ({ callId: JSON.stringify([id]), rootId: id, attempt: 0, operation: "light", offeredAt: 0 });
function machine(threshold = 2) {
  const kernel = new EventKernel(10000), q = quantities(), causal: unknown[] = [], trace = networkTrace(kernel, 1000, (e) => causal.push(e));
  const policy: CircuitBreakerPolicy = { profile: "caller-circuit-breaker/1", failureThreshold: q.q("threshold", threshold, "count"), cooldown: q.q("cooldown", 100, "us"), maxProbes: q.q("probes", 1, "count"), successfulProbesToClose: q.q("successes", 1, "count") };
  return { kernel, policy, trace, causal, breaker: circuitBreaker("a->b", policy, kernel, trace.emit) };
}
const failure = (reason: FailureReason = "backend-rejected"): TransportResult => ({ ok: false, reason, ambiguous: true });
const success: TransportResult = { ok: true, ambiguous: false };

test("consecutive failures open; ignored outcomes leave streak, successful real calls reset it", () => {
  const f = machine();
  const finish = (id: string, result: TransportResult, cancelled = false, local = false, health = false) => f.breaker.complete(f.breaker.admit(work(id), health)!, result, cancelled, local);
  finish("one", failure()); finish("health", success, false, false, true);
  expect(f.breaker.measure().consecutiveFailures).toBe(1);
  for (const reason of ["acquire-timeout", "pool-overflow", "drained", "link-overflow", "circuit-open"] as const) finish(reason, failure(reason));
  finish("cancel", failure("reset"), true); finish("local", failure("reset"), false, true);
  expect(f.breaker.measure().consecutiveFailures).toBe(1);
  finish("success", success); expect(f.breaker.measure().consecutiveFailures).toBe(0);
  finish("external-reset", failure("reset")); finish("timeout", failure("response-timeout"));
  expect(f.breaker.measure()).toMatchObject({ state: "open", openUntil: 100, consecutiveFailures: 2 });
  expect(f.breaker.admit(work("blocked"))).toBeUndefined(); expect(f.causal.some((e) => (e as {kind:string}).kind === "breaker-transition")).toBe(true);
});

test("half-open synchronously reserves one probe; counted failure reopens for a full cooldown", () => {
  const f = machine(1); f.breaker.complete(f.breaker.admit(work("fail"))!, failure("connect-timeout"));
  f.kernel.advanceTo(100); expect(f.breaker.measure().state).toBe("half-open");
  const probe = f.breaker.admit(work("probe"))!;
  expect(f.breaker.admit(work("excess"))).toBeUndefined();
  f.kernel.advanceTo(120); f.breaker.complete(probe, failure());
  expect(f.breaker.measure()).toMatchObject({ state: "open", openUntil: 220, probeInFlight: false });
  f.kernel.advanceTo(219); expect(f.breaker.admit(work("early"))).toBeUndefined();
  f.kernel.advanceTo(220); f.breaker.complete(f.breaker.admit(work("success"))!, success);
  expect(f.breaker.measure()).toMatchObject({ state: "closed", consecutiveFailures: 0, probes: { started: 2, succeeded: 1, failed: 1 } });
});

test("cancelled or ignored probes release the slot; health obeys open and can reserve the same half-open slot", () => {
  const f = machine(1); f.breaker.complete(f.breaker.admit(work("fail"))!, failure());
  expect(f.breaker.admit(work("health-open"), true)).toBeUndefined(); f.kernel.advanceTo(100);
  f.breaker.complete(f.breaker.admit(work("cancel-probe"))!, failure("reset"), true);
  f.breaker.complete(f.breaker.admit(work("local-probe"))!, failure("pool-overflow"));
  expect(f.breaker.measure()).toMatchObject({state:"half-open",probeInFlight:false,probes:{cancelled:1,ignored:1}});
  const health = f.breaker.admit(work("health-probe"), true)!;
  expect(f.breaker.admit(work("real-excess"))).toBeUndefined(); f.breaker.complete(health, success);
  expect(f.breaker.measure().state).toBe("closed");
});

test("stale in-flight completion cannot change an open or later generation; dispose cancels timers/probes", () => {
  const f = machine(1), stale = f.breaker.admit(work("stale"))!;
  f.breaker.complete(f.breaker.admit(work("fail"))!, failure()); f.breaker.complete(stale, success);
  expect(f.breaker.measure().state).toBe("open"); expect(f.kernel.pending).toBe(1);
  f.breaker.dispose(); expect(f.kernel.pending).toBe(0); expect(f.breaker.admit(work("retired"))).toBeUndefined();
  f.breaker.startGeneration(); expect(f.breaker.measure()).toMatchObject({state:"closed",generation:1,consecutiveFailures:0});
  const fresh = f.breaker.admit(work("fresh"))!; f.breaker.complete(stale, failure()); f.breaker.complete(fresh, success);
  f.breaker.complete(f.breaker.admit(work("again"))!, failure()); f.kernel.advanceTo(100);
  f.breaker.admit(work("probe")); f.breaker.dispose(); expect(f.breaker.measure().probeInFlight).toBe(false); expect(f.kernel.pending).toBe(0);
});

function transportFixture() {
  const f = machine(1), input = networkFixture({ bytes: 0, responseBytes: 0, propagation: 0, establish: 0 }), config = input.paths[0]!;
  config.circuitBreaker = f.policy; config.pool.remoteCancellation = "request-cancellation";
  const links = new Map(input.links.map((l) => [l.id, networkLink(l, f.kernel, f.trace.emit)]));
  let delivered = 0, acquiredSessions = 0, entered = 0, budgetLive = 0, fail = true;
  const path = pathTransport(config, f.kernel, links, (_target, w, done): Receipt => {
    delivered++; let terminal = false;
    const cancel = f.kernel.schedule(f.kernel.now + 10, 2, w.callId, () => { terminal = true; done(fail ? "rejected" : "completed"); });
    return { admitted: true, state: () => terminal ? "finished" : "waiting", cancel() { if (terminal) return "already-finished"; terminal = true; cancel(); done("cancelled"); return "cancelled"; } };
  }, () => true, f.trace.emit, undefined, { open(_id, done) { acquiredSessions++; done(); return () => false; }, close() {} }, { enter() { entered++; budgetLive++; return () => { budgetLive--; }; } });
  return { ...f, path, success: () => { fail = false; }, counts: () => ({ delivered, acquiredSessions, entered, budgetLive }) };
}

test("OPEN rejects before budget, pool acquisition, connection/session and delivery; half-open admits exactly one", () => {
  const f = transportFixture(); f.path.exchange(work("one"), () => {}); f.kernel.advanceTo(10);
  const pool = f.path.measure().pool, counts = f.counts(); let result: TransportResult | undefined;
  const r = f.path.exchange(work("blocked"), (x) => { result = x; });
  expect(r.admitted).toBe(false); expect(r.state()).toBe("finished"); expect(result).toEqual({ok:false,reason:"circuit-open",ambiguous:false});
  expect(f.path.measure().pool).toEqual(pool); expect(f.counts()).toEqual(counts);
  f.kernel.advanceTo(110); f.success(); const a = f.path.exchange(work("probe"), () => {}), b = f.path.exchange(work("excess"), () => {});
  expect(a.admitted).toBe(true); expect(b.admitted).toBe(false); f.kernel.advanceTo(120);
  expect(f.path.measure().circuitBreaker).toMatchObject({state:"closed",probeInFlight:false});
  expect(f.counts().delivered).toBe(2); expect(f.counts().budgetLive).toBe(0);
});

test("path disposal settles live calls, releases budget, cancels probe/cooldown and owned work timers", () => {
  const f = transportFixture(); f.path.exchange(work("open"), () => {}); f.kernel.advanceTo(10); f.kernel.advanceTo(110);
  f.path.exchange(work("live-probe"), () => {}); f.kernel.advanceTo(110); f.path.dispose();
  expect(f.kernel.pending).toBe(0); expect(f.counts().budgetLive).toBe(0);
  expect(f.path.measure()).toMatchObject({live:0,pool:{connections:0,activeStreams:0},circuitBreaker:{disposed:true,probeInFlight:false}});
});

test("separate caller paths have isolated state and a replacement generation starts closed", () => {
  const first = transportFixture(), other = transportFixture();
  first.path.exchange(work("failure"), () => {}); first.kernel.advanceTo(10);
  expect(first.path.measure().circuitBreaker!.state).toBe("open"); expect(other.path.measure().circuitBreaker!.state).toBe("closed");
  first.path.dispose(); first.path.startGeneration(); expect(first.path.measure().circuitBreaker).toMatchObject({state:"closed",generation:1});
});

test("complete path evidence matches exact replay and event slicing", () => {
  const run = (slice: boolean) => {
    const f = transportFixture();
    const advance = (until: number) => { if (slice) { while (!f.kernel.advanceSlice(until, 1)) { /* deterministic event slices */ } } else f.kernel.advanceTo(until); };
    f.path.exchange(work("initial"), () => {}); advance(10); f.path.exchange(work("blocked"), () => {}); advance(110);
    f.success(); f.path.exchange(work("probe"), () => {}); advance(130);
    return { path: f.path.measure(), trace: f.trace.measure(), causal: f.causal };
  };
  expect(run(false)).toEqual(run(false)); expect(run(true)).toEqual(run(false));
});

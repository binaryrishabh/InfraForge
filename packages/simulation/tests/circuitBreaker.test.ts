import { loadBalancer } from "../src/model2/network/load-balancer";
import { expect, test } from "bun:test";
import { circuitBreaker } from "../src/model2/network/circuit-breaker";
import { pathTransport } from "../src/model2/network/transport";
import { networkLink } from "../src/model2/network/link";
import { networkTrace } from "../src/model2/network/trace";
import { EventKernel } from "../src/model2/time";
import type { Invocation, Receipt } from "../src/model2/workload/contracts";
import type { CircuitBreakerPolicy, TransportResult, FailureReason } from "../src/model2/network/contracts";
import { quantities } from "./workloadFixture";
import { createNetworkRuntime, type NetworkContext } from "../src/model2/network/run";
import { networkFixture, verticalFixture } from "./networkFixture";

const work = (id: string): Invocation => ({ callId: JSON.stringify([id]), rootId: id, attempt: 0, operation: "light", offeredAt: 0 });
function machine(threshold = 2) {
  const kernel = new EventKernel(10000), q = quantities(), causal: unknown[] = [], trace = networkTrace(kernel, 1000, (e) => causal.push(e));
  const policy: CircuitBreakerPolicy = { profile: "caller-circuit-breaker/1", failureThreshold: q.q("threshold", threshold, "count"), cooldown: q.q("cooldown", 100, "us"), maxProbes: q.q("probes", 1, "count"), successfulProbesToClose: q.q("successes", 1, "count") };
  return { kernel, policy, trace, causal, ledger: q.ledger, breaker: circuitBreaker("a->b", policy, kernel, trace.emit) };
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

function transportFixture(options: { timeout?: number; service?: number; streams?: number } = {}) {
  const f = machine(1), input = networkFixture({ bytes: 0, responseBytes: 0, propagation: 0, establish: 0, responseTimeout: options.timeout, streams: options.streams }), config = input.paths[0]!;
  config.circuitBreaker = f.policy; config.pool.remoteCancellation = "request-cancellation";
  const links = new Map(input.links.map((l) => [l.id, networkLink(l, f.kernel, f.trace.emit)]));
  let delivered = 0, acquiredSessions = 0, entered = 0, budgetLive = 0, fail = true;
  const path = pathTransport(config, f.kernel, links, (_target, w, done): Receipt => {
    delivered++; let terminal = false;
    const cancel = f.kernel.schedule(f.kernel.now + (options.service ?? 10), 2, w.callId, () => { terminal = true; done(fail ? "rejected" : "completed"); });
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


test("network retirement disposes owned and incoming breaker state without changing another caller path", () => {
  const input=verticalFixture({count:1,horizon:500}), f=machine();
  for(const path of input.paths) if(["lb","a","b"].includes(path.source)) path.circuitBreaker=f.policy;
  input.ledger.push(...f.ledger);
  let context: NetworkContext | undefined;
  const run=createNetworkRuntime(input,{resource:()=>undefined,install(_kernel,_trace,c){context=c;}});
  context!.retireOwner!("a");
  let paths=run.evidence().network.paths;
  expect(paths.find((p)=>p.target === "a")!.circuitBreaker!.disposed).toBe(true);
  expect(paths.find((p)=>p.target === "b")!.circuitBreaker!.disposed).toBe(false);
  expect(paths.find((p)=>p.source === "a")!.circuitBreaker!.disposed).toBe(true);
  expect(paths.find((p)=>p.source === "b")!.circuitBreaker!.disposed).toBe(false);
  const endpoint=context!.endpoint("a");
  context!.startOwner!("a"); paths=run.evidence().network.paths;
  expect(paths.find((p)=>p.target === "a")!.circuitBreaker).toMatchObject({state:"closed",generation:1,disposed:false});
  expect(context!.endpoint("a")).toEqual(endpoint); // New caller policy state cannot heal readiness.
  run.dispose();
  expect(run.evidence().network.paths.filter((p)=>p.circuitBreaker).every((p)=>p.circuitBreaker!.disposed)).toBe(true);
});

test("cooldown priority precedes an arrival at the exact boundary", () => {
  const f=machine(1); f.breaker.complete(f.breaker.admit(work("failure"))!,failure());
  let admitted=false;
  f.kernel.schedule(100,3,"same-boundary-arrival",()=>{admitted=!!f.breaker.admit(work("probe"));});
  f.kernel.advanceTo(100); expect(admitted).toBe(true); expect(f.breaker.measure().probeInFlight).toBe(true);
  f.breaker.dispose(); expect(f.kernel.pending).toBe(0);
});

test("local transport resets do not count as backend failure, external resets do", () => {
  const f=transportFixture();
  f.path.exchange(work("local"),()=>{}); f.kernel.advanceTo(0); f.path.reset(true);
  expect(f.path.measure().circuitBreaker!.state).toBe("closed");
  f.path.exchange(work("external"),()=>{}); f.kernel.advanceTo(0); f.path.reset();
  expect(f.path.measure().circuitBreaker!.state).toBe("open"); f.path.dispose();
});


test("full network evidence and breaker traces replay identically under advanceTo and advanceSlice", () => {
  const input=networkFixture({count:8,interval:100,horizon:2000,bytes:0,responseBytes:0,establish:0,propagation:0}), f=machine(1);
  input.paths[0]!.circuitBreaker=f.policy; input.ledger.push(...f.ledger);
  input.endpoints.app!.ready=false;
  const run=(slice:boolean)=>{const r=createNetworkRuntime(input); if(slice){while(!r.advanceSlice(r.horizon,3)){/* same deterministic input */}}else r.advanceTo(r.horizon);return r.evidence();};
  expect(run(false)).toEqual(run(true)); expect(run(false)).toEqual(run(false));
});

test("callers on the same clock keep independent circuits and replacement paths start closed", () => {
  const f=machine(1), other=circuitBreaker("app#1->target",f.policy,f.kernel,f.trace.emit);
  f.breaker.complete(f.breaker.admit(work("app0-fail"))!,failure());
  const accepted=other.admit(work("app1-success"))!; other.complete(accepted,success);
  expect(f.breaker.measure().state).toBe("open"); expect(other.measure().state).toBe("closed");
  f.breaker.dispose(); expect(f.kernel.pending).toBe(0);
  const replacement=circuitBreaker("a->b",f.policy,f.kernel,f.trace.emit);
  expect(replacement.measure()).toMatchObject({state:"closed",consecutiveFailures:0,probeInFlight:false});
});


test("LB health checks obey OPEN and close only by completing a reserved half-open probe", () => {
  const f=transportFixture(), {q}=quantities();
  f.path.exchange(work("first-failure"),()=>{});
  const lb=loadBalancer({id:"lb",kind:"load-balancer",backends:["app"],policy:"round-robin",maxOutstanding:q("max",10,"count"),maxPending:q("pending",10,"count"),pendingTimeout:q("pending-timeout",1000,"us"),
    health:{interval:q("interval",100,"us"),timeout:q("timeout",50,"us"),healthy:q("healthy",1,"count"),unhealthy:q("unhealthy",1,"count"),operation:"light",initial:"eligible"}},
    f.kernel,new Map([[JSON.stringify(["lb","app"]),f.path]]),new Map(),"health-proof",300,f.trace.emit);
  f.kernel.advanceTo(100); expect(f.path.measure().circuitBreaker!.state).toBe("open");
  const before=f.counts().delivered; f.kernel.advanceTo(110); expect(f.counts().delivered).toBe(before);
  f.success(); f.kernel.advanceTo(210);
  expect(f.path.measure().circuitBreaker!.state).toBe("closed");
  const probe=f.trace.measure().events.find((e)=>e.kind === "breaker-probe-start" && JSON.parse(e.detail).health === true);
  expect(probe).toBeDefined(); lb.dispose(); f.path.dispose(); expect(f.kernel.pending).toBe(0);
});


test("a timeout opens on the first terminal before a shared-lease failure cascades to another call", () => {
  const f=transportFixture({timeout:100,service:1000,streams:2});
  f.path.exchange(work("first"),()=>{}); f.path.exchange(work("second"),()=>{}); f.kernel.advanceTo(100);
  const transition=f.trace.measure().events.find((e)=>e.kind === "breaker-transition")!;
  expect(transition.root).toBe("first"); f.path.dispose();
});

import { policies, rootOf, sessionDesign, runCauseSessionStudy } from "./failureCauseStudy";
import { loadBalancer } from "../src/model2/network/load-balancer";
import { expect, test } from "bun:test";
import { carryCause, seedCause, type Cause } from "../src/model2/workload/cause";
import type { Invocation, Receipt, RemoteCompletion } from "../src/model2/workload/contracts";
import type { LoadBalancer, TransportResult } from "../src/model2/network/contracts";
import type { AsideConfig } from "../src/model2/data/contracts";
import type { CausalEvent } from "../src/model2/workload/causal";
import { EventKernel, utf8Bytes } from "../src/model2/time";
import { pathTransport } from "../src/model2/network/transport";
import { networkLink } from "../src/model2/network/link";
import { networkTrace } from "../src/model2/network/trace";
import { circuitBreaker } from "../src/model2/network/circuit-breaker";
import { createNetworkRuntime } from "../src/model2/network/run";
import { createDataRuntime } from "../src/model2/data/run";
import { cacheAside } from "../src/model2/data/aside";
import { dataFixture } from "./dataFixture";
import { networkFixture, verticalFixture } from "./networkFixture";
import { runRetryStudy } from "./retryStudy";
import { DEFAULT_CIRCUIT_BREAKER_SETTINGS } from "@infraforge/domain/resource";

/** Cause fields are additive evidence: removing them from an event leaves exactly what the run did without causes. */
const causeFree = <T extends { detail: object }>(events: T[]) => events.map(e => { const { rootReason: _r, rootResource: _s, depth: _d, ...detail } = e.detail as Record<string, unknown>; return { ...e, detail }; });
const pathShape = (evidence: { network: { paths: Array<Record<string, any>> } }) => evidence.network.paths.map(p => ({ source: p.source, target: p.target, offered: p.offered, completed: p.completed, failed: p.failed, reasons: p.reasons, breaker: p.circuitBreaker ?? null }));
const behaviour = (s: ReturnType<typeof runRetryStudy>["summary"]) => ({ originalRequests: s.originalRequests, attempts: s.attempts, retries: s.retries, suppressed: s.suppressed, caller: s.caller, databaseCalls: s.databaseCalls, databaseAdmitted: s.databaseAdmitted, databaseCommitted: s.databaseCommitted, sessionRefusals: s.sessionRefusals, responseTimeouts: s.responseTimeouts, poolOverflow: s.poolOverflow, ambiguousWrites: s.ambiguousWrites, ambiguousWriteRetries: s.ambiguousWriteRetries, drainAfterLoadFallUs: s.drainAfterLoadFallUs });

const finished: Receipt = { admitted: true, state: () => "finished", cancel: () => "already-finished" };
const work = (id: string, operation = "light"): Invocation => ({ rootId: id, callId: JSON.stringify([id]), operation, attempt: 0, offeredAt: 0 });

test("real DB session refusal survives app hop; the outer breaker still counts the app failure exactly as without causes; retry chain stays readable", () => {
  const { evidence, events } = runCauseSessionStudy();
  const terminal = events.find(e => e.kind === "attempt-terminal" && e.detail.rootReason === "session-limit")!;
  expect(terminal).toBeDefined();
  expect(terminal.detail).toMatchObject({ detail: "backend-rejected", rootResource: "db" });
  const outer = evidence.network.paths.find(p => p.source === "lb")!;
  expect(outer.reasons["backend-rejected"]).toBeGreaterThan(0);
  const root = rootOf(terminal), chain = events.filter(e => rootOf(e) === root);
  const kinds = chain.map(e => e.kind);
  for (const kind of ["caller-offered", "lb-selected", "app-dependency", "app-terminal", "transport-terminal", "attempt-terminal", "retry-scheduled"]) expect(kinds).toContain(kind);
  expect(chain.some(e => e.kind === "transport-terminal" && e.detail.detail === "session-limit")).toBe(true);
  const selections = chain.filter(e => e.kind === "lb-selected").length;
  expect(selections).toBeGreaterThanOrEqual(2);
  expect(chain.find(e => e.kind === "app-terminal")!.detail.rootReason).toBe("session-limit");
  // Causes are explanation only: the breaker behaves exactly as it does without them.
  const without = runCauseSessionStudy(false);
  // The same request makes exactly the same attempts with and without causes.
  expect(without.events.filter(e => rootOf(e) === root && e.kind === "lb-selected").length).toBe(selections);
  const off = without.evidence.network.paths.find(p => p.source === "lb")!.circuitBreaker!;
  expect(off.state).toBe("open");
  expect(outer.circuitBreaker!.state).toBe(off.state);
  expect(outer.circuitBreaker!.transitions).toEqual(off.transitions);
});

test("legacy DB refusal seeds exactly the reason it reports, including backend-rejected", () => {
  const run = createDataRuntime(sessionDesign(true), { resource: () => undefined }); run.advanceTo(run.horizon);
  const rows = run.evidence().network.trace.events as Array<{ kind: string; detail: string; rootReason?: string; rootResource?: string }>;
  expect(rows.some(e => e.kind === "transport-terminal" && e.detail === "backend-rejected" && e.rootReason === "backend-rejected" && e.rootResource === "db")).toBe(true);
});

function nested(cause = true) {
  const input = verticalFixture({ count: 2, interval: 1000, horizon: 10000, cpu: 1, bytes: 0, responseBytes: 0, propagation: 0, establish: 0, responseTimeout: 5000 });
  const p = policies(); if (cause) input.failureCauseProfile = "failure-cause/1";
  const outer = input.resources.find(r => r.kind === "load-balancer") as LoadBalancer; outer.retry = p.retry;
  const inner: LoadBalancer = { ...structuredClone(outer), id: "dep", backends: ["leaf"], retry: undefined };
  input.resources = input.resources.filter(r => r.id !== "dep"); input.resources.push(inner);
  const app = input.resources.find(r => r.kind === "compute")!; input.resources.push({ ...structuredClone(app), id: "leaf", downstream: undefined });
  input.endpoints.leaf = { alive: true, ready: true };
  const path = structuredClone(input.paths[0]!); path.id = "dep:leaf"; path.source = "dep"; path.target = "leaf"; path.request = ["dep:leaf:req"]; path.response = ["dep:leaf:res"];
  input.links.push({ ...structuredClone(input.links[0]!), id: path.request[0]!, from: "dep", to: "leaf" }, { ...structuredClone(input.links[0]!), id: path.response[0]!, from: "leaf", to: "dep" }); path.circuitBreaker = p.breaker; input.paths.push(path);
  input.ledger.push(...p.q.ledger);
  const events: CausalEvent[] = [];
  const run = createNetworkRuntime(input, { resource: () => undefined, causal: e => events.push(e), receive(target, _work, done) { if (target !== "leaf") return; done("rejected"); return finished; } });
  run.advanceTo(run.horizon);
  return { evidence: run.evidence(), events };
}
test("nested LB -> app -> inner LB open breaker: the outer retry follows its authored policy exactly as without causes; the root stays visible", () => {
  const on = nested(), off = nested(false);
  const secondRoot = rootOf(on.events.filter(e => e.kind === "caller-offered").at(-1)!);
  const terminal = on.events.find(e => rootOf(e) === secondRoot && e.kind === "attempt-terminal" && e.detail.rootReason === "circuit-open" && JSON.parse(String(e.detail.id)).at(-4) === "lb")!;
  expect(terminal).toBeDefined(); expect(terminal.detail.detail).toBe("backend-rejected");
  // Same attempts, retries and suppressions in the same order: the root cause is evidence, never a decision input.
  expect(causeFree(on.events)).toEqual(causeFree(off.events));
  expect(on.events.filter(e => e.kind === "retry-scheduled").length).toBe(off.events.filter(e => e.kind === "retry-scheduled").length);
  expect(on.events.filter(e => e.kind === "retry-suppressed").length).toBe(off.events.filter(e => e.kind === "retry-suppressed").length);
});

test("compatibility proof: the same input, seed and policies with causes disabled versus enabled behave identically; only cause evidence differs", () => {
  // The data/network study: retries and a breaker over real database session refusals.
  const on = runCauseSessionStudy(true), off = runCauseSessionStudy(false);
  expect(causeFree(on.events)).toEqual(causeFree(off.events));
  expect(pathShape(on.evidence)).toEqual(pathShape(off.evidence));
  expect(on.events.some(e => e.detail.rootReason === "session-limit")).toBe(true);
  expect(off.events.some(e => e.detail.rootReason !== undefined)).toBe(false);
});

for (const [name, run] of [
  ["canvas overload with aggressive retries and the breaker", (profiles: [] | ["failure-cause/1"]) => runRetryStudy("overload", "aggressive", 1, { circuitBreaker: DEFAULT_CIRCUIT_BREAKER_SETTINGS, adapterProfiles: profiles })],
  ["canvas overload with bounded retries and no breaker", (profiles: [] | ["failure-cause/1"]) => runRetryStudy("overload", "bounded", 1, { adapterProfiles: profiles })],
  ["canvas transient failure with bounded retries", (profiles: [] | ["failure-cause/1"]) => runRetryStudy("transient", "bounded", 1, { adapterProfiles: profiles })],
] as const) test(`compatibility proof (${name}): requests, completions, rejections, retries, breaker transitions and database work are unchanged by causes`, () => {
  const off = run([]), on = run(["failure-cause/1"]);
  expect(behaviour(on.summary)).toEqual(behaviour(off.summary));
  expect(pathShape(on.evidence)).toEqual(pathShape(off.evidence));
  expect(on.summary.caller).toEqual(off.summary.caller);
}, 180000);

test("bounded summaries saturate depth; oversize identities and unknown roots remain Unknown", () => {
  let cause = seedCause("session-limit", "db"); for (let i = 0; i < 300; i++) cause = carryCause(cause);
  expect(cause).toEqual({ rootReason: "session-limit", rootResource: "db", depth: 255 });
  expect(carryCause(seedCause(null, null))).toEqual({ rootReason: null, rootResource: null, depth: 1 });
  expect(seedCause("session-limit", "x".repeat(257))).toEqual({ rootReason: null, rootResource: null, depth: 0 });
  expect(seedCause("x".repeat(65) as "reset", "db")).toEqual({ rootReason: null, rootResource: null, depth: 0 });
});

function transport(deliver: (done: RemoteCompletion, work: Invocation, kernel: EventKernel) => void, timeout = 100, cause = true) {
  const input = networkFixture({ bytes: 0, responseBytes: 0, propagation: 0, establish: 0, responseTimeout: timeout }), kernel = new EventKernel(10000), trace = networkTrace(kernel, 1000);
  const links = new Map(input.links.map(l => [l.id, networkLink(l, kernel, trace.emit)]));
  const path = pathTransport(input.paths[0]!, kernel, links, (_target, work, done) => { deliver(done, work, kernel); return finished; }, () => true, trace.emit, undefined, undefined, undefined, cause ? "failure-cause/1" : undefined);
  return { kernel, path, trace };
}
test("bare remote rejection remains Unknown rather than inventing backend-rejected as a root", () => {
  const f = transport(done => done("rejected")); let result: TransportResult | undefined;
  f.path.exchange(work("unknown"), r => result = r); f.kernel.advanceTo(10);
  expect(result).toEqual({ ok: false, reason: "backend-rejected", ambiguous: true, cause: { rootReason: null, rootResource: null, depth: 0 } });
});
for (const local of ["timeout", "reset"] as const) test(`local ${local} wins over a late known child reply`, () => {
  const f = transport((done, _work, kernel) => { kernel.schedule(200, 2, "late", () => done("rejected", seedCause("circuit-open", "inner"))); });
  const results: TransportResult[] = []; f.path.exchange(work(local), r => results.push(r));
  f.kernel.advanceTo(50); if (local === "reset") f.path.reset(); f.kernel.advanceTo(300);
  expect(results).toEqual([{ ok: false, reason: local === "timeout" ? "response-timeout" : "reset", ambiguous: true, cause: seedCause(null, null) }]);
  expect(f.path.measure().remoteOutcomesAfterStop).toBe(1);
});

test("breaker counts the immediate reason whatever the known root; unknown root and local reasons are unchanged", () => {
  const p = policies();
  const run = (reason: TransportResult["reason"], cause: Cause | undefined) => {
    const kernel = new EventKernel(10000), trace = networkTrace(kernel, 1000);
    const breaker = circuitBreaker("outer", p.breaker, kernel, trace.emit, "lb");
    breaker.complete(breaker.admit(work("failure"))!, { ok: false, ambiguous: true, reason, ...(cause ? { cause } : {}) }); return breaker.measure().state;
  };
  expect(run("backend-rejected", seedCause("session-limit", "db"))).toBe("open");
  expect(run("backend-rejected", seedCause("circuit-open", "inner"))).toBe("open");
  expect(run("backend-rejected", seedCause(null, null))).toBe("open");
  expect(run("response-timeout", seedCause("session-limit", "db"))).toBe("open");
});

function asideFixture(mode: "fail" | "fallback" | "fill" | "invalidate") {
  const input = dataFixture({ keys: 1, coalesce: true }), config = input.resources.find(r => r.kind === "cache-aside") as AsideConfig;
  const kernel = new EventKernel(10000), pending: Array<() => void> = [];
  const aside = cacheAside(config, kernel, (target, child, done) => {
    if (target === "db") {
      pending.push(() => {
        if (mode === "fail") { done("rejected", seedCause("session-limit", "db")); return; }
        child.message!.response = { ok: true, rows: [{ key: "k0", version: 1, bytes: 64 }] }; done("completed");
      });
    } else if (mode === "fill" && (child.message!.request as { kind: string }).kind === "get") {
      child.message!.response = { ok: true, hit: false }; done("completed");
    } else done("rejected", seedCause("pool-overflow", "cache"));
    return finished;
  }, "cause");
  return { aside, pending };
}
for (const mode of ["fail", "fallback", "fill", "invalidate"] as const) test(`coalesced cache-aside ${mode} carries only terminal dependency failures`, () => {
  const f = asideFixture(mode), results: Array<{ outcome: string; cause?: Cause }> = [];
  for (const id of ["a", "b"]) f.aside.accept(work(id, mode === "invalidate" ? "heavy" : "light"), (outcome, cause) => results.push({ outcome, cause }));
  for (const complete of f.pending) complete();
  expect(results).toHaveLength(2);
  if (mode === "fail") expect(results).toEqual(Array.from({ length: 2 }, () => ({ outcome: "rejected", cause: { ...seedCause("session-limit", "db"), depth: 1 } })));
  else expect(results).toEqual(Array.from({ length: 2 }, () => ({ outcome: "completed", cause: undefined })));
  if (mode !== "invalidate") expect(f.aside.evidence().coalescedWaiters).toBe(1);
});

test("cause-enabled exact replay twice and event-sliced execution are identical", () => {
  const run = (slice: boolean) => {
    const events: CausalEvent[] = [], runtime = createDataRuntime(sessionDesign(), { resource: () => undefined, causal: e => events.push(e) });
    if (slice) while (!runtime.advanceSlice(runtime.horizon, 7)) { /* bounded event slices */ }
    else runtime.advanceTo(runtime.horizon);
    return JSON.stringify({ evidence: runtime.evidence(), events });
  };
  const a = run(false); expect(run(false)).toBe(a); expect(run(true)).toBe(a);
});

test("terminal cause scalars share existing row and UTF-8 trace budgets", () => {
  const kernel = new EventKernel(100), cause = seedCause("session-limit", "資料庫"), full = networkTrace(kernel, 10);
  full.emit("transport-terminal", "id", "backend-rejected", undefined, undefined, undefined, cause);
  const row = full.measure().events[0]!, bytes = utf8Bytes(JSON.stringify(row));
  const exact = networkTrace(kernel, 1, undefined, bytes), short = networkTrace(kernel, 1, undefined, bytes - 1);
  for (const trace of [exact, short]) trace.emit("transport-terminal", "id", "backend-rejected", undefined, undefined, undefined, cause);
  expect(exact.measure().retained).toBe(1); expect(short.measure()).toMatchObject({ retained: 0, omitted: 1 });
  expect(row).toMatchObject({ rootReason: "session-limit", rootResource: "資料庫", depth: 0 });
});

function balancerAttempt(results: TransportResult[], options?: { write?: boolean; retryOn?: LoadBalancer["retry"]; invalidate?: boolean }) {
  const input = verticalFixture(), config = structuredClone(input.resources.find(r => r.kind === "load-balancer") as LoadBalancer), kernel = new EventKernel(10000), trace = networkTrace(kernel, 1000), p = policies();
  config.backends = ["a"]; config.retry = options?.retryOn ?? p.retry;
  const operation = structuredClone(input.operations[0]!); if (options?.write) operation.idempotency = "non-idempotent";
  let current = 0;
  const path = { exchange(w: Invocation, done: (result: TransportResult) => void, exchangeOptions?: { healthCheck?: boolean }) {
    if (exchangeOptions?.healthCheck) done({ ok: true, ambiguous: false });
    else { done(results[current++]!); if (options?.invalidate) lb.invalidate("a"); }
    return finished;
  } } as ReturnType<typeof pathTransport>;
  const lb = loadBalancer(config, kernel, new Map([[JSON.stringify([config.id, "a"]), path]]), new Map([[operation.id, operation]]), "cause", 1000, trace.emit, undefined, "failure-cause/1");
  kernel.advanceTo(0); // Initial health probe; terminal callbacks remain synchronous as real breaker refusals are.
  let final: { outcome: string; cause?: Cause } | undefined;
  lb.accept(work("attempt", operation.id), (outcome, cause) => final = { outcome, cause }); kernel.advanceTo(1000);
  return { final, lb: lb.measure(), trace: trace.measure() };
}
test("LB success clears previous cause; independent local no-backend replaces previous attempt root", () => {
  const failed: TransportResult = { ok: false, reason: "backend-rejected", ambiguous: true, cause: seedCause("session-limit", "db") };
  expect(balancerAttempt([failed, { ok: true, ambiguous: false }]).final).toEqual({ outcome: "completed", cause: undefined });
  expect(balancerAttempt([failed], { invalidate: true }).final).toEqual({ outcome: "rejected", cause: seedCause(null, null) });
});
test("ambiguous writes stay suppressed and known root never adds immediate retry eligibility", () => {
  const failure: TransportResult = { ok: false, reason: "backend-rejected", ambiguous: true, cause: seedCause("session-limit", "db") };
  const write = balancerAttempt([failure], { write: true });
  expect(write.lb.attempts).toBe(1); expect(write.lb.suppressedByReason?.["ambiguous-write"]).toBe(1);
  const blocked = balancerAttempt([failure], { retryOn: { ...policies().retry!, retryOn: ["reset"] } });
  expect(blocked.lb.attempts).toBe(1); expect(blocked.lb.suppressedByReason?.["non-retryable"]).toBe(1);
});
test("LB replaces a known root with the terminal attempt's Unknown", () => {
  const result = balancerAttempt([
    { ok: false, reason: "backend-rejected", ambiguous: true, cause: seedCause("session-limit", "db") },
    { ok: false, reason: "response-timeout", ambiguous: true, cause: seedCause(null, null) },
  ]);
  expect(result.lb.attempts).toBe(2); expect(result.final?.cause).toEqual({ rootReason: null, rootResource: null, depth: 1 });
});
for (const overflow of ["link", "pool"] as const) test(`${overflow} overflow seeds the actual observed transport resource`, () => {
  const input = networkFixture({ bytes: overflow === "link" ? 1 : 0, responseBytes: 0, establish: 0, propagation: 0, pending: 0, streams: overflow === "link" ? 2 : 1 }), kernel = new EventKernel(1000), trace = networkTrace(kernel, 100);
  if (overflow === "link") input.links[0]!.bufferBytes = { ...input.links[0]!.bufferBytes, kind: "known", value: 0 };
  const links = new Map(input.links.map(l => [l.id, networkLink(l, kernel, trace.emit)]));
  const path = pathTransport(input.paths[0]!, kernel, links, () => finished, () => true, trace.emit, undefined, undefined, undefined, "failure-cause/1");
  const results: TransportResult[] = [];
  path.exchange(work("one"), r => results.push(r));
  path.exchange(work("two"), r => results.push(r));
  kernel.advanceTo(10);
  expect(results).toEqual([{ ok: false, reason: `${overflow}-overflow`, ambiguous: false, cause: seedCause(`${overflow}-overflow`, overflow === "link" ? "out" : "caller-app") }]);
});

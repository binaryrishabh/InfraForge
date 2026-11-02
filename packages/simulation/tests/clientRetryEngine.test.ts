import { expect, test } from "bun:test";
import { createWorkloadRuntime } from "../src/model2/workload/run";
import type { Invocation, RemoteCompletion, Receipt, WorkloadInput } from "../src/model2/workload/contracts";
import { seedCause, type FailureReason } from "../src/model2/workload/cause";
import type { CausalEvent } from "../src/model2/workload/causal";
import { workloadFixture, quantities } from "./workloadFixture";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { loadBalancer } from "../src/model2/network/load-balancer";
import { EventKernel } from "../src/model2/time";
import { identity } from "../src/model2/workload/arrivals";
import type { pathTransport } from "../src/model2/network/transport";
import type { LoadBalancer } from "../src/model2/network/contracts";

const receipt: Receipt = { admitted: true, state: () => "finished", cancel: () => "already-finished" };
function fixture(options: { timeout?: number; maxAttempts?: number; abandon?: number; write?: boolean } = {}) {
  const input = workloadFixture({ count: 1, timeout: options.timeout ?? 50000, horizon: 60000 });
  input.failureCauseProfile = "failure-cause/1";
  input.operations[0]!.clientRetry = { version: 1, maxAttempts: options.maxAttempts ?? 3, backoffMs: 1 };
  if (options.write) { delete input.operations[0]!.clientRetry; input.operations[0]!.idempotency = "non-idempotent"; }
  if (options.abandon) { const { q, ledger } = quantities(); input.operations[0]!.abandonAfter = q("abandon", options.abandon, "us"); input.ledger.push(...ledger); }
  return input;
}
function run(input: WorkloadInput, failure: FailureReason | null = "backend-rejected", succeedAt = Infinity) {
  const calls: Invocation[] = [], at: number[] = [], events: CausalEvent[] = [];
  const runtime = createWorkloadRuntime(input, { causal: e => events.push(e), station: (_c, _d, clock) => ({
    accept(work, done) { calls.push(work); at.push(clock.now); done(work.attempt >= succeedAt ? "completed" : "rejected", failure === null ? undefined : seedCause(failure, "app")); return receipt; },
    pause() {}, measure: () => ({ id: "app" } as never),
  }) });
  return { runtime, calls, at, events };
}

test("eligible reads retry through the same entry, keep root/deadline, double exact microsecond backoff and recover once", () => {
  const f = run(fixture(), "backend-rejected", 2); f.runtime.advanceTo(60000);
  expect(f.at).toEqual([0, 1000, 3000]);
  expect(f.calls.map(w => w.attempt)).toEqual([0, 1, 2]);
  expect(new Set(f.calls.map(w => w.rootId)).size).toBe(1);
  expect(new Set(f.calls.map(w => w.callId)).size).toBe(3);
  expect(f.calls.map(w => w.offeredAt)).toEqual([0, 0, 0]);
  expect(f.runtime.evidence().results).toMatchObject([{ outcome: "completed", responseUs: 3000 }]);
  expect(f.events.filter(e => e.kind === "caller-terminal")).toHaveLength(1);
  const stepped = run(fixture(), "backend-rejected", 2);
  while (!stepped.runtime.advanceSlice(60000, 1)) { /* bounded stepping */ }
  expect(stepped.runtime.evidence()).toEqual(f.runtime.evidence());
  expect(JSON.stringify(stepped.runtime.evidence())).toBe(JSON.stringify(f.runtime.evidence()));
});

for (const reason of ["rate-limited", "circuit-open", "session-limit", null] as const) test(`ineligible cause ${reason} never retries`, () => {
  const f = run(fixture(), reason); f.runtime.advanceTo(60000); expect(f.calls).toHaveLength(1);
  expect(f.runtime.evidence().counts.rejected).toBe(1);
  expect(f.runtime.evidence().clientRetry!.ineligibleByReason).toEqual({ [reason ?? "unknown"]: 1 });
});
test("writes never retry; eligible exhaustion and deadline-too-close give up with one root outcome", () => {
  for (const input of [fixture({ write: true }), fixture({ timeout: 1000 }), fixture({ maxAttempts: 2 })]) {
    const f = run(input); f.runtime.advanceTo(60000);
    expect(f.calls).toHaveLength(input.operations[0]!.clientRetry?.maxAttempts === 2 ? 2 : 1);
    expect(f.runtime.evidence().counts.rejected).toBe(1);
    if (input.operations[0]!.clientRetry) expect(f.runtime.evidence().clientRetry).toMatchObject({ exhausted: input.operations[0]!.clientRetry!.maxAttempts === 2 ? 1 : 0, givenUp: input.operations[0]!.clientRetry!.maxAttempts === 2 ? 0 : 1 });
    expect(f.events.filter(e => e.kind === "caller-terminal")).toHaveLength(1);
  }
});
test("abandon time prevents waiting retries; deadlines and abandonment cancel the current receipt and ignore late superseded outcomes", () => {
  const waiting = run(fixture({ abandon: 1000 })); waiting.runtime.advanceTo(60000); expect(waiting.calls).toHaveLength(1);
  for (const abandon of [undefined, 2000]) {
    const input = fixture({ timeout: 4000, abandon }); input.operations[0]!.onCallerStop = "request-cancellation";
    let cancel = 0; const callbacks: RemoteCompletion[] = [];
    const runtime = createWorkloadRuntime(input, { station: (_c, _d, clock) => ({
      accept(_work, done) {
        callbacks.push(done);
        if (callbacks.length === 1) { done("rejected", seedCause("reset", "app")); clock.schedule(1500, 2, "old-outcome", () => done("completed")); }
        else clock.schedule(5000, 2, "late-outcome", () => done("completed"));
        return { ...receipt, cancel: () => { cancel++; return "cancelled"; } };
      }, pause() {}, measure: () => ({ id: "app" } as never),
    }) });
    runtime.advanceTo(60000); const e = runtime.evidence();
    expect(callbacks).toHaveLength(2); expect(cancel).toBe(1);
    expect(e.counts.remoteOutcomesAfterCallerStop).toBe(2); expect(e.results).toHaveLength(1);
    expect(e.results[0]!.outcome).toBe(abandon ? "abandoned" : "deadline-exceeded");
    expect(e.clientRetry!.perAttemptOutcomes[1]).toMatchObject({ inFlight: 0, completed: 0, deadlineExceeded: abandon ? 0 : 1, abandoned: abandon ? 1 : 0 });
  }
});

test("client attempts crossed with internal LB tries have unique call IDs and separate ordinals", () => {
  const d = lbDesign();
  d.resources[0]!.retry = { enabled: true, maxAttempts: 2, backoffMs: 1, jitterRatio: 0, maxConcurrentRetries: 4, retryOn: ["backendFailure"] };
  const f = prepareLb(d), config = f.compiled.input.resources.find(r => r.kind === "load-balancer") as LoadBalancer;
  const clock = new EventKernel(10000), calls: Invocation[] = [];
  const paths = new Map([[JSON.stringify(["lb", "app"]), { exchange: (w: Invocation, done: (r: unknown) => void, options?: { healthCheck?: boolean }) => {
    if (options?.healthCheck) done({ ok: true, ambiguous: false });
    else { calls.push(w); done({ ok: false, reason: "backend-rejected", ambiguous: false, cause: seedCause("backend-rejected", "app") }); }
    return receipt;
  } } as unknown as ReturnType<typeof pathTransport>]]);
  const lb = loadBalancer(config, clock, paths, new Map(f.compiled.input.operations.map(o => [o.id, o])), "retry-identity", 10000, () => {}, undefined, "failure-cause/1");
  for (const attempt of [0, 1, 2]) {
    lb.accept({ rootId: "root", attempt, clientAttempt: attempt, callId: identity("root", "attempt", attempt, "entry"), operation: "read", offeredAt: 0 }, () => {});
    clock.advanceTo((attempt + 1) * 2000);
  }
  expect(calls).toHaveLength(6);
  expect(new Set(calls.map(w => w.callId)).size).toBe(6);
  expect(calls.map(w => [w.attempt, w.clientAttempt, w.lbAttempt])).toEqual([[0, 0, 1], [0, 0, 2], [1, 1, 1], [1, 1, 2], [2, 2, 1], [2, 2, 2]]);
});

test("invalid retry ownership or missing cause profile refuses before execution", () => {
  const input = fixture(); input.operations[0]!.idempotency = "non-idempotent";
  expect(() => run(input)).toThrow("read-only");
  input.operations[0]!.idempotency = "read-only"; delete input.failureCauseProfile;
  expect(() => run(input)).toThrow("failure-cause/1");
});

test("pending-event budget refuses retry timers without reporting them as scheduled", () => {
  const input = fixture(); input.limits.maxPendingEvents = 2;
  const f = run(input);
  expect(() => f.runtime.advanceTo(60000)).toThrow("pending-event budget exhausted");
  expect(f.runtime.evidence().clientRetry).toMatchObject({ totalAttempts: 1, retriesScheduled: 0, retriesIssued: 0 });
});

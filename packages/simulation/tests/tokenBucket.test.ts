import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { requestTokenBucket, type RequestTokenBucketConfig, type RequestTokenBucketState } from "../src/model2/composition/token-bucket";
import { createStackComposition } from "../src/model2/composition/run";
import type { Invocation, Receipt } from "../src/model2/workload/contracts";
import { quantities } from "./workloadFixture";
import { dataFixture } from "./dataFixture";

function config(options: { id?: string; capacity?: number; initial?: number; refill?: number; every?: number; operation?: string } = {}): RequestTokenBucketConfig {
  const q = quantities("Authored request admission policy; no provider or calibration claim");
  return { id: options.id ?? "limiter", scope: { target: "lb", ...(options.operation ? { operation: options.operation } : {}) },
    capacity: q.q("bucket.capacity", options.capacity ?? 2, "count"), initial: q.q("bucket.initial", options.initial ?? 2, "count"),
    refill: { tokens: q.q("bucket.refill", options.refill ?? 1, "count"), every: q.q("bucket.every", options.every ?? 10, "us") } };
}
const work = (id = "request", operation = "light"): Invocation => ({ rootId: id, callId: id, attempt: 0, offeredAt: 0, operation });
const receipt: Receipt = { admitted: true, state: () => "serving", cancel: () => "cancelled" };

test("scoped tokens conserve initial plus retained refill credits and reject without downstream work", () => {
  const clock = new EventKernel(100), gate = requestTokenBucket(config()).instantiate({ clock }); let calls = 0, rejected = 0;
  const send = () => gate.receive("lb", work(), outcome => { if (outcome === "rejected") rejected++; }, () => { calls++; return receipt; });
  expect(send()).toBe(receipt); expect(send()).toBe(receipt);
  const blocked = send(); expect(blocked.admitted).toBe(false); expect(blocked.cancel()).toBe("already-finished"); expect(rejected).toBe(1);
  clock.advanceTo(9); expect(send().admitted).toBe(false);
  clock.advanceTo(10); expect(send()).toBe(receipt); expect(calls).toBe(3);
  const state = gate.measure(); expect(state.received).toBe(5); expect(state.rejected).toBe(2);
  expect(state.tokens + state.admitted).toBe(2 + state.retainedRefillTokens);
  expect(clock.processed).toBe(0); expect(clock.pending).toBe(0);
});

test("other targets and operations bypass the scope without spending its tokens", () => {
  const clock = new EventKernel(100), gate = requestTokenBucket(config({ operation: "light" })).instantiate({ clock });
  gate.receive("app", work(), () => {}, () => receipt); gate.receive("lb", work("other", "heavy"), () => {}, () => receipt);
  expect(gate.measure().tokens).toBe(2); expect(gate.measure().received).toBe(0); expect(gate.measure().bypassed).toBe(2);
});

test("forwarding preserves the real cancellation receipt and never refunds an admission", () => {
  const clock = new EventKernel(100), gate = requestTokenBucket(config({ capacity: 1, initial: 1 })).instantiate({ clock }); let cancelled = 0;
  const downstream: Receipt = { admitted: true, state: () => "serving", cancel: () => { cancelled++; return "cancelled"; } };
  const forwarded = gate.receive("lb", work(), () => {}, () => downstream);
  expect(forwarded).toBe(downstream); expect(forwarded.cancel()).toBe("cancelled"); expect(cancelled).toBe(1); expect(gate.measure().tokens).toBe(0);
  expect(gate.receive("lb", work("next"), () => {}, () => downstream).admitted).toBe(false);
});

test("same-time admission follows the existing event phase/key order and cancelled events spend nothing", () => {
  const clock = new EventKernel(100), gate = requestTokenBucket(config({ capacity: 1, initial: 1 })).instantiate({ clock }), admitted: string[] = [], rejected: string[] = [];
  const offer = (id: string) => gate.receive("lb", work(id), () => rejected.push(id), () => { admitted.push(id); return receipt; });
  clock.schedule(0, 2, "b", () => offer("b")); clock.schedule(0, 2, "a", () => offer("a"));
  const cancel = clock.schedule(0, 1, "earlier", () => offer("cancelled")); cancel();
  clock.advanceTo(0); expect(admitted).toEqual(["a"]); expect(rejected).toEqual(["b"]);
});

test("measurement is pure, refill is capped and large virtual-time jumps avoid arithmetic overflow", () => {
  const clock = new EventKernel(100), module = requestTokenBucket(config({ capacity: 3, initial: 0, refill: Number.MAX_SAFE_INTEGER, every: 1 })), a = module.instantiate({ clock }), b = module.instantiate({ clock });
  clock.advanceTo(Number.MAX_SAFE_INTEGER);
  expect(a.measure().tokens).toBe(3); a.measure(); a.measure();
  a.receive("lb", work(), () => {}, () => receipt); b.receive("lb", work(), () => {}, () => receipt);
  expect(a.measure()).toEqual(b.measure()); expect(a.measure().tokens).toBe(2); expect(a.measure().retainedRefillTokens).toBe(3);
});

test("invalid, fractional and Unknown token policy inputs fail before instantiation", () => {
  for (const options of [{ capacity: 0 }, { initial: 3 }, { every: 0 }, { refill: 0 }, { initial: 0.5 }]) expect(() => requestTokenBucket(config(options)).validate()).toThrow();
  const unknown = config(); unknown.capacity = { kind: "unknown", unit: "count", reason: "Missing policy", provenance: ["missing"] };
  expect(() => requestTokenBucket(unknown).instantiate({ clock: new EventKernel(100) })).toThrow();
  const empty = config(); empty.scope.target = ""; expect(() => requestTokenBucket(empty).validate()).toThrow("scope");
});

test("token admission composes with the real first stack and observer on/off evidence stays identical", () => {
  const input = dataFixture(), policy = config({ capacity: 1, initial: 1, every: 1000000 }), observed: unknown[] = [], q = quantities();
  const ownership = { hosts: [{ id: "host", cores: q.q("host.cores", 1, "cores"), memory: q.q("host.memory", 1024, "bytes") }],
    bindings: ["app", "db", "cache"].map(resource => ({ resource, host: "host", reservedMemory: q.q(`${resource}.reservation`, 256, "bytes") })) };
  const a = createStackComposition(input, { ...ownership, plugins: [requestTokenBucket(policy)] });
  const b = createStackComposition(input, { ...ownership, plugins: [requestTokenBucket(policy)], causal: event => observed.push(event) });
  a.advanceTo(1000); a.evidence(); a.evidence(); a.advanceTo(a.horizon); b.advanceTo(b.horizon);
  const e = a.evidence(); expect(e).toEqual(b.evidence()); expect(observed.length).toBeGreaterThan(0);
  const state = e.composition.mechanisms[0] as RequestTokenBucketState;
  expect(state.admitted).toBe(1); expect(state.rejected).toBe(19); expect(e.counts.completed).toBe(1); expect(e.counts.rejected).toBe(19);
  expect(state.configuration).toEqual(policy); expect(e.composition.pluginOrder).toEqual(["limiter"]);
});

test("plug-in order is explicit and its downstream rejections do not invent token refunds", () => {
  const input = dataFixture(), first = config({ id: "first", capacity: 1, initial: 1, every: 1000000 }), second = config({ id: "second", capacity: 1, initial: 0, every: 1000000 });
  const a = createStackComposition(input, { hosts: [], bindings: [], plugins: [requestTokenBucket(first), requestTokenBucket(second)] });
  const b = createStackComposition(input, { hosts: [], bindings: [], plugins: [requestTokenBucket(second), requestTokenBucket(first)] });
  a.advanceTo(a.horizon); b.advanceTo(b.horizon);
  expect(a.evidence().composition.pluginOrder).toEqual(["first", "second"]); expect(b.evidence().composition.pluginOrder).toEqual(["second", "first"]);
  expect((a.evidence().composition.mechanisms[0] as RequestTokenBucketState).admitted).toBe(1);
  expect((b.evidence().composition.mechanisms[1] as RequestTokenBucketState).received).toBe(0);
});

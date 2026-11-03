import { expect, test } from "bun:test";
import { eventBus } from "../src/model2/eventbus/run";
import { EventKernel } from "../src/model2/time";
import { prepare, design } from "./asyncCanvas.fixture";
import type { EventBusConfig } from "../src/model2/eventbus/contracts";
import type { Deliver } from "../src/model2/compute/run";
import type { Invocation, RemoteCompletion } from "../src/model2/workload/contracts";
import { deliveryQueue } from "../src/model2/async/broker";

function setup(capacity = 2, prefix?: string, hang = false) {
  const broker = prepare(design()).compiled.input.resources.find(r => r.kind === "delivery-queue")!;
  if (broker.kind !== "delivery-queue") throw Error("queue missing");
  const q = <U extends "count" | "us">(value: number, unit: U) => ({ kind: "known" as const, value, unit, provenance: ["test"] });
  const config: EventBusConfig = { ...broker, id: "bus", kind: "event-bus", profile: "independent-pubsub/1", subscriptions: [{ id: "a-slow", target: "q1" }, { id: "b-fast", target: "q2", ...(prefix ? { keyPrefix: prefix } : {}) }], capacityMessages: q(capacity, "count"), maxAttempts: q(3, "count"), retryDelay: q(1000, "us"), deliveryTimeout: q(500, "us"), deadLetterCapacity: q(1, "count") };
  const kernel = new EventKernel(100000), calls: Array<{ target: string; work: Invocation; done: RemoteCompletion }> = [];
  let slow = false;
  const send: Deliver = (target, work, done) => {
    calls.push({ target, work, done });
    if (target === "q2" || slow) { work.message!.response = { ok: true }; done("completed"); }
    else if (!hang) done("rejected");
    return { admitted: true, state: () => "finished", cancel: () => "already-finished" };
  };
  const bus = eventBus(config, kernel, send);
  let seq = 0;
  const publish = (key = "event") => {
    const callId = JSON.stringify(["publish", seq++]);
    const work: Invocation = { rootId: key, callId, attempt: 1, operation: "write", offeredAt: kernel.now, message: { request: { kind: "publish", logicalId: key, body: { key, namespace: "uploads", objectKey: key, bytes: 128 }, delayUs: 0 } } };
    let completions = 0; bus.accept(work, () => completions++); kernel.advanceTo(kernel.now + 300);
    expect(completions).toBe(1); return work.message!.response;
  };
  return { kernel, config, bus, calls, publish, recover: () => { slow = true; } };
}
test("one publication fans out independently and failure exhausts only its subscription", () => {
  const f = setup(); f.publish(); f.kernel.advanceTo(10000);
  const e = f.bus.evidence();
  expect(e.accepted).toBe(1);
  expect(e.subscriptions[0]).toMatchObject({ accepted: 1, delivered: 0, retried: 2, pending: 0, deadLettered: 1 });
  expect(e.subscriptions[1]).toMatchObject({ accepted: 1, delivered: 1, retried: 0, pending: 0 });
  expect(f.calls.filter(c => c.target === "q2")).toHaveLength(1);
});
test("full subscription discards independently; retry success reopens its capacity", () => {
  const f = setup(1); f.publish("a"); f.publish("b");
  expect(f.bus.evidence().subscriptions[0]).toMatchObject({ accepted: 1, discarded: 1, pending: 1 });
  expect(f.bus.evidence().subscriptions[1]).toMatchObject({ delivered: 2, pending: 0 });
  f.recover(); f.kernel.advanceTo(3000); f.publish("c"); f.kernel.advanceTo(10000);
  expect(f.bus.evidence().subscriptions[0]).toMatchObject({ accepted: 2, delivered: 2, pending: 0, discarded: 1 });
});
test("explicit filters, duplicate logical publications and bounded dead-letter overflow are visible", () => {
  const f = setup(2, "order"); f.publish("order-1"); f.publish("order-1"); f.kernel.advanceTo(10000);
  expect(f.bus.evidence().subscriptions[0]).toMatchObject({ deadLettered: 1, discarded: 1, deadLetterOverflow: 1 });
  expect(f.bus.evidence().subscriptions[1].delivered).toBe(2);
  f.publish("other"); expect(f.bus.evidence().subscriptions[1].filtered).toBe(1);
});
test("deterministic stepped delivery equals one-shot delivery", () => {
  const a = setup(), b = setup(); a.publish(); b.publish();
  for (let at = 500; at <= 10000; at += 500) a.kernel.advanceTo(at);
  b.kernel.advanceTo(10000); expect(a.bus.evidence()).toEqual(b.bus.evidence());
});
test("lost confirmations time out with bounded retry and late duplicate callbacks cannot settle twice", () => {
  const f = setup(1, undefined, true); f.publish(); f.kernel.advanceTo(10000);
  const slow = f.calls.filter(c => c.target === "q1"); expect(slow).toHaveLength(3);
  expect(new Set(slow.map(c => (c.work.message!.request as { logicalId: string }).logicalId)).size).toBe(1);
  const before = f.bus.evidence();
  for (const call of slow) { call.work.message!.response = { ok: true }; call.done("completed"); call.done("completed"); }
  expect(f.bus.evidence()).toEqual(before);
  expect(before.subscriptions[0]).toMatchObject({ pending: 0, deadLettered: 1, retried: 2, delivered: 0 });
});
test("an ambiguous delivery retries the real queue and only queue deduplication suppresses duplicate ownership", () => {
  for (const deduplicatePublishes of [false, true]) {
    const config = setup().config, broker = prepare(design()).compiled.input.resources.find(r => r.kind === "delivery-queue")!;
    if (broker.kind !== "delivery-queue") throw Error("queue"); broker.deduplicatePublishes = deduplicatePublishes;
    const clock = new EventKernel(100000), queue = deliveryQueue(broker, clock); let replies = 0;
    const bus = eventBus({ ...config, subscriptions: [{ id: "one", target: "queue" }] }, clock, (_target, work, done) => queue.accept(work, outcome => { if (++replies > 1) done(outcome); }));
    const work: Invocation = { rootId: "one", callId: JSON.stringify(["one"]), attempt: 1, offeredAt: 0, operation: "write", message: { request: { kind: "publish", logicalId: "one", body: { key: "one", namespace: "uploads", objectKey: "one", bytes: 128 } } } };
    bus.accept(work, () => {}); clock.advanceTo(10000);
    expect(bus.evidence().subscriptions[0]).toMatchObject({ delivered: 1, retried: 1, pending: 0 });
    expect(queue.evidence().accepted).toBe(deduplicatePublishes ? 1 : 2);
    expect(queue.evidence().duplicatePublishes).toBe(deduplicatePublishes ? 1 : 0);
    expect(queue.evidence().messages).toHaveLength(deduplicatePublishes ? 1 : 2);
  }
});
